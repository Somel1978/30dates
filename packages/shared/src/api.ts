import type {
  BridgeMode,
  Gender,
  LifeArchitectureGates,
  Seeks,
} from './domain.js';
import type { PromptVector } from './prompts.js';
import type { WeekPhase } from './week.js';

/** Wire contracts shared by the API and the web client. Dates are ISO-8601 UTC strings. */

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export interface MeResponse {
  id: string;
  email: string;
  first_name: string | null;
  onboarding_completed: boolean;
  time_zone: string | null;
  photos: { id: string; position: number }[];
}

export interface OnboardingPayload {
  first_name: string;
  birth_date: string;
  gender: Gender;
  seeks: Seeks;
  country_code: string;
  postal_code: string;
  coordinates?: { lat: number; lng: number };
  time_zone: string;
  search_radius_km: number;
  gates: LifeArchitectureGates;
  coin: { flaw: string; upside: string };
  interests: { key: string; receipt: string }[];
}

/** The member's own answers (for editing) plus their card exactly as others see it. */
export interface ProfileResponse {
  first_name: string;
  birth_date: string;
  gender: Gender;
  seeks: Seeks;
  country_code: string;
  postal_code: string;
  search_radius_km: number;
  time_zone: string;
  gates: LifeArchitectureGates;
  coin: { flaw: string; upside: string };
  interests: { key: string; receipt: string }[];
  preview: CardProfile;
}

export interface DevStatus {
  real_now: string;
  server_now: string;
  clock_shifted: boolean;
  phase: WeekPhase;
  batch_week: string;
  members: number;
  my_cards: number;
  selected_me: number;
  exchanges: number;
  matches: number;
}

export interface CardInterest {
  position: number;
  key: string;
  label: string;
  receipt: string;
}

/** A faceless, nameless Monday card: Life Rhythm, behavioral interests and the coin. No gates. */
export interface CardProfile {
  user_id: string;
  distance_km: number;
  rhythm: string[];
  interests: CardInterest[];
  coin: { flaw: string; upside: string };
}

export interface BatchCard extends CardProfile {
  carried_over: boolean;
  frozen: boolean;
  /** Chosen into blind escrow this week. There is no pass: unchosen cards simply lapse. */
  selected: boolean;
}

export type ExchangeStatus = 'questions' | 'answering' | 'released' | 'expired';

/** A mutual pair's Stage 3 voice exchange, as it appears on the weekly dashboard. */
export interface ExchangeSummary {
  id: string;
  status: ExchangeStatus;
  counterpart: CardProfile;
  my_pick_count: number;
  i_locked: boolean;
  questions_close_at: string;
  answers_close_at: string;
  /** Set the instant both have locked: the simultaneous modality switch. */
  revealed: { first_name: string; age: number; photo_ids: string[] } | null;
  match_id: string | null;
}

export interface ExchangeDetail extends ExchangeSummary {
  server_now: string;
  /** The bank to pick from (while picking questions). */
  prompt_bank: { key: string; vector: PromptVector; text: string }[];
  /** Questions I chose for them. */
  my_picks: string[];
  /** Questions they chose for me; visible once the Response Clock starts. */
  questions_for_me: { key: string; text: string }[];
  /** Their answers, playable only after release. */
  their_answers: { prompt_key: string; text: string; audio_url: string }[];
  /** My own locked answers (playable by me after locking). */
  my_answers: { prompt_key: string; text: string; audio_url: string }[];
}

export interface WeekClockDto {
  deal_at: string;
  selection_closes_at: string;
  questions_close_at: string;
  answers_close_at: string;
  next_deal_at: string;
}

export interface CurrentBatchResponse {
  batch_week: string;
  phase: WeekPhase;
  server_now: string;
  clock: WeekClockDto;
  cards: BatchCard[];
  selections_remaining: number;
  freeze: {
    token_available: boolean;
    used_for: 'card_carry' | 'raincheck' | null;
    frozen_user_id: string | null;
  };
  exchanges: ExchangeSummary[];
}

export interface SelectRequest {
  target_user_id: string;
}

export interface VenueDto {
  id: string;
  name: string;
  address: string;
  venue_type: 'specialty_coffee' | 'wine_bar';
  lat: number;
  lng: number;
}

export interface BridgeEventDto {
  id: string;
  mode: BridgeMode;
  starts_at: string;
  duration_minutes: number;
  status: 'scheduled' | 'raincheck_pending' | 'completed' | 'cancelled';
  venue: VenueDto | null;
  raincheck: {
    requested_by_me: boolean;
    proposed_starts_at: string;
    expires_at: string;
  } | null;
}

export type BridgeState = 'awaiting_alignment' | 'scheduled' | 'no_venue_nearby' | 'closed';

export interface MatchSummary {
  id: string;
  status: 'bridging' | 'scheduled' | 'raincheck_pending' | 'met' | 'expired';
  time_zone: string;
  created_at: string;
  counterpart: { user_id: string; first_name: string; age: number; photo_ids: string[] };
  event: BridgeEventDto | null;
}

export interface MatchDetail extends MatchSummary {
  /** Venue auto-assigned at the release, within 3 km of the geographic midpoint. */
  suggested_venue: VenueDto | null;
  /** The first meeting must start before this (72 hours after the release). */
  bridge_window_closes_at: string;
  server_now: string;
  bridge: {
    state: BridgeState;
    my_preference: { mode: BridgeMode; slots: string[] } | null;
  };
  freeze_token_available: boolean;
}

export interface BridgePreferenceRequest {
  mode: BridgeMode;
  slots: string[];
}

export interface ChatMessageDto {
  id: string;
  sender_is_me: boolean;
  body: string;
  created_at: string;
}
