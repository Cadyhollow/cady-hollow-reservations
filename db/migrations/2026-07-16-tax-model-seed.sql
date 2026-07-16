-- Tax Model · T1 · SEED — reproduce Cady's CURRENT behavior under the new tax model.
-- Cady ONLY (Supabase project dmqyuujhdflfydfhigvn). Run once in the Supabase SQL editor,
-- AFTER 2026-07-16-tax-model-tables.sql. DO NOT RUN until reviewed.
--
-- Convention (same as the electric backfill): snapshot the derivation source ·
-- abort-on-mismatch · exact-once · verify. The whole thing is ONE DO block = ONE
-- transaction: if any check RAISEs, EVERYTHING rolls back (snapshot included) and the
-- new tables are left exactly as the schema script created them — empty.
--
-- What it does (docs/tax-model-spec.md "Migration" §1–3):
--   1. Seed ONE tax: "PA Sales Tax", rate 6.0 — matches today's hardcoded POS 6%.
--   2. For every product with tax_class = 'standard', add a tax_applications row
--      (type 'product', key = product.id). tax_class = 'exempt' products get NOTHING.
--   3. NO site types are taxed — Cady charges no stay tax. (So sites, add-ons, fees, and
--      the singletons all get nothing here.)
--   This reproduces current POS behavior EXACTLY: 6/100 === 0.06 on the same products.
--
-- Why the snapshot is of `products`, not of the tables being written: taxes and
-- tax_applications start empty, so their pre-image is nothing. The value worth freezing
-- is the DERIVATION INPUT — the product tax_class values this seed's decisions are based
-- on — so a later "why is product X taxed?" has a frozen answer. Its existence also
-- doubles as the exact-once guard.
--
-- NOTE: this seed assumes the live `products` table has a `tax_class` column (it does —
-- all five POS sites read product.tax_class). database-setup.sql's `products` definition
-- lags reality and omits it; that drift is pre-existing and out of scope for T1.

DO $$
DECLARE
  snapshot_name text := 'products_taxclass_snapshot_20260716';
  seeded_tax_id uuid;
  bad_count     int;
  standard_cnt  int;
  applied_cnt   int;
BEGIN
  -- 1) Snapshot the derivation source. Refuse to overwrite a prior snapshot (exact-once).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = snapshot_name) THEN
    RAISE EXCEPTION 'Snapshot % already exists — this seed appears to have run. Review before re-running.', snapshot_name;
  END IF;
  EXECUTE format('CREATE TABLE %I AS SELECT id, name, tax_class FROM products', snapshot_name);

  -- 2) Exact-once guard #2: the seeded tax must not already exist.
  IF EXISTS (SELECT 1 FROM taxes WHERE name = 'PA Sales Tax') THEN
    RAISE EXCEPTION 'A tax named "PA Sales Tax" already exists — seed already ran. Nothing changed.';
  END IF;

  -- 3) Abort-on-mismatch: every product must be a tax_class we understand. If POS grew a
  --    third value we have not accounted for, stop rather than silently mis-seed.
  SELECT count(*) INTO bad_count
  FROM products
  WHERE tax_class IS NULL OR tax_class NOT IN ('standard', 'exempt');
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Aborting seed: % product(s) have a tax_class other than standard/exempt. Nothing changed.', bad_count;
  END IF;

  -- 4) Seed the tax.
  INSERT INTO taxes (name, rate, is_active, display_order)
  VALUES ('PA Sales Tax', 6.0, true, 0)
  RETURNING id INTO seeded_tax_id;

  -- 5) Apply it to every 'standard' product; 'exempt' get nothing.
  SELECT count(*) INTO standard_cnt FROM products WHERE tax_class = 'standard';

  INSERT INTO tax_applications (tax_id, applies_to_type, applies_to_key)
  SELECT seeded_tax_id, 'product', id::text
  FROM products
  WHERE tax_class = 'standard';
  GET DIAGNOSTICS applied_cnt = ROW_COUNT;

  -- 6) Verify: exactly one application per standard product, none for exempt.
  IF applied_cnt <> standard_cnt THEN
    RAISE EXCEPTION 'Post-check failed: applied % rows but % standard products exist. Rolling back.', applied_cnt, standard_cnt;
  END IF;

  RAISE NOTICE 'Seed complete: tax "PA Sales Tax" (6.0) applied to % standard product(s). Exempt products untouched. Source snapshot: %.', applied_cnt, snapshot_name;
END $$;

-- Optional post-run spot check (read-only), run separately after the block commits:
--   SELECT t.name, t.rate, ta.applies_to_type, count(*)
--   FROM taxes t LEFT JOIN tax_applications ta ON ta.tax_id = t.id
--   GROUP BY 1,2,3 ORDER BY 1;
