import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  INTEREST_CATALOG,
  VOICE_PROMPTS,
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
import { selectProfile } from './escrow.js';
import { lockAnswers, pickPrompts } from './exchange.js';
import { completeOnboarding, onboardingSchema } from './onboarding.js';
import { addPhoto } from './photos.js';

/**
 * Development-only test tools. Lets one person walk the whole weekly ritual in minutes: seed
 * compatible members, deal, have cards select you, move the clock through the week, and have
 * mutual pairs pick questions and lock (generated) voice answers. Routes are registered only
 * when NODE_ENV=development.
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
    // Two abstract test photos each, so the reveal carousel has something to show.
    for (const variant of [0, 1]) await addPhoto(ctx, rows[0]!.id, testPhotoPng(i * 2 + variant));
  }
  await ensureVenuesNear(ctx, me.lat, me.lng);
  return count;
}

/** A coffee house and a wine bar a few hundred metres away, so the First-Meet Bridge has a venue. */
async function ensureVenuesNear(ctx: AppContext, lat: number, lng: number): Promise<void> {
  const near = await ctx.db.query(
    `SELECT 1 FROM partner_venues WHERE is_active AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, 3000)`,
    [lat, lng],
  );
  if (near.rowCount) return;
  await ctx.db.query(
    `INSERT INTO partner_venues (name, venue_type, address, geom, curation_score) VALUES
       ('Ritual Roasters', 'specialty_coffee', 'Test venue · 12 Market Lane', ST_SetSRID(ST_MakePoint($2 + 0.002, $1 + 0.001), 4326), 4.6),
       ('The Vine Loft', 'wine_bar', 'Test venue · 3 Harbour Steps', ST_SetSRID(ST_MakePoint($2 - 0.002, $1 + 0.002), 4326), 4.8)`,
    [lat, lng],
  );
}

/** Abstract warm "light study" PNG (no faces, no silhouettes), unique per seed. */
export function testPhotoPng(seed: number, width = 360, height = 480): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const hue = (seed * 47) % 360;
  const tone = (h: number, l: number): [number, number, number] => {
    const a = 0.45 * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const [cx1, cy1] = [0.3 + ((seed * 13) % 40) / 100, 0.25 + ((seed * 7) % 30) / 100];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const glow = Math.exp(-((u - cx1) ** 2 + (v - cy1) ** 2) * 7);
      const [r, g, b] = tone((hue + 25 * v) % 360, 0.12 + 0.5 * glow + 0.08 * (1 - v));
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function dealNow(ctx: AppContext) {
  const clock = weekClock(ctx.now());
  if (clock.phase !== 'selection') {
    throw conflict('not_dealing', 'Cards are dealt Monday 07:00 to Tuesday night. Jump the clock to Monday first.');
  }
  return runMondayBatch(ctx.db, clock.batchWeek, ctx.config.MATCHING_TOP_K);
}

/** Has up to `count` of my current cards silently select me (respecting their own limit of 3). */
export async function selectMe(ctx: AppContext, userId: string, count: number): Promise<number> {
  const clock = weekClock(ctx.now());
  if (clock.phase !== 'selection') throw conflict('selection_closed', 'Jump the clock to Monday first');
  const cards = await ctx.db.query<{ card_user_ids: string[] }>(
    'SELECT card_user_ids FROM weekly_batches WHERE user_id = $1 AND batch_week = $2',
    [userId, clock.batchWeek],
  );
  let selected = 0;
  for (const other of cards.rows[0]?.card_user_ids ?? []) {
    if (selected >= count) break;
    try {
      await selectProfile(ctx, other, userId);
      selected++;
    } catch (err) {
      // Already decided on me, out of selections, or froze me: try the next card.
      if (!(err instanceof HttpError)) throw err;
    }
  }
  return selected;
}

/** A one-second 440 Hz tone as a WAV file, standing in for a recorded voice answer. */
export function toneWav(seconds = 1, sampleRate = 8000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 400, (samples - i) / 400);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 9000 * fade), 44 + i * 2);
  }
  return buf;
}

/**
 * Plays the other side of each of my exchanges this week: while questions are open they pick
 * two prompts for me; once the Response Clock runs they lock generated answers to my questions.
 */
export async function counterpartsAct(ctx: AppContext, userId: string): Promise<{ picked: number; locked: number }> {
  const clock = weekClock(ctx.now());
  const { rows } = await ctx.db.query<{ id: string; status: string; other: string; other_locked: boolean }>(
    `SELECT id, status, CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS other,
            CASE WHEN user_a_id = $1 THEN user_b_locked_at IS NOT NULL ELSE user_a_locked_at IS NOT NULL END AS other_locked
       FROM voice_exchanges WHERE batch_week = $2 AND (user_a_id = $1 OR user_b_id = $1)`,
    [userId, clock.batchWeek],
  );
  let picked = 0;
  let locked = 0;
  for (const x of rows) {
    if (x.status === 'questions') {
      await pickPrompts(ctx, x.other, x.id, VOICE_PROMPTS.slice(0, 3).map((p) => p.key));
      picked++;
    } else if (x.status === 'answering' && !x.other_locked) {
      const mine = await ctx.db.query<{ prompt_key: string }>(
        'SELECT prompt_key FROM voice_prompt_picks WHERE exchange_id = $1 AND picker_id = $2',
        [x.id, userId],
      );
      await lockAnswers(ctx, x.other, x.id, mine.rows.map((r) => ({ promptKey: r.prompt_key, data: toneWav() })));
      locked++;
    }
  }
  return { picked, locked };
}

export const CLOCK_TARGETS = ['real', 'monday', 'wednesday', 'thursday', 'friday', 'next_monday'] as const;
export type ClockTarget = (typeof CLOCK_TARGETS)[number];

/**
 * Moves the API's clock to a point in the current (possibly already shifted) week and runs the
 * jobs that would have fired on the way.
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
    thursday: at(3, 9),
    friday: at(4, 12, 5),
    next_monday: at(7, 7, 5),
  };
  setNow(targets[target]);
  await runJob(ctx, 'exchange-tick');
  if (target === 'next_monday') await runJob(ctx, 'monday-deal');
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
             AND ((user_a_id = $1 AND user_b_action = 'validated') OR (user_b_id = $1 AND user_a_action = 'validated'))) AS selected_me,
         (SELECT count(*)::int FROM voice_exchanges WHERE batch_week = $2 AND (user_a_id = $1 OR user_b_id = $1)) AS exchanges,
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
