import { CARDS_PER_BATCH, PLATFORM_MAX_AGE, PLATFORM_MIN_AGE, AGE_WINDOW_HALF_SPAN, addDays } from '@thirtydates/shared';
import { withSystemTx, type Db, type Tx } from '../db/pool.js';
import { assignStableBatches, type ScoredPair } from './galeShapley.js';

/**
 * Monday batch pipeline (runs Monday 07:00 UTC):
 *   Stage 1 — SQL hard filter: platform age bounds, bilateral 14-year window, mutual orientation,
 *             bilateral PostGIS radius, life-architecture gate compatibility, and never-repeat
 *             history (weekly_batches, escrow_vault, matches) plus blocks.
 *   Stage 2 — pgvector cosine scoring (<=>) of the surviving pairs, top-K per user.
 *   Stage 3 — capacitated Gale–Shapley assignment of symmetric 6-card batches.
 * Frozen cards from the previous week are carried into the freezer's batch only (see escrow
 * service for why carries are one-sided) and consume one of their six slots.
 */

export interface BatchRunSummary {
  batchWeek: string;
  status: 'completed' | 'locked_elsewhere';
  usersConsidered: number;
  eligiblePairs: number;
  edgesAssigned: number;
  carriedCards: number;
  shortfallUsers: number;
}

export interface Stage1Result {
  poolSize: number;
  pairCount: number;
}

/**
 * Stage 1. Materialises `stage1_pool` (matchable users as of the batch week) and
 * `stage1_pairs` (unordered pairs, a < b, that pass every hard filter). Both are temp
 * tables dropped at commit.
 */
export async function stage1FilterEligiblePairs(tx: Tx, batchWeek: string): Promise<Stage1Result> {
  await tx.query(`
    CREATE TEMP TABLE stage1_pool (
      id                  uuid PRIMARY KEY,
      gender              gender_identity NOT NULL,
      seeks               seeks_preference NOT NULL,
      age                 integer NOT NULL,
      geog                geography(Point, 4326) NOT NULL,
      radius_m            double precision NOT NULL,
      family_goal         text NOT NULL,
      living_architecture text NOT NULL,
      mobility            text NOT NULL,
      financial_rhythm    text NOT NULL
    ) ON COMMIT DROP`);

  const pool = await tx.query(
    `INSERT INTO stage1_pool
     SELECT u.id, u.gender, u.seeks, age_in_years(u.birth_date, $1::date), u.coordinates::geography,
            u.search_radius_km * 1000.0,
            g.family_goal::text, g.living_architecture::text, g.mobility::text, g.financial_rhythm::text
       FROM users u
       JOIN life_architecture_gates g ON g.user_id = u.id
       JOIN psychometric_vectors pv ON pv.user_id = u.id
      WHERE u.is_active
        AND u.paused_at IS NULL
        AND u.onboarding_completed_at IS NOT NULL
        AND u.email_verified_at IS NOT NULL
        AND u.coordinates IS NOT NULL
        AND age_in_years(u.birth_date, $1::date) BETWEEN $2::int AND $3::int`,
    [batchWeek, PLATFORM_MIN_AGE, PLATFORM_MAX_AGE],
  );
  await tx.query('CREATE INDEX ON stage1_pool USING gist (geog)');
  await tx.query('ANALYZE stage1_pool');

  await tx.query(`CREATE TEMP TABLE stage1_pairs (a uuid NOT NULL, b uuid NOT NULL, PRIMARY KEY (a, b)) ON COMMIT DROP`);
  const pairs = await tx.query(
    `INSERT INTO stage1_pairs (a, b)
     SELECT a.id, b.id
       FROM stage1_pool a
       JOIN stage1_pool b
         ON b.id > a.id
        -- Bilateral radius: each user's own search radius must cover the other.
        AND ST_DWithin(a.geog, b.geog, a.radius_m)
        AND ST_DWithin(a.geog, b.geog, b.radius_m)
      WHERE
        -- Bilateral 14-year window: [max(30, age − 7), min(55, age + 7)] in both directions.
            b.age BETWEEN GREATEST($1::int, a.age - $3::int) AND LEAST($2::int, a.age + $3::int)
        AND a.age BETWEEN GREATEST($1::int, b.age - $3::int) AND LEAST($2::int, b.age + $3::int)
        -- Mutual orientation.
        AND (a.seeks = 'everyone' OR (a.seeks = 'men' AND b.gender = 'man') OR (a.seeks = 'women' AND b.gender = 'woman'))
        AND (b.seeks = 'everyone' OR (b.seeks = 'men' AND a.gender = 'man') OR (b.seeks = 'women' AND a.gender = 'woman'))
        -- Life-architecture gates: no hard contradictions.
        AND EXISTS (SELECT 1 FROM gate_compatibility c WHERE c.gate = 'family_goal' AND c.value_a = a.family_goal AND c.value_b = b.family_goal)
        AND EXISTS (SELECT 1 FROM gate_compatibility c WHERE c.gate = 'living_architecture' AND c.value_a = a.living_architecture AND c.value_b = b.living_architecture)
        AND EXISTS (SELECT 1 FROM gate_compatibility c WHERE c.gate = 'mobility' AND c.value_a = a.mobility AND c.value_b = b.mobility)
        AND EXISTS (SELECT 1 FROM gate_compatibility c WHERE c.gate = 'financial_rhythm' AND c.value_a = a.financial_rhythm AND c.value_b = b.financial_rhythm)
        -- Never repeat a card: any previous batch, escrow stake or match between the two.
        AND NOT EXISTS (SELECT 1 FROM weekly_batches wb WHERE wb.user_id = a.id AND wb.card_user_ids @> ARRAY[b.id])
        AND NOT EXISTS (SELECT 1 FROM weekly_batches wb WHERE wb.user_id = b.id AND wb.card_user_ids @> ARRAY[a.id])
        AND NOT EXISTS (SELECT 1 FROM escrow_vault ev WHERE ev.user_a_id = a.id AND ev.user_b_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.user_a_id = a.id AND m.user_b_id = b.id)
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
           WHERE (ub.blocker_id = a.id AND ub.blocked_id = b.id) OR (ub.blocker_id = b.id AND ub.blocked_id = a.id)
        )`,
    [PLATFORM_MIN_AGE, PLATFORM_MAX_AGE, AGE_WINDOW_HALF_SPAN],
  );
  return { poolSize: pool.rowCount ?? 0, pairCount: pairs.rowCount ?? 0 };
}

/**
 * Stage 2. Cosine similarity (1 − pgvector `<=>` distance) for every Stage 1 pair, keeping a
 * pair when it ranks inside either user's top K. Both sides of a kept pair see the same score.
 */
export async function stage2ScoreCandidates(tx: Tx, topK: number): Promise<ScoredPair[]> {
  const { rows } = await tx.query<{ a: string; b: string; similarity: number }>(
    `WITH scored AS (
       SELECT p.a, p.b, 1 - (va.embedding <=> vb.embedding) AS similarity
         FROM stage1_pairs p
         JOIN psychometric_vectors va ON va.user_id = p.a
         JOIN psychometric_vectors vb ON vb.user_id = p.b
     ),
     directed AS (
       SELECT a AS u, b AS v, a, b, similarity FROM scored
       UNION ALL
       SELECT b AS u, a AS v, a, b, similarity FROM scored
     ),
     ranked AS (
       SELECT a, b, similarity, row_number() OVER (PARTITION BY u ORDER BY similarity DESC, v) AS rn
         FROM directed
     )
     SELECT a, b, max(similarity)::float8 AS similarity
       FROM ranked
      WHERE rn <= $1
      GROUP BY a, b`,
    [topK],
  );
  return rows.map((r) => ({ a: r.a, b: r.b, score: r.similarity }));
}

interface CarryOver {
  userId: string;
  cardUserId: string;
}

/** Frozen cards from last week that are still valid (both users matchable, not blocked/matched). */
async function loadCarryOvers(tx: Tx, batchWeek: string): Promise<CarryOver[]> {
  const { rows } = await tx.query<{ user_id: string; frozen_user_id: string }>(
    `SELECT wb.user_id, wb.frozen_user_id
       FROM weekly_batches wb
       JOIN stage1_pool p1 ON p1.id = wb.user_id
       JOIN stage1_pool p2 ON p2.id = wb.frozen_user_id
      WHERE wb.batch_week = $1::date
        AND wb.frozen_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
           WHERE (ub.blocker_id = wb.user_id AND ub.blocked_id = wb.frozen_user_id)
              OR (ub.blocker_id = wb.frozen_user_id AND ub.blocked_id = wb.user_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM matches m
           WHERE m.user_a_id = LEAST(wb.user_id, wb.frozen_user_id)
             AND m.user_b_id = GREATEST(wb.user_id, wb.frozen_user_id)
        )`,
    [addDays(batchWeek, -7)],
  );
  return rows.map((r) => ({ userId: r.user_id, cardUserId: r.frozen_user_id }));
}

/** Stage 3: capacitated Gale–Shapley over the scored pairs; `capacity` is each member's free slots. */
export function stage3AssignBatches(
  poolUserIds: readonly string[],
  pairs: readonly ScoredPair[],
  capacity: (userId: string) => number,
): Map<string, string[]> {
  return assignStableBatches({ users: poolUserIds, pairs, capacity }).partners;
}

/**
 * Deals (or tops up) a week's batches. The first run of a week is the Monday deal; later runs
 * only fill members who are below six cards — late joiners and anyone left short — and never
 * remove or replace a card already dealt. Re-running with nothing new is a no-op.
 */
export async function runMondayBatch(db: Db, batchWeek: string, topK: number): Promise<BatchRunSummary> {
  return withSystemTx(db, async (tx) => {
    const empty = { usersConsidered: 0, eligiblePairs: 0, edgesAssigned: 0, carriedCards: 0, shortfallUsers: 0 };
    const lock = await tx.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('monday_batch')) AS ok");
    if (!lock.rows[0]!.ok) return { batchWeek, status: 'locked_elsewhere', ...empty };

    await tx.query(
      `INSERT INTO batch_runs (batch_week) VALUES ($1)
       ON CONFLICT (batch_week) DO UPDATE SET started_at = now()`,
      [batchWeek],
    );

    const stage1 = await stage1FilterEligiblePairs(tx, batchWeek);
    const poolIds = (await tx.query<{ id: string }>('SELECT id FROM stage1_pool ORDER BY id')).rows.map((r) => r.id);
    const existing = new Map(
      (
        await tx.query<{ user_id: string; card_user_ids: string[] }>(
          'SELECT user_id, card_user_ids FROM weekly_batches WHERE batch_week = $1',
          [batchWeek],
        )
      ).rows.map((r) => [r.user_id, r.card_user_ids]),
    );
    // Carries apply when a member's batch is first created.
    const carries = new Map(
      (await loadCarryOvers(tx, batchWeek)).filter((c) => !existing.has(c.userId)).map((c) => [c.userId, c.cardUserId]),
    );
    const scored = await stage2ScoreCandidates(tx, topK);
    const assignment = stage3AssignBatches(
      poolIds,
      scored,
      (u) => CARDS_PER_BATCH - (existing.get(u)?.length ?? 0) - (carries.has(u) ? 1 : 0),
    );

    const inserts: { user_id: string; cards: string[]; carried: string | null }[] = [];
    const appends: { user_id: string; cards: string[] }[] = [];
    let edgeEndpoints = 0;
    let shortfallUsers = 0;
    for (const userId of poolIds) {
      const added = assignment.get(userId) ?? [];
      edgeEndpoints += added.length;
      const held = existing.get(userId);
      const carried = carries.get(userId) ?? null;
      const total = (held?.length ?? 0) + (carried ? 1 : 0) + added.length;
      if (total < CARDS_PER_BATCH) shortfallUsers++;
      if (held) {
        if (added.length > 0) appends.push({ user_id: userId, cards: added });
      } else if (carried || added.length > 0) {
        inserts.push({ user_id: userId, cards: carried ? [carried, ...added] : added, carried });
      }
    }

    if (inserts.length > 0) {
      await tx.query(
        `INSERT INTO weekly_batches (user_id, batch_week, card_user_ids, carried_over_user_id)
         SELECT r.user_id, $1::date, r.cards, r.carried
           FROM jsonb_to_recordset($2::jsonb) AS r (user_id uuid, cards uuid[], carried uuid)`,
        [batchWeek, JSON.stringify(inserts)],
      );
    }
    if (appends.length > 0) {
      await tx.query(
        `UPDATE weekly_batches wb SET card_user_ids = wb.card_user_ids || r.cards
           FROM jsonb_to_recordset($2::jsonb) AS r (user_id uuid, cards uuid[])
          WHERE wb.user_id = r.user_id AND wb.batch_week = $1::date`,
        [batchWeek, JSON.stringify(appends)],
      );
    }

    const summary: BatchRunSummary = {
      batchWeek,
      status: 'completed',
      usersConsidered: stage1.poolSize,
      eligiblePairs: stage1.pairCount,
      edgesAssigned: edgeEndpoints / 2,
      carriedCards: carries.size,
      shortfallUsers,
    };
    await tx.query(
      `UPDATE batch_runs
          SET completed_at = now(), users_considered = $2, eligible_pairs = $3,
              edges_assigned = coalesce(edges_assigned, 0) + $4,
              carried_cards = coalesce(carried_cards, 0) + $5, shortfall_users = $6, stats = $7::jsonb
        WHERE batch_week = $1`,
      [
        batchWeek,
        summary.usersConsidered,
        summary.eligiblePairs,
        summary.edgesAssigned,
        summary.carriedCards,
        summary.shortfallUsers,
        JSON.stringify({ scored_pairs: scored.length, top_k: topK }),
      ],
    );
    return summary;
  });
}
