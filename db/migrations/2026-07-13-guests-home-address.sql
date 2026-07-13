-- Guests home (mailing) address — Cady ONLY (Supabase project dmqyuujhdflfydfhigvn).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Seasonal campers must have a permanent residence outside the campground (park
-- rule) and we need a mailing address as a fallback when email delivery fails.
-- Structured (not a free-text blob) so we can address mail from the parts.
-- All four are nullable → safe against every existing read of the guests table.
-- Surfaced + marked required only on the seasonal camper page; optional elsewhere.

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS home_street text,
  ADD COLUMN IF NOT EXISTS home_city   text,
  ADD COLUMN IF NOT EXISTS home_state  text,
  ADD COLUMN IF NOT EXISTS home_zip    text;
