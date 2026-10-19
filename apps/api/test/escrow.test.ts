import { addDays } from '@thirtydates/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { withSystemTx, withUserTx } from '../src/db/pool.js';
import { pairHash } from '../src/lib/crypto.js';
import { freezeCard, getCurrentBatch, unfreezeCard } from '../src/services/batches.js';
import { recordEscrowAction, runSundayReveal } from '../src/services/escrow.js';
import { answerScenario, getScenarioExchange } from '../src/services/scenarios.js';
import { submitSignal } from '../src/services/signals.js';
import { TEST_WEEK, at, createMember, dealBatch, dealPair, makeCtx, resetDb } from './helpers.js';

const ctx = makeCtx();
const stamp = { kind: 'validated', stamp: 'same_flaw', line: 'flaw' } as const;

async function rawStakesVisibleTo(userId: string) {
  return withUserTx(ctx.db, userId, async (tx) => (await tx.query('SELECT * FROM escrow_vault')).rows);
}

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as { code: string }).code;
  }
  return 'resolved';
}

beforeEach(async () => {
  await resetDb();
  ctx.setNow(at(0, 9)); // Monday 09:00 UTC, validation window open
});

describe('pair hashing', () => {
  it('is order-independent, keyed and 32 bytes', () => {
    const a = '0b3f6c1e-0000-4000-8000-000000000001';
    const b = 'f0a1d2c3-0000-4000-8000-000000000002';
    expect(pairHash(a, b, 'salt-one-salt-one-salt-one-salt-one')).toEqual(pairHash(b, a, 'salt-one-salt-one-salt-one-salt-one'));
    expect(pairHash(a, b, 'salt-one-salt-one-salt-one-salt-one')).not.toEqual(pairHash(a, b, 'salt-two-salt-two-salt-two-salt-two'));
    expect(pairHash(a, b, 'x'.repeat(32))).toHaveLength(32);
  });
});

describe('silent validation (blind escrow)', () => {
  it('hides an unreciprocated validation from the target under row-level security', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);

    expect(await rawStakesVisibleTo(b)).toHaveLength(0);
    expect(await rawStakesVisibleTo(a)).toHaveLength(1);
    const view = await getCurrentBatch(ctx, b);
    expect(view.cards[0]!.my_action).toBeNull();
    expect(view.mutual).toHaveLength(0);
  });

  it('never exposes the counterpart side through the own-stake view', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);
    await recordEscrowAction(ctx, b, a, { kind: 'passed' });
    const rows = await withUserTx(ctx.db, b, async (tx) => (await tx.query('SELECT * FROM escrow_my_stakes')).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].my_action).toBe('passed');
    expect(rows[0].status).toBe('locked');
    expect(Object.keys(rows[0])).not.toContain('user_a_stamp');
  });

  it('becomes mutual when both validate, but stays hidden until Wednesday', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);
    await recordEscrowAction(ctx, b, a, { kind: 'validated', stamp: 'made_me_smile', line: 'interest_2' });

    expect((await getCurrentBatch(ctx, a)).mutual).toHaveLength(0);
    ctx.setNow(at(2, 0, 1)); // Wednesday 00:01
    const view = await getCurrentBatch(ctx, a);
    expect(view.mutual).toHaveLength(1);
    expect(view.mutual[0]!.revealed).toBeNull();
    expect(view.mutual[0]!.scenario_exchange.unlocked).toBe(true);
  });

  it('limits validations to three per week and makes actions final', async () => {
    const me = await createMember(ctx);
    const others = await Promise.all([1, 2, 3, 4].map(() => createMember(ctx)));
    await dealBatch(ctx, me, others);
    for (const o of others.slice(0, 3)) await recordEscrowAction(ctx, me, o, stamp);
    expect(await errorCode(recordEscrowAction(ctx, me, others[3]!, stamp))).toBe('stamp_limit_reached');
    expect(await errorCode(recordEscrowAction(ctx, me, others[0]!, { kind: 'passed' }))).toBe('card_already_decided');
    await recordEscrowAction(ctx, me, others[3]!, { kind: 'passed' });
    expect((await getCurrentBatch(ctx, me)).stamps_remaining).toBe(0);
  });

  it('rejects cards outside the batch and actions outside the window', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    const c = await createMember(ctx);
    await dealPair(ctx, a, b);
    expect(await errorCode(recordEscrowAction(ctx, a, c, stamp))).toBe('card_not_in_batch');
    ctx.setNow(at(6, 1)); // Sunday 01:00 — sealed
    expect(await errorCode(recordEscrowAction(ctx, a, b, stamp))).toBe('validation_window_closed');
  });

  it('does not let a pass mutate the validator’s stake mid-week (no side channel)', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);
    const before = await getCurrentBatch(ctx, a);
    await recordEscrowAction(ctx, b, a, { kind: 'passed' });
    const after = await getCurrentBatch(ctx, a);
    expect(after.cards).toEqual(before.cards);
    expect(after.stamps_remaining).toBe(before.stamps_remaining);
  });
});

describe('Sunday reveal', () => {
  it('reveals mutual pairs and wipes every unreciprocated stake without trace', async () => {
    const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map((i) => createMember(ctx, { firstName: `P${i}` })));
    await dealBatch(ctx, a!, [b!, c!]);
    await dealBatch(ctx, b!, [a!]);
    await dealBatch(ctx, c!, [a!, d!]);
    await dealBatch(ctx, d!, [c!]);
    await recordEscrowAction(ctx, a!, b!, stamp);
    await recordEscrowAction(ctx, b!, a!, stamp);
    await recordEscrowAction(ctx, a!, c!, stamp); // c ignores
    await recordEscrowAction(ctx, c!, d!, stamp);
    await recordEscrowAction(ctx, d!, c!, { kind: 'passed' });

    ctx.setNow(at(6, 6));
    const summary = await runSundayReveal(ctx, TEST_WEEK);
    expect(summary).toMatchObject({ revealed: 1, wiped: 2, carried: 0 });

    const view = await getCurrentBatch(ctx, a!);
    expect(view.phase).toBe('reveal');
    expect(view.mutual).toHaveLength(1);
    expect(view.mutual[0]!.revealed?.first_name).toBe('P2');

    const leftovers = await withSystemTx(ctx.db, async (tx) =>
      (await tx.query(`SELECT * FROM escrow_vault WHERE status = 'wiped'`)).rows,
    );
    expect(leftovers).toHaveLength(2);
    for (const row of leftovers) {
      expect(row.user_a_id).toBeNull();
      expect(row.user_b_id).toBeNull();
      expect(row.user_a_stamp).toBeNull();
      expect(row.user_b_action).toBeNull();
    }
    expect(await rawStakesVisibleTo(c!)).toHaveLength(0);
    expect((await runSundayReveal(ctx, TEST_WEEK)).revealed).toBe(0);
  });

  it('carries a frozen, undecided stake into next week instead of wiping it', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, b, a, stamp);
    await freezeCard(ctx, a, b);

    ctx.setNow(at(6, 6));
    expect(await runSundayReveal(ctx, TEST_WEEK)).toMatchObject({ carried: 1, wiped: 0 });

    // Next week: a sees b as the carried card and validates; the pair becomes mutual.
    const next = addDays(TEST_WEEK, 7);
    await ctx.db.query(
      'INSERT INTO weekly_batches (user_id, batch_week, card_user_ids, carried_over_user_id) VALUES ($1, $2, $3, $4)',
      [a, next, [b], b],
    );
    ctx.setNow(at(7, 9));
    await recordEscrowAction(ctx, a, b, stamp);
    const status = await withSystemTx(ctx.db, async (tx) =>
      (await tx.query('SELECT status, batch_week FROM escrow_vault')).rows[0],
    );
    expect(status).toEqual({ status: 'mutual_unlocked', batch_week: next });
  });
});

describe('Freeze Slot', () => {
  it('spends one token per week and can be undone during the week', async () => {
    const me = await createMember(ctx);
    const [x, y] = await Promise.all([createMember(ctx), createMember(ctx)]);
    await dealBatch(ctx, me, [x!, y!]);
    await freezeCard(ctx, me, x!);
    expect(await errorCode(freezeCard(ctx, me, y!))).toBe('already_frozen');
    expect(await errorCode(recordEscrowAction(ctx, me, x!, stamp))).toBe('card_frozen');
    let view = await getCurrentBatch(ctx, me);
    expect(view.freeze).toEqual({ token_available: false, used_for: 'card_carry', frozen_user_id: x });

    await unfreezeCard(ctx, me);
    view = await getCurrentBatch(ctx, me);
    expect(view.freeze.token_available).toBe(true);
    await recordEscrowAction(ctx, me, y!, { kind: 'passed' });
    expect(await errorCode(freezeCard(ctx, me, y!))).toBe('card_already_decided');
  });
});

describe('mid-week scenario exchange', () => {
  it('unlocks Wednesday for mutual pairs and compares only once both have answered', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);
    await recordEscrowAction(ctx, b, a, stamp);
    expect(await errorCode(getScenarioExchange(ctx, a, b))).toBe('scenario_exchange_locked');

    ctx.setNow(at(2, 8));
    const exchange = await getScenarioExchange(ctx, a, b);
    expect(exchange.scenarios).toHaveLength(2);
    for (const s of exchange.scenarios) await answerScenario(ctx, a, b, s.key, s.stances[0]!.key);
    expect((await getScenarioExchange(ctx, a, b)).comparison_ready).toBe(false);
    expect((await getScenarioExchange(ctx, b, a)).scenarios.every((s) => s.their_stance === null)).toBe(true);

    for (const s of exchange.scenarios) await answerScenario(ctx, b, a, s.key, s.stances[2]!.key);
    const done = await getScenarioExchange(ctx, a, b);
    expect(done.comparison_ready).toBe(true);
    expect(done.scenarios[0]!.their_stance).toBe(exchange.scenarios[0]!.stances[2]!.key);
    expect(await errorCode(answerScenario(ctx, a, b, exchange.scenarios[0]!.key, exchange.scenarios[0]!.stances[1]!.key))).toBe('already_answered');
  });

  it('is unavailable for non-mutual pairs', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);
    ctx.setNow(at(2, 8));
    expect(await errorCode(getScenarioExchange(ctx, a, b))).toBe('not_mutual');
  });
});

describe('Sunday #1 Signal', () => {
  async function revealedPair() {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);
    await recordEscrowAction(ctx, b, a, stamp);
    ctx.setNow(at(6, 6));
    await runSundayReveal(ctx, TEST_WEEK);
    return [a, b] as const;
  }

  it('opens a match and chat thread only when #1 signals align', async () => {
    const [a, b] = await revealedPair();
    expect(await errorCode(submitSignal(ctx, a, b))).toBe('signal_window_closed');
    ctx.setNow(at(6, 19));
    expect(await submitSignal(ctx, a, b)).toEqual({ matchId: null });
    expect(await errorCode(submitSignal(ctx, a, b))).toBe('signal_already_sent');

    const signalsSeenByB = await withUserTx(ctx.db, b, async (tx) => (await tx.query('SELECT * FROM sunday_signals')).rows);
    expect(signalsSeenByB).toHaveLength(0);

    const { matchId } = await submitSignal(ctx, b, a);
    expect(matchId).toBeTruthy();
    const thread = await ctx.db.query('SELECT 1 FROM chat_threads WHERE match_id = $1', [matchId]);
    expect(thread.rowCount).toBe(1);
    expect((await getCurrentBatch(ctx, a)).my_signal).toEqual({ target_user_id: b, match_id: matchId });
  });

  it('only accepts signals from the revealed mutual pool', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);
    ctx.setNow(at(6, 6));
    await runSundayReveal(ctx, TEST_WEEK);
    ctx.setNow(at(6, 19));
    expect(await errorCode(submitSignal(ctx, a, b))).toBe('not_in_mutual_pool');
  });

  it('meets simultaneous signals', async () => {
    const [a, b] = await revealedPair();
    ctx.setNow(at(6, 20));
    const results = await Promise.all([submitSignal(ctx, a, b), submitSignal(ctx, b, a)]);
    expect(results.filter((r) => r.matchId !== null)).toHaveLength(1);
    expect((await ctx.db.query('SELECT 1 FROM matches')).rowCount).toBe(1);
  });
});

describe('member deletion', () => {
  it('wipes the member’s live stakes instead of failing', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, stamp);
    await ctx.db.query('DELETE FROM users WHERE id = $1', [b]);
    const rows = await withSystemTx(ctx.db, async (tx) => (await tx.query('SELECT status, user_a_id, user_b_id FROM escrow_vault')).rows);
    expect(rows).toEqual([{ status: 'wiped', user_a_id: null, user_b_id: null }]);
  });
});
