import { randomUUID } from 'node:crypto';
import {
  INTEREST_CATALOG,
  RESONANCE_STAMPS,
  ageOn,
  ageWindow,
  isoDate,
  weekClock,
  type DevStatus,
  type Gender,
  type LifeArchitectureGates,
  type Seeks,
} from '@thirtydates/shared';
import type { AppContext } from '../context.js';
import { withSystemTx } from '../db/pool.js';
import { HttpError, conflict } from '../lib/errors.js';
import { runJob } from '../jobs.js';
import { runMondayBatch } from '../matching/matching.js';
import { recordEscrowAction } from './escrow.js';
import { completeOnboarding, onboardingSchema } from './onboarding.js';
import { submitSignal } from './signals.js';

/**
 * Development-only test tools. Lets one person walk the whole weekly ritual in minutes:
 * seed compatible members, deal, have cards stamp you back, move the clock through the week
 * and have mutual pairs signal you. Routes are registered only when NODE_ENV=development.
 */

const FIRST_NAMES = ['Maya', 'Tom', 'Sasha', 'Inês', 'Daniel', 'Priya', 'Luca', 'Aoife', 'Kwame', 'Elena', 'Rui', 'Hannah', 'Omar', 'Clara', 'Jonas', 'Leila'];
const COINS: [string, string][] = [
  ['Over-prepares for travel', 'Every trip is seamless'],
  ['Talks to every dog on the street', 'Never a dull walk'],
  ['Reads the ending first', 'Zero spoilers can hurt me'],
  ['Re-plans the week every Sunday', 'Your Monday is already sorted'],
  ['Laughs at my own jokes first', 'You will always know when to laugh'],
  ['Collects too many cookbooks', 'Dinner is never boring'],
  ['Cannot leave a museum before closing', 'You will see everything'],
  ['Keeps a spreadsheet for holidays', 'Nothing gets forgotten'],
];
const AGE_OFFSETS = [-5, 3, -2, 6, 0, -6, 4, -3, 1, 5, -1, 2, -4];

export function requireDevTools(ctx: AppContext): (instant: Date | null) => void {
  if (ctx.config.NODE_ENV !== 'development' || !ctx.setNow) {
    throw new HttpError(404, 'not_found', 'Not found');
  }
  return ctx.setNow;
}

interface Me {
  birth_date: string;
  gender: Gender;
  seeks: Seeks;
  lat: number;
  lng: number;
  gates: LifeArchitectureGates;
}

async function loadMe(ctx: AppContext, userId: string): Promise<Me> {
  const { rows } = await ctx.db.query<Omit<Me, 'gates'> & LifeArchitectureGates>(
    `SELECT u.birth_date, u.gender, u.seeks, ST_Y(u.coordinates) AS lat, ST_X(u.coordinates) AS lng,
            g.family_goal, g.living_architecture, g.mobility, g.financial_rhythm
       FROM users u JOIN life_architecture_gates g ON g.user_id = u.id
      WHERE u.id = $1 AND u.onboarding_completed_at IS NOT NULL`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw conflict('onboarding_required', 'Finish your own profile first');
  return {
    birth_date: r.birth_date,
    gender: r.gender,
    seeks: r.seeks,
    lat: r.lat,
    lng: r.lng,
    gates: {
      family_goal: r.family_goal,
      living_architecture: r.living_architecture,
      mobility: r.mobility,
      financial_rhythm: r.financial_rhythm,
    },
  };
}

/** Birth date that makes someone exactly `age` on `now`. */
function birthDateFor(age: number, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 40);
  return isoDate(d);
}

/**
 * Creates `count` onboarded members guaranteed to pass every hard filter with the given user:
 * within ~2 km, inside both age windows, genders the user seeks (each seeking everyone), and the
 * same life-architecture answers. Interests and coins vary so vector scores differ.
 */
export async function seedMembersAround(ctx: AppContext, userId: string, count: number): Promise<number> {
  const me = await loadMe(ctx, userId);
  const now = ctx.now();
  const myAge = ageOn(me.birth_date, now);
  const window = ageWindow(myAge);
  const genders: Gender[] = me.seeks === 'men' ? ['man'] : me.seeks === 'women' ? ['woman'] : ['woman', 'man', 'non_binary'];
  const lngScale = Math.cos((me.lat * Math.PI) / 180) || 1;

  for (let i = 0; i < count; i++) {
    const age = Math.min(window.max, Math.max(window.min, myAge + AGE_OFFSETS[i % AGE_OFFSETS.length]!));
    const interests = [0, 1, 2].map((k) => INTEREST_CATALOG[(i * 5 + k * 11) % INTEREST_CATALOG.length]!);
    const [flaw, upside] = COINS[i % COINS.length]!;
    const angle = (i * 137.5 * Math.PI) / 180;
    const distance = 0.004 + (i % 5) * 0.003; // ~0.4–1.6 km in latitude degrees
    const { rows } = await ctx.db.query<{ id: string }>(
      'INSERT INTO users (email, email_verified_at) VALUES ($1, now()) RETURNING id',
      [`demo-${randomUUID().slice(0, 8)}@thirtydates.local`],
    );
    await completeOnboarding(
      ctx,
      rows[0]!.id,
      onboardingSchema.parse({
        first_name: FIRST_NAMES[i % FIRST_NAMES.length],
        birth_date: birthDateFor(age, now),
        gender: genders[i % genders.length],
        seeks: 'everyone',
        country_code: 'GB',
        postal_code: 'DEMO',
        coordinates: { lat: me.lat + Math.sin(angle) * distance, lng: me.lng + (Math.cos(angle) * distance) / lngScale },
        time_zone: 'Europe/London',
        search_radius_km: 50,
        gates: me.gates,
        coin: { flaw, upside },
        interests: interests.map((d) => ({ key: d.key, receipt: d.receiptHint })),
      }),
    );
  }
  return count;
}

export async function dealNow(ctx: AppContext) {
  const clock = weekClock(ctx.now());
  if (clock.phase !== 'validation') {
    throw conflict('not_dealing', 'Cards are dealt Monday 07:00 to Saturday night. Jump the clock to Monday or Wednesday first.');
  }
  return runMondayBatch(ctx.db, clock.batchWeek, ctx.config.MATCHING_TOP_K);
}

/** Has up to `count` of my current cards silently validate me (respecting their own 3-stamp limit). */
export async function stampMe(ctx: AppContext, userId: string, count: number): Promise<number> {
  const clock = weekClock(ctx.now());
  if (clock.phase !== 'validation') throw conflict('validation_window_closed', 'Jump the clock to Monday or Wednesday first');
  const cards = await ctx.db.query<{ card_user_ids: string[] }>(
    'SELECT card_user_ids FROM weekly_batches WHERE user_id = $1 AND batch_week = $2',
    [userId, clock.batchWeek],
  );
  let stamped = 0;
  for (const [i, other] of (cards.rows[0]?.card_user_ids ?? []).entries()) {
    if (stamped >= count) break;
    try {
      await recordEscrowAction(ctx, other, userId, {
        kind: 'validated',
        stamp: RESONANCE_STAMPS[i % RESONANCE_STAMPS.length]!,
        line: (['flaw', 'interest_1', 'upside', 'badges'] as const)[i % 4]!,
      });
      stamped++;
    } catch (err) {
      // Already decided on me, out of stamps, or frozen me: skip to the next card.
      if (!(err instanceof HttpError)) throw err;
    }
  }
  return stamped;
}

/** Has every revealed mutual pair send me their #1 Signal. */
export async function signalMe(ctx: AppContext, userId: string): Promise<number> {
  const clock = weekClock(ctx.now());
  if (clock.phase !== 'signal') throw conflict('signal_window_closed', 'Jump the clock to Sunday 18:00 first');
  const mutual = await withSystemTx(ctx.db, async (tx) =>
    (
      await tx.query<{ other: string }>(
        `SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS other
           FROM escrow_vault
          WHERE batch_week = $2 AND status = 'mutual_unlocked' AND revealed_at IS NOT NULL
            AND (user_a_id = $1 OR user_b_id = $1)`,
        [userId, clock.batchWeek],
      )
    ).rows,
  );
  let sent = 0;
  for (const { other } of mutual) {
    try {
      await submitSignal(ctx, other, userId);
      sent++;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
  }
  return sent;
}

export const CLOCK_TARGETS = ['real', 'monday', 'wednesday', 'sealed', 'reveal', 'signal', 'next_monday'] as const;
export type ClockTarget = (typeof CLOCK_TARGETS)[number];

/**
 * Moves the API's clock to a point in the current (possibly already shifted) week and runs the
 * jobs that would have fired on the way: the reveal for Sunday, the deal for next Monday.
 */
export async function moveClock(ctx: AppContext, target: ClockTarget): Promise<void> {
  const setNow = requireDevTools(ctx);
  if (target === 'real') {
    setNow(null);
    return;
  }
  const week = weekClock(ctx.now()).weekStart.getTime();
  const at = (days: number, hours: number, minutes = 0) => new Date(week + ((days * 24 + hours) * 60 + minutes) * 60_000);
  const targets: Record<Exclude<ClockTarget, 'real'>, Date> = {
    monday: at(0, 9),
    wednesday: at(2, 9),
    sealed: at(6, 3),
    reveal: at(6, 6, 5),
    signal: at(6, 18, 5),
    next_monday: at(7, 7, 5),
  };
  setNow(targets[target]);
  if (target === 'reveal' || target === 'signal') await runJob(ctx, 'sunday-reveal');
  if (target === 'next_monday') {
    await runJob(ctx, 'signal-close');
    await runJob(ctx, 'monday-deal');
  }
}

export async function devStatus(ctx: AppContext, userId: string): Promise<DevStatus> {
  const now = ctx.now();
  const clock = weekClock(now);
  return withSystemTx(ctx.db, async (tx) => {
    const { rows } = await tx.query<Omit<DevStatus, 'real_now' | 'server_now' | 'clock_shifted' | 'phase' | 'batch_week'>>(
      `SELECT
         (SELECT count(*)::int FROM users WHERE onboarding_completed_at IS NOT NULL AND is_active) AS members,
         coalesce((SELECT cardinality(card_user_ids) FROM weekly_batches WHERE user_id = $1 AND batch_week = $2), 0) AS my_cards,
         (SELECT count(*)::int FROM escrow_vault WHERE batch_week = $2 AND status <> 'wiped'
             AND ((user_a_id = $1 AND user_b_action = 'validated') OR (user_b_id = $1 AND user_a_action = 'validated'))) AS stamped_me,
         (SELECT count(*)::int FROM escrow_vault WHERE batch_week = $2 AND status = 'mutual_unlocked'
             AND (user_a_id = $1 OR user_b_id = $1)) AS mutual,
         (SELECT count(*)::int FROM matches WHERE user_a_id = $1 OR user_b_id = $1) AS matches`,
      [userId, clock.batchWeek],
    );
    const realNow = new Date();
    return {
      real_now: realNow.toISOString(),
      server_now: now.toISOString(),
      clock_shifted: Math.abs(now.getTime() - realNow.getTime()) > 60_000,
      phase: clock.phase,
      batch_week: clock.batchWeek,
      ...rows[0]!,
    };
  });
}
