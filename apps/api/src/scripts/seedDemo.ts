import { weekClock } from '@thirtydates/shared';
import { runMondayBatch } from '../matching/matching.js';
import { createContext } from '../runtime.js';
import { seedMembersAround, stampMe } from '../services/devTools.js';

/**
 * Development seed for an existing, onboarded account: creates members built to match it
 * (nearby, in its age window, the genders it seeks, the same life-architecture answers), deals
 * this week's cards if stamps are open, and has three of its cards silently stamp it.
 * The same actions are available as buttons on the in-app Test tools page.
 *
 * Usage: npm run seed:demo -w @thirtydates/api -- you@example.com [count]
 */
const [email, countArg] = process.argv.slice(2);
if (!email) {
  console.error('usage: seedDemo <your-email> [count]');
  process.exit(1);
}

const ctx = createContext('seed');
try {
  if (ctx.config.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const { rows } = await ctx.db.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 AND onboarding_completed_at IS NOT NULL',
    [email.toLowerCase()],
  );
  const userId = rows[0]?.id;
  if (!userId) throw new Error(`No onboarded account for ${email}. Sign up in the app and finish onboarding first.`);

  const count = Number(countArg ?? 24);
  await seedMembersAround(ctx, userId, count);
  console.log(`created ${count} members matched to ${email}`);

  const clock = weekClock(ctx.now());
  if (clock.phase === 'validation') {
    console.log(await runMondayBatch(ctx.db, clock.batchWeek, ctx.config.MATCHING_TOP_K));
    console.log(`${await stampMe(ctx, userId, 3)} of your cards have stamped you`);
  } else {
    console.log(`Stamps are closed (${clock.phase}); cards are dealt next Monday 07:00 UTC, or use Test tools to move the clock.`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await ctx.db.end();
}
