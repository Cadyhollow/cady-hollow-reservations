-- Electric Billing Redesign · Phase A · ALTER 1 of 2 — `voided` on both bill halves.
-- Cady ONLY (Supabase project dmqyuujhdflfydfhigvn). Run once in the Supabase SQL
-- editor. Safe to re-run (IF NOT EXISTS). DO NOT RUN until the Phase A code is
-- reviewed and deployed — code deploys before schema, per project rule.
--
-- Why both tables: a "bill" is two records (the charge on folio_line_items + the
-- reading on electric_readings). The redesign voids them as one unit, so BOTH need
-- their own void flag. Feasibility pass confirmed neither column exists in the live
-- DB today, so the existing `!i.voided` filter at folio/[id]:413 has been a silent
-- no-op. This ADDS the column; making that filter real is Phase C, not now.
--
-- NOT NULL DEFAULT false: existing rows backfill to false automatically; no bill is
-- ever "unknown" voided-ness. Nothing writes true in Phase A (void is Phase C).

ALTER TABLE folio_line_items
  ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false;

ALTER TABLE electric_readings
  ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false;
