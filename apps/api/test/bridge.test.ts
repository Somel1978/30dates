import { beforeEach, describe, expect, it } from 'vitest';
import { acceptRaincheck, raincheckStart, requestRaincheck, runBridgeMaintenance, setBridgePreference } from '../src/services/bridge.js';
import { recordEscrowAction, runSundayReveal } from '../src/services/escrow.js';
import { getMatch } from '../src/services/matches.js';
import { submitSignal } from '../src/services/signals.js';
import { TEST_WEEK, at, createMember, dealPair, makeCtx, resetDb } from './helpers.js';

const ctx = makeCtx();
const stamp = { kind: 'validated', stamp: 'balance_out', line: 'badges' } as const;

/** Runs the real weekly ritual up to a confirmed match (Sunday 19:00 UTC). */
async function matchedPair(coords?: { a: [number, number]; b: [number, number] }) {
  const a = await createMember(ctx, coords ? { lat: coords.a[0], lng: coords.a[1] } : {});
  const b = await createMember(ctx, coords ? { lat: coords.b[0], lng: coords.b[1] } : {});
  ctx.setNow(at(0, 9));
  await dealPair(ctx, a, b);
  await recordEscrowAction(ctx, a, b, stamp);
  await recordEscrowAction(ctx, b, a, stamp);
  ctx.setNow(at(6, 6));
  await runSundayReveal(ctx, TEST_WEEK);
  ctx.setNow(at(6, 19));
  await submitSignal(ctx, a, b);
  const { matchId } = await submitSignal(ctx, b, a);
  return { a, b, matchId: matchId! };
}

async function addVenue(name: string, type: 'specialty_coffee' | 'wine_bar', lat: number, lng: number, score = 4) {
  await ctx.db.query(
    `INSERT INTO partner_venues (name, venue_type, address, geom, curation_score)
     VALUES ($1, $2, '1 Test St', ST_SetSRID(ST_MakePoint($4, $3), 4326), $5)`,
    [name, type, lat, lng, score],
  );
}

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as { code: string }).code;
  }
  return 'resolved';
}

// November in Europe/London is UTC+0, so local 21:00 == 21:00Z.
const MON_21 = at(7, 21).toISOString();
const TUE_21 = at(8, 21).toISOString();
const TUE_10 = at(8, 10).toISOString();
const TUE_18 = at(8, 18).toISOString();

beforeEach(resetDb);

describe('First-Meet Bridge', () => {
  it('locks the earliest common slot once both privately pick the same path', async () => {
    const { a, b, matchId } = await matchedPair();
    expect((await setBridgePreference(ctx, a, matchId, 'audio_lounge', [MON_21, TUE_21])).state).toBe('awaiting_alignment');
    expect((await setBridgePreference(ctx, b, matchId, 'audio_lounge', [TUE_21])).state).toBe('scheduled');

    const detail = await getMatch(ctx, a, matchId);
    expect(detail.status).toBe('scheduled');
    expect(detail.event).toMatchObject({ mode: 'audio_lounge', starts_at: TUE_21, duration_minutes: 10, venue: null });
  });

  it('waits when paths differ, without revealing the partner’s choice', async () => {
    const { a, b, matchId } = await matchedPair();
    await setBridgePreference(ctx, a, matchId, 'audio_lounge', [MON_21]);
    expect((await setBridgePreference(ctx, b, matchId, 'coffee_audit', [TUE_10])).state).toBe('awaiting_alignment');
    const detail = await getMatch(ctx, b, matchId);
    expect(detail.bridge).toEqual({ state: 'awaiting_alignment', my_preference: { mode: 'coffee_audit', slots: [TUE_10] } });
  });

  it('validates slots against the local schedule', async () => {
    const { a, matchId } = await matchedPair();
    expect(await errorCode(setBridgePreference(ctx, a, matchId, 'audio_lounge', [at(7, 20).toISOString()]))).toBe('invalid_slot');
    expect(await errorCode(setBridgePreference(ctx, a, matchId, 'audio_lounge', [at(12, 21).toISOString()]))).toBe('invalid_slot');
    expect(await errorCode(setBridgePreference(ctx, a, matchId, 'coffee_audit', [at(8, 7).toISOString()]))).toBe('invalid_slot');
    expect(await errorCode(setBridgePreference(ctx, a, matchId, 'coffee_audit', [at(30, 10).toISOString()]))).toBe('invalid_slot');
  });

  it('assigns the nearest suitable partner venue within 3 km of the midpoint', async () => {
    const { a, b, matchId } = await matchedPair({ a: [51.5, -0.14], b: [51.5, -0.1] }); // midpoint ≈ 51.5, -0.12
    await addVenue('Far Coffee', 'specialty_coffee', 51.55, -0.12); // ~5.6 km away
    await addVenue('Near Coffee', 'specialty_coffee', 51.505, -0.12);
    await addVenue('Wine Bar', 'wine_bar', 51.51, -0.12);
    await setBridgePreference(ctx, a, matchId, 'coffee_audit', [TUE_10]);
    await setBridgePreference(ctx, b, matchId, 'coffee_audit', [TUE_10]);
    const detail = await getMatch(ctx, a, matchId);
    expect(detail.event).toMatchObject({ mode: 'coffee_audit', duration_minutes: 45, starts_at: TUE_10 });
    expect(detail.event!.venue!.name).toBe('Near Coffee');
  });

  it('prefers a wine bar for evening slots', async () => {
    const { a, b, matchId } = await matchedPair();
    await addVenue('Near Coffee', 'specialty_coffee', 51.5075, -0.1276);
    await addVenue('Wine Bar', 'wine_bar', 51.52, -0.1276);
    await setBridgePreference(ctx, a, matchId, 'coffee_audit', [TUE_18]);
    await setBridgePreference(ctx, b, matchId, 'coffee_audit', [TUE_18]);
    expect((await getMatch(ctx, a, matchId)).event!.venue!.name).toBe('Wine Bar');
  });

  it('reports when no partner venue covers the midpoint', async () => {
    const { a, b, matchId } = await matchedPair();
    await setBridgePreference(ctx, a, matchId, 'coffee_audit', [TUE_10]);
    expect((await setBridgePreference(ctx, b, matchId, 'coffee_audit', [TUE_10])).state).toBe('no_venue_nearby');
    expect((await getMatch(ctx, a, matchId)).bridge.state).toBe('no_venue_nearby');
  });
});

describe('Freeze Raincheck', () => {
  async function scheduledLounge() {
    const pair = await matchedPair();
    await setBridgePreference(ctx, pair.a, pair.matchId, 'audio_lounge', [TUE_21]);
    await setBridgePreference(ctx, pair.b, pair.matchId, 'audio_lounge', [TUE_21]);
    ctx.setNow(at(8, 9)); // Tuesday morning, new UTC week
    return pair;
  }

  it('shifts by 48–72 h, spends the token, and needs the partner to accept', async () => {
    const { a, b, matchId } = await scheduledLounge();
    await requestRaincheck(ctx, a, matchId);
    let detail = await getMatch(ctx, a, matchId);
    expect(detail.status).toBe('raincheck_pending');
    expect(detail.freeze_token_available).toBe(false);
    expect(detail.event!.raincheck).toMatchObject({
      requested_by_me: true,
      proposed_starts_at: at(10, 21).toISOString(), // Thursday 21:00, +48 h
      expires_at: at(9, 9).toISOString(),
    });
    expect(await errorCode(acceptRaincheck(ctx, a, matchId))).toBe('own_raincheck');
    expect(await errorCode(requestRaincheck(ctx, b, matchId))).toBe('raincheck_unavailable');

    await acceptRaincheck(ctx, b, matchId);
    detail = await getMatch(ctx, b, matchId);
    expect(detail.status).toBe('scheduled');
    expect(detail.event).toMatchObject({ starts_at: at(10, 21).toISOString(), raincheck: null });
  });

  it('expires the match cleanly when the partner does not accept within 24 h', async () => {
    const { a, matchId } = await scheduledLounge();
    await requestRaincheck(ctx, a, matchId);
    ctx.setNow(at(9, 9, 1));
    expect((await runBridgeMaintenance(ctx)).rainchecksExpired).toBe(1);
    const detail = await getMatch(ctx, a, matchId);
    expect(detail.status).toBe('expired');
    expect(detail.event!.status).toBe('cancelled');
    expect(detail.bridge.state).toBe('closed');
  });

  it('requires an unspent weekly Freeze Token', async () => {
    const { a, matchId } = await scheduledLounge();
    await ctx.db.query(`INSERT INTO freeze_tokens (user_id, token_week, used_for) VALUES ($1, $2, 'card_carry')`, [
      a,
      '2026-11-09',
    ]);
    expect(await errorCode(requestRaincheck(ctx, a, matchId))).toBe('freeze_token_spent');
  });

  it('prefers a weekday for lounges and survives DST transitions', () => {
    // Thursday 21:00 → Saturday 21:00 (both candidates fall on the weekend).
    expect(raincheckStart('audio_lounge', new Date('2026-11-12T21:00:00Z'), 'Europe/London').toISOString()).toBe(
      '2026-11-14T21:00:00.000Z',
    );
    // Friday 23 Oct 2026 21:00 BST; clocks go back on the 25th → Monday 26 Oct 21:00 GMT.
    expect(raincheckStart('audio_lounge', new Date('2026-10-23T20:00:00Z'), 'Europe/London').toISOString()).toBe(
      '2026-10-26T21:00:00.000Z',
    );
    expect(raincheckStart('coffee_audit', new Date('2026-11-10T10:30:00Z'), 'Europe/London').toISOString()).toBe(
      '2026-11-12T10:30:00.000Z',
    );
  });
});

describe('bridge maintenance', () => {
  it('marks met after the event and times out bridges that never align', async () => {
    const first = await matchedPair();
    await setBridgePreference(ctx, first.a, first.matchId, 'audio_lounge', [TUE_21]);
    await setBridgePreference(ctx, first.b, first.matchId, 'audio_lounge', [TUE_21]);
    ctx.setNow(at(8, 21, 11));
    expect((await runBridgeMaintenance(ctx)).eventsCompleted).toBe(1);
    expect((await getMatch(ctx, first.a, first.matchId)).status).toBe('met');

    const second = await matchedPair();
    ctx.setNow(at(13, 19, 1));
    expect((await runBridgeMaintenance(ctx)).bridgesTimedOut).toBe(1);
    expect((await getMatch(ctx, second.a, second.matchId)).status).toBe('expired');
  });
});
