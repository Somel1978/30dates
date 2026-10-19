-- =============================================================================
-- 003_voice_exchange.sql — master spec state machine.
--  * Stage 2 is a clean whole-profile selection: resonance stamps and line tags are removed.
--  * Stage 3 is an asynchronous voice Q&A (replaces the text scenario exchange).
--  * Stage 4 releases names, photos and the First-Meet Bridge when both lock their answers
--    (replaces the Sunday reveal and the #1 Signal).
-- =============================================================================

DROP TABLE IF EXISTS sunday_signals;
DROP TABLE IF EXISTS scenario_responses;

-- Whole-profile selection: no stamps, no line tags. A selection is just 'validated' + when.
DROP VIEW escrow_my_stakes;
DROP FUNCTION wipe_escrow_for_deleted_user() CASCADE;
ALTER TABLE escrow_vault
  DROP CONSTRAINT escrow_wiped_scrubbed,
  DROP CONSTRAINT escrow_a_stamp_shape,
  DROP CONSTRAINT escrow_b_stamp_shape,
  DROP COLUMN user_a_stamp_line,
  DROP COLUMN user_b_stamp_line,
  DROP COLUMN user_a_stamp,
  DROP COLUMN user_b_stamp;
DROP TYPE card_line;
DROP TYPE resonance_stamp;

ALTER TABLE escrow_vault
  ADD CONSTRAINT escrow_wiped_scrubbed CHECK (
    status <> 'wiped' OR (
      user_a_id IS NULL AND user_b_id IS NULL AND user_a_action IS NULL AND user_b_action IS NULL
      AND user_a_acted_at IS NULL AND user_b_acted_at IS NULL
    )
  ),
  ADD CONSTRAINT escrow_a_selection_shape CHECK (
    user_a_action IS NULL OR (user_a_action = 'validated') = (user_a_acted_at IS NOT NULL)
  ),
  ADD CONSTRAINT escrow_b_selection_shape CHECK (
    user_b_action IS NULL OR (user_b_action = 'validated') = (user_b_acted_at IS NOT NULL)
  );

-- Recreated without the stamp columns: deleting a member wipes their stakes first.
CREATE FUNCTION wipe_escrow_for_deleted_user() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.role', 'system', true);
  UPDATE escrow_vault SET
    status = 'wiped', wiped_at = now(), mutual_at = NULL, revealed_at = NULL,
    user_a_id = NULL, user_b_id = NULL, user_a_action = NULL, user_b_action = NULL,
    user_a_acted_at = NULL, user_b_acted_at = NULL
  WHERE user_a_id = OLD.id OR user_b_id = OLD.id;
  RETURN OLD;
END $$;

CREATE TRIGGER users_wipe_escrow BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION wipe_escrow_for_deleted_user();

CREATE VIEW escrow_my_stakes WITH (security_barrier = true, security_invoker = true) AS
SELECT
  e.id,
  e.pair_hash,
  e.batch_week,
  CASE WHEN e.user_a_id = app_current_user_id() THEN e.user_b_id ELSE e.user_a_id END AS counterpart_id,
  CASE WHEN e.user_a_id = app_current_user_id() THEN e.user_a_action ELSE e.user_b_action END AS my_action,
  CASE WHEN e.user_a_id = app_current_user_id() THEN e.user_a_acted_at ELSE e.user_b_acted_at END AS my_acted_at,
  e.status,
  e.mutual_at,
  e.revealed_at
FROM escrow_vault e
WHERE (e.user_a_id = app_current_user_id() AND e.user_a_action <> 'pending')
   OR (e.user_b_id = app_current_user_id() AND e.user_b_action <> 'pending');

-- -----------------------------------------------------------------------------
-- Stage 3: asynchronous voice Q&A
-- -----------------------------------------------------------------------------
CREATE TYPE exchange_status AS ENUM ('questions', 'answering', 'released', 'expired');

CREATE TABLE voice_exchanges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_hash          bytea NOT NULL CHECK (octet_length(pair_hash) = 32),
  batch_week         date NOT NULL CHECK (extract(isodow FROM batch_week) = 1),
  user_a_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status             exchange_status NOT NULL DEFAULT 'questions',
  questions_close_at timestamptz NOT NULL,
  answers_close_at   timestamptz NOT NULL,
  -- Locking is final; the vaults stay double-blind until both are locked.
  user_a_locked_at   timestamptz,
  user_b_locked_at   timestamptz,
  released_at        timestamptz,
  expired_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pair_hash, batch_week),
  CHECK (user_a_id < user_b_id),
  CHECK (answers_close_at > questions_close_at),
  CHECK ((status = 'released') = (released_at IS NOT NULL)),
  CHECK ((status = 'expired') = (expired_at IS NOT NULL)),
  CHECK (status <> 'released' OR (user_a_locked_at IS NOT NULL AND user_b_locked_at IS NOT NULL))
);
CREATE INDEX voice_exchanges_a_idx ON voice_exchanges (user_a_id, batch_week);
CREATE INDEX voice_exchanges_b_idx ON voice_exchanges (user_b_id, batch_week);
CREATE INDEX voice_exchanges_open_idx ON voice_exchanges (status, answers_close_at)
  WHERE status IN ('questions', 'answering');

-- The 2–3 questions each member chose for the other.
CREATE TABLE voice_prompt_picks (
  exchange_id uuid NOT NULL REFERENCES voice_exchanges (id) ON DELETE CASCADE,
  picker_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
  prompt_key  varchar(48) NOT NULL,
  PRIMARY KEY (exchange_id, picker_id, position),
  UNIQUE (exchange_id, picker_id, prompt_key)
);

-- Locked voice answers. Drafts never leave the member's device; files arrive only on lock.
CREATE TABLE voice_answers (
  exchange_id  uuid NOT NULL REFERENCES voice_exchanges (id) ON DELETE CASCADE,
  answerer_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  prompt_key   varchar(48) NOT NULL,
  storage_key  text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav')),
  byte_size    integer NOT NULL CHECK (byte_size > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange_id, answerer_id, prompt_key)
);

-- Stage 4: the venue auto-assigned at release (3 km of the geographic midpoint).
ALTER TABLE matches ADD COLUMN venue_id uuid REFERENCES partner_venues (id) ON DELETE SET NULL;
