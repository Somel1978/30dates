import { describe, expect, it } from 'vitest';
import {
  INTEREST_CATALOG,
  TRAITS,
  ageOn,
  ageWindow,
  buildPsychometricVector,
  cosineSimilarity,
  VOICE_PROMPTS,
  VOICE_PROMPT_BY_KEY,
  seeksGender,
  weekClock,
} from './index.js';

const gates = {
  family_goal: 'family_builder',
  living_architecture: 'lat',
  mobility: 'rooted',
  financial_rhythm: 'balanced',
} as const;

describe('psychometric vector', () => {
  it('is deterministic, 32-dimensional and unit-length', () => {
    const a = buildPsychometricVector(gates, ['hiking', 'home_cooking', 'chess']);
    const b = buildPsychometricVector(gates, ['hiking', 'home_cooking', 'chess']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(32);
    expect(Math.hypot(...a)).toBeCloseTo(1, 5);
  });

  it('is order-independent over interests', () => {
    expect(buildPsychometricVector(gates, ['chess', 'hiking', 'baking'])).toEqual(
      buildPsychometricVector(gates, ['baking', 'chess', 'hiking']),
    );
  });

  it('ranks lifestyle neighbours above opposites', () => {
    const runner = buildPsychometricVector(gates, ['trail_running', 'hiking', 'open_water_swimming']);
    const hiker = buildPsychometricVector(gates, ['hiking', 'cycling_touring', 'dog_life']);
    const homebody = buildPsychometricVector(gates, ['film_nights', 'board_games', 'reading_fiction']);
    expect(cosineSimilarity(runner, hiker)).toBeGreaterThan(cosineSimilarity(runner, homebody));
  });

  it('rejects unknown interests', () => {
    expect(() => buildPsychometricVector(gates, ['nope'])).toThrow('unknown_interest');
  });

  it('only references known traits in the catalog', () => {
    for (const i of INTEREST_CATALOG) {
      for (const t of Object.keys(i.traits)) expect(TRAITS).toContain(t);
    }
  });
});

describe('age window', () => {
  it('clamps to platform bounds', () => {
    expect(ageWindow(31)).toEqual({ min: 30, max: 38 });
    expect(ageWindow(42)).toEqual({ min: 35, max: 49 });
    expect(ageWindow(54)).toEqual({ min: 47, max: 55 });
  });

  it('computes age on a date', () => {
    expect(ageOn('1990-06-15', new Date('2026-06-14T23:00:00Z'))).toBe(35);
    expect(ageOn('1990-06-15', new Date('2026-06-15T00:00:00Z'))).toBe(36);
  });
});

describe('orientation', () => {
  it('is directional', () => {
    expect(seeksGender('women', 'woman')).toBe(true);
    expect(seeksGender('women', 'non_binary')).toBe(false);
    expect(seeksGender('everyone', 'non_binary')).toBe(true);
  });
});

describe('week clock (UTC)', () => {
  it('maps instants to the four-stage week', () => {
    expect(weekClock(new Date('2026-10-19T06:59:59Z')).phase).toBe('awaiting_deal');
    expect(weekClock(new Date('2026-10-19T07:00:00Z')).phase).toBe('selection');
    expect(weekClock(new Date('2026-10-20T23:59:59Z')).phase).toBe('selection');
    expect(weekClock(new Date('2026-10-21T00:00:00Z')).phase).toBe('exchange_questions');
    expect(weekClock(new Date('2026-10-22T00:00:00Z')).phase).toBe('exchange_answers');
    expect(weekClock(new Date('2026-10-23T11:59:59Z')).phase).toBe('exchange_answers');
    expect(weekClock(new Date('2026-10-23T12:00:00Z')).phase).toBe('bridge');
    expect(weekClock(new Date('2026-10-25T23:59:59Z')).phase).toBe('bridge');
  });

  it('gives the Response Clock exactly 36 hours', () => {
    const c = weekClock(new Date('2026-10-21T10:00:00Z'));
    expect(c.answersCloseAt.getTime() - c.questionsCloseAt.getTime()).toBe(36 * 3_600_000);
  });

  it('anchors every day of the week to the same Monday', () => {
    for (let d = 19; d <= 25; d++) {
      expect(weekClock(new Date(`2026-10-${d}T12:00:00Z`)).batchWeek).toBe('2026-10-19');
    }
    expect(weekClock(new Date('2026-10-26T00:00:00Z')).batchWeek).toBe('2026-10-26');
  });
});

describe('voice prompt bank', () => {
  it('has unique keys and enough prompts for two picks of three', () => {
    expect(VOICE_PROMPT_BY_KEY.size).toBe(VOICE_PROMPTS.length);
    expect(VOICE_PROMPTS.length).toBeGreaterThanOrEqual(6);
  });
});

describe('life rhythm', () => {
  it('names the three strongest traits, never both early riser and night owl', async () => {
    const { lifeRhythm } = await import('./index.js');
    const rhythm = lifeRhythm(['trail_running', 'specialty_coffee', 'live_music']);
    expect(rhythm).toHaveLength(3);
    expect(rhythm.includes('Early riser') && rhythm.includes('Night owl')).toBe(false);
    expect(lifeRhythm(['trail_running', 'specialty_coffee', 'live_music'])).toEqual(rhythm);
  });
});
