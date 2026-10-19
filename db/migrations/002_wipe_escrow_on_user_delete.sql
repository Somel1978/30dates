-- Deleting a member must never leave a half-identified escrow stake behind, and must not be
-- blocked by the escrow shape constraints (ON DELETE SET NULL alone would violate them).
-- Wipe every stake the member is party to, exactly as the Sunday job does, before the delete.
CREATE FUNCTION wipe_escrow_for_deleted_user() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.role', 'system', true);
  UPDATE escrow_vault SET
    status = 'wiped', wiped_at = now(), mutual_at = NULL, revealed_at = NULL,
    user_a_id = NULL, user_b_id = NULL, user_a_action = NULL, user_b_action = NULL,
    user_a_stamp = NULL, user_b_stamp = NULL, user_a_stamp_line = NULL, user_b_stamp_line = NULL,
    user_a_acted_at = NULL, user_b_acted_at = NULL
  WHERE user_a_id = OLD.id OR user_b_id = OLD.id;
  RETURN OLD;
END $$;

CREATE TRIGGER users_wipe_escrow BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION wipe_escrow_for_deleted_user();
