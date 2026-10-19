import {
  AUDIO_LOUNGE_LOCAL_HOUR,
  BRIDGE_HORIZON_DAYS,
  BRIDGE_MODE_META,
  BRIDGING_TIMEOUT_DAYS,
  COFFEE_FIRST_LOCAL_HOUR,
  COFFEE_LAST_LOCAL_HOUR,
  RAINCHECK_ACCEPT_WINDOW_HOURS,
  RAINCHECK_MAX_SHIFT_HOURS,
  RAINCHECK_MIN_SHIFT_HOURS,
  VENUE_RADIUS_METERS,
  weekClock,
  type BridgeMode,
  type BridgeState,
} from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx, type Tx } from '../db/pool.js';
import { conflict, forbidden, unprocessable } from '../lib/errors.js';
import { addLocalDays, localParts, zonedTimeToUtc } from '../lib/tz.js';
import { lockMatchForParty, type MatchRow } from './matches.js';

const HOUR = 3_600_000;
const AUDIO_LEAD_HOURS = 2;
const COFFEE_LEAD_HOURS = 12;

function leadHours(mode: BridgeMode): number {
  return mode === 'audio_lounge' ? AUDIO_LEAD_HOURS : COFFEE_LEAD_HOURS;
}

/** Slot rules in the match's local zone; returns a reason when invalid. */
export function slotProblem(mode: BridgeMode, slot: Date, timeZone: string, now: Date): string | null {
  if (Number.isNaN(slot.getTime())) return 'not a valid timestamp';
  if (slot.getTime() < now.getTime() + leadHours(mode) * HOUR) return `must be at least ${leadHours(mode)}h ahead`;
  if (slot.getTime() > now.getTime() + BRIDGE_HORIZON_DAYS * 24 * HOUR) return `must be within ${BRIDGE_HORIZON_DAYS} days`;
  const p = localParts(slot, timeZone);
  if (p.second !== 0) return 'must start on the minute';
  if (mode === 'audio_lounge') {
    if (p.isoWeekday > 5) return 'audio lounges run on weekday evenings';
    if (p.hour !== AUDIO_LOUNGE_LOCAL_HOUR || p.minute !== 0) return `audio lounges start at ${AUDIO_LOUNGE_LOCAL_HOUR}:00`;
    return null;
  }
  if (p.minute !== 0 && p.minute !== 30) return 'coffee slots start on the hour or half hour';
  const minutes = p.hour * 60 + p.minute;
  if (minutes < COFFEE_FIRST_LOCAL_HOUR * 60 || minutes > COFFEE_LAST_LOCAL_HOUR * 60) {
    return `coffee slots start between ${COFFEE_FIRST_LOCAL_HOUR}:00 and ${COFFEE_LAST_LOCAL_HOUR}:00`;
  }
  return null;
}

function preferredVenueType(slot: Date, timeZone: string): 'specialty_coffee' | 'wine_bar' {
  return localParts(slot, timeZone).hour >= 17 ? 'wine_bar' : 'specialty_coffee';
}

/**
 * Optimal partner venue: active, within 3 km of the geographic midpoint of both members,
 * preferring the venue type that suits the slot (wine bar from 17:00), then the nearest to the
 * midpoint, then the highest curation score.
 */
export async function pickVenue(tx: Tx, userA: string, userB: string, preferred: 'specialty_coffee' | 'wine_bar') {
  const { rows } = await tx.query<{ id: string }>(
    `WITH mid AS (
       SELECT ST_Centroid(ST_Collect(a.coordinates, b.coordinates))::geography AS pt
         FROM users a, users b WHERE a.id = $1 AND b.id = $2
     )
     SELECT v.id
       FROM partner_venues v, mid
      WHERE v.is_active AND ST_DWithin(v.geom::geography, mid.pt, $3)
      ORDER BY (v.venue_type = $4::venue_type) DESC, ST_Distance(v.geom::geography, mid.pt), v.curation_score DESC, v.id
      LIMIT 1`,
    [userA, userB, VENUE_RADIUS_METERS, preferred],
  );
  return rows[0]?.id ?? null;
}

export interface BridgeOutcome {
  state: BridgeState;
}

/**
 * Store a member's private transition preference; lock the event the moment both members
 * hold the same mode and share at least one slot (earliest common slot wins).
 */
export async function setBridgePreference(
  ctx: AppContext,
  userId: string,
  matchId: string,
  mode: BridgeMode,
  rawSlots: readonly string[],
): Promise<BridgeOutcome> {
  const now = ctx.now();
  return withSystemTx(ctx.db, async (tx) => {
    const match = await lockMatchForParty(tx, matchId, userId);
    if (match.status !== 'bridging') throw conflict('bridge_closed', 'The First-Meet Bridge is already settled for this match');

    const slots = [...new Set(rawSlots.map((s) => new Date(s).getTime()))].sort((a, b) => a - b).map((t) => new Date(t));
    for (const slot of slots) {
      const problem = slotProblem(mode, slot, match.time_zone, now);
      if (problem) throw unprocessable('invalid_slot', `Slot ${slot.toISOString()} ${problem}`, { slot: rawSlots });
    }
    if (slots.length === 0) throw unprocessable('invalid_slot', 'Pick at least one time window');

    await tx.query(
      `INSERT INTO bridge_preferences (match_id, user_id, mode, slots) VALUES ($1, $2, $3, $4::timestamptz[])
       ON CONFLICT (match_id, user_id) DO UPDATE SET mode = EXCLUDED.mode, slots = EXCLUDED.slots`,
      [matchId, userId, mode, slots],
    );

    const other = await tx.query<{ mode: BridgeMode; slots: Date[] }>(
      'SELECT mode, slots FROM bridge_preferences WHERE match_id = $1 AND user_id <> $2',
      [matchId, userId],
    );
    const theirs = other.rows[0];
    if (!theirs || theirs.mode !== mode) return { state: 'awaiting_alignment' };

    const earliest = now.getTime() + leadHours(mode) * HOUR;
    const theirTimes = new Set(theirs.slots.map((d) => d.getTime()));
    const common = slots.filter((s) => theirTimes.has(s.getTime()) && s.getTime() >= earliest);
    const start = common[0];
    if (!start) return { state: 'awaiting_alignment' };

    let venueId: string | null = null;
    if (mode === 'coffee_audit') {
      venueId = await pickVenue(tx, match.user_a_id, match.user_b_id, preferredVenueType(start, match.time_zone));
      if (!venueId) return { state: 'no_venue_nearby' };
    }
    await tx.query(
      `INSERT INTO bridge_events (match_id, mode, starts_at, duration_minutes, venue_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [matchId, mode, start, BRIDGE_MODE_META[mode].minutes, venueId],
    );
    await tx.query(`UPDATE matches SET status = 'scheduled' WHERE id = $1`, [matchId]);
    return { state: 'scheduled' };
  });
}

/**
 * Raincheck target: the same local wall-clock time two or three days later (48–72 h). Audio
 * lounges prefer a weekday inside that window and fall back to the 48 h day.
 */
export function raincheckStart(mode: BridgeMode, startsAt: Date, timeZone: string): Date {
  const p = localParts(startsAt, timeZone);
  const candidates = [2, 3].map((days) => {
    const day = addLocalDays(p, days);
    return zonedTimeToUtc({ ...day, hour: p.hour, minute: p.minute }, timeZone);
  });
  const inWindow = candidates.filter((c) => {
    const shift = (c.getTime() - startsAt.getTime()) / HOUR;
    // ±1 h tolerance absorbs a DST transition inside the window.
    return shift >= RAINCHECK_MIN_SHIFT_HOURS - 1 && shift <= RAINCHECK_MAX_SHIFT_HOURS + 1;
  });
  if (mode === 'audio_lounge') {
    const weekday = inWindow.find((c) => localParts(c, timeZone).isoWeekday <= 5);
    if (weekday) return weekday;
  }
  return inWindow[0] ?? new Date(startsAt.getTime() + RAINCHECK_MIN_SHIFT_HOURS * HOUR);
}

interface LiveEvent {
  id: string;
  mode: BridgeMode;
  starts_at: Date;
  venue_id: string | null;
  status: 'scheduled' | 'raincheck_pending';
  raincheck_requested_by: string | null;
  raincheck_proposed_starts_at: Date | null;
  raincheck_expires_at: Date | null;
}

async function lockLiveEvent(tx: Tx, matchId: string): Promise<LiveEvent | undefined> {
  const { rows } = await tx.query<LiveEvent>(
    `SELECT id, mode, starts_at, venue_id, status, raincheck_requested_by, raincheck_proposed_starts_at, raincheck_expires_at
       FROM bridge_events WHERE match_id = $1 AND status IN ('scheduled', 'raincheck_pending') FOR UPDATE`,
    [matchId],
  );
  return rows[0];
}

/** Spend this week's Freeze Token to propose moving the event 48–72 h later. */
export async function requestRaincheck(ctx: AppContext, userId: string, matchId: string): Promise<void> {
  const now = ctx.now();
  await withSystemTx(ctx.db, async (tx) => {
    const match: MatchRow = await lockMatchForParty(tx, matchId, userId);
    const event = await lockLiveEvent(tx, matchId);
    if (!event || event.status !== 'scheduled') throw conflict('raincheck_unavailable', 'There is no scheduled meeting to move');
    if (event.starts_at.getTime() <= now.getTime()) throw conflict('event_already_started', 'This meeting has already started');

    const token = await tx.query(
      `INSERT INTO freeze_tokens (user_id, token_week, used_for, used_at) VALUES ($1, $2, 'raincheck', $3)
       ON CONFLICT (user_id, token_week) DO NOTHING`,
      [userId, weekClock(now).batchWeek, now],
    );
    if (token.rowCount === 0) throw conflict('freeze_token_spent', 'Your Freeze Token for this week is already used');

    const proposed = raincheckStart(event.mode, event.starts_at, match.time_zone);
    let venueId = event.venue_id;
    if (event.mode === 'coffee_audit') {
      const active = await tx.query('SELECT 1 FROM partner_venues WHERE id = $1 AND is_active', [venueId]);
      if (!active.rowCount) {
        venueId = await pickVenue(tx, match.user_a_id, match.user_b_id, preferredVenueType(proposed, match.time_zone));
        if (!venueId) throw conflict('no_venue_nearby', 'No partner venue is available near your midpoint');
      }
    }
    await tx.query(
      `UPDATE bridge_events SET
         status = 'raincheck_pending', venue_id = $2,
         raincheck_requested_by = $3, raincheck_requested_at = $4,
         raincheck_proposed_starts_at = $5,
         raincheck_expires_at = $4::timestamptz + make_interval(hours => $6),
         raincheck_count = raincheck_count + 1
       WHERE id = $1`,
      [event.id, venueId, userId, now, proposed, RAINCHECK_ACCEPT_WINDOW_HOURS],
    );
    await tx.query(`UPDATE matches SET status = 'raincheck_pending' WHERE id = $1`, [matchId]);
  });
}

/** The partner accepts the raincheck within 24 h; otherwise the maintenance job expires the match. */
export async function acceptRaincheck(ctx: AppContext, userId: string, matchId: string): Promise<void> {
  const now = ctx.now();
  await withSystemTx(ctx.db, async (tx) => {
    await lockMatchForParty(tx, matchId, userId);
    const event = await lockLiveEvent(tx, matchId);
    if (!event || event.status !== 'raincheck_pending') throw conflict('no_raincheck_pending', 'There is no raincheck to accept');
    if (event.raincheck_requested_by === userId) throw forbidden('own_raincheck', 'Your partner needs to accept this raincheck');
    if (event.raincheck_expires_at!.getTime() <= now.getTime()) throw conflict('raincheck_expired', 'This raincheck has expired');
    await tx.query(
      `UPDATE bridge_events SET
         status = 'scheduled', starts_at = raincheck_proposed_starts_at,
         raincheck_proposed_starts_at = NULL, raincheck_expires_at = NULL
       WHERE id = $1`,
      [event.id],
    );
    await tx.query(`UPDATE matches SET status = 'scheduled' WHERE id = $1`, [matchId]);
  });
}

export interface BridgeMaintenanceSummary {
  rainchecksExpired: number;
  eventsCompleted: number;
  bridgesTimedOut: number;
}

/** Every 5 minutes: expire unanswered rainchecks, complete past events, time out stalled bridges. */
export async function runBridgeMaintenance(ctx: AppContext): Promise<BridgeMaintenanceSummary> {
  const now = ctx.now();
  return withSystemTx(ctx.db, async (tx) => {
    const expired = await tx.query<{ match_id: string }>(
      `UPDATE bridge_events SET status = 'cancelled', raincheck_proposed_starts_at = NULL, raincheck_expires_at = NULL
        WHERE status = 'raincheck_pending' AND raincheck_expires_at <= $1
        RETURNING match_id`,
      [now],
    );
    if (expired.rowCount) {
      await tx.query(
        `UPDATE matches SET status = 'expired', expired_at = $2, expired_reason = 'raincheck_not_accepted'
          WHERE id = ANY ($1::uuid[]) AND status <> 'expired'`,
        [expired.rows.map((r) => r.match_id), now],
      );
    }
    const completed = await tx.query<{ match_id: string }>(
      `UPDATE bridge_events SET status = 'completed'
        WHERE status = 'scheduled' AND starts_at + make_interval(mins => duration_minutes) <= $1
        RETURNING match_id`,
      [now],
    );
    if (completed.rowCount) {
      await tx.query(`UPDATE matches SET status = 'met' WHERE id = ANY ($1::uuid[]) AND status = 'scheduled'`, [
        completed.rows.map((r) => r.match_id),
      ]);
    }
    const timedOut = await tx.query(
      `UPDATE matches SET status = 'expired', expired_at = $1, expired_reason = 'bridge_not_aligned'
        WHERE status = 'bridging' AND created_at <= $1::timestamptz - make_interval(days => $2)`,
      [now, BRIDGING_TIMEOUT_DAYS],
    );
    return {
      rainchecksExpired: expired.rowCount ?? 0,
      eventsCompleted: completed.rowCount ?? 0,
      bridgesTimedOut: timedOut.rowCount ?? 0,
    };
  });
}
