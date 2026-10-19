/**
 * Behavioral interest catalog. Each interest projects onto 20 lifestyle trait axes;
 * those projections are the deterministic source of the psychometric vector.
 */
export const TRAITS = [
  'outdoors',
  'endurance',
  'culinary',
  'visual_arts',
  'music',
  'literature',
  'learning',
  'hosting',
  'homebody',
  'travel',
  'making',
  'wellness',
  'reflective',
  'civic',
  'tech',
  'strategy',
  'animals',
  'nature',
  'early_rhythm',
  'late_rhythm',
] as const;
export type Trait = (typeof TRAITS)[number];

export interface InterestDefinition {
  key: string;
  label: string;
  receiptHint: string;
  traits: Partial<Record<Trait, number>>;
}

export const INTEREST_CATALOG: readonly InterestDefinition[] = [
  { key: 'trail_running', label: 'Trail running', receiptHint: 'Ran the ridge loop at 6am twice last month', traits: { outdoors: 0.8, endurance: 1, early_rhythm: 0.6, wellness: 0.4 } },
  { key: 'open_water_swimming', label: 'Open-water swimming', receiptHint: 'Swim the lake every Saturday from May to October', traits: { outdoors: 0.7, endurance: 0.9, early_rhythm: 0.5, wellness: 0.5 } },
  { key: 'cycling_touring', label: 'Cycle touring', receiptHint: 'Rode 300 km along the coast last summer', traits: { outdoors: 0.8, endurance: 0.8, travel: 0.5 } },
  { key: 'hiking', label: 'Hiking', receiptHint: 'Two long hikes a month, map in the glovebox', traits: { outdoors: 1, nature: 0.7, endurance: 0.5 } },
  { key: 'climbing', label: 'Climbing', receiptHint: 'Bouldering gym Tuesdays and Thursdays', traits: { outdoors: 0.6, endurance: 0.6, strategy: 0.4 } },
  { key: 'yoga_practice', label: 'Yoga practice', receiptHint: 'Twenty minutes on the mat before coffee', traits: { wellness: 1, reflective: 0.6, early_rhythm: 0.4 } },
  { key: 'meditation', label: 'Meditation', receiptHint: '400-day streak, mostly on the train', traits: { reflective: 1, wellness: 0.7, early_rhythm: 0.3 } },
  { key: 'home_cooking', label: 'Home cooking', receiptHint: 'Cook from scratch five nights a week', traits: { culinary: 1, hosting: 0.6, homebody: 0.5 } },
  { key: 'baking', label: 'Baking', receiptHint: 'Sourdough starter is eight years old', traits: { culinary: 0.8, making: 0.6, homebody: 0.6, early_rhythm: 0.3 } },
  { key: 'dinner_hosting', label: 'Hosting dinners', receiptHint: 'Table for eight, once a month', traits: { hosting: 1, culinary: 0.7, late_rhythm: 0.4 } },
  { key: 'natural_wine', label: 'Natural wine', receiptHint: 'Keep tasting notes on every bottle', traits: { culinary: 0.6, hosting: 0.4, late_rhythm: 0.5, learning: 0.3 } },
  { key: 'specialty_coffee', label: 'Specialty coffee', receiptHint: 'Weigh my beans, own a hand grinder', traits: { culinary: 0.5, early_rhythm: 0.6, learning: 0.3 } },
  { key: 'live_music', label: 'Live music', receiptHint: 'Two gigs a month, small venues only', traits: { music: 1, late_rhythm: 0.7, hosting: 0.3 } },
  { key: 'playing_instrument', label: 'Playing an instrument', receiptHint: 'Piano lessons every Wednesday since 2019', traits: { music: 1, making: 0.5, learning: 0.5 } },
  { key: 'choir_singing', label: 'Choir', receiptHint: 'Tenor in a community choir', traits: { music: 0.9, civic: 0.4, hosting: 0.3 } },
  { key: 'dancing', label: 'Dancing', receiptHint: 'Salsa social on Fridays', traits: { music: 0.8, wellness: 0.4, late_rhythm: 0.7, hosting: 0.3 } },
  { key: 'reading_fiction', label: 'Reading fiction', receiptHint: 'Forty novels last year', traits: { literature: 1, homebody: 0.6, reflective: 0.5 } },
  { key: 'book_club', label: 'Book club', receiptHint: 'Host the club every third month', traits: { literature: 0.8, hosting: 0.5, learning: 0.4 } },
  { key: 'writing', label: 'Writing', receiptHint: 'Journal every night, short stories on Sundays', traits: { literature: 0.8, reflective: 0.7, making: 0.4 } },
  { key: 'museums_galleries', label: 'Museums & galleries', receiptHint: 'Annual membership, go on rainy Sundays', traits: { visual_arts: 1, learning: 0.6, travel: 0.3 } },
  { key: 'photography', label: 'Photography', receiptHint: 'Film camera in my bag every day', traits: { visual_arts: 0.8, making: 0.5, outdoors: 0.4 } },
  { key: 'film_nights', label: 'Film nights', receiptHint: 'Criterion list, one film every Friday', traits: { visual_arts: 0.5, homebody: 0.7, late_rhythm: 0.6 } },
  { key: 'ceramics', label: 'Ceramics', receiptHint: 'Throw on the wheel at a studio on Mondays', traits: { making: 1, visual_arts: 0.6, reflective: 0.3 } },
  { key: 'woodworking_diy', label: 'Woodworking & DIY', receiptHint: 'Built our dining table myself', traits: { making: 1, homebody: 0.5, tech: 0.3 } },
  { key: 'gardening', label: 'Gardening', receiptHint: 'Allotment plot, tomatoes every August', traits: { nature: 1, homebody: 0.5, early_rhythm: 0.5, making: 0.3 } },
  { key: 'dog_life', label: 'Life with a dog', receiptHint: 'Two long walks a day, rain or shine', traits: { animals: 1, outdoors: 0.6, early_rhythm: 0.5 } },
  { key: 'slow_travel', label: 'Slow travel', receiptHint: 'One month somewhere new each year', traits: { travel: 1, learning: 0.5, culinary: 0.3 } },
  { key: 'language_learning', label: 'Learning languages', receiptHint: 'Italian evening class, B1 so far', traits: { learning: 1, travel: 0.6 } },
  { key: 'volunteering', label: 'Volunteering', receiptHint: 'Food bank shift every other Saturday', traits: { civic: 1, hosting: 0.3 } },
  { key: 'board_games', label: 'Board games', receiptHint: 'Game night with the same friends for 6 years', traits: { strategy: 1, hosting: 0.6, homebody: 0.4 } },
  { key: 'chess', label: 'Chess', receiptHint: 'Daily puzzle, club on Thursdays', traits: { strategy: 1, learning: 0.4 } },
  { key: 'tech_tinkering', label: 'Tech tinkering', receiptHint: 'Home automation runs on a Raspberry Pi', traits: { tech: 1, making: 0.6, learning: 0.5 } },
  { key: 'documentaries_podcasts', label: 'Documentaries & podcasts', receiptHint: 'Long-form history podcasts on every commute', traits: { learning: 0.9, homebody: 0.5, reflective: 0.4 } },
];

export const INTEREST_BY_KEY: ReadonlyMap<string, InterestDefinition> = new Map(
  INTEREST_CATALOG.map((i) => [i.key, i]),
);

export function interestLabel(key: string): string {
  return INTEREST_BY_KEY.get(key)?.label ?? key;
}
