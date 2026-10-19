import { INTEREST_CATALOG, weekClock } from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx } from '../db/pool.js';
import { orderedPair, pairHash } from '../lib/crypto.js';
import { runMondayBatch } from '../matching/matching.js';
import { completeOnboarding, onboardingSchema } from '../services/onboarding.js';
import { createContext } from '../runtime.js';

/**
 * Development seed: ~30 onboarded members around central London, a handful of partner venues,
 * and an onboarded demo account. Deals this week's batches and has some members silently stamp
 * the demo account, so stamping them back produces mutual resonance.
 * Usage: npm run seed:demo -w @thirtydates/api -- you@example.com
 */
const FLAWS: [string, string][] = [
  ['Over-prepares for travel', 'Every trip is seamless'],
  ['Talks to every dog on the street', 'Never a dull walk'],
  ['Reads the ending first', 'Zero spoilers can hurt me'],
  ['Re-plans the week every Sunday', 'Your Monday is already sorted'],
  ['Laughs at my own jokes first', 'You will always know when to laugh'],
  ['Collects too many cookbooks', 'Dinner is never boring'],
];

async function seed(ctx: AppContext, demoEmail: string): Promise<void> {
  if (ctx.config.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const now = ctx.now();
  const genders = ['woman', 'man', 'non_binary'] as const;
  const ids: string[] = [];

  for (let i = 0; i < 30; i++) {
    const email = `demo-member-${i}@thirtydates.local`;
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO users (email, email_verified_at) VALUES ($1, now())
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [email],
    );
    const id = rows[0]!.id;
    const interests = [0, 1, 2].map((k) => INTEREST_CATALOG[(i * 3 + k * 7) % INTEREST_CATALOG.length]!);
    const [flaw, upside] = FLAWS[i % FLAWS.length]!;
    await completeOnboarding(
      ctx,
      id,
      onboardingSchema.parse({
        first_name: ['Maya', 'Tom', 'Sasha', 'Inês', 'Daniel', 'Priya', 'Luca', 'Aoife', 'Kwame', 'Elena'][i % 10],
        birth_date: `${now.getUTCFullYear() - (34 + (i % 12))}-0${1 + (i % 9)}-15`,
        gender: genders[i % 3],
        seeks: 'everyone',
        country_code: 'GB',
        postal_code: 'EC1A 1BB',
        coordinates: { lat: 51.5 + ((i % 7) - 3) * 0.01, lng: -0.12 + ((i % 5) - 2) * 0.015 },
        time_zone: 'Europe/London',
        search_radius_km: 40,
        gates: {
          family_goal: i % 4 === 0 ? 'blended_coparent' : 'family_builder',
          living_architecture: i % 3 === 0 ? 'flexible' : 'cohabit',
          mobility: 'rooted',
          financial_rhythm: 'balanced',
        },
        coin: { flaw, upside },
        interests: interests.map((def) => ({ key: def.key, receipt: def.receiptHint })),
      }),
    );
    ids.push(id);
  }

  const { rows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO users (email, email_verified_at) VALUES ($1, now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [demoEmail.toLowerCase()],
  );
  const demoId = rows[0]!.id;
  await completeOnboarding(
    ctx,
    demoId,
    onboardingSchema.parse({
      first_name: 'You',
      birth_date: `${now.getUTCFullYear() - 40}-05-20`,
      gender: 'woman',
      seeks: 'everyone',
      country_code: 'GB',
      postal_code: 'EC1A 1BB',
      coordinates: { lat: 51.507, lng: -0.128 },
      time_zone: 'Europe/London',
      search_radius_km: 40,
      gates: { family_goal: 'family_builder', living_architecture: 'flexible', mobility: 'rooted', financial_rhythm: 'balanced' },
      coin: { flaw: 'Over-prepares for travel', upside: 'Every trip is seamless' },
      interests: [
        { key: 'hiking', receipt: 'Two long hikes a month, map in the glovebox' },
        { key: 'home_cooking', receipt: 'Cook from scratch five nights a week' },
        { key: 'reading_fiction', receipt: 'Forty novels last year' },
      ],
    }),
  );

  await ctx.db.query(
    `INSERT INTO partner_venues (name, venue_type, address, geom, curation_score)
     SELECT * FROM (VALUES
       ('Prufrock Coffee', 'specialty_coffee'::venue_type, '23-25 Leather Ln, London', ST_SetSRID(ST_MakePoint(-0.1093, 51.5203), 4326), 4.6),
       ('Monmouth Coffee', 'specialty_coffee'::venue_type, '27 Monmouth St, London', ST_SetSRID(ST_MakePoint(-0.1268, 51.5141), 4326), 4.5),
       ('Noble Rot', 'wine_bar'::venue_type, '51 Lamb''s Conduit St, London', ST_SetSRID(ST_MakePoint(-0.1186, 51.5222), 4326), 4.7)
     ) AS v (name, venue_type, address, geom, curation_score)
     WHERE NOT EXISTS (SELECT 1 FROM partner_venues)`,
  );

  const clock = weekClock(now);
  console.log(await runMondayBatch(ctx.db, clock.batchWeek, ctx.config.MATCHING_TOP_K));

  // A few of the demo account's cards quietly stamp it back.
  await withSystemTx(ctx.db, async (tx) => {
    const batch = await tx.query<{ card_user_ids: string[] }>(
      'SELECT card_user_ids FROM weekly_batches WHERE user_id = $1 AND batch_week = $2',
      [demoId, clock.batchWeek],
    );
    for (const other of (batch.rows[0]?.card_user_ids ?? []).slice(0, 3)) {
      const [lo, hi] = orderedPair(demoId, other);
      const side = other === lo ? 'a' : 'b';
      await tx.query(
        `INSERT INTO escrow_vault (pair_hash, batch_week, user_a_id, user_b_id, user_a_action, user_b_action,
                                  user_${side}_stamp, user_${side}_stamp_line, user_${side}_acted_at)
         VALUES ($1, $2, $3, $4, $6::escrow_action, $7::escrow_action, 'made_me_smile', 'interest_1', $5)
         ON CONFLICT (pair_hash, batch_week) DO NOTHING`,
        [
          pairHash(lo, hi, ctx.config.ESCROW_PAIR_SALT),
          clock.batchWeek,
          lo,
          hi,
          now,
          side === 'a' ? 'validated' : 'pending',
          side === 'b' ? 'validated' : 'pending',
        ],
      );
    }
  });
  console.log(`seeded ${ids.length} members; demo account ${demoEmail} (${demoId})`);
}

const email = process.argv[2];
if (!email) {
  console.error('usage: seedDemo <your-email>');
  process.exit(1);
}
const ctx = createContext('seed');
seed(ctx, email)
  .then(() => ctx.db.end())
  .catch(async (err: Error) => {
    console.error(err.message);
    await ctx.db.end();
    process.exit(1);
  });
