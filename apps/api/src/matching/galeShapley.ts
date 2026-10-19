/**
 * Stage 3 — capacitated Gale–Shapley deferred acceptance for symmetric weekly batches.
 *
 * Cards are symmetric (if A is dealt B, B is dealt A, otherwise blind escrow could never
 * become mutual), so the problem is a stable b-matching on a general graph: every user has a
 * capacity (6, or 5 when a frozen card is carried over) and both sides of a pair rank each
 * other by the same Stage 2 similarity.
 *
 * 1. Deferred acceptance: every user proposes down its preference list; a receiver holds the
 *    best proposals up to capacity and releases its worst holder when a better one arrives.
 *    Released users resume proposing from where they stopped. Pointers only move forward, so
 *    this phase is O(Σ preference-list lengths).
 * 2. Stabilisation: because preferences derive from one symmetric score, a stable matching
 *    always exists. Any blocking pair left by phase 1 (possible in non-bipartite pools) is
 *    satisfied highest-score first; each repair strictly increases the lexicographically
 *    sorted vector of matched scores, so the loop terminates with a stable assignment.
 *
 * 3. Coverage augmentation (on by default): a stable matching can still leave users short of
 *    six cards. While two short users x, y (or one user short by two) can each take one end of
 *    an assigned pair (u, v) — x–u and y–v acceptable — the pair is split and re-linked, which
 *    keeps u and v at the same count and fills x and y. The highest-score swap is applied
 *    first. This trades strict stability for complete batches only where someone is short.
 *
 * Ties are broken by the concatenated ordered pair key, giving one global strict edge order
 * and a fully deterministic result.
 */
export interface ScoredPair {
  a: string;
  b: string;
  score: number;
}

export interface StableAssignmentInput {
  users: readonly string[];
  pairs: readonly ScoredPair[];
  capacity: (userId: string) => number;
  /** Phase 3; defaults to true. */
  augmentCoverage?: boolean;
}

export interface StableAssignmentResult {
  /** Assigned partners per user, best first. Users with no partners map to []. */
  partners: Map<string, string[]>;
  proposals: number;
  repairs: number;
  augmentations: number;
}

interface Edge {
  a: string;
  b: string;
  score: number;
  key: string;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function compareEdges(x: Edge, y: Edge): number {
  if (x.score !== y.score) return y.score - x.score;
  return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
}

export function assignStableBatches(input: StableAssignmentInput): StableAssignmentResult {
  const users = [...new Set(input.users)].sort();
  const userSet = new Set(users);
  const capacity = new Map(users.map((u) => [u, Math.max(0, Math.floor(input.capacity(u)))]));

  // Deduplicate undirected edges, keeping the highest score.
  const edgesByKey = new Map<string, Edge>();
  for (const p of input.pairs) {
    if (p.a === p.b || !userSet.has(p.a) || !userSet.has(p.b) || !Number.isFinite(p.score)) continue;
    const key = edgeKey(p.a, p.b);
    const existing = edgesByKey.get(key);
    if (!existing || p.score > existing.score) edgesByKey.set(key, { a: p.a, b: p.b, score: p.score, key });
  }
  const edges = [...edgesByKey.values()].sort(compareEdges);

  // Preference lists inherit the global edge order, so every user's ranking is consistent with it.
  const prefs = new Map<string, string[]>(users.map((u) => [u, []]));
  for (const e of edges) {
    prefs.get(e.a)!.push(e.b);
    prefs.get(e.b)!.push(e.a);
  }
  const rank = new Map<string, Map<string, number>>();
  for (const [u, list] of prefs) rank.set(u, new Map(list.map((v, i) => [v, i])));

  const partners = new Map<string, Set<string>>(users.map((u) => [u, new Set()]));
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (u: string) => {
    if (!queued.has(u) && capacity.get(u)! > 0) {
      queued.add(u);
      queue.push(u);
    }
  };

  const isFree = (u: string) => partners.get(u)!.size < capacity.get(u)!;
  const worst = (u: string): string | undefined => {
    const r = rank.get(u)!;
    let worstV: string | undefined;
    let worstRank = -1;
    for (const v of partners.get(u)!) {
      const rv = r.get(v)!;
      if (rv > worstRank) {
        worstRank = rv;
        worstV = v;
      }
    }
    return worstV;
  };
  /** Would `u` take `v` now (free capacity, or `v` beats its current worst partner)? */
  const wouldAccept = (u: string, v: string): boolean => {
    if (capacity.get(u)! === 0) return false;
    if (isFree(u)) return true;
    const w = worst(u);
    return w !== undefined && rank.get(u)!.get(v)! < rank.get(u)!.get(w)!;
  };
  const link = (u: string, v: string) => {
    partners.get(u)!.add(v);
    partners.get(v)!.add(u);
  };
  const release = (holder: string, released: string) => {
    partners.get(holder)!.delete(released);
    partners.get(released)!.delete(holder);
    enqueue(released);
  };
  const makeRoomAndLink = (u: string, v: string) => {
    if (!isFree(u)) release(u, worst(u)!);
    if (!isFree(v)) release(v, worst(v)!);
    link(u, v);
  };

  // Phase 1: deferred acceptance.
  const pointer = new Map(users.map((u) => [u, 0]));
  let proposals = 0;
  users.forEach(enqueue);
  while (queue.length > 0) {
    const u = queue.shift()!;
    queued.delete(u);
    const list = prefs.get(u)!;
    while (pointer.get(u)! < list.length) {
      const v = list[pointer.get(u)!]!;
      // Lists are sorted, so once u is full and v is not an improvement, nothing later is either.
      if (!wouldAccept(u, v)) break;
      pointer.set(u, pointer.get(u)! + 1);
      if (partners.get(u)!.has(v)) continue;
      proposals++;
      if (!wouldAccept(v, u)) continue;
      makeRoomAndLink(u, v);
    }
  }

  // Phase 2: satisfy residual blocking pairs, best first, until none remain.
  let repairs = 0;
  const maxRepairs = edges.length * 8 + 1_000;
  for (;;) {
    const blocking = edges.find(
      (e) => !partners.get(e.a)!.has(e.b) && wouldAccept(e.a, e.b) && wouldAccept(e.b, e.a),
    );
    if (!blocking) break;
    makeRoomAndLink(blocking.a, blocking.b);
    if (++repairs > maxRepairs) throw new Error('stable_assignment_did_not_converge');
  }

  // Phase 3: coverage augmentation along alternating paths x–u, (u–v removed), v–y.
  let augmentations = 0;
  if (input.augmentCoverage ?? true) {
    const score = new Map(edges.map((e) => [e.key, e.score]));
    const s = (p: string, q: string) => score.get(edgeKey(p, q));
    const deficit = (u: string) => capacity.get(u)! - partners.get(u)!.size;
    for (;;) {
      const short = users.filter((u) => deficit(u) > 0);
      let best: { x: string; u: string; v: string; y: string; gain: number; key: string } | undefined;
      for (const x of short) {
        for (const u of prefs.get(x)!) {
          if (partners.get(x)!.has(u)) continue;
          const xu = s(x, u)!;
          for (const v of partners.get(u)!) {
            if (v === x) continue;
            const uv = s(u, v)!;
            for (const y of short) {
              if (y === u || y === v) continue;
              if (y === x ? deficit(x) < 2 || partners.get(x)!.has(v) : false) continue;
              const yv = s(y, v);
              if (yv === undefined || partners.get(y)!.has(v)) continue;
              const gain = xu + yv - uv;
              const key = `${x}|${u}|${v}|${y}`;
              if (!best || gain > best.gain || (gain === best.gain && key < best.key)) best = { x, u, v, y, gain, key };
            }
          }
        }
      }
      if (!best) break;
      partners.get(best.u)!.delete(best.v);
      partners.get(best.v)!.delete(best.u);
      link(best.x, best.u);
      link(best.y, best.v);
      augmentations++;
    }
  }

  const result = new Map<string, string[]>();
  for (const u of users) {
    const r = rank.get(u)!;
    result.set(u, [...partners.get(u)!].sort((x, y) => r.get(x)! - r.get(y)!));
  }
  return { partners: result, proposals, repairs, augmentations };
}

/** Pairs that would both rather be matched to each other than keep their current assignment. */
export function findBlockingPairs(input: StableAssignmentInput, partners: Map<string, string[]>): ScoredPair[] {
  const score = new Map<string, number>();
  for (const p of input.pairs) {
    const key = edgeKey(p.a, p.b);
    score.set(key, Math.max(score.get(key) ?? -Infinity, p.score));
  }
  const s = (u: string, v: string) => score.get(edgeKey(u, v))!;
  const keyOf = (u: string, v: string) => edgeKey(u, v);
  const better = (u: string, v: string, w: string) => {
    const sv = s(u, v);
    const sw = s(u, w);
    return sv > sw || (sv === sw && keyOf(u, v) < keyOf(u, w));
  };
  const wants = (u: string, v: string) => {
    const cap = input.capacity(u);
    const mine = partners.get(u) ?? [];
    if (cap <= 0) return false;
    if (mine.length < cap) return true;
    return mine.some((w) => better(u, v, w));
  };
  const out: ScoredPair[] = [];
  for (const [key, sc] of score) {
    const [a, b] = key.split('|') as [string, string];
    if ((partners.get(a) ?? []).includes(b)) continue;
    if (wants(a, b) && wants(b, a)) out.push({ a, b, score: sc });
  }
  return out;
}
