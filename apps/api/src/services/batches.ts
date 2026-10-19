import {
  MAX_WEEKLY_VALIDATIONS,
  SCENARIOS_PER_EXCHANGE,
  weekClock,
  type BatchCard,
  type CardLine,
  type CurrentBatchResponse,
  type MutualCard,
  type ResonanceStamp,
} from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx, withUserTx } from '../db/pool.js';
import { conflict, notFound } from '../lib/errors.js';
import { orderedPair, pairHash } from '../lib/crypto.js';
import { countWeeklyValidations, lockActorBatch } from './escrow.js';
import { loadCardProfiles, loadRevealedIdentities } from './profiles.js';

interface StakeRow {
  counterpart_id: string;
  pair_hash: Buffer;
  my_action: 'validated' | 'passed';
  my_stamp: ResonanceStamp | null;
  my_stamp_line: CardLine | null;
  status: 'locked' | 'mutual_unlocked';
  revealed_at: Date | null;
}

/** GET /api/batches/current — the user's own view of the week, read under row-level security. */
export async function getCurrentBatch(ctx: AppContext, userId: string): Promise<CurrentBatchResponse> {
  const now = ctx.now();
  const clock = weekClock(now);
  const week = clock.batchWeek;

  return withUserTx(ctx.db, userId, async (tx) => {
    const batchRes = await tx.query<{
      card_user_ids: string[];
      carried_over_user_id: string | null;
      frozen_user_id: string | null;
    }>(
      `SELECT card_user_ids, carried_over_user_id, frozen_user_id
         FROM weekly_batches WHERE user_id = $1 AND batch_week = $2`,
      [userId, week],
    );
    const batch = clock.phase === 'awaiting_deal' ? undefined : batchRes.rows[0];
    const cardIds = batch?.card_user_ids ?? [];

    const stakes = (
      await tx.query<StakeRow>(
        `SELECT counterpart_id, pair_hash, my_action, my_stamp, my_stamp_line, status, revealed_at
           FROM escrow_my_stakes WHERE batch_week = $1`,
        [week],
      )
    ).rows;
    const stakeByCounterpart = new Map(stakes.map((s) => [s.counterpart_id, s]));

    const mutualVisible = now >= clock.scenarioUnlockAt;
    const mutualStakes = mutualVisible ? stakes.filter((s) => s.status === 'mutual_unlocked') : [];
    const profiles = await loadCardProfiles(tx, userId, [...new Set([...cardIds, ...mutualStakes.map((s) => s.counterpart_id)])]);

    const cards: BatchCard[] = cardIds.flatMap((id) => {
      const profile = profiles.get(id);
      if (!profile) return [];
      const stake = stakeByCounterpart.get(id);
      return [
        {
          ...profile,
          carried_over: batch?.carried_over_user_id === id,
          frozen: batch?.frozen_user_id === id,
          my_action: stake?.my_action ?? null,
          my_stamp: stake?.my_stamp ?? null,
          my_stamp_line: stake?.my_stamp_line ?? null,
        },
      ];
    });

    const revealedIds = mutualStakes.filter((s) => s.revealed_at !== null).map((s) => s.counterpart_id);
    const identities = await loadRevealedIdentities(tx, revealedIds);

    const scenarioCounts = new Map<string, { mine: number; theirs: number }>();
    if (mutualStakes.length > 0) {
      const { rows } = await tx.query<{ pair_hash: Buffer; mine: number; total: number }>(
        `SELECT pair_hash, count(*) FILTER (WHERE user_id = $2)::int AS mine, count(*)::int AS total
           FROM scenario_responses WHERE batch_week = $1 AND pair_hash = ANY ($3::bytea[])
          GROUP BY pair_hash`,
        [week, userId, mutualStakes.map((s) => s.pair_hash)],
      );
      for (const r of rows) scenarioCounts.set(r.pair_hash.toString('hex'), { mine: r.mine, theirs: r.total - r.mine });
    }

    const mutual: MutualCard[] = mutualStakes.flatMap((s) => {
      const profile = profiles.get(s.counterpart_id);
      if (!profile) return [];
      const counts = scenarioCounts.get(s.pair_hash.toString('hex')) ?? { mine: 0, theirs: 0 };
      return [
        {
          ...profile,
          scenario_exchange: {
            unlocked: true,
            answered_by_me: counts.mine,
            comparison_ready: counts.mine >= SCENARIOS_PER_EXCHANGE && counts.theirs >= SCENARIOS_PER_EXCHANGE,
          },
          revealed: identities.get(s.counterpart_id) ?? null,
        },
      ];
    });

    const token = await tx.query<{ used_for: 'card_carry' | 'raincheck' }>(
      'SELECT used_for FROM freeze_tokens WHERE user_id = $1 AND token_week = $2',
      [userId, week],
    );
    const stampsUsed = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM escrow_my_stakes
        WHERE my_action = 'validated' AND my_acted_at >= $1 AND my_acted_at < $1 + interval '7 days'`,
      [clock.weekStart],
    );

    const signal = await tx.query<{ target_id: string }>(
      'SELECT target_id FROM sunday_signals WHERE batch_week = $1',
      [week],
    );
    let mySignal: CurrentBatchResponse['my_signal'] = null;
    if (signal.rows[0]) {
      const targetId = signal.rows[0].target_id;
      const [lo, hi] = orderedPair(userId, targetId);
      const match = await tx.query<{ id: string }>(
        'SELECT id FROM matches WHERE user_a_id = $1 AND user_b_id = $2',
        [lo, hi],
      );
      mySignal = { target_user_id: targetId, match_id: match.rows[0]?.id ?? null };
    }

    return {
      batch_week: week,
      phase: clock.phase,
      server_now: now.toISOString(),
      clock: {
        deal_at: clock.dealAt.toISOString(),
        scenario_unlock_at: clock.scenarioUnlockAt.toISOString(),
        stamps_close_at: clock.stampsCloseAt.toISOString(),
        reveal_at: clock.revealAt.toISOString(),
        signal_opens_at: clock.signalOpensAt.toISOString(),
        signal_closes_at: clock.signalClosesAt.toISOString(),
        next_deal_at: clock.nextDealAt.toISOString(),
      },
      cards,
      stamps_remaining: Math.max(0, MAX_WEEKLY_VALIDATIONS - stampsUsed.rows[0]!.n),
      freeze: {
        token_available: token.rows.length === 0,
        used_for: token.rows[0]?.used_for ?? null,
        frozen_user_id: batch?.frozen_user_id ?? null,
      },
      mutual,
      my_signal: mySignal,
    };
  });
}

/** Spend this week's Freeze Token to carry one undecided card into next Monday's batch. */
export async function freezeCard(ctx: AppContext, userId: string, targetId: string): Promise<void> {
  const clock = weekClock(ctx.now());
  if (clock.phase !== 'validation') throw conflict('validation_window_closed', 'Cards can only be frozen during the week');

  await withSystemTx(ctx.db, async (tx) => {
    const batch = await tx.query<{ card_user_ids: string[]; carried_over_user_id: string | null; frozen_user_id: string | null }>(
      `SELECT card_user_ids, carried_over_user_id, frozen_user_id FROM weekly_batches
        WHERE user_id = $1 AND batch_week = $2 FOR UPDATE`,
      [userId, clock.batchWeek],
    );
    const row = batch.rows[0];
    if (!row || !row.card_user_ids.includes(targetId)) throw notFound('card_not_in_batch', 'That card is not in your batch');
    if (row.carried_over_user_id === targetId) throw conflict('card_already_carried', 'A carried card cannot be frozen again');
    if (row.frozen_user_id) throw conflict('already_frozen', 'You already froze a card this week');

    const [lo, hi] = orderedPair(userId, targetId);
    const stake = await tx.query<{ user_a_action: string | null; user_b_action: string | null }>(
      'SELECT user_a_action, user_b_action FROM escrow_vault WHERE pair_hash = $1 AND batch_week = $2',
      [pairHash(lo, hi, ctx.config.ESCROW_PAIR_SALT), clock.batchWeek],
    );
    const mine = stake.rows[0] ? (userId.toLowerCase() === lo ? stake.rows[0].user_a_action : stake.rows[0].user_b_action) : 'pending';
    if (mine !== 'pending') throw conflict('card_already_decided', 'You have already decided on this card');

    const token = await tx.query(
      `INSERT INTO freeze_tokens (user_id, token_week, used_for, used_at) VALUES ($1, $2, 'card_carry', $3)
       ON CONFLICT (user_id, token_week) DO NOTHING`,
      [userId, clock.batchWeek, ctx.now()],
    );
    if (token.rowCount === 0) throw conflict('freeze_token_spent', 'Your Freeze Token for this week is already used');

    await tx.query('UPDATE weekly_batches SET frozen_user_id = $3 WHERE user_id = $1 AND batch_week = $2', [
      userId,
      clock.batchWeek,
      targetId,
    ]);
  });
}

/** Return a frozen card to the table and refund the Freeze Token (validation window only). */
export async function unfreezeCard(ctx: AppContext, userId: string): Promise<void> {
  const clock = weekClock(ctx.now());
  if (clock.phase !== 'validation') throw conflict('validation_window_closed', 'The freeze can only be changed during the week');

  await withSystemTx(ctx.db, async (tx) => {
    const batch = await lockActorBatch(tx, userId, clock.batchWeek);
    if (!batch.frozen_user_id) throw conflict('nothing_frozen', 'No card is frozen this week');
    await tx.query('UPDATE weekly_batches SET frozen_user_id = NULL WHERE user_id = $1 AND batch_week = $2', [
      userId,
      clock.batchWeek,
    ]);
    await tx.query(
      `DELETE FROM freeze_tokens WHERE user_id = $1 AND token_week = $2 AND used_for = 'card_carry'`,
      [userId, clock.batchWeek],
    );
  });
}
