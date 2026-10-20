-- A member may write their own question for the voice exchange instead of picking one from
-- the bank. Custom picks use the keys custom_1 / custom_2 and carry their text here.
ALTER TABLE voice_prompt_picks
  ADD COLUMN custom_text varchar(200) CHECK (custom_text IS NULL OR length(btrim(custom_text)) >= 10);
