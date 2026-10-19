import { addDays, VOICE_PROMPTS } from '@thirtydates/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { withSystemTx, withUserTx } from '../src/db/pool.js';
import { pairHash } from '../src/lib/crypto.js';
import { freezeCard, getCurrentBatch, unfreezeCard } from '../src/services/batches.js';
import { toneWav } from '../src/services/devTools.js';
import { recordEscrowAction } from '../src/services/escrow.js';
import { getExchange, lockAnswers, pickPrompts, readAnswerAudio, runExchangeTick, sniffAudioType } from '../src/services/exchange.js';
import { getMatch } from '../src/services/matches.js';
import { TEST_WEEK, at, createMember, dealBatch, dealPair, makeCtx, resetDb } from './helpers.js';

const ctx = makeCtx();
const select = { kind: 'validated' } as const;
const [P1, P2, P3] = VOICE_PROMPTS.map((p) => p.key) as [string, string, string];

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

/** Two members who selected each other on Monday, with their exchange opened on Wednesday. */
async function mutualPair(names: [string, string] = ['Ana', 'Rui']) {
  const a = await createMember(ctx, { firstName: names[0] });
  const b = await createMember(ctx, { firstName: names[1] });
  ctx.setNow(at(0, 9));
  await dealPair(ctx, a, b);
  await recordEscrowAction(ctx, a, b, select);
  await recordEscrowAction(ctx, b, a, select);
  ctx.setNow(at(2, 0, 1)); // Wednesday 00:01
  await runExchangeTick(ctx);
  const { rows } = await ctx.db.query<{ id: string }>('SELECT id FROM voice_exchanges');
  return { a, b, exchangeId: rows[0]!.id };
}

beforeEach(async () => {
  await resetDb();
  ctx.setNow(at(0, 9)); // Monday 09:00 UTC, selection open
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

describe('Stage 2: whole-profile blind selection', () => {
  it('hides an unreciprocated selection from the target under row-level security', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, select);

    expect(await rawStakesVisibleTo(b)).toHaveLength(0);
    expect(await rawStakesVisibleTo(a)).toHaveLength(1);
    expect((await getCurrentBatch(ctx, b)).cards[0]!.my_action).toBeNull();
  });

  it('cards carry Life Rhythm, interests and the coin, but no gates, names or photos', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    const card = (await getCurrentBatch(ctx, a)).cards[0]!;
    expect(Object.keys(card).sort()).toEqual(
      ['carried_over', 'coin', 'distance_km', 'frozen', 'interests', 'my_action', 'rhythm', 'user_id'].sort(),
    );
    expect(card.rhythm.length).toBeGreaterThan(0);
  });

  it('allows three selections a week, and decisions are final', async () => {
    const me = await createMember(ctx);
    const others = await Promise.all([1, 2, 3, 4].map(() => createMember(ctx)));
    await dealBatch(ctx, me, others);
    for (const o of others.slice(0, 3)) await recordEscrowAction(ctx, me, o, select);
    expect(await errorCode(recordEscrowAction(ctx, me, others[3]!, select))).toBe('selection_limit_reached');
    expect(await errorCode(recordEscrowAction(ctx, me, others[0]!, { kind: 'passed' }))).toBe('card_already_decided');
    await recordEscrowAction(ctx, me, others[3]!, { kind: 'passed' });
    expect((await getCurrentBatch(ctx, me)).selections_remaining).toBe(0);
  });

  it('closes selection at Wednesday 00:00', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    const c = await createMember(ctx);
    await dealPair(ctx, a, b);
    expect(await errorCode(recordEscrowAction(ctx, a, c, select))).toBe('card_not_in_batch');
    ctx.setNow(at(2, 0, 1));
    expect(await errorCode(recordEscrowAction(ctx, a, b, select))).toBe('selection_closed');
  });

  it('a pass never changes what the selector sees (no side channel)', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, select);
    const before = await getCurrentBatch(ctx, a);
    await recordEscrowAction(ctx, b, a, { kind: 'passed' });
    const after = await getCurrentBatch(ctx, a);
    expect(after.cards).toEqual(before.cards);
    expect(after.selections_remaining).toBe(before.selections_remaining);
  });

  it('mutual selections stay invisible until the exchange opens on Wednesday', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, select);
    await recordEscrowAction(ctx, b, a, select);
    expect((await getCurrentBatch(ctx, a)).exchanges).toEqual([]);
  });
});

describe('Wednesday seal', () => {
  it('opens an exchange per mutual pair and wipes everything else without trace', async () => {
    const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map(() => createMember(ctx)));
    await dealBatch(ctx, a!, [b!, c!]);
    await dealBatch(ctx, b!, [a!]);
    await dealBatch(ctx, c!, [a!, d!]);
    await dealBatch(ctx, d!, [c!]);
    await recordEscrowAction(ctx, a!, b!, select);
    await recordEscrowAction(ctx, b!, a!, select);
    await recordEscrowAction(ctx, a!, c!, select); // c ignores
    await recordEscrowAction(ctx, c!, d!, select);
    await recordEscrowAction(ctx, d!, c!, { kind: 'passed' });

    ctx.setNow(at(2, 0, 1));
    const tick = await runExchangeTick(ctx);
    expect(tick.opened).toBe(1);
    const view = await getCurrentBatch(ctx, a!);
    expect(view.phase).toBe('exchange_questions');
    expect(view.exchanges).toHaveLength(1);
    expect(view.exchanges[0]!.revealed).toBeNull();

    const wiped = await withSystemTx(ctx.db, async (tx) => (await tx.query(`SELECT * FROM escrow_vault WHERE status = 'wiped'`)).rows);
    expect(wiped).toHaveLength(2);
    for (const row of wiped) {
      expect(row.user_a_id).toBeNull();
      expect(row.user_b_id).toBeNull();
      expect(row.user_a_action).toBeNull();
    }
    expect((await runExchangeTick(ctx)).opened).toBe(0);
  });

  it('carries a frozen, undecided stake into next week instead of wiping it', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, b, a, select);
    await freezeCard(ctx, a, b);
    ctx.setNow(at(2, 0, 1));
    await runExchangeTick(ctx);
    const row = await withSystemTx(ctx.db, async (tx) => (await tx.query('SELECT status, batch_week FROM escrow_vault')).rows[0]);
    expect(row).toEqual({ status: 'locked', batch_week: addDays(TEST_WEEK, 7) });
  });
});

describe('Freeze Slot', () => {
  it('spends one token per week and can be undone while selection is open', async () => {
    const me = await createMember(ctx);
    const [x, y] = await Promise.all([createMember(ctx), createMember(ctx)]);
    await dealBatch(ctx, me, [x!, y!]);
    await freezeCard(ctx, me, x!);
    expect(await errorCode(freezeCard(ctx, me, y!))).toBe('already_frozen');
    expect(await errorCode(recordEscrowAction(ctx, me, x!, select))).toBe('card_frozen');
    expect((await getCurrentBatch(ctx, me)).freeze).toEqual({ token_available: false, used_for: 'card_carry', frozen_user_id: x });
    await unfreezeCard(ctx, me);
    expect((await getCurrentBatch(ctx, me)).freeze.token_available).toBe(true);
  });
});

describe('Stage 3: asynchronous voice Q&A', () => {
  it('runs questions → 36 h Response Clock → double-blind lock → simultaneous release', async () => {
    const { a, b, exchangeId } = await mutualPair();

    // Wednesday: each drops 2–3 questions for the other.
    const bank = await getExchange(ctx, a, exchangeId);
    expect(bank.status).toBe('questions');
    expect(bank.prompt_bank.length).toBeGreaterThan(3);
    expect(bank.questions_for_me).toEqual([]);
    await pickPrompts(ctx, a, exchangeId, [P1, P2]);
    await pickPrompts(ctx, b, exchangeId, [P1, P2, P3]);
    expect(await errorCode(pickPrompts(ctx, a, exchangeId, [P1]))).toBe('invalid_picks');

    // Thursday 00:00: the Response Clock starts; each now sees the questions they must answer.
    ctx.setNow(at(3, 0, 1));
    expect((await runExchangeTick(ctx)).started).toBe(1);
    const forA = await getExchange(ctx, a, exchangeId);
    expect(forA.status).toBe('answering');
    expect(forA.questions_for_me.map((q) => q.key)).toEqual([P1, P2, P3]);
    expect(Date.parse(forA.answers_close_at) - Date.parse(forA.questions_close_at)).toBe(36 * 3_600_000);

    // Must answer every question; locking is final.
    expect(await errorCode(lockAnswers(ctx, a, exchangeId, [{ promptKey: P1, data: toneWav() }]))).toBe('answers_incomplete');
    expect(
      await errorCode(lockAnswers(ctx, a, exchangeId, [P1, P2, P3].map((k) => ({ promptKey: k, data: Buffer.from('not audio') })))),
    ).toBe('invalid_audio');
    expect(await lockAnswers(ctx, a, exchangeId, [P1, P2, P3].map((k) => ({ promptKey: k, data: toneWav() })))).toEqual({
      released: false,
    });
    expect(await errorCode(lockAnswers(ctx, a, exchangeId, []))).toBe('already_locked');

    // Double-blind: b cannot hear a, cannot tell a has locked, and nothing is revealed.
    const forB = await getExchange(ctx, b, exchangeId);
    expect(forB.their_answers).toEqual([]);
    expect(forB.revealed).toBeNull();
    expect(JSON.stringify(forB)).not.toContain('locked_at');
    expect(await errorCode(readAnswerAudio(ctx, b, exchangeId, a, P1))).toBe('audio_not_found');
    expect((await readAnswerAudio(ctx, a, exchangeId, a, P1)).contentType).toBe('audio/wav');

    // b locks: the modality switch happens in that same transaction.
    expect(await lockAnswers(ctx, b, exchangeId, [P1, P2].map((k) => ({ promptKey: k, data: toneWav() })))).toEqual({
      released: true,
    });
    const released = await getExchange(ctx, a, exchangeId);
    expect(released.status).toBe('released');
    expect(released.revealed?.first_name).toBe('Rui');
    expect(released.their_answers.map((x) => x.prompt_key)).toEqual([P1, P2]);
    expect((await readAnswerAudio(ctx, a, exchangeId, b, P2)).data.length).toBeGreaterThan(44);
    expect((await getExchange(ctx, b, exchangeId)).revealed?.first_name).toBe('Ana');

    // Stage 4: the match, chat and First-Meet Bridge exist immediately.
    expect(released.match_id).toBeTruthy();
    const match = await getMatch(ctx, a, released.match_id!);
    expect(match.status).toBe('bridging');
    expect(Date.parse(match.bridge_window_closes_at) - Date.parse(match.created_at)).toBe(72 * 3_600_000);
  });

  it('assigns questions to anyone who picked none when the clock starts', async () => {
    const { a, b, exchangeId } = await mutualPair();
    await pickPrompts(ctx, a, exchangeId, [P1, P2]);
    ctx.setNow(at(3, 0, 1));
    expect((await runExchangeTick(ctx)).autoPicked).toBe(1);
    expect((await getExchange(ctx, a, exchangeId)).questions_for_me).toHaveLength(2);
    expect((await getExchange(ctx, b, exchangeId)).questions_for_me.map((q) => q.key)).toEqual([P1, P2]);
  });

  it('closes silently when the Response Clock runs out, deleting audio and revealing nothing', async () => {
    const { a, b, exchangeId } = await mutualPair();
    ctx.setNow(at(3, 0, 1));
    await runExchangeTick(ctx);
    const mine = (await getExchange(ctx, a, exchangeId)).questions_for_me.map((q) => q.key);
    await lockAnswers(ctx, a, exchangeId, mine.map((k) => ({ promptKey: k, data: toneWav() })));

    ctx.setNow(at(4, 12, 1)); // Friday 12:01, 36 h later
    expect((await runExchangeTick(ctx)).expired).toBe(1);
    const closed = await getExchange(ctx, b, exchangeId);
    expect(closed.status).toBe('expired');
    expect(closed.revealed).toBeNull();
    expect((await ctx.db.query('SELECT 1 FROM voice_answers')).rowCount).toBe(0);
    expect((await ctx.db.query('SELECT 1 FROM matches')).rowCount).toBe(0);
    expect(await errorCode(lockAnswers(ctx, b, exchangeId, []))).toBe('response_clock_closed');
  });

  it('recognises the formats browsers record in', () => {
    expect(sniffAudioType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toBe('audio/webm');
    expect(sniffAudioType(Buffer.from('OggS\0\0\0\0'))).toBe('audio/ogg');
    expect(sniffAudioType(Buffer.from('\0\0\0\x20ftypM4A '))).toBe('audio/mp4');
    expect(sniffAudioType(toneWav())).toBe('audio/wav');
    expect(sniffAudioType(Buffer.from('<svg>'))).toBeNull();
  });
});

describe('member deletion', () => {
  it('wipes the member’s live stakes instead of failing', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await dealPair(ctx, a, b);
    await recordEscrowAction(ctx, a, b, select);
    await ctx.db.query('DELETE FROM users WHERE id = $1', [b]);
    const rows = await withSystemTx(ctx.db, async (tx) => (await tx.query('SELECT status, user_a_id, user_b_id FROM escrow_vault')).rows);
    expect(rows).toEqual([{ status: 'wiped', user_a_id: null, user_b_id: null }]);
  });
});
