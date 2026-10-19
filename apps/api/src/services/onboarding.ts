import {
  FAMILY_GOALS,
  FINANCIAL_RHYTHMS,
  GENDERS,
  INTEREST_BY_KEY,
  LIVING_ARCHITECTURES,
  MOBILITY_PROFILES,
  PLATFORM_MAX_AGE,
  PLATFORM_MIN_AGE,
  SEEKS,
  VECTOR_VERSION,
  ageOn,
  buildPsychometricVector,
  toPgVector,
  type MeResponse,
} from '@thirtydates/shared';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withUserTx } from '../db/pool.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { isValidTimeZone } from '../lib/tz.js';

/** ~100 m precision (3 decimal places of a degree). */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Invalid date');

export const onboardingSchema = z.object({
  first_name: z.string().trim().min(1).max(40),
  birth_date: isoDate,
  gender: z.enum(GENDERS),
  seeks: z.enum(SEEKS),
  country_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((s) => s.toUpperCase()),
  postal_code: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .transform((s) => s.toUpperCase().replace(/\s+/g, ' ')),
  coordinates: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  time_zone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
  search_radius_km: z.number().int().min(5).max(200),
  gates: z.object({
    family_goal: z.enum(FAMILY_GOALS),
    living_architecture: z.enum(LIVING_ARCHITECTURES),
    mobility: z.enum(MOBILITY_PROFILES),
    financial_rhythm: z.enum(FINANCIAL_RHYTHMS),
  }),
  coin: z.object({
    flaw: z.string().trim().min(3).max(120),
    upside: z.string().trim().min(3).max(120),
  }),
  interests: z
    .array(
      z.object({
        key: z.string().refine((k) => INTEREST_BY_KEY.has(k), 'Unknown interest'),
        receipt: z.string().trim().min(3).max(140),
      }),
    )
    .length(3)
    .refine((list) => new Set(list.map((i) => i.key)).size === list.length, 'Interests must be distinct'),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

/**
 * Day-1 onboarding payload. Writes the profile, the life-architecture gates, the coin, the three
 * behavioral interests and the deterministic psychometric vector in one transaction.
 */
export async function completeOnboarding(ctx: AppContext, userId: string, input: OnboardingInput): Promise<void> {
  const age = ageOn(input.birth_date, ctx.now());
  if (age < PLATFORM_MIN_AGE || age > PLATFORM_MAX_AGE) {
    throw unprocessable('age_out_of_bounds', `This platform is for members aged ${PLATFORM_MIN_AGE} to ${PLATFORM_MAX_AGE}.`);
  }
  const vector = buildPsychometricVector(
    input.gates,
    input.interests.map((i) => i.key),
  );

  await withUserTx(ctx.db, userId, async (tx) => {
    let lat: number;
    let lng: number;
    if (input.coordinates) {
      lat = roundCoordinate(input.coordinates.lat);
      lng = roundCoordinate(input.coordinates.lng);
    } else {
      const centroid = await tx.query<{ lat: number; lng: number }>(
        `SELECT ST_Y(centroid) AS lat, ST_X(centroid) AS lng
           FROM postal_code_centroids WHERE country_code = $1 AND postal_code = $2`,
        [input.country_code, input.postal_code],
      );
      const row = centroid.rows[0];
      if (!row) {
        throw unprocessable('location_unresolved', 'We could not place that postal code. Share your approximate location instead.');
      }
      lat = roundCoordinate(row.lat);
      lng = roundCoordinate(row.lng);
    }

    const updated = await tx.query(
      `UPDATE users SET
         first_name = $2, birth_date = $3, gender = $4, seeks = $5,
         country_code = $6, postal_code = $7,
         coordinates = ST_SetSRID(ST_MakePoint($8, $9), 4326),
         time_zone = $10, search_radius_km = $11,
         onboarding_completed_at = coalesce(onboarding_completed_at, now())
       WHERE id = $1 AND email_verified_at IS NOT NULL`,
      [
        userId,
        input.first_name,
        input.birth_date,
        input.gender,
        input.seeks,
        input.country_code,
        input.postal_code,
        lng,
        lat,
        input.time_zone,
        input.search_radius_km,
      ],
    );
    if (updated.rowCount !== 1) throw notFound('user_not_found', 'Verify your email before onboarding');

    await tx.query(
      `INSERT INTO life_architecture_gates (user_id, family_goal, living_architecture, mobility, financial_rhythm)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         family_goal = EXCLUDED.family_goal, living_architecture = EXCLUDED.living_architecture,
         mobility = EXCLUDED.mobility, financial_rhythm = EXCLUDED.financial_rhythm`,
      [userId, input.gates.family_goal, input.gates.living_architecture, input.gates.mobility, input.gates.financial_rhythm],
    );
    await tx.query(
      `INSERT INTO flaw_upside_coins (user_id, flaw, upside) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET flaw = EXCLUDED.flaw, upside = EXCLUDED.upside`,
      [userId, input.coin.flaw, input.coin.upside],
    );
    await tx.query('DELETE FROM behavioral_interests WHERE user_id = $1', [userId]);
    await tx.query(
      `INSERT INTO behavioral_interests (user_id, position, interest_key, receipt)
       SELECT $1, ord, key, receipt
         FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS t (key, receipt, ord)`,
      [userId, input.interests.map((i) => i.key), input.interests.map((i) => i.receipt)],
    );
    await tx.query(
      `INSERT INTO psychometric_vectors (user_id, embedding, vector_version) VALUES ($1, $2::vector, $3)
       ON CONFLICT (user_id) DO UPDATE SET embedding = EXCLUDED.embedding, vector_version = EXCLUDED.vector_version`,
      [userId, toPgVector(vector), VECTOR_VERSION],
    );
  });
}

export async function getMe(ctx: AppContext, userId: string): Promise<MeResponse> {
  const { rows } = await ctx.db.query<{
    id: string;
    email: string;
    first_name: string | null;
    onboarding_completed_at: Date | null;
    time_zone: string | null;
    photos: { id: string; position: number }[];
  }>(
    `SELECT u.id, u.email, u.first_name, u.onboarding_completed_at, u.time_zone,
            coalesce((SELECT json_agg(json_build_object('id', p.id, 'position', p.position) ORDER BY p.position)
                        FROM user_photos p WHERE p.user_id = u.id), '[]') AS photos
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw notFound('user_not_found', 'Account not found');
  return {
    id: u.id,
    email: u.email,
    first_name: u.first_name,
    onboarding_completed: u.onboarding_completed_at !== null,
    time_zone: u.time_zone,
    photos: u.photos,
  };
}
