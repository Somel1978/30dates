import { addDays } from '@thirtydates/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { withSystemTx } from '../src/db/pool.js';
import { runMondayBatch, stage1FilterEligiblePairs, stage2ScoreCandidates } from '../src/matching/matching.js';
import { TEST_WEEK, createMember, makeCtx, resetDb, type MemberOptions } from './helpers.js';

const ctx = makeCtx();

async function eligiblePairs(week = TEST_WEEK): Promise<Set<string>> {
  return withSystemTx(ctx.db, async (tx) => {
    await stage1FilterEligiblePairs(tx, week);
    const { rows } = await tx.query<{ a: string; b: string }>('SELECT a, b FROM stage1_pairs');
    return new Set(rows.map((r) => `${r.a}|${r.b}`));
  });
}

function pairKey(x: string, y: string) {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

async function eligible(a: MemberOptions, b: MemberOptions): Promise<boolean> {
  await resetDb();
  const x = await createMember(ctx, a);
  const y = await createMember(ctx, b);
  return (await eligiblePairs()).has(pairKey(x, y));
}

async function batchOf(userId: string, week = TEST_WEEK): Promise<string[]> {
  const { rows } = await ctx.db.query<{ card_user_ids: string[] }>(
    'SELECT card_user_ids FROM weekly_batches WHERE user_id = $1 AND batch_week = $2',
    [userId, week],
  );
  return rows[0]?.card_user_ids ?? [];
}

describe('Stage 1 — hard SQL filter', () => {
  beforeEach(resetDb);

  it('enforces the bilateral 14-year window', async () => {
    expect(await eligible({ age: 35 }, { age: 42 })).toBe(true);
    expect(await eligible({ age: 35 }, { age: 43 })).toBe(false);
    expect(await eligible({ age: 50 }, { age: 43 })).toBe(true);
  });

  it('enforces mutual orientation', async () => {
    expect(await eligible({ gender: 'man', seeks: 'women' }, { gender: 'woman', seeks: 'men' })).toBe(true);
    expect(await eligible({ gender: 'man', seeks: 'women' }, { gender: 'woman', seeks: 'women' })).toBe(false);
    expect(await eligible({ gender: 'woman', seeks: 'women' }, { gender: 'woman', seeks: 'everyone' })).toBe(true);
    expect(await eligible({ gender: 'non_binary', seeks: 'everyone' }, { gender: 'man', seeks: 'women' })).toBe(false);
    expect(await eligible({ gender: 'non_binary', seeks: 'everyone' }, { gender: 'man', seeks: 'everyone' })).toBe(true);
  });

  it('requires each user’s own radius to cover the other (PostGIS)', async () => {
    // London ↔ Brighton is ~76 km.
    const london = { lat: 51.5072, lng: -0.1276 };
    const brighton = { lat: 50.8225, lng: -0.1372 };
    expect(await eligible({ ...london, radiusKm: 100 }, { ...brighton, radiusKm: 100 })).toBe(true);
    expect(await eligible({ ...london, radiusKm: 100 }, { ...brighton, radiusKm: 50 })).toBe(false);
  });

  it('rejects hard life-architecture contradictions', async () => {
    expect(await eligible({ gates: { family_goal: 'family_builder' } }, { gates: { family_goal: 'sovereign_lat' } })).toBe(false);
    expect(await eligible({ gates: { family_goal: 'blended_coparent' } }, { gates: { family_goal: 'sovereign_lat' } })).toBe(true);
    expect(await eligible({ gates: { living_architecture: 'cohabit' } }, { gates: { living_architecture: 'lat' } })).toBe(false);
    expect(await eligible({ gates: { living_architecture: 'flexible' } }, { gates: { living_architecture: 'lat' } })).toBe(true);
  });

  it('excludes inactive, paused and aged-out users', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    const c = await createMember(ctx);
    await ctx.db.query('UPDATE users SET paused_at = now() WHERE id = $1', [b]);
    await ctx.db.query('UPDATE users SET is_active = false WHERE id = $1', [c]);
    const pairs = await eligiblePairs();
    expect(pairs.has(pairKey(a, b))).toBe(false);
    expect(pairs.has(pairKey(a, c))).toBe(false);
  });

  it('never re-deals a pair that has shared a batch', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    expect((await eligiblePairs()).has(pairKey(a, b))).toBe(true);
    await ctx.db.query('INSERT INTO weekly_batches (user_id, batch_week, card_user_ids) VALUES ($1, $2, $3)', [
      a,
      addDays(TEST_WEEK, -7),
      [b],
    ]);
    expect((await eligiblePairs()).has(pairKey(a, b))).toBe(false);
  });

  it('excludes blocked pairs', async () => {
    const a = await createMember(ctx);
    const b = await createMember(ctx);
    await ctx.db.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [b, a]);
    expect((await eligiblePairs()).has(pairKey(a, b))).toBe(false);
  });
});

describe('Stage 2 — pgvector scoring', () => {
  beforeEach(resetDb);

  it('scores lifestyle neighbours higher using cosine distance', async () => {
    const runner = await createMember(ctx, { interests: ['trail_running', 'hiking', 'open_water_swimming'] });
    const hiker = await createMember(ctx, { interests: ['hiking', 'cycling_touring', 'dog_life'] });
    const homebody = await createMember(ctx, { interests: ['film_nights', 'board_games', 'reading_fiction'] });
    const scored = await withSystemTx(ctx.db, async (tx) => {
      await stage1FilterEligiblePairs(tx, TEST_WEEK);
      return stage2ScoreCandidates(tx, 24);
    });
    const score = (x: string, y: string) => scored.find((s) => pairKey(s.a, s.b) === pairKey(x, y))!.score;
    expect(score(runner, hiker)).toBeGreaterThan(score(runner, homebody));
    for (const s of scored) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(1.000001);
    }
  });
});

describe('Monday batch run', () => {
  beforeEach(resetDb);

  async function seedPool(n: number): Promise<string[]> {
    const interestSets: [string, string, string][] = [
      ['hiking', 'home_cooking', 'reading_fiction'],
      ['trail_running', 'specialty_coffee', 'chess'],
      ['live_music', 'dinner_hosting', 'natural_wine'],
      ['ceramics', 'museums_galleries', 'writing'],
      ['dog_life', 'gardening', 'baking'],
    ];
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        await createMember(ctx, {
          age: 36 + (i % 8),
          gender: i % 2 === 0 ? 'woman' : 'man',
          seeks: 'everyone',
          interests: interestSets[i % interestSets.length]!,
          lat: 51.5 + (i % 5) * 0.01,
          lng: -0.12 + (i % 7) * 0.01,
        }),
      );
    }
    return ids;
  }

  it('deals symmetric, non-repeating batches of up to six cards', async () => {
    const ids = await seedPool(16);
    const summary = await runMondayBatch(ctx.db, TEST_WEEK, 24);
    expect(summary.status).toBe('completed');
    expect(summary.usersConsidered).toBe(16);

    for (const id of ids) {
      const cards = await batchOf(id);
      expect(cards).toHaveLength(6);
      expect(new Set(cards).size).toBe(6);
      for (const c of cards) expect(await batchOf(c)).toContain(id);
    }

    const next = addDays(TEST_WEEK, 7);
    await runMondayBatch(ctx.db, next, 24);
    for (const id of ids) {
      const week1 = new Set(await batchOf(id));
      for (const c of await batchOf(id, next)) expect(week1.has(c)).toBe(false);
    }
  });

  it('is idempotent for a week', async () => {
    await seedPool(8);
    await runMondayBatch(ctx.db, TEST_WEEK, 24);
    const again = await runMondayBatch(ctx.db, TEST_WEEK, 24);
    expect(again.status).toBe('already_completed');
    const { rows } = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM weekly_batches');
    expect(rows[0]!.n).toBe(8);
  });

  it('carries a frozen card into the freezer’s next batch only', async () => {
    const ids = await seedPool(12);
    await runMondayBatch(ctx.db, TEST_WEEK, 24);
    const freezer = ids[0]!;
    const frozen = (await batchOf(freezer))[0]!;
    await ctx.db.query('UPDATE weekly_batches SET frozen_user_id = $2 WHERE user_id = $1 AND batch_week = $3', [
      freezer,
      frozen,
      TEST_WEEK,
    ]);

    const next = addDays(TEST_WEEK, 7);
    const summary = await runMondayBatch(ctx.db, next, 24);
    expect(summary.carriedCards).toBe(1);
    const freezerNext = await batchOf(freezer, next);
    expect(freezerNext[0]).toBe(frozen);
    expect(freezerNext.length).toBeLessThanOrEqual(6);
    expect(await batchOf(frozen, next)).not.toContain(freezer);
    const { rows } = await ctx.db.query<{ carried_over_user_id: string }>(
      'SELECT carried_over_user_id FROM weekly_batches WHERE user_id = $1 AND batch_week = $2',
      [freezer, next],
    );
    expect(rows[0]!.carried_over_user_id).toBe(frozen);
  });

  it('records a shortfall instead of breaking hard filters in a thin pool', async () => {
    await createMember(ctx, { age: 33 });
    await createMember(ctx, { age: 52 });
    const summary = await runMondayBatch(ctx.db, TEST_WEEK, 24);
    expect(summary.eligiblePairs).toBe(0);
    expect(summary.shortfallUsers).toBe(2);
    const { rows } = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM weekly_batches');
    expect(rows[0]!.n).toBe(0);
  });
});
