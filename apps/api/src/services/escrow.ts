import { MAX_WEEKLY_VALIDATIONS, addDays, weekClock, type CardLine, type ResonanceStamp } from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx, type Tx } from '../db/pool.js';
import { conflict, notFound } from '../lib/errors.js';
import { orderedPair, pairHash } from '../lib/crypto.js';

/**
 * Simultaneous blind escrow state machine.
 *
 *   (no row) ──first action──▶ locked ──second validation──▶ mutual_unlocked ──Sun 06:00──▶ revealed
 *                                 │
 *                                 └──Sun 06:00, not mutual──▶ wiped (all identifying columns scrubbed)
 *
 * Invariants:
 *  - The target is never notified. Responses to the actor are identical whatever the
 *    counterpart did, and the counterpart can only read a stake after acting on it themselves
 *    (RLS policy `escrow_party_read`), so an unreciprocated validation is invisible.
 *  - A pass never mutates the counterpart's stake mid-week: wiping happens only in the Sunday
 *    job. An immediate wipe would change the validator's own view and leak the pass.
 *  - Actions are final for the week; at most three validations per user per UTC week.
 *  - A card frozen by a party who has not acted is carried into next week: its stake moves to
 *    the next batch week instead of being wiped. Carries are one-sided (only the freezer sees
 *    the card again), so the counterpart never learns they were frozen.
 */

export type EscrowAction =
  | { kind: 'validated'; stamp: ResonanceStamp; line: CardLine }
  | { kind: 'passed' };

interface BatchRow {
  card_user_ids: string[];
  frozen_user_id: string | null;
}

export async function lockActorBatch(tx: Tx, userId: string, batchWeek: string): Promise<BatchRow> {
  const { rows } = await tx.query<BatchRow>(
    `SELECT card_user_ids, frozen_user_id FROM weekly_batches
      WHERE user_id = $1 AND batch_week = $2 FOR UPDATE`,
    [userId, batchWeek],
  );
  const batch = rows[0];
  if (!batch) throw notFound('no_batch', 'You have no batch this week');
  return batch;
}

export async function countWeeklyValidations(tx: Tx, userId: string, weekStart: Date): Promise<number> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM escrow_vault
      WHERE (user_a_id = $1 AND user_a_action = 'validated' AND user_a_acted_at >= $2 AND user_a_acted_at < $3)
         OR (user_b_id = $1 AND user_b_action = 'validated' AND user_b_acted_at >= $2 AND user_b_acted_at < $3)`,
    [userId, weekStart, weekEnd],
  );
  return rows[0]!.n;
}

export async function recordEscrowAction(
  ctx: AppContext,
  actorId: string,
  targetId: string,
  action: EscrowAction,
): Promise<void> {
  const now = ctx.now();
  const clock = weekClock(now);
  if (clock.phase !== 'validation') {
    throw conflict('validation_window_closed', 'Resonance stamps open Monday 07:00 and close Saturday midnight (UTC)');
  }
  if (actorId === targetId) throw notFound('card_not_in_batch', 'That card is not in your batch');

  await withSystemTx(ctx.db, async (tx) => {
    const batch = await lockActorBatch(tx, actorId, clock.batchWeek);
    if (!batch.card_user_ids.includes(targetId)) throw notFound('card_not_in_batch', 'That card is not in your batch');
    if (batch.frozen_user_id === targetId) throw conflict('card_frozen', 'Unfreeze this card before deciding on it');

    if (action.kind === 'validated') {
      const used = await countWeeklyValidations(tx, actorId, clock.weekStart);
      if (used >= MAX_WEEKLY_VALIDATIONS) {
        throw conflict('stamp_limit_reached', `You can stamp up to ${MAX_WEEKLY_VALIDATIONS} cards a week`);
      }
    }

    const [lo, hi] = orderedPair(actorId, targetId);
    const hash = pairHash(lo, hi, ctx.config.ESCROW_PAIR_SALT);
    await tx.query(
      `INSERT INTO escrow_vault (pair_hash, batch_week, user_a_id, user_b_id, user_a_action, user_b_action)
       VALUES ($1, $2, $3, $4, 'pending', 'pending')
       ON CONFLICT (pair_hash, batch_week) DO NOTHING`,
      [hash, clock.batchWeek, lo, hi],
    );
    const { rows } = await tx.query<{
      id: string;
      status: string;
      user_a_action: string | null;
      user_b_action: string | null;
    }>(
      `SELECT id, status, user_a_action, user_b_action FROM escrow_vault
        WHERE pair_hash = $1 AND batch_week = $2 FOR UPDATE`,
      [hash, clock.batchWeek],
    );
    const stake = rows[0]!;
    const side = actorId.toLowerCase() === lo ? 'a' : 'b';
    const mine = side === 'a' ? stake.user_a_action : stake.user_b_action;
    const theirs = side === 'a' ? stake.user_b_action : stake.user_a_action;
    if (stake.status === 'wiped' || mine !== 'pending') {
      throw conflict('card_already_decided', 'You have already decided on this card');
    }

    const becomesMutual = action.kind === 'validated' && theirs === 'validated';
    await tx.query(
      `UPDATE escrow_vault SET
         user_${side}_action = $2::escrow_action,
         user_${side}_stamp = $3::resonance_stamp,
         user_${side}_stamp_line = $4::card_line,
         user_${side}_acted_at = CASE WHEN $2 = 'validated' THEN $5::timestamptz END,
         status = CASE WHEN $6 THEN 'mutual_unlocked'::escrow_status ELSE status END,
         mutual_at = CASE WHEN $6 THEN $5::timestamptz ELSE mutual_at END
       WHERE id = $1`,
      [
        stake.id,
        action.kind,
        action.kind === 'validated' ? action.stamp : null,
        action.kind === 'validated' ? action.line : null,
        now,
        becomesMutual,
      ],
    );
  });
}

export interface RevealSummary {
  batchWeek: string;
  revealed: number;
  carried: number;
  wiped: number;
}

/**
 * Sunday 06:00 UTC. Unblurs first names and photos for mutual stakes, carries frozen undecided
 * stakes into next week, and silently wipes everything else.
 */
export async function runSundayReveal(ctx: AppContext, batchWeek: string): Promise<RevealSummary> {
  const now = ctx.now();
  return withSystemTx(ctx.db, async (tx) => {
    const revealed = await tx.query(
      `UPDATE escrow_vault SET revealed_at = $2
        WHERE batch_week = $1 AND status = 'mutual_unlocked' AND revealed_at IS NULL`,
      [batchWeek, now],
    );
    const carried = await tx.query(
      `UPDATE escrow_vault e SET batch_week = $2
         FROM weekly_batches wb
        WHERE e.batch_week = $1 AND e.status = 'locked'
          AND wb.batch_week = $1 AND wb.frozen_user_id IS NOT NULL
          AND (   (wb.user_id = e.user_a_id AND wb.frozen_user_id = e.user_b_id AND e.user_a_action = 'pending')
               OR (wb.user_id = e.user_b_id AND wb.frozen_user_id = e.user_a_id AND e.user_b_action = 'pending'))`,
      [batchWeek, addDays(batchWeek, 7)],
    );
    const wiped = await tx.query(
      `UPDATE escrow_vault SET
         status = 'wiped', wiped_at = $2,
         user_a_id = NULL, user_b_id = NULL, user_a_action = NULL, user_b_action = NULL,
         user_a_stamp = NULL, user_b_stamp = NULL, user_a_stamp_line = NULL, user_b_stamp_line = NULL,
         user_a_acted_at = NULL, user_b_acted_at = NULL
       WHERE batch_week = $1 AND status = 'locked'`,
      [batchWeek, now],
    );
    return {
      batchWeek,
      revealed: revealed.rowCount ?? 0,
      carried: carried.rowCount ?? 0,
      wiped: wiped.rowCount ?? 0,
    };
  });
}
