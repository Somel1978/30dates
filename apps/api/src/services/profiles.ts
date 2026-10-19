import { gateBadges, interestLabel, type CardProfile, type LifeArchitectureGates } from '@thirtydates/shared';
import type { Tx } from '../db/pool.js';

/**
 * Faceless card profiles: zero photos, zero names. Distance is rounded up to whole kilometres
 * from the viewer's stored (already ~100 m-rounded) coordinates.
 */
export async function loadCardProfiles(tx: Tx, viewerId: string, userIds: readonly string[]): Promise<Map<string, CardProfile>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await tx.query<{
    id: string;
    distance_km: number;
    family_goal: LifeArchitectureGates['family_goal'];
    living_architecture: LifeArchitectureGates['living_architecture'];
    mobility: LifeArchitectureGates['mobility'];
    financial_rhythm: LifeArchitectureGates['financial_rhythm'];
    flaw: string;
    upside: string;
    interests: { position: number; key: string; receipt: string }[];
  }>(
    `SELECT u.id,
            greatest(1, ceil(ST_Distance(u.coordinates::geography, me.coordinates::geography) / 1000.0))::int AS distance_km,
            g.family_goal, g.living_architecture, g.mobility, g.financial_rhythm,
            c.flaw, c.upside,
            coalesce((SELECT json_agg(json_build_object('position', bi.position, 'key', bi.interest_key, 'receipt', bi.receipt)
                                      ORDER BY bi.position)
                        FROM behavioral_interests bi WHERE bi.user_id = u.id), '[]') AS interests
       FROM users u
       JOIN life_architecture_gates g ON g.user_id = u.id
       JOIN flaw_upside_coins c ON c.user_id = u.id
       CROSS JOIN (SELECT coordinates FROM users WHERE id = $1) me
      WHERE u.id = ANY ($2::uuid[])`,
    [viewerId, userIds],
  );
  return new Map(
    rows.map((r) => {
      const gates: LifeArchitectureGates = {
        family_goal: r.family_goal,
        living_architecture: r.living_architecture,
        mobility: r.mobility,
        financial_rhythm: r.financial_rhythm,
      };
      return [
        r.id,
        {
          user_id: r.id,
          distance_km: r.distance_km,
          badges: gateBadges(gates),
          gates,
          interests: r.interests.map((i) => ({ ...i, label: interestLabel(i.key) })),
          coin: { flaw: r.flaw, upside: r.upside },
        },
      ];
    }),
  );
}

/** First name and photo ids — only ever called for revealed mutual pairs and matches. */
export async function loadRevealedIdentities(
  tx: Tx,
  userIds: readonly string[],
): Promise<Map<string, { first_name: string; photo_ids: string[] }>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await tx.query<{ id: string; first_name: string; photo_ids: string[] }>(
    `SELECT u.id, u.first_name,
            coalesce(array_agg(p.id ORDER BY p.position) FILTER (WHERE p.id IS NOT NULL), '{}') AS photo_ids
       FROM users u LEFT JOIN user_photos p ON p.user_id = u.id
      WHERE u.id = ANY ($1::uuid[])
      GROUP BY u.id`,
    [userIds],
  );
  return new Map(rows.map((r) => [r.id, { first_name: r.first_name, photo_ids: r.photo_ids }]));
}
