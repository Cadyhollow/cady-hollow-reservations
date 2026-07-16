-- Tax Model · T1 · SCHEMA — the dormant `taxes` + `tax_applications` tables.
-- Cady ONLY (Supabase project dmqyuujhdflfydfhigvn). Run once in the Supabase SQL
-- editor. Safe to re-run (IF NOT EXISTS everywhere). DO NOT RUN until the T1 code is
-- reviewed and deployed — code deploys before schema, per project rule.
--
-- These tables are DORMANT after T1: only the config UI (app/admin/fees/page.tsx)
-- reads or writes them. computePricing, the five hardcoded 6% POS sites, reservations,
-- reports, and the card surcharge do NOT touch them until T2+. Creating them now is the
-- same "build the mechanism dark, wire it later" pattern as electric Phase A.
--
-- Model (docs/tax-model-spec.md §1–2):
--   taxes            — first-class rows: a name + a rate. NO "type" column; a tax's
--                      meaning IS its scoping (lodging vs sales falls out of what it
--                      applies to, not a kind flag).
--   tax_applications — polymorphic many-to-many: which sellable things a tax applies to.
--                      applies_to_key is the site_type string, or a product/addon/fee id,
--                      or NULL for the settings-priced singletons (early check-in,
--                      late check-out, extra guest).

CREATE TABLE IF NOT EXISTS taxes (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  name          text NOT NULL,
  rate          numeric NOT NULL,          -- percent, decimals REQUIRED: 6.0, 4.1, 3.4
  is_active     boolean DEFAULT true,
  display_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tax_applications (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now(),
  tax_id          uuid NOT NULL REFERENCES taxes(id) ON DELETE CASCADE,
  applies_to_type text NOT NULL CHECK (applies_to_type IN
                    ('site_type','product','addon','fee','early_checkin','late_checkout','extra_guest')),
  applies_to_key  text            -- site_type string | product/addon/fee id | NULL for singletons
);

-- Lookups are always "which applications does this tax have" and, later (T2+),
-- "is this thing taxed" — index both directions.
CREATE INDEX IF NOT EXISTS idx_tax_applications_tax ON tax_applications(tax_id);
CREATE INDEX IF NOT EXISTS idx_tax_applications_target ON tax_applications(applies_to_type, applies_to_key);

-- Uniqueness: one application per (tax, type, key). applies_to_key is NULL for the
-- singletons, and NULLs are distinct under a plain UNIQUE constraint, so COALESCE the
-- NULL to '' — otherwise a tax could hold two "early_checkin" rows. This also makes the
-- config UI's delete-then-reinsert sync safe against accidental duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_applications
  ON tax_applications(tax_id, applies_to_type, COALESCE(applies_to_key, ''));

ALTER TABLE taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_applications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'taxes' AND policyname = 'Allow all on taxes') THEN
    CREATE POLICY "Allow all on taxes" ON taxes FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tax_applications' AND policyname = 'Allow all on tax_applications') THEN
    CREATE POLICY "Allow all on tax_applications" ON tax_applications FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
