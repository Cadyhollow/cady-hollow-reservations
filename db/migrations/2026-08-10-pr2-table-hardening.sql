-- ============================================================================
-- Security lockdown PR 2 — zero-impact table hardening
-- Cady only (project dmqyuujhdflfydfhigvn). Propagation to database-setup.sql,
-- the onboarding route and the template is PR 7 — deliberately NOT done here.
--
-- Everything below is backend-only or provably dead. No table the browser reads
-- is touched: folios, folio_payments, guests, products, product_categories,
-- electric_readings and folio_line_items keep RLS OFF until PRs 3-6 move their
-- reads server-side. Locking them now would break the confirmation page and the
-- admin app, which still talks to Supabase with the publishable key.
--
-- Idempotent: safe to re-run. Every step is guarded.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. RLS on the last backend-only table that still has it disabled.
--
-- terminal_checkouts is written only by /api/terminal/{charge,cancel} and
-- /api/webhooks/square, all service-role. Its anon+authenticated GRANTs were
-- already revoked in the key-rotation work, so this is defense in depth: if a
-- future GRANT is handed back by accident, RLS with no policy still denies.
-- service_role bypasses RLS, so the Square terminal flow is unaffected.
--
-- NOT INCLUDED, because they are already done — verified 2026-08-10:
--   failed_bookings   RLS already enabled
--   broadcast_emails  RLS already enabled
-- (The brief expected these to still be disabled; they are not. Their
-- permissive public/ALL policies remain, but with anon GRANTs revoked they are
-- unreachable from the browser. Dropping those policies is PR 6.)
-- ----------------------------------------------------------------------------
ALTER TABLE public.terminal_checkouts ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- 2. Backup tables — DELIBERATELY NOT DROPPED. See the report.
--
-- electric_readings_backup_20260714 and products_taxclass_snapshot_20260716
-- have no FK, no view, no trigger and no runtime code reference. But they are
-- NOT unreferenced:
--
--   * docs/electric-billing-redesign-spec.md:7,142 says keep the electric
--     backup "until Phase C is validated", because Phase C is the first phase
--     that MODIFIES existing readings. Phase C is not done — the spec shows
--     Phase D IN PROGRESS and C still pending after the 2026-07-15 flip.
--
--   * db/migrations/2026-07-16-tax-model-seed.sql:30-40 uses the products
--     snapshot as its exact-once guard (it RAISES if the table exists) and as
--     the frozen derivation record for "why is product X taxed?". Dropping it
--     disarms one of two re-run guards and destroys that audit trail.
--
-- Both already have their anon GRANTs revoked, so neither is exposed today.
-- The security benefit of dropping them right now is zero; the cost is real.
-- Revisit once Phase C is validated.
-- ----------------------------------------------------------------------------
-- (no statements)


-- ----------------------------------------------------------------------------
-- 3. Drop the dead anon INSERT policy on reservations.
--
-- Confirmed unused: the only inserts into reservations are /api/payment and
-- /api/manual-booking, both service-role, which bypasses RLS entirely. No
-- browser path inserts a reservation.
--
-- HONEST SCOPE: this does NOT stop anon inserting. The separate
-- "Allow all operations on reservations" policy ({public} ALL, USING true)
-- still permits it, and anon still holds the INSERT grant. This is dead-code
-- removal so PR 6 has one less thing to reason about — not a closed hole.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public insert for booking" ON public.reservations;


-- ----------------------------------------------------------------------------
-- 4. Pin search_path on the four functions the advisor flags.
--
-- Signatures taken from pg_proc (oid::regprocedure), not guessed. All four are
-- SECURITY INVOKER, so the practical risk is low, but they run under
-- service_role in /api/payment and the electric routes, and an unpinned
-- search_path is a standing hazard. pg_temp last is the standard hardening.
--
-- Body-preserving: ALTER FUNCTION ... SET does not recompile or change logic.
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.increment_discount_usage(text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.sync_guest_from_reservation()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.create_electric_bill(
  uuid, uuid, text, date, date, text, integer, numeric, numeric, numeric, numeric, integer, integer, integer
) SET search_path = public, pg_temp;

ALTER FUNCTION public.void_electric_bill(uuid, text, text)
  SET search_path = public, pg_temp;


-- ----------------------------------------------------------------------------
-- 5. Drop settings.admin_password — the exposed, vestigial password column.
--
-- It was readable by any visitor (anon holds SELECT on settings with a
-- USING(true) policy) and it held a real password-shaped value, while being
-- read by NOTHING: /api/admin-auth:6 compares against the ADMIN_PASSWORD env
-- var. The settings page merely WROTE it from a "Change Admin Password" field,
-- so staff typing a new password there changed nothing about logging in.
--
-- WHY DROP RATHER THAN REVOKE THE COLUMN: the revoke path needs
-- REVOKE SELECT ON settings + GRANT SELECT (cols...), leaving only column-level
-- grants — and SELECT * then fails on the ungranted column. Six code paths do
-- settings.select('*'), five of them admin pages running as anon (admin still
-- uses the publishable key). That would break the admin dashboard, calendar,
-- settings, new-reservation and reservations pages at once. Dropping is both
-- safer and complete.
--
-- CODE COMPANION — ships in the same PR, and is REQUIRED, not optional:
-- app/admin/settings/page.tsx no longer references admin_password. Leaving the
-- write in place would fail the ENTIRE settings save the first time anyone
-- typed in that field (the neighbouring hasThemeColumn guard documents exactly
-- that failure mode: "one unknown column fails the whole update and takes every
-- other setting with it").
--
-- Changing the admin password is, and always was, an ADMIN_PASSWORD env var
-- change in Vercel + redeploy.
-- ----------------------------------------------------------------------------
ALTER TABLE public.settings DROP COLUMN IF EXISTS admin_password;

COMMIT;


-- ============================================================================
-- VERIFY (read-only, after applying)
-- ============================================================================
-- select relname, relrowsecurity from pg_class
--  where relname = 'terminal_checkouts';                     -- expect: t
--
-- select policyname from pg_policies
--  where tablename = 'reservations';                          -- expect: no "Allow public insert for booking"
--
-- select p.oid::regprocedure::text, p.proconfig from pg_proc p
--  join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('increment_discount_usage','sync_guest_from_reservation',
--                      'create_electric_bill','void_electric_bill');
--                                                             -- expect: {"search_path=public, pg_temp"} on all four
--
-- select count(*) from information_schema.columns
--  where table_schema='public' and table_name='settings'
--    and column_name='admin_password';                        -- expect: 0
--
-- Advisor: the four function_search_path_mutable WARNs should clear. The seven
-- rls_disabled_in_public ERRORs will REMAIN (browser-facing, PRs 3-6), and
-- terminal_checkouts will ADD an rls_enabled_no_policy INFO — that INFO is the
-- locked state we want, not a regression.
-- ============================================================================
