-- Electric Billing Redesign · Phase A · ALTER 2 of 2 — flexible period columns.
-- Cady ONLY (Supabase project dmqyuujhdflfydfhigvn). Run once in the Supabase SQL
-- editor. Safe to re-run (IF NOT EXISTS). DO NOT RUN until the Phase A code is
-- reviewed and deployed — code deploys before schema, per project rule.
--
-- Adds the half-open [period_start, period_end) DATE range that replaces the
-- free-text `billing_month` as the real period model. Both columns are added here
-- as NULL; the separate backfill script (2026-07-14-electric-period-backfill.sql)
-- populates them from `billing_month`. `billing_month` STAYS — it runs in parallel
-- and remains the authority for existing reads until a later phase migrates them.
--
-- DATE (not timestamptz) on purpose: no time component, no timezone drift. All
-- overlap math in lib/electric-periods.ts compares these as 'YYYY-MM-DD' strings.

ALTER TABLE electric_readings
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end   date;
