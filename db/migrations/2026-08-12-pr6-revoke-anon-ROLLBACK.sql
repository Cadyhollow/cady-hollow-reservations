-- ROLLBACK for db/migrations/2026-08-12-pr6-revoke-anon.sql
--
-- Restores the exact pre-PR-6 state: re-grants anon and re-creates every {public}/{anon} policy
-- with the definition it had before the revoke. One command, no data loss — this migration only
-- ever touched grants and policies, never rows.
--
--   psql "$DATABASE_URL" -f db/migrations/2026-08-12-pr6-revoke-anon-ROLLBACK.sql
--
-- Run this if the post-apply verification fails: a broken admin page, a broken booking, or a
-- PostgREST 401/403 anywhere it should not be. Reversibility is the safety model for PR 6 —
-- reach for this before debugging live.
--
-- Every CREATE POLICY below was generated from pg_policies BEFORE the revoke, so the restored
-- definitions are byte-faithful rather than reconstructed from memory.
--
-- NOTE: this deliberately does NOT drop 5b's permissive/restrictive `authenticated` policies.
-- They were untouched by the revoke and the admin depends on them.

BEGIN;

-- ============================================================================================
-- 1. Re-create the {public} allow-all policies.
-- ============================================================================================

CREATE POLICY "Allow all operations on addons" ON public.addons AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on blocked_dates" ON public.blocked_dates AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on cancellation_rules" ON public.cancellation_rules AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON public.categories AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on discounts" ON public.discounts AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on electric_readings" ON public.electric_readings AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.failed_bookings AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for authenticated admin" ON public.fees AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on folio_line_items" ON public.folio_line_items AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on folio_payments" ON public.folio_payments AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on folios" ON public.folios AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on guests" ON public.guests AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on min_stay_rules" ON public.min_stay_rules AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on pricing_rules" ON public.pricing_rules AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on product_categories" ON public.product_categories AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on products" ON public.products AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on reservation_addons" ON public.reservation_addons AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on reservations" ON public.reservations AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on settings" ON public.settings AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON public.site_categories AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on sites" ON public.sites AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on tax_applications" ON public.tax_applications AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on taxes" ON public.taxes AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

-- The two anon SELECT policies.
CREATE POLICY "Allow public read for booking" ON public.settings AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read for booking" ON public.sites AS PERMISSIVE FOR SELECT TO anon USING (true);

-- The two misnamed {public} decoys. Note the asymmetry is faithful to the original:
-- broadcast_emails had USING only, with no WITH CHECK.
CREATE POLICY "Service role full access" ON public.broadcast_emails AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Allow all for service role" ON public.resonation_clients AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

-- ============================================================================================
-- 2. Re-grant anon.
-- ============================================================================================
-- Restores Supabase's stock grant set. Section 2 of the migration revoked schema-wide, so this
-- re-grants schema-wide; the pre-revoke state had these privileges on all 27 tables anon could
-- reach, and re-granting is a superset only for tables that had already been locked down by
-- PR 2's table hardening (broadcast_emails, failed_bookings, terminal_checkouts,
-- resonation_clients, profiles) — so those five are re-revoked immediately after.

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;

-- Tables that had NO anon grant before PR 6. Without this the rollback would leave the database
-- MORE open than it was pre-revoke.
REVOKE ALL ON public.broadcast_emails FROM anon;
REVOKE ALL ON public.failed_bookings FROM anon;
REVOKE ALL ON public.terminal_checkouts FROM anon;
REVOKE ALL ON public.resonation_clients FROM anon;
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.electric_readings_backup_20260714 FROM anon;
REVOKE ALL ON public.products_taxclass_snapshot_20260716 FROM anon;

-- 2b. Restore the stock default privileges (only needed if the migration's flagged block ran).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

-- ============================================================================================
-- 3. Restore the storage.objects policies.
-- ============================================================================================

DROP POLICY IF EXISTS "public read logos" ON storage.objects;
DROP POLICY IF EXISTS "public read site-photos" ON storage.objects;
DROP POLICY IF EXISTS "owner write logos" ON storage.objects;
DROP POLICY IF EXISTS "owner update logos" ON storage.objects;
DROP POLICY IF EXISTS "owner delete logos" ON storage.objects;
DROP POLICY IF EXISTS "manager write site-photos" ON storage.objects;
DROP POLICY IF EXISTS "manager update site-photos" ON storage.objects;
DROP POLICY IF EXISTS "manager delete site-photos" ON storage.objects;

CREATE POLICY "Allow public read access on logos" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (bucket_id = 'logos'::text);
CREATE POLICY "Allow admin upload to logos" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (bucket_id = 'logos'::text);
CREATE POLICY "Allow admin update logos" ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (bucket_id = 'logos'::text);
CREATE POLICY "Allow admin delete from logos" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (bucket_id = 'logos'::text);
CREATE POLICY "allow all operations mjc347_0" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (bucket_id = 'site-photos'::text);
CREATE POLICY "allow all operations mjc347_1" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (bucket_id = 'site-photos'::text);
CREATE POLICY "allow all operations mjc347_2" ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (bucket_id = 'site-photos'::text);
CREATE POLICY "allow all operations mjc347_3" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (bucket_id = 'site-photos'::text);

COMMIT;
