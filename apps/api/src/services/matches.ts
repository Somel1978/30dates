import {
  weekClock,
  type BridgeEventDto,
  type BridgeMode,
  type BridgeState,
  type ChatMessageDto,
  type MatchDetail,
  type MatchSummary,
} from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx, type Tx } from '../db/pool.js';
import { conflict, notFound } from '../lib/errors.js';
import { loadRevealedIdentities } from './profiles.js';

export interface MatchRow {
  id: string;
  user_a_id: string;
  user_b_id: string;
  status: MatchSummary['status'];
  time_zone: string;
  created_at: Date;
}

const MATCH_COLUMNS = 'id, user_a_id, user_b_id, status, time_zone, created_at';

export async function lockMatchForParty(tx: Tx, matchId: string, userId: string): Promise<MatchRow> {
  const { rows } = await tx.query<MatchRow>(
    `SELECT ${MATCH_COLUMNS} FROM matches WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) FOR UPDATE`,
    [matchId, userId],
  );
  const match = rows[0];
  if (!match) throw notFound('match_not_found', 'Match not found');
  return match;
}

async function loadEvents(tx: Tx, matchIds: string[], viewerId: string): Promise<Map<string, BridgeEventDto>> {
  if (matchIds.length === 0) return new Map();
  const { rows } = await tx.query<{
    id: string;
    match_id: string;
    mode: BridgeMode;
    starts_at: Date;
    duration_minutes: number;
    status: BridgeEventDto['status'];
    raincheck_requested_by: string | null;
    raincheck_proposed_starts_at: Date | null;
    raincheck_expires_at: Date | null;
    venue_id: string | null;
    venue_name: string | null;
    venue_address: string | null;
    venue_type: 'specialty_coffee' | 'wine_bar' | null;
    venue_lat: number | null;
    venue_lng: number | null;
  }>(
    `SELECT DISTINCT ON (e.match_id)
            e.id, e.match_id, e.mode, e.starts_at, e.duration_minutes, e.status,
            e.raincheck_requested_by, e.raincheck_proposed_starts_at, e.raincheck_expires_at,
            v.id AS venue_id, v.name AS venue_name, v.address AS venue_address, v.venue_type,
            ST_Y(v.geom) AS venue_lat, ST_X(v.geom) AS venue_lng
       FROM bridge_events e LEFT JOIN partner_venues v ON v.id = e.venue_id
      WHERE e.match_id = ANY ($1::uuid[])
      ORDER BY e.match_id, (e.status IN ('scheduled', 'raincheck_pending')) DESC, e.created_at DESC`,
    [matchIds],
  );
  return new Map(
    rows.map((r) => [
      r.match_id,
      {
        id: r.id,
        mode: r.mode,
        starts_at: r.starts_at.toISOString(),
        duration_minutes: r.duration_minutes,
        status: r.status,
        venue: r.venue_id
          ? {
              id: r.venue_id,
              name: r.venue_name!,
              address: r.venue_address!,
              venue_type: r.venue_type!,
              lat: r.venue_lat!,
              lng: r.venue_lng!,
            }
          : null,
        raincheck:
          r.status === 'raincheck_pending'
            ? {
                requested_by_me: r.raincheck_requested_by === viewerId,
                proposed_starts_at: r.raincheck_proposed_starts_at!.toISOString(),
                expires_at: r.raincheck_expires_at!.toISOString(),
              }
            : null,
      },
    ]),
  );
}

async function summarise(tx: Tx, matches: MatchRow[], viewerId: string): Promise<MatchSummary[]> {
  const counterpartIds = matches.map((m) => (m.user_a_id === viewerId ? m.user_b_id : m.user_a_id));
  const identities = await loadRevealedIdentities(tx, counterpartIds);
  const events = await loadEvents(tx, matches.map((m) => m.id), viewerId);
  return matches.map((m, i) => {
    const counterpartId = counterpartIds[i]!;
    const identity = identities.get(counterpartId) ?? { first_name: '', photo_ids: [] };
    return {
      id: m.id,
      status: m.status,
      time_zone: m.time_zone,
      created_at: m.created_at.toISOString(),
      counterpart: { user_id: counterpartId, ...identity },
      event: events.get(m.id) ?? null,
    };
  });
}

export async function listMatches(ctx: AppContext, userId: string): Promise<MatchSummary[]> {
  return withSystemTx(ctx.db, async (tx) => {
    const { rows } = await tx.query<MatchRow>(
      `SELECT ${MATCH_COLUMNS} FROM matches WHERE user_a_id = $1 OR user_b_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return summarise(tx, rows, userId);
  });
}

export async function getMatch(ctx: AppContext, userId: string, matchId: string): Promise<MatchDetail> {
  return withSystemTx(ctx.db, async (tx) => {
    const { rows } = await tx.query<MatchRow>(
      `SELECT ${MATCH_COLUMNS} FROM matches WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)`,
      [matchId, userId],
    );
    const match = rows[0];
    if (!match) throw notFound('match_not_found', 'Match not found');
    const [summary] = await summarise(tx, [match], userId);

    const pref = await tx.query<{ mode: BridgeMode; slots: Date[] }>(
      'SELECT mode, slots FROM bridge_preferences WHERE match_id = $1 AND user_id = $2',
      [matchId, userId],
    );
    const token = await tx.query('SELECT 1 FROM freeze_tokens WHERE user_id = $1 AND token_week = $2', [
      userId,
      weekClock(ctx.now()).batchWeek,
    ]);

    let state: BridgeState;
    if (match.status === 'expired' || match.status === 'met') state = 'closed';
    else if (match.status !== 'bridging') state = 'scheduled';
    else {
      // Both chose coffee with an overlapping slot but no partner venue covers the midpoint.
      const aligned = await tx.query(
        `SELECT 1 FROM bridge_preferences mine JOIN bridge_preferences theirs
             ON theirs.match_id = mine.match_id AND theirs.user_id <> mine.user_id
          WHERE mine.match_id = $1 AND mine.user_id = $2
            AND mine.mode = 'coffee_audit' AND theirs.mode = 'coffee_audit' AND mine.slots && theirs.slots`,
        [matchId, userId],
      );
      state = aligned.rowCount ? 'no_venue_nearby' : 'awaiting_alignment';
    }

    return {
      ...summary!,
      bridge: {
        state,
        my_preference: pref.rows[0]
          ? { mode: pref.rows[0].mode, slots: pref.rows[0].slots.map((d) => d.toISOString()) }
          : null,
      },
      freeze_token_available: token.rowCount === 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Chat (text only, silent by design)
// ---------------------------------------------------------------------------
export async function listMessages(
  ctx: AppContext,
  userId: string,
  matchId: string,
  since: Date | null,
): Promise<ChatMessageDto[]> {
  return withSystemTx(ctx.db, async (tx) => {
    const { rows } = await tx.query<{ id: string; sender_id: string; body: string; created_at: Date }>(
      `SELECT cm.id, cm.sender_id, cm.body, cm.created_at
         FROM chat_messages cm
         JOIN chat_threads t ON t.id = cm.thread_id
         JOIN matches m ON m.id = t.match_id
        WHERE m.id = $1 AND (m.user_a_id = $2 OR m.user_b_id = $2)
          AND ($3::timestamptz IS NULL OR cm.created_at > $3)
        ORDER BY cm.created_at, cm.id
        LIMIT 200`,
      [matchId, userId, since],
    );
    return rows.map((r) => ({
      id: r.id,
      sender_is_me: r.sender_id === userId,
      body: r.body,
      created_at: r.created_at.toISOString(),
    }));
  });
}

export async function sendMessage(ctx: AppContext, userId: string, matchId: string, body: string): Promise<ChatMessageDto> {
  return withSystemTx(ctx.db, async (tx) => {
    const match = await lockMatchForParty(tx, matchId, userId);
    if (match.status === 'expired') throw conflict('match_closed', 'This conversation has closed');
    const { rows } = await tx.query<{ id: string; created_at: Date }>(
      `INSERT INTO chat_messages (thread_id, sender_id, body)
       SELECT t.id, $2, $3 FROM chat_threads t WHERE t.match_id = $1
       RETURNING id, created_at`,
      [matchId, userId, body],
    );
    const row = rows[0];
    if (!row) throw notFound('thread_not_found', 'Conversation not found');
    return { id: row.id, sender_is_me: true, body, created_at: row.created_at.toISOString() };
  });
}
