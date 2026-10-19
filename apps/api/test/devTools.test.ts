import { beforeEach, describe, expect, it } from 'vitest';
import { recordEscrowAction } from '../src/services/escrow.js';
import { dealNow, devStatus, moveClock, seedMembersAround, signalMe, stampMe } from '../src/services/devTools.js';
import { getCurrentBatch } from '../src/services/batches.js';
import { submitSignal } from '../src/services/signals.js';
import { at, createMember, makeCtx, resetDb } from './helpers.js';

const base = makeCtx(at(0, 9));
// Test tools only exist in development.
const ctx = { ...base, config: { ...base.config, NODE_ENV: 'development' as const } };

beforeEach(async () => {
  await resetDb();
  base.setNow(at(0, 9));
});

describe('test tools', () => {
  it('walk one person through a whole week: seed, deal, mutual, reveal, signal, match', async () => {
    const me = await createMember(ctx, { gender: 'man', seeks: 'women', age: 44, gates: { family_goal: 'sovereign_lat' } });
    await seedMembersAround(ctx, me, 12);

    await dealNow(ctx);
    let status = await devStatus(ctx, me);
    expect(status.my_cards).toBe(6);

    // Every seeded card is a woman within my window who seeks me back.
    const batch = await getCurrentBatch(ctx, me);
    expect(batch.cards).toHaveLength(6);

    expect(await stampMe(ctx, me, 3)).toBe(3);
    const stampedMe = batch.cards.slice(0, 3).map((c) => c.user_id);
    for (const other of stampedMe) {
      await recordEscrowAction(ctx, me, other, { kind: 'validated', stamp: 'made_me_smile', line: 'flaw' });
    }
    status = await devStatus(ctx, me);
    expect(status.mutual).toBe(3);

    await moveClock(ctx, 'reveal');
    expect((await getCurrentBatch(ctx, me)).mutual.every((m) => m.revealed !== null)).toBe(true);

    await moveClock(ctx, 'signal');
    await submitSignal(ctx, me, stampedMe[0]!);
    expect(await signalMe(ctx, me)).toBe(3);
    status = await devStatus(ctx, me);
    expect(status.matches).toBe(1);

    await moveClock(ctx, 'next_monday');
    status = await devStatus(ctx, me);
    expect(status.phase).toBe('validation');
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
