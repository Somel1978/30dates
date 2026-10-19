import { beforeEach, describe, expect, it } from 'vitest';
import { toneWav } from '../src/services/devTools.js';
import { acceptRaincheck, raincheckStart, requestRaincheck, runBridgeMaintenance, setBridgePreference } from '../src/services/bridge.js';
import { selectProfile } from '../src/services/escrow.js';
import { getExchange, lockAnswers, runExchangeTick } from '../src/services/exchange.js';
import { getMatch } from '../src/services/matches.js';
import { at, createMember, dealPair, makeCtx, resetDb } from './helpers.js';

const ctx = makeCtx();

async function addVenue(name: string, type: 'specialty_coffee' | 'wine_bar', lat: number, lng: number, score = 4) {
  await ctx.db.query(
    `INSERT INTO partner_venues (name, venue_type, address, geom, curation_score)
     VALUES ($1, $2, '1 Test St', ST_SetSRID(ST_MakePoint($4, $3), 4326), $5)`,
    [name, type, lat, lng, score],
  );
}

/** Runs the real week up to the release: Thursday 10:00 UTC, both answers locked. */
async function releasedPair(coords?: { a: [number, number]; b: [number, number] }) {
  const a = await createMember(ctx, coords ? { lat: coords.a[0], lng: coords.a[1] } : {});
  const b = await createMember(ctx, coords ? { lat: coords.b[0], lng: coords.b[1] } : {});
  ctx.setNow(at(0, 9));
  await dealPair(ctx, a, b);
  await selectProfile(ctx, a, b);
  await selectProfile(ctx, b, a);
  ctx.setNow(at(2, 0, 1));
  await runExchangeTick(ctx);
  ctx.setNow(at(3, 0, 1));
  await runExchangeTick(ctx);
  ctx.setNow(at(3, 10));
  const { rows } = await ctx.db.query<{ id: string }>('SELECT id FROM voice_exchanges');
  const exchangeId = rows[0]!.id;
  for (const who of [a, b]) {
    const keys = (await getExchange(ctx, who, exchangeId)).questions_for_me.map((q) => q.key);
    await lockAnswers(ctx, who, exchangeId, keys.map((k) => ({ promptKey: k, data: toneWav() })));
  }
  const matchId = (await getExchange(ctx, a, exchangeId)).match_id!;
  return { a, b, matchId };
}

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as { code: string }).code;
  }
  return 'resolved';
}

// November in Europe/London is UTC+0. Release happens Thursday 10:00; the window ends Sunday 10:00.
const FRI_10 = at(4, 10).toISOString();
const FRI_18 = at(4, 18).toISOString();
const SAT_11 = at(5, 11).toISOString();

beforeEach(resetDb);

describe('Stage 4: First-Meet Bridge', () => {
  it('auto-assigns a venue near the midpoint at the release', async () => {
    await addVenue('Near Coffee', 'specialty_coffee', 51.505, -0.12);
    const { a, matchId } = await releasedPair({ a: [51.5, -0.14], b: [51.5, -0.1] });
    const match = await getMatch(ctx, a, matchId);
    expect(match.suggested_venue?.name).toBe('Near Coffee');
    expect(match.bridge_window_closes_at).toBe(at(6, 10).toISOString());
  });

  it('locks the earliest shared slot inside the 72-hour window', async () => {
    await addVenue('Near Coffee', 'specialty_coffee', 51.5075, -0.1276);
    const { a, b, matchId } = await releasedPair();
    expect((await setBridgePreference(ctx, a, matchId, 'coffee_audit', [FRI_10, SAT_11])).state).toBe('awaiting_alignment');
    expect((await setBridgePreference(ctx, b, matchId, 'coffee_audit', [SAT_11])).state).toBe('scheduled');
    const detail = await getMatch(ctx, a, matchId);
    expect(detail.status).toBe('scheduled');
    expect(detail.event).toMatchObject({ mode: 'coffee_audit', starts_at: SAT_11, duration_minutes: 45 });
    expect(detail.event!.venue!.name).toBe('Near Coffee');
  });

  it('prefers a wine bar for evening slots', async () => {
    await addVenue('Near Coffee', 'specialty_coffee', 51.5075, -0.1276);
    await addVenue('Wine Bar', 'wine_bar', 51.52, -0.1276);
    const { a, b, matchId } = await releasedPair();
    await setBridgePreference(ctx, a, matchId, 'coffee_audit', [FRI_18]);
    await setBridgePreference(ctx, b, matchId, 'coffee_audit', [FRI_18]);
    expect((await getMatch(ctx, a, matchId)).event!.venue!.name).toBe('Wine Bar');
  });

  it('rejects slots outside the window or the venue hours', async () => {
    const { a, matchId } = await releasedPair();
    expect(await errorCode(setBridgePreference(ctx, a, matchId, 'coffee_audit', [at(7, 10).toISOString()]))).toBe('invalid_slot');
    expect(await errorCode(setBridgePreference(ctx, a, matchId, 'coffee_audit', [at(4, 7).toISOString()]))).toBe('invalid_slot');
    expect(await errorCode(setBridgePreference(ctx, a, matchId, 'coffee_audit', [at(3, 11).toISOString()]))).toBe('invalid_slot');
  });

  it('reports when no partner venue covers the midpoint', async () => {
    const { a, b, matchId } = await releasedPair();
    await setBridgePreference(ctx, a, matchId, 'coffee_audit', [FRI_10]);
    expect((await setBridgePreference(ctx, b, matchId, 'coffee_audit', [FRI_10])).state).toBe('no_venue_nearby');
  });

  it('closes the match kindly if no slot aligns within 72 hours', async () => {
    const { a, matchId } = await releasedPair();
    ctx.setNow(at(6, 10, 1));
    expect((await runBridgeMaintenance(ctx)).bridgesTimedOut).toBe(1);
    expect((await getMatch(ctx, a, matchId)).status).toBe('expired');
  });
});

describe('Freeze Raincheck', () => {
  async function scheduled() {
    await addVenue('Near Coffee', 'specialty_coffee', 51.5075, -0.1276);
    const pair = await releasedPair();
    await setBridgePreference(ctx, pair.a, pair.matchId, 'coffee_audit', [SAT_11]);
    await setBridgePreference(ctx, pair.b, pair.matchId, 'coffee_audit', [SAT_11]);
    ctx.setNow(at(4, 9));
    return pair;
  }

  it('shifts by 48 h, spends the token, and needs the partner to accept', async () => {
    const { a, b, matchId } = await scheduled();
    await requestRaincheck(ctx, a, matchId);
    let detail = await getMatch(ctx, a, matchId);
    expect(detail.status).toBe('raincheck_pending');
    expect(detail.freeze_token_available).toBe(false);
    expect(detail.event!.raincheck).toMatchObject({ requested_by_me: true, proposed_starts_at: at(7, 11).toISOString() });
    expect(await errorCode(acceptRaincheck(ctx, a, matchId))).toBe('own_raincheck');
    await acceptRaincheck(ctx, b, matchId);
    detail = await getMatch(ctx, b, matchId);
    expect(detail.status).toBe('scheduled');
    expect(detail.event!.starts_at).toBe(at(7, 11).toISOString());
  });

  it('expires the match cleanly when the partner does not accept within 24 h', async () => {
    const { a, matchId } = await scheduled();
    await requestRaincheck(ctx, a, matchId);
    ctx.setNow(at(5, 9, 1));
    expect((await runBridgeMaintenance(ctx)).rainchecksExpired).toBe(1);
    expect((await getMatch(ctx, a, matchId)).status).toBe('expired');
  });

  it('keeps the local wall-clock time across a DST change', () => {
    // Friday 23 Oct 2026 10:30 BST; clocks go back on the 25th.
    expect(raincheckStart(new Date('2026-10-23T09:30:00Z'), 'Europe/London').toISOString()).toBe('2026-10-25T10:30:00.000Z');
  });
});

describe('bridge maintenance', () => {
  it('marks met after the coffee', async () => {
    const { a, matchId } = await scheduledMet();
    ctx.setNow(at(5, 11, 46));
    expect((await runBridgeMaintenance(ctx)).eventsCompleted).toBe(1);
    expect((await getMatch(ctx, a, matchId)).status).toBe('met');
  });
});

async function scheduledMet() {
  await addVenue('Near Coffee', 'specialty_coffee', 51.5075, -0.1276);
  const pair = await releasedPair();
  await setBridgePreference(ctx, pair.a, pair.matchId, 'coffee_audit', [SAT_11]);
  await setBridgePreference(ctx, pair.b, pair.matchId, 'coffee_audit', [SAT_11]);
  return pair;
}
