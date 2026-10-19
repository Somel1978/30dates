import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { at, createMember, dealPair, makeCtx, resetDb } from './helpers.js';

const ctx = makeCtx();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(ctx);
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  ctx.sent.length = 0;
  ctx.setNow(at(0, 9));
});

const ORIGIN = { origin: 'http://web.test' };

let clientSeq = 0;

async function signIn(email: string): Promise<string> {
  // Each simulated client gets its own address so the per-IP magic-link limit is not shared.
  clientSeq += 1;
  const remoteAddress = `10.0.${Math.floor(clientSeq / 250)}.${clientSeq % 250}`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/magic-link', headers: ORIGIN, payload: { email }, remoteAddress });
  expect(res.statusCode).toBe(202);
  const link = ctx.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  const token = new URL(link).searchParams.get('token')!;
  const verify = await app.inject({ method: 'POST', url: '/api/auth/verify', headers: ORIGIN, payload: { token } });
  expect(verify.statusCode).toBe(200);
  const cookie = verify.cookies.find((c) => c.name === 'td_session')!;
  expect(cookie.httpOnly).toBe(true);
  return `td_session=${cookie.value}`;
}

const onboardingPayload = {
  first_name: 'Ana',
  birth_date: '1984-06-15',
  gender: 'woman',
  seeks: 'men',
  country_code: 'pt',
  postal_code: '1100-148',
  coordinates: { lat: 38.71234, lng: -9.13987 },
  time_zone: 'Europe/Lisbon',
  search_radius_km: 25,
  gates: { family_goal: 'blended_coparent', living_architecture: 'lat', mobility: 'rooted', financial_rhythm: 'balanced' },
  coin: { flaw: 'Over-prepares for travel', upside: 'Every trip is seamless' },
  interests: [
    { key: 'slow_travel', receipt: 'One month somewhere new each year' },
    { key: 'specialty_coffee', receipt: 'I weigh my beans' },
    { key: 'reading_fiction', receipt: 'Forty novels last year' },
  ],
};

describe('magic-link auth & onboarding', () => {
  it('signs in, gates on onboarding, then serves the weekly batch', async () => {
    const cookie = await signIn('Ana@Example.test');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ email: 'ana@example.test', onboarding_completed: false });

    const gated = await app.inject({ method: 'GET', url: '/api/batches/current', headers: { cookie } });
    expect(gated.statusCode).toBe(403);
    expect(gated.json().error).toBe('onboarding_required');

    const onboard = await app.inject({ method: 'POST', url: '/api/onboarding', headers: { cookie, ...ORIGIN }, payload: onboardingPayload });
    expect(onboard.statusCode).toBe(200);
    expect(onboard.json().onboarding_completed).toBe(true);

    const coords = await ctx.db.query<{ lat: number; lng: number }>(
      'SELECT ST_Y(coordinates) AS lat, ST_X(coordinates) AS lng FROM users WHERE email = $1',
      ['ana@example.test'],
    );
    expect(coords.rows[0]).toEqual({ lat: 38.712, lng: -9.14 });

    const batch = await app.inject({ method: 'GET', url: '/api/batches/current', headers: { cookie } });
    expect(batch.statusCode).toBe(200);
    expect(batch.json()).toMatchObject({ phase: 'validation', cards: [], stamps_remaining: 3 });
  });

  it('rejects reused or bogus links and does not reveal whether an email exists', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify', headers: ORIGIN, payload: { token: 'x'.repeat(43) } });
    expect(res.statusCode).toBe(400);
    const a = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      headers: ORIGIN,
      payload: { email: 'new@example.test' },
      remoteAddress: '10.8.8.8',
    });
    expect(a.statusCode).toBe(202);
    const token = new URL(ctx.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/api/auth/verify', headers: ORIGIN, payload: { token } });
    const reused = await app.inject({ method: 'POST', url: '/api/auth/verify', headers: ORIGIN, payload: { token } });
    expect(reused.statusCode).toBe(400);
  });

  it('refuses members outside 30–55', async () => {
    const cookie = await signIn('young@example.test');
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: { cookie, ...ORIGIN },
      payload: { ...onboardingPayload, birth_date: '2000-01-01' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('age_out_of_bounds');
  });

  it('logout revokes the session', async () => {
    const cookie = await signIn('bye@example.test');
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, ...ORIGIN } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('request hardening', () => {
  it('throttles magic-link requests per client', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/magic-link',
        headers: ORIGIN,
        payload: { email: `burst${i}@example.test` },
        remoteAddress: '10.9.9.9',
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([202, 202, 202, 202, 202, 429]);
  });

  it('rejects cross-origin state changes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'x@example.test' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('protects cron endpoints with the shared secret and refuses jobs that are not due', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/escrow/reveal' })).statusCode).toBe(401);
    const secret = { 'x-cron-secret': ctx.config.CRON_SECRET };
    const early = await app.inject({ method: 'POST', url: '/api/escrow/reveal', headers: secret });
    expect(early.statusCode).toBe(409);
    const deal = await app.inject({ method: 'POST', url: '/api/cron/monday-deal', headers: secret });
    expect(deal.statusCode).toBe(200);
    expect(deal.json().status).toBe('completed');
  });
});

describe('escrow endpoints', () => {
  it('returns the same silent acknowledgement regardless of the counterpart', async () => {
    const cookie = await signIn('stamp@example.test');
    await app.inject({ method: 'POST', url: '/api/onboarding', headers: { cookie, ...ORIGIN }, payload: onboardingPayload });
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json().id as string;
    const other = await createMember(ctx, { lat: 38.71, lng: -9.14, gender: 'man', seeks: 'women' });
    await dealPair(ctx, me, other);

    const res = await app.inject({
      method: 'POST',
      url: '/api/escrow/validate',
      headers: { cookie, ...ORIGIN },
      payload: { target_user_id: other, resonance_stamp_type: 'rhythm_agree', card_line: 'interest_1' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });

    const batch = (await app.inject({ method: 'GET', url: '/api/batches/current', headers: { cookie } })).json();
    expect(batch.cards[0]).toMatchObject({ user_id: other, my_action: 'validated', my_stamp: 'rhythm_agree' });
    expect(batch.cards[0]).not.toHaveProperty('first_name');
    expect(JSON.stringify(batch)).not.toContain('photo');
  });

  it('validates request bodies', async () => {
    const cookie = await signIn('bad@example.test');
    await app.inject({ method: 'POST', url: '/api/onboarding', headers: { cookie, ...ORIGIN }, payload: onboardingPayload });
    const res = await app.inject({
      method: 'POST',
      url: '/api/escrow/validate',
      headers: { cookie, ...ORIGIN },
      payload: { target_user_id: 'nope', resonance_stamp_type: 'heart' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });
});

describe('photos', () => {
  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
    'hex',
  );

  function multipart(data: Buffer, filename: string) {
    const boundary = '----thirtydates';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
  }

  it('stores sniffed images and serves them only to the owner until reveal', async () => {
    const owner = await signIn('owner@example.test');
    const viewer = await signIn('viewer@example.test');
    const upload = multipart(PNG, 'me.png');
    const res = await app.inject({
      method: 'POST',
      url: '/api/profile/photos',
      headers: { cookie: owner, 'content-type': upload.contentType, ...ORIGIN },
      payload: upload.body,
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect((await app.inject({ method: 'GET', url: `/api/photos/${id}`, headers: { cookie: owner } })).headers['content-type']).toBe(
      'image/png',
    );
    expect((await app.inject({ method: 'GET', url: `/api/photos/${id}`, headers: { cookie: viewer } })).statusCode).toBe(404);

    const fake = multipart(Buffer.from('<svg onload=alert(1)>'), 'x.png');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/profile/photos',
      headers: { cookie: owner, 'content-type': fake.contentType, ...ORIGIN },
      payload: fake.body,
    });
    expect(bad.statusCode).toBe(400);
  });
});
