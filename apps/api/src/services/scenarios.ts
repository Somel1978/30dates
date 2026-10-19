import { SCENARIOS_PER_EXCHANGE, pickScenarios, weekClock, type ScenarioExchangeResponse } from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx, type Tx } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { orderedPair, pairHash } from '../lib/crypto.js';

/**
 * Mid-week scenario exchange: unlocked Wednesday 00:00 UTC for mutually validated pairs.
 * Two deterministic dilemma cards per pair per week; answers are final, and the counterpart's
 * stances are shown only once both people have answered both cards.
 */
async function resolveMutualPair(ctx: AppContext, tx: Tx, userId: string, targetId: string) {
  const now = ctx.now();
  const clock = weekClock(now);
  if (now < clock.scenarioUnlockAt) {
    throw conflict('scenario_exchange_locked', 'The scenario exchange unlocks Wednesday 00:00 (UTC)');
  }
  if (userId === targetId) throw notFound('not_mutual', 'No scenario exchange with this card');
  const [lo, hi] = orderedPair(userId, targetId);
  const hash = pairHash(lo, hi, ctx.config.ESCROW_PAIR_SALT);
  const stake = await tx.query<{ status: string }>(
    'SELECT status FROM escrow_vault WHERE pair_hash = $1 AND batch_week = $2',
    [hash, clock.batchWeek],
  );
  if (stake.rows[0]?.status !== 'mutual_unlocked') throw notFound('not_mutual', 'No scenario exchange with this card');
  return { clock, hash, scenarios: pickScenarios(hash.toString('hex'), clock.batchWeek) };
}

export async function getScenarioExchange(ctx: AppContext, userId: string, targetId: string): Promise<ScenarioExchangeResponse> {
  return withSystemTx(ctx.db, async (tx) => {
    const { clock, hash, scenarios } = await resolveMutualPair(ctx, tx, userId, targetId);
    const { rows } = await tx.query<{ user_id: string; scenario_key: string; stance_key: string }>(
      'SELECT user_id, scenario_key, stance_key FROM scenario_responses WHERE batch_week = $1 AND pair_hash = $2',
      [clock.batchWeek, hash],
    );
    const mine = new Map(rows.filter((r) => r.user_id === userId).map((r) => [r.scenario_key, r.stance_key]));
    const theirs = new Map(rows.filter((r) => r.user_id !== userId).map((r) => [r.scenario_key, r.stance_key]));
    const comparisonReady = mine.size >= SCENARIOS_PER_EXCHANGE && theirs.size >= SCENARIOS_PER_EXCHANGE;
    return {
      batch_week: clock.batchWeek,
      comparison_ready: comparisonReady,
      scenarios: scenarios.map((s) => ({
        key: s.key,
        prompt: s.prompt,
        stances: s.stances.map((st) => ({ key: st.key, label: st.label })),
        my_stance: mine.get(s.key) ?? null,
        their_stance: comparisonReady ? (theirs.get(s.key) ?? null) : null,
      })),
    };
  });
}

export async function answerScenario(
  ctx: AppContext,
  userId: string,
  targetId: string,
  scenarioKey: string,
  stanceKey: string,
): Promise<ScenarioExchangeResponse> {
  const now = ctx.now();
  if (now >= weekClock(now).revealAt) {
    throw conflict('scenario_exchange_closed', 'The scenario exchange closes at the Sunday reveal');
  }
  await withSystemTx(ctx.db, async (tx) => {
    const { clock, hash, scenarios } = await resolveMutualPair(ctx, tx, userId, targetId);
    const scenario = scenarios.find((s) => s.key === scenarioKey);
    if (!scenario) throw badRequest('unknown_scenario', 'That scenario is not part of this exchange');
    if (!scenario.stances.some((s) => s.key === stanceKey)) throw badRequest('unknown_stance', 'Pick one of the three stances');
    const res = await tx.query(
      `INSERT INTO scenario_responses (batch_week, pair_hash, user_id, scenario_key, stance_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [clock.batchWeek, hash, userId, scenarioKey, stanceKey, now],
    );
    if (res.rowCount === 0) throw conflict('already_answered', 'You already answered this scenario');
  });
  return getScenarioExchange(ctx, userId, targetId);
}
