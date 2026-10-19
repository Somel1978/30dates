import type { LifeArchitectureGates, OnboardingPayload } from '@thirtydates/shared';
import type { AppContext } from '../src/context.js';
import { createPool, type Db } from '../src/db/pool.js';
import type { MailMessage } from '../src/services/mailer.js';
import { completeOnboarding, onboardingSchema } from '../src/services/onboarding.js';
import { appUrl } from './env.js';

/** A fixed UTC week used by the scenario tests (Monday 2 November 2026). */
export const TEST_WEEK = '2026-11-02';

/** Instant `days` after TEST_WEEK's Monday 00:00 UTC, at hh:mm UTC. */
export function at(days: number, hh = 0, mm = 0): Date {
  return new Date(Date.parse(`${TEST_WEEK}T00:00:00Z`) + ((days * 24 + hh) * 60 + mm) * 60_000);
}

export interface TestContext extends AppContext {
  setNow(d: Date): void;
  sent: MailMessage[];
}

let sharedPool: Db | undefined;

export function testPool(): Db {
  sharedPool ??= createPool(appUrl());
  return sharedPool;
}

export function makeCtx(now: Date = at(0, 9)): TestContext {
  let current = now;
  const sent: MailMessage[] = [];
  return {
    db: testPool(),
    config: {
      NODE_ENV: 'test',
      DATABASE_URL: appUrl(),
      JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0123456789',
      ESCROW_PAIR_SALT: 'test-escrow-salt-test-escrow-salt-0123456789',
      CRON_SECRET: 'test-cron-secret-0123',
      API_PORT: 0,
      WEB_ORIGIN: 'http://web.test',
      SMTP_URL: '',
      MAIL_FROM: 'test@thirtydates.local',
      UPLOAD_DIR: '/tmp/thirtydates-test-uploads',
      MATCHING_TOP_K: 24,
    },
    mailer: { send: async (m) => void sent.push(m) },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    now: () => current,
    setNow(d: Date) {
      current = d;
    },
    sent,
  };
}

export async function resetDb(): Promise<void> {
  await testPool().query(`
    TRUNCATE users, magic_link_tokens, postal_code_centroids, weekly_batches, freeze_tokens, batch_runs,
             job_runs, escrow_vault, sunday_signals, scenario_responses, matches, partner_venues CASCADE`);
}

export interface MemberOptions {
  age?: number;
  gender?: OnboardingPayload['gender'];
  seeks?: OnboardingPayload['seeks'];
  lat?: number;
  lng?: number;
  radiusKm?: number;
  gates?: Partial<LifeArchitectureGates>;
  interests?: [string, string, string];
  firstName?: string;
  timeZone?: string;
}

let memberSeq = 0;

/** Creates a verified, fully onboarded member through the real onboarding service. */
export async function createMember(ctx: AppContext, opts: MemberOptions = {}): Promise<string> {
  memberSeq += 1;
  const { rows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO users (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [`member${memberSeq}-${Date.now()}@example.test`],
  );
  const id = rows[0]!.id;
  const age = opts.age ?? 40;
  const payload: OnboardingPayload = {
    first_name: opts.firstName ?? `Member${memberSeq}`,
    birth_date: `${2026 - age}-06-15`,
    gender: opts.gender ?? 'woman',
    seeks: opts.seeks ?? 'everyone',
    country_code: 'GB',
    postal_code: 'EC1A 1BB',
    coordinates: { lat: opts.lat ?? 51.5072, lng: opts.lng ?? -0.1276 },
    time_zone: opts.timeZone ?? 'Europe/London',
    search_radius_km: opts.radiusKm ?? 50,
    gates: {
      family_goal: 'family_builder',
      living_architecture: 'cohabit',
      mobility: 'rooted',
      financial_rhythm: 'balanced',
      ...opts.gates,
    },
    coin: { flaw: 'Over-prepares for travel', upside: 'Every trip is seamless' },
    interests: (opts.interests ?? ['hiking', 'home_cooking', 'reading_fiction']).map((key) => ({
      key,
      receipt: `Receipt for ${key}`,
    })),
  };
  await completeOnboarding(ctx, id, onboardingSchema.parse(payload));
  return id;
}

/** Inserts a batch row directly (bypassing Stage 3) for escrow-focused tests. */
export async function dealBatch(ctx: AppContext, userId: string, cards: string[], week = TEST_WEEK): Promise<void> {
  await ctx.db.query(
    `INSERT INTO weekly_batches (user_id, batch_week, card_user_ids) VALUES ($1, $2, $3::uuid[])`,
    [userId, week, cards],
  );
}

/** Deal a symmetric pair of batches: each user sees the other. */
export async function dealPair(ctx: AppContext, a: string, b: string, week = TEST_WEEK): Promise<void> {
  await dealBatch(ctx, a, [b], week);
  await dealBatch(ctx, b, [a], week);
}
