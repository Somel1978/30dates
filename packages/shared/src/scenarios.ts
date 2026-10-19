export interface ScenarioStance {
  key: string;
  label: string;
}

export interface ScenarioCard {
  key: string;
  prompt: string;
  stances: readonly [ScenarioStance, ScenarioStance, ScenarioStance];
}

export const SCENARIO_CATALOG: readonly ScenarioCard[] = [
  {
    key: 'sunday_double_booked',
    prompt: "A friend's last-minute birthday dinner collides with your planned quiet Sunday together.",
    stances: [
      { key: 'go_together', label: 'We go together and leave early' },
      { key: 'split_evening', label: 'You go, I keep the quiet night' },
      { key: 'protect_plan', label: 'We keep our plan and send a gift' },
    ],
  },
  {
    key: 'shared_expense_drift',
    prompt: "You notice you've paid for the last four dinners.",
    stances: [
      { key: 'name_it', label: 'Mention it lightly, right away' },
      { key: 'rebalance_quietly', label: 'Suggest a shared kitty' },
      { key: 'let_it_ride', label: 'It evens out over time' },
    ],
  },
  {
    key: 'travel_planning',
    prompt: 'Planning a four-day trip together.',
    stances: [
      { key: 'itinerary', label: 'I build the itinerary' },
      { key: 'anchor_points', label: 'Book two anchors, improvise the rest' },
      { key: 'fully_open', label: 'Book the flight, decide the rest there' },
    ],
  },
  {
    key: 'hard_week_support',
    prompt: 'Your partner has had a brutal week at work.',
    stances: [
      { key: 'cook_and_listen', label: 'Cook dinner and listen' },
      { key: 'give_space', label: 'Give space until they reach out' },
      { key: 'plan_escape', label: 'Plan a small escape for Saturday' },
    ],
  },
  {
    key: 'disagreement_timing',
    prompt: 'A small disagreement starts at 22:30 on a weeknight.',
    stances: [
      { key: 'resolve_now', label: 'Talk it through tonight' },
      { key: 'sleep_on_it', label: 'Pause, revisit over breakfast' },
      { key: 'write_it', label: 'Each write it down, compare tomorrow' },
    ],
  },
  {
    key: 'family_visit',
    prompt: 'Family wants a standing monthly Sunday lunch.',
    stances: [
      { key: 'every_time', label: 'Join every time' },
      { key: 'alternate', label: 'Alternate months' },
      { key: 'own_cadence', label: 'Each visits our own family separately' },
    ],
  },
  {
    key: 'phone_at_dinner',
    prompt: 'Work keeps pinging during dinner.',
    stances: [
      { key: 'phone_away', label: 'Phone face-down, reply later' },
      { key: 'quick_reply', label: 'Quick reply, then back' },
      { key: 'agreed_windows', label: 'Agree in advance which evenings are offline' },
    ],
  },
  {
    key: 'weekend_rhythm',
    prompt: 'A completely free Saturday morning.',
    stances: [
      { key: 'early_active', label: 'Early run or the market' },
      { key: 'slow_start', label: 'Slow coffee, papers, no plans' },
      { key: 'project_time', label: 'Tackle a home project together' },
    ],
  },
];

export const SCENARIO_BY_KEY: ReadonlyMap<string, ScenarioCard> = new Map(
  SCENARIO_CATALOG.map((s) => [s.key, s]),
);

export const SCENARIOS_PER_EXCHANGE = 2;

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministically picks two distinct scenario cards for a pair in a given week. */
export function pickScenarios(pairHashHex: string, batchWeek: string): ScenarioCard[] {
  const n = SCENARIO_CATALOG.length;
  const h = fnv1a(`${pairHashHex}:${batchWeek}`);
  const first = h % n;
  const second = (first + 1 + ((h >>> 8) % (n - 1))) % n;
  return [SCENARIO_CATALOG[first]!, SCENARIO_CATALOG[second]!];
}
