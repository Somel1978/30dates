export const PLATFORM_MIN_AGE = 30;
export const PLATFORM_MAX_AGE = 55;
export const AGE_WINDOW_HALF_SPAN = 7;
export const CARDS_PER_BATCH = 6;
export const MAX_WEEKLY_VALIDATIONS = 3;

export const GENDERS = ['man', 'woman', 'non_binary'] as const;
export type Gender = (typeof GENDERS)[number];

export const SEEKS = ['men', 'women', 'everyone'] as const;
export type Seeks = (typeof SEEKS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  man: 'Man',
  woman: 'Woman',
  non_binary: 'Non-binary',
};

export const SEEKS_LABELS: Record<Seeks, string> = {
  men: 'Men',
  women: 'Women',
  everyone: 'Everyone',
};

/** Mirrors the Stage 1 SQL orientation predicate: true when `seeker` wants to meet `gender`. */
export function seeksGender(seeks: Seeks, gender: Gender): boolean {
  if (seeks === 'everyone') return true;
  return (seeks === 'men' && gender === 'man') || (seeks === 'women' && gender === 'woman');
}

/** Candidate window for a given age: [max(30, age − 7), min(55, age + 7)]. */
export function ageWindow(age: number): { min: number; max: number } {
  return {
    min: Math.max(PLATFORM_MIN_AGE, age - AGE_WINDOW_HALF_SPAN),
    max: Math.min(PLATFORM_MAX_AGE, age + AGE_WINDOW_HALF_SPAN),
  };
}

export function ageOn(birthDate: string, at: Date): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = at.getUTCFullYear() - y;
  const beforeBirthday =
    at.getUTCMonth() + 1 < m || (at.getUTCMonth() + 1 === m && at.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

// ---------------------------------------------------------------------------
// Life-architecture gates
// ---------------------------------------------------------------------------
export const FAMILY_GOALS = ['family_builder', 'blended_coparent', 'sovereign_lat'] as const;
export const LIVING_ARCHITECTURES = ['cohabit', 'lat', 'flexible'] as const;
export const MOBILITY_PROFILES = ['rooted', 'open_to_relocate', 'location_independent'] as const;
export const FINANCIAL_RHYTHMS = ['steady_saver', 'balanced', 'experience_first'] as const;

export type FamilyGoal = (typeof FAMILY_GOALS)[number];
export type LivingArchitecture = (typeof LIVING_ARCHITECTURES)[number];
export type MobilityProfile = (typeof MOBILITY_PROFILES)[number];
export type FinancialRhythm = (typeof FINANCIAL_RHYTHMS)[number];

export interface LifeArchitectureGates {
  family_goal: FamilyGoal;
  living_architecture: LivingArchitecture;
  mobility: MobilityProfile;
  financial_rhythm: FinancialRhythm;
}

export const GATE_LABELS = {
  family_goal: {
    family_builder: 'Wants kids',
    blended_coparent: 'Co-parenting / blended',
    sovereign_lat: 'No more kids',
  },
  living_architecture: {
    cohabit: 'Cohabit',
    lat: 'LAT preferred',
    flexible: 'Living: flexible',
  },
  mobility: {
    rooted: 'Rooted locally',
    open_to_relocate: 'Open to relocate',
    location_independent: 'Location-independent',
  },
  financial_rhythm: {
    steady_saver: 'Steady saver',
    balanced: 'Balanced spender',
    experience_first: 'Experiences first',
  },
} as const satisfies {
  family_goal: Record<FamilyGoal, string>;
  living_architecture: Record<LivingArchitecture, string>;
  mobility: Record<MobilityProfile, string>;
  financial_rhythm: Record<FinancialRhythm, string>;
};

export const GATE_QUESTIONS: Record<keyof LifeArchitectureGates, string> = {
  family_goal: 'Where are you on family?',
  living_architecture: 'How do you want to live with a partner?',
  mobility: 'How rooted are you?',
  financial_rhythm: 'Your money rhythm',
};

export function gateBadges(g: LifeArchitectureGates): string[] {
  return [
    GATE_LABELS.family_goal[g.family_goal],
    GATE_LABELS.living_architecture[g.living_architecture],
    GATE_LABELS.mobility[g.mobility],
    GATE_LABELS.financial_rhythm[g.financial_rhythm],
  ];
}

// ---------------------------------------------------------------------------
// Resonance stamps & card lines
// ---------------------------------------------------------------------------
export const RESONANCE_STAMPS = ['same_flaw', 'balance_out', 'rhythm_agree', 'made_me_smile'] as const;
export type ResonanceStamp = (typeof RESONANCE_STAMPS)[number];

export const STAMP_META: Record<ResonanceStamp, { glyph: string; label: string }> = {
  same_flaw: { glyph: '📌', label: 'I have the exact same flaw' },
  balance_out: { glyph: '⚖️', label: "We'd balance each other out" },
  rhythm_agree: { glyph: '☕', label: 'Hard agree on this rhythm' },
  made_me_smile: { glyph: '💡', label: 'This made me smile' },
};

export const CARD_LINES = ['badges', 'interest_1', 'interest_2', 'interest_3', 'flaw', 'upside'] as const;
export type CardLine = (typeof CARD_LINES)[number];

// ---------------------------------------------------------------------------
// First-Meet Bridge
// ---------------------------------------------------------------------------
export const BRIDGE_MODES = ['audio_lounge', 'coffee_audit'] as const;
export type BridgeMode = (typeof BRIDGE_MODES)[number];

export const BRIDGE_MODE_META: Record<BridgeMode, { title: string; detail: string; minutes: number }> = {
  audio_lounge: {
    title: '10-minute audio lounge',
    detail: 'Camera off. Weekday evenings at 21:00.',
    minutes: 10,
  },
  coffee_audit: {
    title: '45-minute coffee or wine',
    detail: 'A vetted partner venue near your midpoint.',
    minutes: 45,
  },
};

export const AUDIO_LOUNGE_LOCAL_HOUR = 21;
export const COFFEE_FIRST_LOCAL_HOUR = 8;
export const COFFEE_LAST_LOCAL_HOUR = 20;
export const BRIDGE_HORIZON_DAYS = 14;
export const BRIDGING_TIMEOUT_DAYS = 7;
export const RAINCHECK_MIN_SHIFT_HOURS = 48;
export const RAINCHECK_MAX_SHIFT_HOURS = 72;
export const RAINCHECK_ACCEPT_WINDOW_HOURS = 24;
export const VENUE_RADIUS_METERS = 3000;
