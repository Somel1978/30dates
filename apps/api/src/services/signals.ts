import { weekClock } from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx, type Tx } from '../db/pool.js';
import { conflict, notFound } from '../lib/errors.js';
import { orderedPair, pairHash } from '../lib/crypto.js';

/**
 * Sunday #1 Signal, held in blind escrow. A signal is only accepted for a revealed mutual
 * pair; when the counterpart has already signalled back, the match and its chat thread are
 * created in the same transaction. Unreciprocated signals are deleted at Monday 00:00 UTC.
 */
export async function submitSignal(
  ctx: AppContext,
  userId: string,
  targetId: string,
): Promise<{ matchId: string | null }> {
  const now = ctx.now();
  const clock = weekClock(now);
  if (clock.phase !== 'signal') {
    throw conflict('signal_window_closed', 'The #1 Signal opens Sunday 18:00 and closes at midnight (UTC)');
  }
  if (userId === targetId) throw notFound('not_in_mutual_pool', 'That person is not in your mutual pool');
  const [lo, hi] = orderedPair(userId, targetId);
  const hash = pairHash(lo, hi, ctx.config.ESCROW_PAIR_SALT);

  return withSystemTx(ctx.db, async (tx) => {
    // Serialise the two parties of this pair so simultaneous signals always meet.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended(encode($1::bytea, \'hex\'), 0))', [hash]);

    const stake = await tx.query<{ status: string; revealed_at: Date | null }>(
      'SELECT status, revealed_at FROM escrow_vault WHERE pair_hash = $1 AND batch_week = $2',
      [hash, clock.batchWeek],
    );
    const row = stake.rows[0];
    if (!row || row.status !== 'mutual_unlocked' || !row.revealed_at) {
      throw notFound('not_in_mutual_pool', 'That person is not in your mutual pool');
    }
    const existing = await tx.query('SELECT 1 FROM matches WHERE pair_hash = $1', [hash]);
    if (existing.rowCount) throw conflict('already_matched', 'You are already matched');

    const inserted = await tx.query(
      `INSERT INTO sunday_signals (batch_week, pair_hash, signaler_id, target_id, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (batch_week, signaler_id) DO NOTHING`,
      [clock.batchWeek, hash, userId, targetId, now],
    );
    if (inserted.rowCount === 0) throw conflict('signal_already_sent', 'Your #1 Signal for this week is already sealed');

    const reciprocal = await tx.query(
      'SELECT 1 FROM sunday_signals WHERE batch_week = $1 AND signaler_id = $2 AND target_id = $3',
      [clock.batchWeek, targetId, userId],
    );
    if (!reciprocal.rowCount) return { matchId: null };

    const matchId = await createMatch(tx, hash, clock.batchWeek, lo, hi, now);
    return { matchId };
  });
}

async function createMatch(tx: Tx, hash: Buffer, batchWeek: string, lo: string, hi: string, now: Date): Promise<string> {
  // Both parties are within each other's radius, so they share a zone in practice; when they
  // don't, the lower UUID's zone is used deterministically for "21:00 local" style rules.
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO matches (pair_hash, batch_week, user_a_id, user_b_id, time_zone, created_at)
     SELECT $1, $2, $3, $4, coalesce(a.time_zone, b.time_zone, 'UTC'), $5
       FROM users a, users b WHERE a.id = $3 AND b.id = $4
     RETURNING id`,
    [hash, batchWeek, lo, hi, now],
  );
  const matchId = rows[0]!.id;
  await tx.query('INSERT INTO chat_threads (match_id) VALUES ($1)', [matchId]);
  return matchId;
}

/** Monday 00:00 UTC: delete every signal from finished weeks (matched pairs already exist). */
export async function purgeClosedSignals(ctx: AppContext): Promise<number> {
  const clock = weekClock(ctx.now());
  return withSystemTx(ctx.db, async (tx) => {
    const res = await tx.query('DELETE FROM sunday_signals WHERE batch_week < $1', [clock.batchWeek]);
    return res.rowCount ?? 0;
  });
}
