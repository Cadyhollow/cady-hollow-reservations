-- Electric Billing Redesign · Phase C2 · Audit columns for the void mechanism.
-- Cady ONLY (Supabase project dmqyuujhdflfydfhigvn). Run once in the Supabase SQL
-- editor. Safe to re-run (IF NOT EXISTS). DO NOT RUN until the Phase C2 code is
-- reviewed and deployed — code before schema, per project rule.
--
-- Adds the void audit trail (Decision 2c) to BOTH tables. `voided` (the boolean) was
-- added in Phase A; this adds the who/when/why. All nullable — existing rows are
-- untouched and non-voided rows simply have NULLs here. On BOTH tables because a void
-- is one unit written to both halves (and an orphan reading has no charge to carry
-- them, so the reading needs its own).

ALTER TABLE electric_readings
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by text,
  ADD COLUMN IF NOT EXISTS reason    text;

ALTER TABLE folio_line_items
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by text,
  ADD COLUMN IF NOT EXISTS reason    text;
