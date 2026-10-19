import type {
  BridgeMode,
  CardLine,
  Gender,
  LifeArchitectureGates,
  ResonanceStamp,
  Seeks,
} from './domain.js';
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

export interface CardInterest {
  position: number;
  key: string;
  label: string;
  receipt: string;
}

export interface CardProfile {
  user_id: string;
  distance_km: number;
  badges: string[];
  gates: LifeArchitectureGates;
  interests: CardInterest[];
  coin: { flaw: string; upside: string };
}

export interface BatchCard extends CardProfile {
  carried_over: boolean;
  frozen: boolean;
  my_action: 'validated' | 'passed' | null;
  my_stamp: ResonanceStamp | null;
  my_stamp_line: CardLine | null;
}

export interface MutualCard extends CardProfile {
  scenario_exchange: {
    unlocked: boolean;
    answered_by_me: number;
    comparison_ready: boolean;
  };
  revealed: { first_name: string; photo_ids: string[] } | null;
}

export interface WeekClockDto {
  deal_at: string;
  scenario_unlock_at: string;
  stamps_close_at: string;
  reveal_at: string;
  signal_opens_at: string;
  signal_closes_at: string;
  next_deal_at: string;
}

export interface CurrentBatchResponse {
  batch_week: string;
  phase: WeekPhase;
  server_now: string;
  clock: WeekClockDto;
  cards: BatchCard[];
  stamps_remaining: number;
  freeze: {
    token_available: boolean;
    used_for: 'card_carry' | 'raincheck' | null;
    frozen_user_id: string | null;
  };
  mutual: MutualCard[];
  my_signal: { target_user_id: string; match_id: string | null } | null;
}

export interface ValidateRequest {
  target_user_id: string;
  resonance_stamp_type: ResonanceStamp;
  card_line: CardLine;
}

export interface SignalResponse {
  accepted: true;
  match_id: string | null;
}

export interface ScenarioExchangeResponse {
  batch_week: string;
  comparison_ready: boolean;
  scenarios: {
    key: string;
    prompt: string;
    stances: { key: string; label: string }[];
    my_stance: string | null;
    their_stance: string | null;
  }[];
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
  counterpart: { user_id: string; first_name: string; photo_ids: string[] };
  event: BridgeEventDto | null;
}

export interface MatchDetail extends MatchSummary {
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
