import { describe, expect, it } from 'vitest';
import { assignStableBatches, findBlockingPairs, type ScoredPair } from '../src/matching/galeShapley.js';

/** Small deterministic PRNG so failures are reproducible. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function randomInstance(seed: number, users: number, density: number) {
  const rand = prng(seed);
  const ids = Array.from({ length: users }, (_, i) => `u${String(i).padStart(3, '0')}`);
  const pairs: ScoredPair[] = [];
  for (let i = 0; i < users; i++) {
    for (let j = i + 1; j < users; j++) {
      if (rand() < density) pairs.push({ a: ids[i]!, b: ids[j]!, score: Math.round(rand() * 1000) / 1000 });
    }
  }
  return { ids, pairs };
}

describe('capacitated Gale–Shapley', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('produces a stable, symmetric, capacity-respecting assignment (seed %i)', (seed) => {
    const { ids, pairs } = randomInstance(seed, 60, 0.25);
    const capacity = (u: string) => (u.endsWith('7') ? 5 : 6);
    const input = { users: ids, pairs, capacity, augmentCoverage: false };
    const { partners } = assignStableBatches(input);

    const allowed = new Set(pairs.map((p) => `${p.a}|${p.b}`));
    for (const [u, list] of partners) {
      expect(list.length).toBeLessThanOrEqual(capacity(u));
      expect(new Set(list).size).toBe(list.length);
      for (const v of list) {
        expect(partners.get(v)).toContain(u);
        expect(allowed.has(u < v ? `${u}|${v}` : `${v}|${u}`)).toBe(true);
      }
    }
    expect(findBlockingPairs(input, partners)).toEqual([]);
  });

  it('augments coverage when a stable assignment leaves users short', () => {
    // Uniform scores: the stable assignment can strand two users with one card each.
    const ids = Array.from({ length: 16 }, (_, i) => `u${String(i).padStart(2, '0')}`);
    const pairs: ScoredPair[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) pairs.push({ a: ids[i]!, b: ids[j]!, score: 0.9 });
    }
    const stableOnly = assignStableBatches({ users: ids, pairs, capacity: () => 6, augmentCoverage: false });
    const full = assignStableBatches({ users: ids, pairs, capacity: () => 6 });
    const total = (m: Map<string, string[]>) => [...m.values()].reduce((n, l) => n + l.length, 0);
    expect(total(full.partners)).toBeGreaterThanOrEqual(total(stableOnly.partners));
    for (const [u, list] of full.partners) {
      expect(list).toHaveLength(6);
      for (const v of list) expect(full.partners.get(v)).toContain(u);
    }
  });

  it.each([11, 12, 13])('never breaks symmetry or capacity while augmenting (seed %i)', (seed) => {
    const { ids, pairs } = randomInstance(seed, 50, 0.2);
    const { partners } = assignStableBatches({ users: ids, pairs, capacity: () => 6 });
    const allowed = new Set(pairs.map((p) => `${p.a}|${p.b}`));
    for (const [u, list] of partners) {
      expect(list.length).toBeLessThanOrEqual(6);
      expect(new Set(list).size).toBe(list.length);
      for (const v of list) {
        expect(partners.get(v)).toContain(u);
        expect(allowed.has(u < v ? `${u}|${v}` : `${v}|${u}`)).toBe(true);
      }
    }
  });

  it('fills everyone to capacity in a dense pool', () => {
    const { ids, pairs } = randomInstance(42, 40, 1);
    const { partners } = assignStableBatches({ users: ids, pairs, capacity: () => 6 });
    for (const list of partners.values()) expect(list).toHaveLength(6);
  });

  it('is deterministic regardless of input order', () => {
    const { ids, pairs } = randomInstance(9, 30, 0.4);
    const a = assignStableBatches({ users: ids, pairs, capacity: () => 6 });
    const b = assignStableBatches({ users: [...ids].reverse(), pairs: [...pairs].reverse(), capacity: () => 6 });
    expect([...b.partners.entries()].sort()).toEqual([...a.partners.entries()].sort());
  });

  it('respects zero capacity and ignores unknown users', () => {
    const { partners } = assignStableBatches({
      users: ['a', 'b', 'c'],
      pairs: [
        { a: 'a', b: 'b', score: 0.9 },
        { a: 'a', b: 'c', score: 0.8 },
        { a: 'a', b: 'zzz', score: 1 },
      ],
      capacity: (u) => (u === 'b' ? 0 : 6),
    });
    expect(partners.get('a')).toEqual(['c']);
    expect(partners.get('b')).toEqual([]);
  });

  it('gives each user their best mutual options when capacity is tight', () => {
    // a and b are each other's top choice; c is everyone's second choice.
    const pairs = [
      { a: 'a', b: 'b', score: 0.95 },
      { a: 'a', b: 'c', score: 0.6 },
      { a: 'b', b: 'c', score: 0.5 },
    ];
    const input = { users: ['a', 'b', 'c'], pairs, capacity: () => 1, augmentCoverage: false };
    const { partners } = assignStableBatches(input);
    expect(partners.get('a')).toEqual(['b']);
    expect(partners.get('c')).toEqual([]);
    expect(findBlockingPairs(input, partners)).toEqual([]);
  });
});
