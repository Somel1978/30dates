-- =============================================================================
-- 001_init.sql — core schema for the 30–55 peer-intent platform.
-- All timestamps are timestamptz and every scheduled boundary is computed in UTC.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE gender_identity     AS ENUM ('man', 'woman', 'non_binary');
CREATE TYPE seeks_preference    AS ENUM ('men', 'women', 'everyone');
CREATE TYPE life_stage_goal     AS ENUM ('family_builder', 'blended_coparent', 'sovereign_lat');
CREATE TYPE living_architecture AS ENUM ('cohabit', 'lat', 'flexible');
CREATE TYPE mobility_profile    AS ENUM ('rooted', 'open_to_relocate', 'location_independent');
CREATE TYPE financial_rhythm    AS ENUM ('steady_saver', 'balanced', 'experience_first');

CREATE TYPE escrow_action       AS ENUM ('pending', 'validated', 'passed');
CREATE TYPE escrow_status       AS ENUM ('locked', 'mutual_unlocked', 'wiped');
CREATE TYPE resonance_stamp     AS ENUM ('same_flaw', 'balance_out', 'rhythm_agree', 'made_me_smile');
CREATE TYPE card_line           AS ENUM ('badges', 'interest_1', 'interest_2', 'interest_3', 'flaw', 'upside');
CREATE TYPE freeze_token_use    AS ENUM ('card_carry', 'raincheck');

CREATE TYPE match_status        AS ENUM ('bridging', 'scheduled', 'raincheck_pending', 'met', 'expired');
CREATE TYPE bridge_mode         AS ENUM ('audio_lounge', 'coffee_audit');
CREATE TYPE bridge_event_status AS ENUM ('scheduled', 'raincheck_pending', 'completed', 'cancelled');
CREATE TYPE venue_type          AS ENUM ('specialty_coffee', 'wine_bar');

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
CREATE FUNCTION age_in_years(p_birth date, p_at date) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT date_part('year', age(p_at::timestamp, p_birth::timestamp))::integer
$$;

CREATE FUNCTION utc_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'UTC')::date $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Session context used by row-level security. Set per transaction with SET LOCAL / set_config(..., true).
CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_user_id', true), '')::uuid $$;

CREATE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.role', true), '') = 'system' $$;

-- -----------------------------------------------------------------------------
-- Users & authentication
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   text NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' IN email) > 1),
  email_verified_at       timestamptz,
  first_name              varchar(40),
  birth_date              date,
  gender                  gender_identity,
  seeks                   seeks_preference,
  postal_code             varchar(16),
  country_code            char(2),
  coordinates             geometry(Point, 4326),
  time_zone               text,
  search_radius_km        integer CHECK (search_radius_km BETWEEN 5 AND 200),
  onboarding_completed_at timestamptz,
  is_active               boolean NOT NULL DEFAULT true,
  deactivated_reason      text,
  paused_at               timestamptz,
  token_version           integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Demographic boundary: strictly 30–55 at onboarding completion (rolling age is re-checked
  -- by the birth-date trigger, the Monday matcher and the daily aged-out sweep).
  CONSTRAINT users_age_bounds CHECK (
    onboarding_completed_at IS NULL
    OR age_in_years(birth_date, (onboarding_completed_at AT TIME ZONE 'UTC')::date) BETWEEN 30 AND 55
  ),
  -- Email verification is mandatory before onboarding can complete.
  CONSTRAINT users_onboarding_complete CHECK (
    onboarding_completed_at IS NULL OR (
      email_verified_at IS NOT NULL AND first_name IS NOT NULL AND birth_date IS NOT NULL
      AND gender IS NOT NULL AND seeks IS NOT NULL AND coordinates IS NOT NULL
      AND search_radius_km IS NOT NULL AND time_zone IS NOT NULL
    )
  ),
  -- Location privacy: coordinates are stored at ~100 m precision (3 decimal places).
  CONSTRAINT users_coordinates_rounded CHECK (
    coordinates IS NULL OR (
      ST_X(coordinates) = round(ST_X(coordinates)::numeric, 3)::double precision
      AND ST_Y(coordinates) = round(ST_Y(coordinates)::numeric, 3)::double precision
    )
  )
);

CREATE INDEX users_coordinates_gist ON users USING gist (coordinates);
CREATE INDEX users_coordinates_geog_gist ON users USING gist ((coordinates::geography));
CREATE INDEX users_matchable_idx ON users (id)
  WHERE is_active AND paused_at IS NULL AND onboarding_completed_at IS NOT NULL;

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE FUNCTION enforce_birth_date_bounds() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.birth_date IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.birth_date IS DISTINCT FROM OLD.birth_date)
     AND age_in_years(NEW.birth_date, utc_today()) NOT BETWEEN 30 AND 55 THEN
    RAISE EXCEPTION 'age_out_of_bounds' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER users_birth_date_bounds BEFORE INSERT OR UPDATE OF birth_date ON users
  FOR EACH ROW EXECUTE FUNCTION enforce_birth_date_bounds();

CREATE TABLE magic_link_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL CHECK (email = lower(email)),
  token_hash  bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_link_tokens_email_idx ON magic_link_tokens (email, created_at DESC);

-- Postal-code centroids (e.g. GeoNames export) used when the client sends no coordinates.
CREATE TABLE postal_code_centroids (
  country_code char(2)     NOT NULL,
  postal_code  varchar(16) NOT NULL,
  place_name   text,
  centroid     geometry(Point, 4326) NOT NULL,
  PRIMARY KEY (country_code, postal_code)
);

CREATE TABLE user_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position     smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
  storage_key  text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size    integer NOT NULL CHECK (byte_size > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, position)
);

CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_id);

-- -----------------------------------------------------------------------------
-- Profile: life architecture, flaw + upside coin, behavioral interests, vector
-- -----------------------------------------------------------------------------
CREATE TABLE life_architecture_gates (
  user_id             uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  family_goal         life_stage_goal     NOT NULL,
  living_architecture living_architecture NOT NULL,
  mobility            mobility_profile    NOT NULL,
  financial_rhythm    financial_rhythm    NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER gates_touch BEFORE UPDATE ON life_architecture_gates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Symmetric compatibility matrix. A pair is a "hard gate contradiction" when any gate
-- has no row for (value_a, value_b).
CREATE TABLE gate_compatibility (
  gate    text NOT NULL CHECK (gate IN ('family_goal', 'living_architecture', 'mobility', 'financial_rhythm')),
  value_a text NOT NULL,
  value_b text NOT NULL,
  PRIMARY KEY (gate, value_a, value_b)
);

INSERT INTO gate_compatibility (gate, value_a, value_b)
SELECT gate, a, b FROM (VALUES
  ('family_goal',         'family_builder',       'family_builder'),
  ('family_goal',         'blended_coparent',     'blended_coparent'),
  ('family_goal',         'blended_coparent',     'sovereign_lat'),
  ('family_goal',         'sovereign_lat',        'sovereign_lat'),
  ('living_architecture', 'cohabit',              'cohabit'),
  ('living_architecture', 'cohabit',              'flexible'),
  ('living_architecture', 'lat',                  'lat'),
  ('living_architecture', 'lat',                  'flexible'),
  ('living_architecture', 'flexible',             'flexible'),
  ('mobility',            'rooted',               'rooted'),
  ('mobility',            'rooted',               'open_to_relocate'),
  ('mobility',            'open_to_relocate',     'open_to_relocate'),
  ('mobility',            'open_to_relocate',     'location_independent'),
  ('mobility',            'location_independent', 'location_independent'),
  ('financial_rhythm',    'steady_saver',         'steady_saver'),
  ('financial_rhythm',    'steady_saver',         'balanced'),
  ('financial_rhythm',    'balanced',             'balanced'),
  ('financial_rhythm',    'balanced',             'experience_first'),
  ('financial_rhythm',    'experience_first',     'experience_first')
) AS t (gate, a, b)
UNION
SELECT gate, b, a FROM (VALUES
  ('family_goal',         'blended_coparent',     'sovereign_lat'),
  ('living_architecture', 'cohabit',              'flexible'),
  ('living_architecture', 'lat',                  'flexible'),
  ('mobility',            'rooted',               'open_to_relocate'),
  ('mobility',            'open_to_relocate',     'location_independent'),
  ('financial_rhythm',    'steady_saver',         'balanced'),
  ('financial_rhythm',    'balanced',             'experience_first')
) AS t (gate, a, b);

CREATE TABLE flaw_upside_coins (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  flaw       varchar(120) NOT NULL CHECK (char_length(btrim(flaw)) >= 3),
  upside     varchar(120) NOT NULL CHECK (char_length(btrim(upside)) >= 3),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER coins_touch BEFORE UPDATE ON flaw_upside_coins
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE behavioral_interests (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position     smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
  interest_key varchar(48) NOT NULL,
  receipt      varchar(140) NOT NULL CHECK (char_length(btrim(receipt)) >= 3),
  PRIMARY KEY (user_id, position),
  UNIQUE (user_id, interest_key)
);

CREATE TABLE psychometric_vectors (
  user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  embedding      vector(32) NOT NULL,
  vector_version smallint NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX psychometric_vectors_hnsw ON psychometric_vectors USING hnsw (embedding vector_cosine_ops);
CREATE TRIGGER vectors_touch BEFORE UPDATE ON psychometric_vectors
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- -----------------------------------------------------------------------------
-- Weekly ritual: batches, freeze tokens, run log
-- -----------------------------------------------------------------------------
CREATE TABLE weekly_batches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  batch_week           date NOT NULL CHECK (extract(isodow FROM batch_week) = 1),
  card_user_ids        uuid[] NOT NULL,
  carried_over_user_id uuid,
  frozen_user_id       uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, batch_week),
  CHECK (cardinality(card_user_ids) BETWEEN 1 AND 6),
  CHECK (array_position(card_user_ids, NULL) IS NULL),
  CHECK (NOT (user_id = ANY (card_user_ids))),
  CHECK (carried_over_user_id IS NULL OR carried_over_user_id = ANY (card_user_ids)),
  CHECK (frozen_user_id IS NULL OR frozen_user_id = ANY (card_user_ids)),
  -- A carried card cannot be frozen again (no indefinite carry).
  CHECK (frozen_user_id IS NULL OR frozen_user_id IS DISTINCT FROM carried_over_user_id)
);
CREATE INDEX weekly_batches_cards_gin ON weekly_batches USING gin (card_user_ids);
CREATE INDEX weekly_batches_week_idx ON weekly_batches (batch_week);

-- One Freeze Token per user per UTC week, spent either on carrying a card or on a raincheck.
CREATE TABLE freeze_tokens (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_week date NOT NULL CHECK (extract(isodow FROM token_week) = 1),
  used_for   freeze_token_use NOT NULL,
  used_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token_week)
);

CREATE TABLE batch_runs (
  batch_week        date PRIMARY KEY,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  users_considered  integer,
  eligible_pairs    integer,
  edges_assigned    integer,
  carried_cards     integer,
  shortfall_users   integer,
  stats             jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE job_runs (
  job_name     text NOT NULL,
  run_key      text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result       jsonb,
  PRIMARY KEY (job_name, run_key)
);

-- -----------------------------------------------------------------------------
-- Simultaneous blind escrow
-- pair_hash = HMAC-SHA256(min(uuid_a, uuid_b) || max(uuid_a, uuid_b), ESCROW_PAIR_SALT)
-- user_a_id is always the lexicographically smaller UUID.
-- -----------------------------------------------------------------------------
CREATE TABLE escrow_vault (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_hash         bytea NOT NULL CHECK (octet_length(pair_hash) = 32),
  batch_week        date NOT NULL CHECK (extract(isodow FROM batch_week) = 1),
  user_a_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  user_b_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  user_a_action     escrow_action,
  user_b_action     escrow_action,
  user_a_stamp      resonance_stamp,
  user_b_stamp      resonance_stamp,
  user_a_stamp_line card_line,
  user_b_stamp_line card_line,
  user_a_acted_at   timestamptz,
  user_b_acted_at   timestamptz,
  status            escrow_status NOT NULL DEFAULT 'locked',
  mutual_at         timestamptz,
  revealed_at       timestamptz,
  wiped_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pair_hash, batch_week),
  CONSTRAINT escrow_live_shape CHECK (
    status = 'wiped' OR (
      user_a_id IS NOT NULL AND user_b_id IS NOT NULL AND user_a_id < user_b_id
      AND user_a_action IS NOT NULL AND user_b_action IS NOT NULL
    )
  ),
  -- Zero trace: a wiped stake keeps nothing that identifies either party or their intent.
  CONSTRAINT escrow_wiped_scrubbed CHECK (
    status <> 'wiped' OR (
      user_a_id IS NULL AND user_b_id IS NULL AND user_a_action IS NULL AND user_b_action IS NULL
      AND user_a_stamp IS NULL AND user_b_stamp IS NULL AND user_a_stamp_line IS NULL
      AND user_b_stamp_line IS NULL AND user_a_acted_at IS NULL AND user_b_acted_at IS NULL
    )
  ),
  CONSTRAINT escrow_mutual_shape CHECK (
    status <> 'mutual_unlocked' OR (user_a_action = 'validated' AND user_b_action = 'validated' AND mutual_at IS NOT NULL)
  ),
  CONSTRAINT escrow_a_stamp_shape CHECK (
    user_a_action IS NULL
    OR (user_a_action = 'validated') = (user_a_stamp IS NOT NULL AND user_a_stamp_line IS NOT NULL AND user_a_acted_at IS NOT NULL)
  ),
  CONSTRAINT escrow_b_stamp_shape CHECK (
    user_b_action IS NULL
    OR (user_b_action = 'validated') = (user_b_stamp IS NOT NULL AND user_b_stamp_line IS NOT NULL AND user_b_acted_at IS NOT NULL)
  )
);
CREATE INDEX escrow_vault_a_idx ON escrow_vault (user_a_id, batch_week);
CREATE INDEX escrow_vault_b_idx ON escrow_vault (user_b_id, batch_week);
CREATE INDEX escrow_vault_week_status_idx ON escrow_vault (batch_week, status);

-- Row-level isolation. FORCE applies the policies to the owning (application) role too.
-- A party can read a stake only once they have acted on it themselves, so a pending
-- (unreciprocated) validation by the counterpart is invisible to the target user.
-- All writes go through the system context used by the escrow state machine.
ALTER TABLE escrow_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_vault FORCE ROW LEVEL SECURITY;

CREATE POLICY escrow_system_all ON escrow_vault
  FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

CREATE POLICY escrow_party_read ON escrow_vault
  FOR SELECT USING (
    (user_a_id = app_current_user_id() AND user_a_action <> 'pending')
    OR (user_b_id = app_current_user_id() AND user_b_action <> 'pending')
  );

-- Own-side projection: never exposes the counterpart's action, stamp or line.
CREATE VIEW escrow_my_stakes WITH (security_barrier = true, security_invoker = true) AS
SELECT
  e.id,
  e.pair_hash,
  e.batch_week,
  CASE WHEN e.user_a_id = app_current_user_id() THEN e.user_b_id ELSE e.user_a_id END AS counterpart_id,
  CASE WHEN e.user_a_id = app_current_user_id() THEN e.user_a_action ELSE e.user_b_action END AS my_action,
  CASE WHEN e.user_a_id = app_current_user_id() THEN e.user_a_stamp ELSE e.user_b_stamp END AS my_stamp,
  CASE WHEN e.user_a_id = app_current_user_id() THEN e.user_a_stamp_line ELSE e.user_b_stamp_line END AS my_stamp_line,
  CASE WHEN e.user_a_id = app_current_user_id() THEN e.user_a_acted_at ELSE e.user_b_acted_at END AS my_acted_at,
  e.status,
  e.mutual_at,
  e.revealed_at
FROM escrow_vault e
WHERE (e.user_a_id = app_current_user_id() AND e.user_a_action <> 'pending')
   OR (e.user_b_id = app_current_user_id() AND e.user_b_action <> 'pending');

-- Sunday #1 Signal, also held in blind escrow: only the signaler can read their own signal.
CREATE TABLE sunday_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_week  date NOT NULL CHECK (extract(isodow FROM batch_week) = 1),
  pair_hash   bytea NOT NULL CHECK (octet_length(pair_hash) = 32),
  signaler_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_week, signaler_id),
  CHECK (signaler_id <> target_id)
);
CREATE INDEX sunday_signals_pair_idx ON sunday_signals (batch_week, pair_hash);

ALTER TABLE sunday_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunday_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY signals_system_all ON sunday_signals
  FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY signals_own_read ON sunday_signals
  FOR SELECT USING (signaler_id = app_current_user_id());

-- Mid-week scenario exchange (unlocked Wednesday 00:00 UTC for mutual pairs).
CREATE TABLE scenario_responses (
  batch_week   date NOT NULL,
  pair_hash    bytea NOT NULL CHECK (octet_length(pair_hash) = 32),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scenario_key varchar(48) NOT NULL,
  stance_key   varchar(48) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_week, pair_hash, user_id, scenario_key)
);

-- -----------------------------------------------------------------------------
-- Matches, chat, First-Meet Bridge
-- -----------------------------------------------------------------------------
CREATE TABLE matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_hash      bytea NOT NULL UNIQUE CHECK (octet_length(pair_hash) = 32),
  batch_week     date NOT NULL,
  user_a_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status         match_status NOT NULL DEFAULT 'bridging',
  time_zone      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  expired_at     timestamptz,
  expired_reason text,
  CHECK (user_a_id < user_b_id),
  CHECK ((status = 'expired') = (expired_at IS NOT NULL))
);
CREATE INDEX matches_a_idx ON matches (user_a_id);
CREATE INDEX matches_b_idx ON matches (user_b_id);
CREATE TRIGGER matches_touch BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE chat_threads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid NOT NULL UNIQUE REFERENCES matches (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       varchar(2000) NOT NULL CHECK (char_length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX chat_messages_thread_idx ON chat_messages (thread_id, created_at, id);

CREATE TABLE partner_venues (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  venue_type     venue_type NOT NULL,
  address        text NOT NULL,
  geom           geometry(Point, 4326) NOT NULL,
  curation_score numeric(3, 2) NOT NULL DEFAULT 3.00 CHECK (curation_score BETWEEN 0 AND 5),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_venues_geom_gist ON partner_venues USING gist (geom);
CREATE INDEX partner_venues_geog_gist ON partner_venues USING gist ((geom::geography)) WHERE is_active;

-- Each party's private transition preference; never shown to the counterpart.
CREATE TABLE bridge_preferences (
  match_id   uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode       bridge_mode NOT NULL,
  slots      timestamptz[] NOT NULL CHECK (cardinality(slots) BETWEEN 1 AND 21),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);
CREATE TRIGGER bridge_preferences_touch BEFORE UPDATE ON bridge_preferences
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE bridge_events (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id                     uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  mode                         bridge_mode NOT NULL,
  starts_at                    timestamptz NOT NULL,
  duration_minutes             smallint NOT NULL CHECK (duration_minutes IN (10, 45)),
  venue_id                     uuid REFERENCES partner_venues (id),
  status                       bridge_event_status NOT NULL DEFAULT 'scheduled',
  raincheck_requested_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  raincheck_requested_at       timestamptz,
  raincheck_proposed_starts_at timestamptz,
  raincheck_expires_at         timestamptz,
  raincheck_count              smallint NOT NULL DEFAULT 0,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CHECK ((mode = 'coffee_audit') = (venue_id IS NOT NULL)),
  CHECK ((mode = 'audio_lounge') = (duration_minutes = 10)),
  CHECK (
    (status = 'raincheck_pending') = (raincheck_proposed_starts_at IS NOT NULL AND raincheck_expires_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX bridge_events_one_live_per_match ON bridge_events (match_id)
  WHERE status IN ('scheduled', 'raincheck_pending');
CREATE INDEX bridge_events_status_idx ON bridge_events (status, starts_at);
CREATE TRIGGER bridge_events_touch BEFORE UPDATE ON bridge_events
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
