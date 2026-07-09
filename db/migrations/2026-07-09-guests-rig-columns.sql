-- Phase 1 addendum — guests rig columns. Cady ONLY (dmqyuujhdflfydfhigvn).
-- A seasonal camper has no reservation, so camper type/length/amperage had no
-- home on the guest record. Adds them alongside camper_make/model/year (added in
-- 2026-07-09-seasonal-contracts.sql). Nullable → safe. Run once in the SQL editor.
--
-- reservations.camper_type / camper_length / camper_amperage are a SEPARATE,
-- unrelated concept (per-reservation rig) and are intentionally left untouched.
-- No data is migrated between reservations and guests.
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS camper_type      text,
  ADD COLUMN IF NOT EXISTS camper_length    int,
  ADD COLUMN IF NOT EXISTS camper_amperage  text;
