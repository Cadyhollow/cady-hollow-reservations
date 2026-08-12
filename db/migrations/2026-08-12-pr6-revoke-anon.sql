-- Security PR 6: revoke the anon role's access to data.
--
-- Rollback: db/migrations/2026-08-12-pr6-revoke-anon-ROLLBACK.sql (one command, no data loss).
--
-- WHAT THIS IS. Every reader has already been moved off the anon role: public pages read
-- server-side (PR 4), the camper flow writes via service-role (PR 0/4a), and the admin runs on
-- the authenticated role with a full policy set (PR 5). The only thing still letting the
-- publishable key touch data is the leftover {public} allow-all policies and the anon table
-- grants. This removes both.
--
-- WHAT THIS IS NOT. This does not touch the publishable key, which stays in the browser and is
-- not a secret. GoTrue login uses that key against the `auth` schema, which has no table grants
-- here and is untouched. "Revoking anon" means revoking what the anon Postgres ROLE may do.
--
-- GRANTS AND POLICIES ARE INDEPENDENT GATES. PR 5a's lesson: a policy is only consulted if the
-- role already holds the table privilege. Closing one leaves the other as a live re-entry point,
-- so sections 1 and 2 both have to happen.
--
-- ============================================================================================
-- WHY DROPPING THE {public} POLICIES DOES NOT BREAK THE ADMIN
-- ============================================================================================
-- `{public}` in Postgres means EVERY role, so these allow-all policies currently apply to
-- `authenticated` too. Today the admin's effective access is:
--
--     (permissive OR-set) AND (restrictive AND-set)
--      ^ trivially true via the {public} allow-all
--                            ^ 5b's `role gate ...` policies — THIS is what makes roles bite
--
-- Dropping the {public} half leaves 5b's PERMISSIVE `authenticated ...` policies (87 of them,
-- across 23 tables) as the permissive side, and they carry the same app.at_least() quals as the
-- restrictive half. Verified before writing this: a full join of permissive vs restrictive quals
-- per (table, cmd) shows agreement everywhere except three intentional cases —
--   electric_readings DELETE  restrictive-only, qual false  (deny; browser never deletes these)
--   folio_payments    DELETE  restrictive-only, qual false  (deny; browser never deletes these)
--   profiles          SELECT  permissive-only, auth.uid() = id
-- and an anti-join of all 79 (table, op) pairs the admin browser actually performs against the
-- surviving permissive authenticated policies returns empty.
--
-- The permissive and restrictive `authenticated` policies are NOT duplicates of each other and
-- MUST NOT be "deduplicated" by a future cleanup — the restrictive half is the half that
-- enforces roles. Both stay.

BEGIN;

-- ============================================================================================
-- 1. Drop the {public} allow-all policies and the leftover anon SELECT policies.
-- ============================================================================================
-- 25 {public} + 2 {anon}. The old reservations anon INSERT is already gone.

DROP POLICY IF EXISTS "Allow all operations on addons" ON public.addons;
DROP POLICY IF EXISTS "Allow all operations on blocked_dates" ON public.blocked_dates;
DROP POLICY IF EXISTS "Allow all operations on cancellation_rules" ON public.cancellation_rules;
DROP POLICY IF EXISTS "allow all" ON public.categories;
DROP POLICY IF EXISTS "Allow all operations on discounts" ON public.discounts;
DROP POLICY IF EXISTS "Allow all operations on electric_readings" ON public.electric_readings;
DROP POLICY IF EXISTS "Allow all" ON public.failed_bookings;
DROP POLICY IF EXISTS "Allow all operations for authenticated admin" ON public.fees;
DROP POLICY IF EXISTS "Allow all operations on folio_line_items" ON public.folio_line_items;
DROP POLICY IF EXISTS "Allow all operations on folio_payments" ON public.folio_payments;
DROP POLICY IF EXISTS "Allow all operations on folios" ON public.folios;
DROP POLICY IF EXISTS "Allow all operations on guests" ON public.guests;
DROP POLICY IF EXISTS "Allow all operations on min_stay_rules" ON public.min_stay_rules;
DROP POLICY IF EXISTS "Allow all operations on pricing_rules" ON public.pricing_rules;
DROP POLICY IF EXISTS "Allow all operations on product_categories" ON public.product_categories;
DROP POLICY IF EXISTS "Allow all operations on products" ON public.products;
DROP POLICY IF EXISTS "Allow all operations on reservation_addons" ON public.reservation_addons;
DROP POLICY IF EXISTS "Allow all operations on reservations" ON public.reservations;
DROP POLICY IF EXISTS "Allow all operations on settings" ON public.settings;
DROP POLICY IF EXISTS "allow all" ON public.site_categories;
DROP POLICY IF EXISTS "Allow all operations on sites" ON public.sites;
DROP POLICY IF EXISTS "Allow all on tax_applications" ON public.tax_applications;
DROP POLICY IF EXISTS "Allow all on taxes" ON public.taxes;

-- The two anon SELECT policies the public pages used before PR 4 relocated those reads.
DROP POLICY IF EXISTS "Allow public read for booking" ON public.settings;
DROP POLICY IF EXISTS "Allow public read for booking" ON public.sites;

-- Two {public} allow-all policies whose NAMES claim to be service-role scoped but whose ROLE is
-- public. They are inert today only because neither table has an anon or authenticated grant —
-- service_role bypasses RLS and never consults them. One stray GRANT would make them live, and
-- resonation_clients holds every tenant's Square + service keys. Removing the decoys.
DROP POLICY IF EXISTS "Service role full access" ON public.broadcast_emails;
DROP POLICY IF EXISTS "Allow all for service role" ON public.resonation_clients;

-- ============================================================================================
-- 2. Revoke anon's table privileges.
-- ============================================================================================
-- Schema-wide rather than a list of 27 table names: the list was generated from today's catalog
-- and would silently miss anything added between writing this and running it. anon holds no
-- privilege in this schema that anything legitimately uses.
--
-- USAGE ON SCHEMA public is deliberately KEPT. Removing it makes PostgREST fail during schema
-- introspection rather than returning a clean permission-denied, and it is the table privileges
-- that gate the data.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Stop the hole reopening on the next CREATE TABLE. Supabase's stock default privileges re-grant
-- anon full access to every newly created table, so without this the next migration that adds a
-- table silently undoes section 2 for that table. Reversible on its own (see rollback §2b).
--
-- FLAGGED FOR REVIEW: this is the one statement here that reaches beyond today's catalog. If you
-- would rather PR 7 own it alongside database-setup.sql, delete this block — nothing else in
-- this migration depends on it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- ============================================================================================
-- 3. Storage: keep public READ, restrict writes.
-- ============================================================================================
-- All 8 storage.objects policies are role {public}, which means anon can currently upload,
-- overwrite AND DELETE every logo and site photo. The policy NAMES say "Allow admin upload to
-- logos" / "Allow admin delete from logos"; the roles say otherwise. This is the "anyone can
-- upload a logo" hole, and the delete half of it is worse than the upload half.
--
-- Public READ stays exactly as it is on both buckets — the booking site displays these images,
-- and both buckets are marked public.
--
-- WRITE ROLES ARE NOT THE SAME FOR THE TWO BUCKETS, deliberately:
--   logos       — written only by /admin/settings, which is an Owner page       -> owner
--   site-photos — written by /admin/sites (Owner) AND /admin/send-email, which
--                 is a MANAGER page (broadcast email images)                    -> manager
-- Gating site-photos at owner would break Manager's broadcast-email image upload. Checked
-- against lib/admin-pages.ts.
--
-- app.at_least() is SECURITY DEFINER and already used by every authenticated policy from 5b, so
-- it resolves the caller's role from their JWT the same way here.

DROP POLICY IF EXISTS "Allow public read access on logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin upload to logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin update logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin delete from logos" ON storage.objects;
DROP POLICY IF EXISTS "allow all operations mjc347_0" ON storage.objects;
DROP POLICY IF EXISTS "allow all operations mjc347_1" ON storage.objects;
DROP POLICY IF EXISTS "allow all operations mjc347_2" ON storage.objects;
DROP POLICY IF EXISTS "allow all operations mjc347_3" ON storage.objects;

-- Reads: unchanged behaviour, explicit about it.
CREATE POLICY "public read logos" ON storage.objects
  AS PERMISSIVE FOR SELECT TO public USING (bucket_id = 'logos');
CREATE POLICY "public read site-photos" ON storage.objects
  AS PERMISSIVE FOR SELECT TO public USING (bucket_id = 'site-photos');

-- Writes: authenticated only, role-gated.
CREATE POLICY "owner write logos" ON storage.objects
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos' AND (SELECT app.at_least('owner')));
CREATE POLICY "owner update logos" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (bucket_id = 'logos' AND (SELECT app.at_least('owner')))
  WITH CHECK (bucket_id = 'logos' AND (SELECT app.at_least('owner')));
CREATE POLICY "owner delete logos" ON storage.objects
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (bucket_id = 'logos' AND (SELECT app.at_least('owner')));

CREATE POLICY "manager write site-photos" ON storage.objects
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-photos' AND (SELECT app.at_least('manager')));
CREATE POLICY "manager update site-photos" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (bucket_id = 'site-photos' AND (SELECT app.at_least('manager')))
  WITH CHECK (bucket_id = 'site-photos' AND (SELECT app.at_least('manager')));
CREATE POLICY "manager delete site-photos" ON storage.objects
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (bucket_id = 'site-photos' AND (SELECT app.at_least('manager')));

COMMIT;
