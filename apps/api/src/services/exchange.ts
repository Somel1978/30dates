import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MAX_ANSWER_BYTES,
  MAX_PROMPTS_PER_PICK,
  MIN_PROMPTS_PER_PICK,
  VOICE_PROMPTS,
  VOICE_PROMPT_BY_KEY,
  weekClock,
  weekClockFor,
  type ExchangeDetail,
  type ExchangeStatus,
  type ExchangeSummary,
} from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx, type Tx } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { pickVenue } from './bridge.js';
import { sealEscrowWeek } from './escrow.js';
import { loadCardProfiles, loadRevealedIdentities } from './profiles.js';

/**
 * Stage 3 + 4: the asynchronous voice Q&A and the simultaneous modality switch.
 *
 *   questions (Wed) ──Thu 00:00──▶ answering (36 h Response Clock) ──both lock──▶ released
 *                                        └──clock runs out without both locks──▶ expired
 *
 * - Each member picks 2–3 prompts for the other on Wednesday; anyone who doesn't gets two
 *   assigned when the Response Clock starts, so the other can still answer.
 * - Drafts never leave the device. Answers are uploaded once, on lock, and locking is final.
 * - Both vaults stay double-blind: nobody learns whether the other has locked, and no audio,
 *   name or photo is released until both have.
 * - The instant the second lock lands, names and photos unblur together, the match and chat
 *   open, and the First-Meet Bridge appears with a venue auto-assigned near the midpoint.
 * - An exchange the clock closes is wiped silently, audio included.
 */

type AudioType = 'audio/webm' | 'audio/ogg' | 'audio/mp4' | 'audio/wav';

/** Identify recorded audio by its magic bytes; the client-declared type is not trusted. */
export function sniffAudioType(buf: Buffer): AudioType | null {
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

const EXTENSION: Record<AudioType, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav' };

function voiceDir(ctx: AppContext): string {
  return path.join(path.resolve(ctx.config.UPLOAD_DIR), 'voice');
}

async function removeAudio(ctx: AppContext, keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => unlink(path.join(voiceDir(ctx), k)).catch(() => undefined)));
}

interface ExchangeRow {
  id: string;
  pair_hash: Buffer;
  batch_week: string;
  user_a_id: string;
  user_b_id: string;
  status: ExchangeStatus;
  questions_close_at: Date;
  answers_close_at: Date;
  user_a_locked_at: Date | null;
  user_b_locked_at: Date | null;
}

const EXCHANGE_COLUMNS =
  'id, pair_hash, batch_week, user_a_id, user_b_id, status, questions_close_at, answers_close_at, user_a_locked_at, user_b_locked_at';

async function loadForParty(tx: Tx, exchangeId: string, userId: string, lock = false): Promise<ExchangeRow> {
  const { rows } = await tx.query<ExchangeRow>(
    `SELECT ${EXCHANGE_COLUMNS} FROM voice_exchanges
      WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) ${lock ? 'FOR UPDATE' : ''}`,
    [exchangeId, userId],
  );
  const row = rows[0];
  if (!row) throw notFound('exchange_not_found', 'Exchange not found');
  return row;
}

const counterpartOf = (x: ExchangeRow, userId: string) => (x.user_a_id === userId ? x.user_b_id : x.user_a_id);
const lockedAt = (x: ExchangeRow, userId: string) => (x.user_a_id === userId ? x.user_a_locked_at : x.user_b_locked_at);

async function picksBy(tx: Tx, exchangeId: string, pickerId: string): Promise<string[]> {
  const { rows } = await tx.query<{ prompt_key: string }>(
    'SELECT prompt_key FROM voice_prompt_picks WHERE exchange_id = $1 AND picker_id = $2 ORDER BY position',
    [exchangeId, pickerId],
  );
  return rows.map((r) => r.prompt_key);
}

async function matchIdFor(tx: Tx, x: ExchangeRow): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM matches WHERE pair_hash = $1', [x.pair_hash]);
  return rows[0]?.id ?? null;
}

async function summarise(tx: Tx, rows: ExchangeRow[], userId: string): Promise<ExchangeSummary[]> {
  if (rows.length === 0) return [];
  const others = rows.map((x) => counterpartOf(x, userId));
  const profiles = await loadCardProfiles(tx, userId, others);
  const identities = await loadRevealedIdentities(
    tx,
    rows.filter((x) => x.status === 'released').map((x) => counterpartOf(x, userId)),
  );
  const out: ExchangeSummary[] = [];
  for (const x of rows) {
    const other = counterpartOf(x, userId);
    const profile = profiles.get(other);
    if (!profile) continue;
    out.push({
      id: x.id,
      status: x.status,
      counterpart: profile,
      my_pick_count: (await picksBy(tx, x.id, userId)).length,
      i_locked: lockedAt(x, userId) !== null,
      questions_close_at: x.questions_close_at.toISOString(),
      answers_close_at: x.answers_close_at.toISOString(),
      revealed: x.status === 'released' ? (identities.get(other) ?? null) : null,
      match_id: x.status === 'released' ? await matchIdFor(tx, x) : null,
    });
  }
  return out;
}

/** This week's exchanges for the dashboard. */
export async function listWeekExchanges(tx: Tx, userId: string, batchWeek: string): Promise<ExchangeSummary[]> {
  const { rows } = await tx.query<ExchangeRow>(
    `SELECT ${EXCHANGE_COLUMNS} FROM voice_exchanges
      WHERE batch_week = $2 AND (user_a_id = $1 OR user_b_id = $1)
      ORDER BY created_at, id`,
    [userId, batchWeek],
  );
  return summarise(tx, rows, userId);
}

const audioUrl = (exchangeId: string, answererId: string, promptKey: string) =>
  `/api/exchanges/${exchangeId}/audio/${answererId}/${promptKey}`;

export async function getExchange(ctx: AppContext, userId: string, exchangeId: string): Promise<ExchangeDetail> {
  return withSystemTx(ctx.db, async (tx) => {
    const x = await loadForParty(tx, exchangeId, userId);
    const other = counterpartOf(x, userId);
    const [summary] = await summarise(tx, [x], userId);
    const myPicks = await picksBy(tx, x.id, userId);
    const theirPicks = x.status === 'questions' ? [] : await picksBy(tx, x.id, other);
    const answers = await tx.query<{ answerer_id: string; prompt_key: string }>(
      'SELECT answerer_id, prompt_key FROM voice_answers WHERE exchange_id = $1',
      [x.id],
    );
    const text = (key: string) => VOICE_PROMPT_BY_KEY.get(key)?.text ?? key;
    return {
      ...summary!,
      server_now: ctx.now().toISOString(),
      prompt_bank: x.status === 'questions' ? VOICE_PROMPTS.map((p) => ({ key: p.key, vector: p.vector, text: p.text })) : [],
      my_picks: myPicks,
      questions_for_me: theirPicks.map((key) => ({ key, text: text(key) })),
      my_answers: answers.rows
        .filter((a) => a.answerer_id === userId)
        .map((a) => ({ prompt_key: a.prompt_key, text: text(a.prompt_key), audio_url: audioUrl(x.id, userId, a.prompt_key) })),
      their_answers:
        x.status === 'released'
          ? answers.rows
              .filter((a) => a.answerer_id === other)
              .map((a) => ({ prompt_key: a.prompt_key, text: text(a.prompt_key), audio_url: audioUrl(x.id, other, a.prompt_key) }))
          : [],
    };
  });
}

/** Wednesday: choose the 2–3 questions the other person will answer. Changeable until Thu 00:00. */
export async function pickPrompts(ctx: AppContext, userId: string, exchangeId: string, keys: string[]): Promise<ExchangeDetail> {
  const unique = [...new Set(keys)];
  if (unique.length < MIN_PROMPTS_PER_PICK || unique.length > MAX_PROMPTS_PER_PICK) {
    throw badRequest('invalid_picks', `Pick ${MIN_PROMPTS_PER_PICK} or ${MAX_PROMPTS_PER_PICK} questions`);
  }
  if (!unique.every((k) => VOICE_PROMPT_BY_KEY.has(k))) throw badRequest('invalid_picks', 'Unknown question');
  const now = ctx.now();
  await withSystemTx(ctx.db, async (tx) => {
    const x = await loadForParty(tx, exchangeId, userId, true);
    if (x.status !== 'questions' || now >= x.questions_close_at) {
      throw conflict('questions_closed', 'Questions closed at Thursday 00:00 (UTC)');
    }
    await tx.query('DELETE FROM voice_prompt_picks WHERE exchange_id = $1 AND picker_id = $2', [x.id, userId]);
    await tx.query(
      `INSERT INTO voice_prompt_picks (exchange_id, picker_id, position, prompt_key)
       SELECT $1, $2, ord, key FROM unnest($3::text[]) WITH ORDINALITY AS t (key, ord)`,
      [x.id, userId, unique],
    );
  });
  return getExchange(ctx, userId, exchangeId);
}

async function createMatch(tx: Tx, x: ExchangeRow, now: Date): Promise<string> {
  // Both members are inside each other's radius, so they share a zone in practice; otherwise the
  // lower UUID's zone is used deterministically for "21:00 local" style bridge rules.
  const venueId = await pickVenue(tx, x.user_a_id, x.user_b_id, 'specialty_coffee');
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO matches (pair_hash, batch_week, user_a_id, user_b_id, time_zone, venue_id, created_at)
     SELECT $1, $2, $3, $4, coalesce(a.time_zone, b.time_zone, 'UTC'), $5, $6
       FROM users a, users b WHERE a.id = $3 AND b.id = $4
     ON CONFLICT (pair_hash) DO UPDATE SET pair_hash = EXCLUDED.pair_hash
     RETURNING id`,
    [x.pair_hash, x.batch_week, x.user_a_id, x.user_b_id, venueId, now],
  );
  const matchId = rows[0]!.id;
  await tx.query('INSERT INTO chat_threads (match_id) VALUES ($1) ON CONFLICT (match_id) DO NOTHING', [matchId]);
  return matchId;
}

/**
 * Lock my answers: one recording for each question they chose for me. Final. If they have
 * already locked, this is the moment of the simultaneous release.
 */
export async function lockAnswers(
  ctx: AppContext,
  userId: string,
  exchangeId: string,
  files: { promptKey: string; data: Buffer }[],
): Promise<{ released: boolean }> {
  const now = ctx.now();
  const stored: string[] = [];
  try {
    return await withSystemTx(ctx.db, async (tx) => {
      const x = await loadForParty(tx, exchangeId, userId, true);
      if (x.status !== 'answering' || now >= x.answers_close_at) {
        throw conflict('response_clock_closed', 'The Response Clock is not running for this exchange');
      }
      if (lockedAt(x, userId)) throw conflict('already_locked', 'Your answers are already locked');

      const required = await picksBy(tx, x.id, counterpartOf(x, userId));
      const byKey = new Map(files.map((f) => [f.promptKey, f.data]));
      if (required.some((k) => !byKey.has(k)) || byKey.size !== required.length) {
        throw badRequest('answers_incomplete', 'Record one answer for each of their questions before locking');
      }

      await mkdir(voiceDir(ctx), { recursive: true });
      for (const key of required) {
        const data = byKey.get(key)!;
        if (data.length === 0 || data.length > MAX_ANSWER_BYTES) throw badRequest('invalid_audio', 'Each answer must be under 4 MB');
        const type = sniffAudioType(data);
        if (!type) throw badRequest('invalid_audio', 'That recording format is not supported');
        const storageKey = `${randomUUID()}.${EXTENSION[type]}`;
        await writeFile(path.join(voiceDir(ctx), storageKey), data, { mode: 0o600 });
        stored.push(storageKey);
        await tx.query(
          `INSERT INTO voice_answers (exchange_id, answerer_id, prompt_key, storage_key, content_type, byte_size)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [x.id, userId, key, storageKey, type, data.length],
        );
      }

      const side = x.user_a_id === userId ? 'a' : 'b';
      await tx.query(`UPDATE voice_exchanges SET user_${side}_locked_at = $2 WHERE id = $1`, [x.id, now]);
      const otherLocked = side === 'a' ? x.user_b_locked_at : x.user_a_locked_at;
      if (!otherLocked) return { released: false };

      // The simultaneous modality switch.
      await tx.query(`UPDATE voice_exchanges SET status = 'released', released_at = $2 WHERE id = $1`, [x.id, now]);
      await tx.query(
        `UPDATE escrow_vault SET revealed_at = $3
          WHERE pair_hash = $1 AND batch_week = $2 AND status = 'mutual_unlocked'`,
        [x.pair_hash, x.batch_week, now],
      );
      await createMatch(tx, x, now);
      return { released: true };
    });
  } catch (err) {
    await removeAudio(ctx, stored);
    throw err;
  }
}

/** Audio is served to the answerer after locking, and to the other party only after release. */
export async function readAnswerAudio(
  ctx: AppContext,
  viewerId: string,
  exchangeId: string,
  answererId: string,
  promptKey: string,
): Promise<{ data: Buffer; contentType: string }> {
  const row = await withSystemTx(ctx.db, async (tx) => {
    const x = await loadForParty(tx, exchangeId, viewerId);
    if (answererId !== viewerId && x.status !== 'released') return undefined;
    const { rows } = await tx.query<{ storage_key: string; content_type: string }>(
      'SELECT storage_key, content_type FROM voice_answers WHERE exchange_id = $1 AND answerer_id = $2 AND prompt_key = $3',
      [x.id, answererId, promptKey],
    );
    return rows[0];
  });
  if (!row) throw notFound('audio_not_found', 'Recording not found');
  return { data: await readFile(path.join(voiceDir(ctx), row.storage_key)), contentType: row.content_type };
}

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface TickSummary {
  sealedWeek: string | null;
  opened: number;
  started: number;
  autoPicked: number;
  expired: number;
}

/**
 * Runs every few minutes and on worker start-up; every step is idempotent:
 *  1. once selection has closed, seal this week's escrow and open an exchange per mutual pair;
 *  2. once questions close, assign two prompts to anyone who chose none and start the clock;
 *  3. once the Response Clock runs out, silently close every exchange that wasn't completed.
 */
export async function runExchangeTick(ctx: AppContext): Promise<TickSummary> {
  const now = ctx.now();
  const clock = weekClock(now);
  const summary: TickSummary = { sealedWeek: null, opened: 0, started: 0, autoPicked: 0, expired: 0 };
  const expiredKeys: string[] = [];

  await withSystemTx(ctx.db, async (tx) => {
    const lock = await tx.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('exchange_tick')) AS ok");
    if (!lock.rows[0]!.ok) return;

    // 1. Seal weeks whose selection window has closed (including any missed while offline).
    const weeks = await tx.query<{ batch_week: string }>(
      `SELECT DISTINCT batch_week FROM escrow_vault WHERE status = 'locked' AND batch_week <= $1 ORDER BY batch_week`,
      [clock.batchWeek],
    );
    for (const { batch_week } of weeks.rows) {
      if (now < weekClockFor(batch_week, now).selectionClosesAt) continue;
      await sealEscrowWeek(tx, batch_week, now);
      summary.sealedWeek = batch_week;
    }
    if (clock.phase === 'exchange_questions' || clock.phase === 'exchange_answers') {
      const opened = await tx.query(
        `INSERT INTO voice_exchanges (pair_hash, batch_week, user_a_id, user_b_id, questions_close_at, answers_close_at)
         SELECT e.pair_hash, e.batch_week, e.user_a_id, e.user_b_id, $2, $3
           FROM escrow_vault e
          WHERE e.batch_week = $1 AND e.status = 'mutual_unlocked'
         ON CONFLICT (pair_hash, batch_week) DO NOTHING`,
        [clock.batchWeek, clock.questionsCloseAt, clock.answersCloseAt],
      );
      summary.opened = opened.rowCount ?? 0;
    }

    // 2. Start the Response Clock.
    const starting = await tx.query<{ id: string; user_a_id: string; user_b_id: string }>(
      `SELECT id, user_a_id, user_b_id FROM voice_exchanges
        WHERE status = 'questions' AND questions_close_at <= $1 AND answers_close_at > $1 FOR UPDATE`,
      [now],
    );
    for (const x of starting.rows) {
      for (const picker of [x.user_a_id, x.user_b_id]) {
        if ((await picksBy(tx, x.id, picker)).length > 0) continue;
        // One everyday-rhythm question and one joy question, chosen deterministically.
        const seed = fnv1a(`${x.id}:${picker}`);
        const keys = (['rhythm', 'joy'] as const).map((v) => {
          const bank = VOICE_PROMPTS.filter((p) => p.vector === v);
          return bank[seed % bank.length]!.key;
        });
        await tx.query(
          `INSERT INTO voice_prompt_picks (exchange_id, picker_id, position, prompt_key)
           SELECT $1, $2, ord, key FROM unnest($3::text[]) WITH ORDINALITY AS t (key, ord)`,
          [x.id, picker, keys],
        );
        summary.autoPicked++;
      }
      await tx.query(`UPDATE voice_exchanges SET status = 'answering' WHERE id = $1`, [x.id]);
      summary.started++;
    }

    // 3. Close exchanges the clock ran out on; nothing is released and the audio is deleted.
    const expiring = await tx.query<{ id: string }>(
      `UPDATE voice_exchanges SET status = 'expired', expired_at = $1
        WHERE status IN ('questions', 'answering') AND answers_close_at <= $1
        RETURNING id`,
      [now],
    );
    if (expiring.rowCount) {
      const ids = expiring.rows.map((r) => r.id);
      const removed = await tx.query<{ storage_key: string }>(
        'DELETE FROM voice_answers WHERE exchange_id = ANY ($1::uuid[]) RETURNING storage_key',
        [ids],
      );
      expiredKeys.push(...removed.rows.map((r) => r.storage_key));
      summary.expired = ids.length;
    }
  });

  await removeAudio(ctx, expiredKeys);
  return summary;
}

/** Storage keys of every recording in exchanges the user is part of (for account deletion). */
export async function voiceKeysForUser(tx: Tx, userId: string): Promise<string[]> {
  const { rows } = await tx.query<{ storage_key: string }>(
    `SELECT va.storage_key FROM voice_answers va
       JOIN voice_exchanges x ON x.id = va.exchange_id
      WHERE x.user_a_id = $1 OR x.user_b_id = $1`,
    [userId],
  );
  return rows.map((r) => r.storage_key);
}

export { removeAudio as removeVoiceFiles };
