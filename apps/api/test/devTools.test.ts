import { beforeEach, describe, expect, it } from 'vitest';
import { getCurrentBatch } from '../src/services/batches.js';
import { counterpartsAct, dealNow, devStatus, moveClock, seedMembersAround, selectMe, toneWav } from '../src/services/devTools.js';
import { selectProfile } from '../src/services/escrow.js';
import { getExchange, lockAnswers, pickPrompts } from '../src/services/exchange.js';
import { VOICE_PROMPTS } from '@thirtydates/shared';
import { at, createMember, makeCtx, resetDb } from './helpers.js';

const base = makeCtx(at(0, 9));
// Test tools only exist in development.
const ctx = { ...base, config: { ...base.config, NODE_ENV: 'development' as const } };

beforeEach(async () => {
  await resetDb();
  base.setNow(at(0, 9));
});

describe('test tools', () => {
  it('walk one person through the whole week: select → voice exchange → release → bridge', async () => {
    const me = await createMember(ctx, { gender: 'man', seeks: 'women', age: 44, gates: { family_goal: 'sovereign_lat' } });
    await seedMembersAround(ctx, me, 12);
    await dealNow(ctx);
    expect((await devStatus(ctx, me)).my_cards).toBe(6);

    expect(await selectMe(ctx, me, 3)).toBe(3);
    const batch = await getCurrentBatch(ctx, me);
    for (const card of batch.cards.slice(0, 3)) await selectProfile(ctx, me, card.user_id);

    await moveClock(ctx, 'wednesday');
    const view = await getCurrentBatch(ctx, me);
    expect(view.phase).toBe('exchange_questions');
    expect(view.exchanges).toHaveLength(3);
    expect(await counterpartsAct(ctx, me)).toEqual({ picked: 3, locked: 0 });
    for (const x of view.exchanges) await pickPrompts(ctx, me, x.id, VOICE_PROMPTS.slice(2, 5).map((p) => p.key));

    await moveClock(ctx, 'thursday');
    expect(await counterpartsAct(ctx, me)).toEqual({ picked: 0, locked: 3 });
    const first = view.exchanges[0]!.id;
    const questions = (await getExchange(ctx, me, first)).questions_for_me.map((q) => q.key);
    const { released } = await lockAnswers(ctx, me, first, questions.map((k) => ({ promptKey: k, data: toneWav() })));
    expect(released).toBe(true);
    expect((await devStatus(ctx, me)).matches).toBe(1);

    // The other two were never answered by me: they close silently at Friday 12:00.
    await moveClock(ctx, 'friday');
    const friday = await getCurrentBatch(ctx, me);
    expect(friday.exchanges.filter((x) => x.status === 'expired')).toHaveLength(2);
    expect(friday.exchanges.filter((x) => x.revealed)).toHaveLength(1);

    await moveClock(ctx, 'next_monday');
    const status = await devStatus(ctx, me);
    expect(status.phase).toBe('selection');
    expect(status.batch_week).toBe('2026-11-09');
  });

  it('refuses to run outside development', async () => {
    await expect(moveClock(base, 'wednesday')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('builds members that match a narrow profile', async () => {
    const me = await createMember(ctx, { gender: 'woman', seeks: 'men', age: 31, radiusKm: 5 });
    await seedMembersAround(ctx, me, 8);
    await dealNow(ctx);
    expect((await devStatus(ctx, me)).my_cards).toBe(6);
  });
});
