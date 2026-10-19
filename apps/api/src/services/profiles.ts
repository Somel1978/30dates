import { interestLabel, lifeRhythm, type CardProfile } from '@thirtydates/shared';
import type { Tx } from '../db/pool.js';

/**
 * Faceless card profiles: zero photos, zero names, and no structural gates (those filter
 * invisibly). Life Rhythm, behavioral interests and the Flaw + Upside coin only. Distance is
 * rounded up to whole kilometres from the viewer's stored (~100 m-rounded) coordinates.
 */
export async function loadCardProfiles(tx: Tx, viewerId: string, userIds: readonly string[]): Promise<Map<string, CardProfile>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await tx.query<{
    id: string;
    distance_km: number;
    flaw: string;
    upside: string;
    interests: { position: number; key: string; receipt: string }[];
  }>(
    `SELECT u.id,
            greatest(1, ceil(ST_Distance(u.coordinates::geography, me.coordinates::geography) / 1000.0))::int AS distance_km,
            c.flaw, c.upside,
            coalesce((SELECT json_agg(json_build_object('position', bi.position, 'key', bi.interest_key, 'receipt', bi.receipt)
                                      ORDER BY bi.position)
                        FROM behavioral_interests bi WHERE bi.user_id = u.id), '[]') AS interests
       FROM users u
       JOIN flaw_upside_coins c ON c.user_id = u.id
       CROSS JOIN (SELECT coordinates FROM users WHERE id = $1) me
      WHERE u.id = ANY ($2::uuid[])`,
    [viewerId, userIds],
  );
  return new Map(
    rows.map((r) => {
      return [
        r.id,
        {
          user_id: r.id,
          distance_km: r.distance_km,
          rhythm: lifeRhythm(r.interests.map((i) => i.key)),
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
