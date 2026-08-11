-- ============================================================================
-- Security lockdown PR 5b-1 — the authenticated-role policy set
-- Cady only (project dmqyuujhdflfydfhigvn). Template + onboarding is PR 7.
--
-- WHAT THIS IS FOR. PR 6 revokes the `anon` role. Today 12 of the 22 tables the
-- admin uses have NO authenticated policy at all: 7 have RLS switched off
-- entirely, and 5 are covered only by a `{public}` policy. Admin reaches all of
-- them over the anon key from the browser. Revoking anon against that shape
-- would not harden the app, it would decapitate it — the folio pages, the guest
-- directory, the POS and electric billing all stop working at once. This
-- migration authors the complete authenticated-role policy set so that PR 6 is
-- a safe revoke, and ships alongside the code change that moves admin's browser
-- reads onto the logged-in session.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   * Does not revoke anon, and does not drop a single `{public}` policy. That
--     is PR 6 in its entirety. Nothing anon can do today changes here.
--   * Does not touch the camper booking flow. Every public path reaches these
--     tables through service-role code, which bypasses RLS outright.
--   * Does not add route or page enforcement. requireRole is 5b-2.
--
-- Idempotent: every CREATE is preceded by DROP ... IF EXISTS. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. THE ROLE HELPER
--
-- SECURITY DEFINER because public.profiles has RLS with a self-row-only SELECT
-- policy. Reading it from inside a policy on another table would otherwise
-- re-enter RLS on every row; DEFINER evaluates it once, as the owner, and means
-- profiles' own policy does not have to be widened to make roles work.
--
-- `set search_path = ''` with fully-qualified names throughout. An unpinned
-- search_path on a DEFINER function is a privilege-escalation primitive: a
-- caller who can create a table in a schema earlier on the path can substitute
-- their own `profiles`. The empty path makes that impossible.
--
-- FAIL CLOSED is the whole design. A user with no profiles row, a deactivated
-- user, or an unrecognised role all fall through to 0 >= n, which is false.
-- Public signup is disabled on this project, but this is what keeps the model
-- safe if it is ever switched back on.
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app TO authenticated;

CREATE OR REPLACE FUNCTION app.user_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT p.role FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.active
$fn$;

-- An unrecognised `minimum` maps to 99 so that a typo in a policy DENIES rather
-- than grants. The comparison is deliberately total.
CREATE OR REPLACE FUNCTION app.at_least(minimum text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT COALESCE(
    (CASE app.user_role()
       WHEN 'owner' THEN 3 WHEN 'manager' THEN 2 WHEN 'staff' THEN 1 ELSE 0 END)
    >=
    (CASE minimum
       WHEN 'owner' THEN 3 WHEN 'manager' THEN 2 WHEN 'staff' THEN 1 ELSE 99 END),
    false)
$fn$;

REVOKE ALL ON FUNCTION app.user_role(), app.at_least(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.user_role(), app.at_least(text) TO authenticated;


-- ----------------------------------------------------------------------------
-- 2. RLS ON for the 7 tables that never had it
--
-- Each gets a `{public}` permissive policy in the SAME statement block, so
-- switching RLS on is a NO-OP for every caller that works today. This is not
-- carelessness, it is deployment ordering: this migration lands on the live
-- database while the CURRENT code — which reads these tables over anon — is
-- still serving traffic. Enabling RLS without a matching permissive policy
-- would take the admin down in the window before the new code deploys.
--
-- It also leaves all 22 tables in ONE uniform shape, so PR 6 has a single
-- pattern to drop rather than two.
-- ----------------------------------------------------------------------------
ALTER TABLE public.electric_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on electric_readings" ON public.electric_readings;
CREATE POLICY "Allow all operations on electric_readings" ON public.electric_readings
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

ALTER TABLE public.folio_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on folio_line_items" ON public.folio_line_items;
CREATE POLICY "Allow all operations on folio_line_items" ON public.folio_line_items
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

ALTER TABLE public.folio_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on folio_payments" ON public.folio_payments;
CREATE POLICY "Allow all operations on folio_payments" ON public.folio_payments
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

ALTER TABLE public.folios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on folios" ON public.folios;
CREATE POLICY "Allow all operations on folios" ON public.folios
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on guests" ON public.guests;
CREATE POLICY "Allow all operations on guests" ON public.guests
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on product_categories" ON public.product_categories;
CREATE POLICY "Allow all operations on product_categories" ON public.product_categories
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on products" ON public.products;
CREATE POLICY "Allow all operations on products" ON public.products
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- 3. DROP the blanket authenticated policies
--
-- All ten of these are `FOR ALL USING(true) WITH CHECK(true)` granted TO
-- authenticated. They are exactly what PR 6 would have left standing after
-- revoking anon — a role model in name only. Replacing them is the point of
-- this stage. NOTE the distinction: these are the `{authenticated}` policies,
-- NOT the `{public}` ones, which are untouched and belong to PR 6.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.addons;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.blocked_dates;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.cancellation_rules;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.discounts;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.min_stay_rules;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.pricing_rules;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.reservation_addons;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.reservations;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.settings;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.sites;


-- ----------------------------------------------------------------------------
-- 4. PERMISSIVE authenticated policies — what each role MAY do
--
-- These are what PR 6 relies on: once the `{public}` policies are dropped,
-- these are the only thing granting the admin access at all.
--
-- The shape, applied per command rather than as one FOR ALL policy, because
-- FOR ALL is checked by USING for DELETE and by WITH CHECK for INSERT — a
-- single policy cannot express a different role per command, which is exactly
-- what the money carve-outs need.
--
--   config & pricing (14 tables) : SELECT staff+, write owner-only
--   operational      (8 tables)  : staff+, with three carve-outs --
--        folio_payments UPDATE (the void)      -> manager+
--        reservations / folios DELETE          -> manager+
--        electric_readings INSERT/UPDATE       -> manager+
--        folio_payments / electric_readings DELETE -> nobody
-- ----------------------------------------------------------------------------

-- addons: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select addons" ON public.addons;
CREATE POLICY "authenticated select addons" ON public.addons
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert addons" ON public.addons;
CREATE POLICY "authenticated insert addons" ON public.addons
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update addons" ON public.addons;
CREATE POLICY "authenticated update addons" ON public.addons
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete addons" ON public.addons;
CREATE POLICY "authenticated delete addons" ON public.addons
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- blocked_dates: select=staff insert=staff update=staff delete=staff
DROP POLICY IF EXISTS "authenticated select blocked_dates" ON public.blocked_dates;
CREATE POLICY "authenticated select blocked_dates" ON public.blocked_dates
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert blocked_dates" ON public.blocked_dates;
CREATE POLICY "authenticated insert blocked_dates" ON public.blocked_dates
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update blocked_dates" ON public.blocked_dates;
CREATE POLICY "authenticated update blocked_dates" ON public.blocked_dates
  FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated delete blocked_dates" ON public.blocked_dates;
CREATE POLICY "authenticated delete blocked_dates" ON public.blocked_dates
  FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- cancellation_rules: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select cancellation_rules" ON public.cancellation_rules;
CREATE POLICY "authenticated select cancellation_rules" ON public.cancellation_rules
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert cancellation_rules" ON public.cancellation_rules;
CREATE POLICY "authenticated insert cancellation_rules" ON public.cancellation_rules
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update cancellation_rules" ON public.cancellation_rules;
CREATE POLICY "authenticated update cancellation_rules" ON public.cancellation_rules
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete cancellation_rules" ON public.cancellation_rules;
CREATE POLICY "authenticated delete cancellation_rules" ON public.cancellation_rules
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- categories: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select categories" ON public.categories;
CREATE POLICY "authenticated select categories" ON public.categories
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert categories" ON public.categories;
CREATE POLICY "authenticated insert categories" ON public.categories
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update categories" ON public.categories;
CREATE POLICY "authenticated update categories" ON public.categories
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete categories" ON public.categories;
CREATE POLICY "authenticated delete categories" ON public.categories
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- discounts: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select discounts" ON public.discounts;
CREATE POLICY "authenticated select discounts" ON public.discounts
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert discounts" ON public.discounts;
CREATE POLICY "authenticated insert discounts" ON public.discounts
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update discounts" ON public.discounts;
CREATE POLICY "authenticated update discounts" ON public.discounts
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete discounts" ON public.discounts;
CREATE POLICY "authenticated delete discounts" ON public.discounts
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- electric_readings: select=staff insert=manager update=manager delete=nobody
DROP POLICY IF EXISTS "authenticated select electric_readings" ON public.electric_readings;
CREATE POLICY "authenticated select electric_readings" ON public.electric_readings
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert electric_readings" ON public.electric_readings;
CREATE POLICY "authenticated insert electric_readings" ON public.electric_readings
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('manager')));
DROP POLICY IF EXISTS "authenticated update electric_readings" ON public.electric_readings;
CREATE POLICY "authenticated update electric_readings" ON public.electric_readings
  FOR UPDATE TO authenticated USING ((select app.at_least('manager'))) WITH CHECK ((select app.at_least('manager')));
DROP POLICY IF EXISTS "authenticated delete electric_readings" ON public.electric_readings;
-- no DELETE policy: denied to authenticated by absence. Service-role only.

-- fees: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select fees" ON public.fees;
CREATE POLICY "authenticated select fees" ON public.fees
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert fees" ON public.fees;
CREATE POLICY "authenticated insert fees" ON public.fees
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update fees" ON public.fees;
CREATE POLICY "authenticated update fees" ON public.fees
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete fees" ON public.fees;
CREATE POLICY "authenticated delete fees" ON public.fees
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- folio_line_items: select=staff insert=staff update=staff delete=staff
DROP POLICY IF EXISTS "authenticated select folio_line_items" ON public.folio_line_items;
CREATE POLICY "authenticated select folio_line_items" ON public.folio_line_items
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert folio_line_items" ON public.folio_line_items;
CREATE POLICY "authenticated insert folio_line_items" ON public.folio_line_items
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update folio_line_items" ON public.folio_line_items;
CREATE POLICY "authenticated update folio_line_items" ON public.folio_line_items
  FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated delete folio_line_items" ON public.folio_line_items;
CREATE POLICY "authenticated delete folio_line_items" ON public.folio_line_items
  FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- folio_payments: select=staff insert=staff update=manager delete=nobody
DROP POLICY IF EXISTS "authenticated select folio_payments" ON public.folio_payments;
CREATE POLICY "authenticated select folio_payments" ON public.folio_payments
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert folio_payments" ON public.folio_payments;
CREATE POLICY "authenticated insert folio_payments" ON public.folio_payments
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update folio_payments" ON public.folio_payments;
CREATE POLICY "authenticated update folio_payments" ON public.folio_payments
  FOR UPDATE TO authenticated USING ((select app.at_least('manager'))) WITH CHECK ((select app.at_least('manager')));
DROP POLICY IF EXISTS "authenticated delete folio_payments" ON public.folio_payments;
-- no DELETE policy: denied to authenticated by absence. Service-role only.

-- folios: select=staff insert=staff update=staff delete=manager
DROP POLICY IF EXISTS "authenticated select folios" ON public.folios;
CREATE POLICY "authenticated select folios" ON public.folios
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert folios" ON public.folios;
CREATE POLICY "authenticated insert folios" ON public.folios
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update folios" ON public.folios;
CREATE POLICY "authenticated update folios" ON public.folios
  FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated delete folios" ON public.folios;
CREATE POLICY "authenticated delete folios" ON public.folios
  FOR DELETE TO authenticated USING ((select app.at_least('manager')));

-- guests: select=staff insert=staff update=staff delete=staff
DROP POLICY IF EXISTS "authenticated select guests" ON public.guests;
CREATE POLICY "authenticated select guests" ON public.guests
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert guests" ON public.guests;
CREATE POLICY "authenticated insert guests" ON public.guests
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update guests" ON public.guests;
CREATE POLICY "authenticated update guests" ON public.guests
  FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated delete guests" ON public.guests;
CREATE POLICY "authenticated delete guests" ON public.guests
  FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- min_stay_rules: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select min_stay_rules" ON public.min_stay_rules;
CREATE POLICY "authenticated select min_stay_rules" ON public.min_stay_rules
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert min_stay_rules" ON public.min_stay_rules;
CREATE POLICY "authenticated insert min_stay_rules" ON public.min_stay_rules
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update min_stay_rules" ON public.min_stay_rules;
CREATE POLICY "authenticated update min_stay_rules" ON public.min_stay_rules
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete min_stay_rules" ON public.min_stay_rules;
CREATE POLICY "authenticated delete min_stay_rules" ON public.min_stay_rules
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- pricing_rules: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select pricing_rules" ON public.pricing_rules;
CREATE POLICY "authenticated select pricing_rules" ON public.pricing_rules
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert pricing_rules" ON public.pricing_rules;
CREATE POLICY "authenticated insert pricing_rules" ON public.pricing_rules
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update pricing_rules" ON public.pricing_rules;
CREATE POLICY "authenticated update pricing_rules" ON public.pricing_rules
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete pricing_rules" ON public.pricing_rules;
CREATE POLICY "authenticated delete pricing_rules" ON public.pricing_rules
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- product_categories: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select product_categories" ON public.product_categories;
CREATE POLICY "authenticated select product_categories" ON public.product_categories
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert product_categories" ON public.product_categories;
CREATE POLICY "authenticated insert product_categories" ON public.product_categories
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update product_categories" ON public.product_categories;
CREATE POLICY "authenticated update product_categories" ON public.product_categories
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete product_categories" ON public.product_categories;
CREATE POLICY "authenticated delete product_categories" ON public.product_categories
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- products: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select products" ON public.products;
CREATE POLICY "authenticated select products" ON public.products
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert products" ON public.products;
CREATE POLICY "authenticated insert products" ON public.products
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update products" ON public.products;
CREATE POLICY "authenticated update products" ON public.products
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete products" ON public.products;
CREATE POLICY "authenticated delete products" ON public.products
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- reservation_addons: select=staff insert=staff update=staff delete=staff
DROP POLICY IF EXISTS "authenticated select reservation_addons" ON public.reservation_addons;
CREATE POLICY "authenticated select reservation_addons" ON public.reservation_addons
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert reservation_addons" ON public.reservation_addons;
CREATE POLICY "authenticated insert reservation_addons" ON public.reservation_addons
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update reservation_addons" ON public.reservation_addons;
CREATE POLICY "authenticated update reservation_addons" ON public.reservation_addons
  FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated delete reservation_addons" ON public.reservation_addons;
CREATE POLICY "authenticated delete reservation_addons" ON public.reservation_addons
  FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- reservations: select=staff insert=staff update=staff delete=manager
DROP POLICY IF EXISTS "authenticated select reservations" ON public.reservations;
CREATE POLICY "authenticated select reservations" ON public.reservations
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert reservations" ON public.reservations;
CREATE POLICY "authenticated insert reservations" ON public.reservations
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update reservations" ON public.reservations;
CREATE POLICY "authenticated update reservations" ON public.reservations
  FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated delete reservations" ON public.reservations;
CREATE POLICY "authenticated delete reservations" ON public.reservations
  FOR DELETE TO authenticated USING ((select app.at_least('manager')));

-- settings: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select settings" ON public.settings;
CREATE POLICY "authenticated select settings" ON public.settings
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert settings" ON public.settings;
CREATE POLICY "authenticated insert settings" ON public.settings
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update settings" ON public.settings;
CREATE POLICY "authenticated update settings" ON public.settings
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete settings" ON public.settings;
CREATE POLICY "authenticated delete settings" ON public.settings
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- site_categories: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select site_categories" ON public.site_categories;
CREATE POLICY "authenticated select site_categories" ON public.site_categories
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert site_categories" ON public.site_categories;
CREATE POLICY "authenticated insert site_categories" ON public.site_categories
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update site_categories" ON public.site_categories;
CREATE POLICY "authenticated update site_categories" ON public.site_categories
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete site_categories" ON public.site_categories;
CREATE POLICY "authenticated delete site_categories" ON public.site_categories
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- sites: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select sites" ON public.sites;
CREATE POLICY "authenticated select sites" ON public.sites
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert sites" ON public.sites;
CREATE POLICY "authenticated insert sites" ON public.sites
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update sites" ON public.sites;
CREATE POLICY "authenticated update sites" ON public.sites
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete sites" ON public.sites;
CREATE POLICY "authenticated delete sites" ON public.sites
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- tax_applications: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select tax_applications" ON public.tax_applications;
CREATE POLICY "authenticated select tax_applications" ON public.tax_applications
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert tax_applications" ON public.tax_applications;
CREATE POLICY "authenticated insert tax_applications" ON public.tax_applications
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update tax_applications" ON public.tax_applications;
CREATE POLICY "authenticated update tax_applications" ON public.tax_applications
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete tax_applications" ON public.tax_applications;
CREATE POLICY "authenticated delete tax_applications" ON public.tax_applications
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- taxes: select=staff insert=owner update=owner delete=owner
DROP POLICY IF EXISTS "authenticated select taxes" ON public.taxes;
CREATE POLICY "authenticated select taxes" ON public.taxes
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert taxes" ON public.taxes;
CREATE POLICY "authenticated insert taxes" ON public.taxes
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated update taxes" ON public.taxes;
CREATE POLICY "authenticated update taxes" ON public.taxes
  FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "authenticated delete taxes" ON public.taxes;
CREATE POLICY "authenticated delete taxes" ON public.taxes
  FOR DELETE TO authenticated USING ((select app.at_least('owner')));


-- ----------------------------------------------------------------------------
-- 5. RESTRICTIVE authenticated policies — what makes section 4 BITE TODAY
--
-- Without this section, everything above is dormant until PR 6. Permissive
-- policies are OR'd together, and the pre-existing `{public}` policies apply to
-- every role INCLUDING authenticated -- so `USING(true)` would win over any
-- role predicate and a Manager could still rewrite pricing from devtools.
--
-- Restrictive policies are AND'd instead, and apply only to the roles named. So
-- `AS RESTRICTIVE ... TO authenticated` constrains the logged-in admin
-- immediately while leaving `anon` and the camper flow completely untouched --
-- which is what lets role enforcement be real in 5b without doing PR 6's job.
--
-- PER COMMAND, deliberately. A single FOR ALL restrictive policy checks DELETE
-- with USING only, so a `USING(staff) WITH CHECK(owner)` catch-all would let a
-- Staff user delete rows it was never meant to touch.
--
-- The predicates intentionally MIRROR section 4 rather than being weaker. If
-- anyone later drops the restrictive set (say, while cleaning up after PR 6),
-- the permissive set still enforces the correct role -- the failure mode is a
-- redundant policy, never an open one.
-- ----------------------------------------------------------------------------

-- addons
DROP POLICY IF EXISTS "role gate select addons" ON public.addons;
CREATE POLICY "role gate select addons" ON public.addons
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert addons" ON public.addons;
CREATE POLICY "role gate insert addons" ON public.addons
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update addons" ON public.addons;
CREATE POLICY "role gate update addons" ON public.addons
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete addons" ON public.addons;
CREATE POLICY "role gate delete addons" ON public.addons
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- blocked_dates
DROP POLICY IF EXISTS "role gate select blocked_dates" ON public.blocked_dates;
CREATE POLICY "role gate select blocked_dates" ON public.blocked_dates
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert blocked_dates" ON public.blocked_dates;
CREATE POLICY "role gate insert blocked_dates" ON public.blocked_dates
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update blocked_dates" ON public.blocked_dates;
CREATE POLICY "role gate update blocked_dates" ON public.blocked_dates
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate delete blocked_dates" ON public.blocked_dates;
CREATE POLICY "role gate delete blocked_dates" ON public.blocked_dates
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- cancellation_rules
DROP POLICY IF EXISTS "role gate select cancellation_rules" ON public.cancellation_rules;
CREATE POLICY "role gate select cancellation_rules" ON public.cancellation_rules
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert cancellation_rules" ON public.cancellation_rules;
CREATE POLICY "role gate insert cancellation_rules" ON public.cancellation_rules
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update cancellation_rules" ON public.cancellation_rules;
CREATE POLICY "role gate update cancellation_rules" ON public.cancellation_rules
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete cancellation_rules" ON public.cancellation_rules;
CREATE POLICY "role gate delete cancellation_rules" ON public.cancellation_rules
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- categories
DROP POLICY IF EXISTS "role gate select categories" ON public.categories;
CREATE POLICY "role gate select categories" ON public.categories
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert categories" ON public.categories;
CREATE POLICY "role gate insert categories" ON public.categories
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update categories" ON public.categories;
CREATE POLICY "role gate update categories" ON public.categories
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete categories" ON public.categories;
CREATE POLICY "role gate delete categories" ON public.categories
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- discounts
DROP POLICY IF EXISTS "role gate select discounts" ON public.discounts;
CREATE POLICY "role gate select discounts" ON public.discounts
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert discounts" ON public.discounts;
CREATE POLICY "role gate insert discounts" ON public.discounts
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update discounts" ON public.discounts;
CREATE POLICY "role gate update discounts" ON public.discounts
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete discounts" ON public.discounts;
CREATE POLICY "role gate delete discounts" ON public.discounts
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- electric_readings
DROP POLICY IF EXISTS "role gate select electric_readings" ON public.electric_readings;
CREATE POLICY "role gate select electric_readings" ON public.electric_readings
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert electric_readings" ON public.electric_readings;
CREATE POLICY "role gate insert electric_readings" ON public.electric_readings
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('manager')));
DROP POLICY IF EXISTS "role gate update electric_readings" ON public.electric_readings;
CREATE POLICY "role gate update electric_readings" ON public.electric_readings
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('manager'))) WITH CHECK ((select app.at_least('manager')));
DROP POLICY IF EXISTS "role gate delete electric_readings" ON public.electric_readings;
CREATE POLICY "role gate delete electric_readings" ON public.electric_readings
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- fees
DROP POLICY IF EXISTS "role gate select fees" ON public.fees;
CREATE POLICY "role gate select fees" ON public.fees
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert fees" ON public.fees;
CREATE POLICY "role gate insert fees" ON public.fees
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update fees" ON public.fees;
CREATE POLICY "role gate update fees" ON public.fees
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete fees" ON public.fees;
CREATE POLICY "role gate delete fees" ON public.fees
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- folio_line_items
DROP POLICY IF EXISTS "role gate select folio_line_items" ON public.folio_line_items;
CREATE POLICY "role gate select folio_line_items" ON public.folio_line_items
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert folio_line_items" ON public.folio_line_items;
CREATE POLICY "role gate insert folio_line_items" ON public.folio_line_items
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update folio_line_items" ON public.folio_line_items;
CREATE POLICY "role gate update folio_line_items" ON public.folio_line_items
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate delete folio_line_items" ON public.folio_line_items;
CREATE POLICY "role gate delete folio_line_items" ON public.folio_line_items
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- folio_payments
DROP POLICY IF EXISTS "role gate select folio_payments" ON public.folio_payments;
CREATE POLICY "role gate select folio_payments" ON public.folio_payments
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert folio_payments" ON public.folio_payments;
CREATE POLICY "role gate insert folio_payments" ON public.folio_payments
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update folio_payments" ON public.folio_payments;
CREATE POLICY "role gate update folio_payments" ON public.folio_payments
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('manager'))) WITH CHECK ((select app.at_least('manager')));
DROP POLICY IF EXISTS "role gate delete folio_payments" ON public.folio_payments;
CREATE POLICY "role gate delete folio_payments" ON public.folio_payments
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- folios
DROP POLICY IF EXISTS "role gate select folios" ON public.folios;
CREATE POLICY "role gate select folios" ON public.folios
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert folios" ON public.folios;
CREATE POLICY "role gate insert folios" ON public.folios
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update folios" ON public.folios;
CREATE POLICY "role gate update folios" ON public.folios
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate delete folios" ON public.folios;
CREATE POLICY "role gate delete folios" ON public.folios
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('manager')));

-- guests
DROP POLICY IF EXISTS "role gate select guests" ON public.guests;
CREATE POLICY "role gate select guests" ON public.guests
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert guests" ON public.guests;
CREATE POLICY "role gate insert guests" ON public.guests
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update guests" ON public.guests;
CREATE POLICY "role gate update guests" ON public.guests
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate delete guests" ON public.guests;
CREATE POLICY "role gate delete guests" ON public.guests
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- min_stay_rules
DROP POLICY IF EXISTS "role gate select min_stay_rules" ON public.min_stay_rules;
CREATE POLICY "role gate select min_stay_rules" ON public.min_stay_rules
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert min_stay_rules" ON public.min_stay_rules;
CREATE POLICY "role gate insert min_stay_rules" ON public.min_stay_rules
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update min_stay_rules" ON public.min_stay_rules;
CREATE POLICY "role gate update min_stay_rules" ON public.min_stay_rules
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete min_stay_rules" ON public.min_stay_rules;
CREATE POLICY "role gate delete min_stay_rules" ON public.min_stay_rules
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- pricing_rules
DROP POLICY IF EXISTS "role gate select pricing_rules" ON public.pricing_rules;
CREATE POLICY "role gate select pricing_rules" ON public.pricing_rules
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert pricing_rules" ON public.pricing_rules;
CREATE POLICY "role gate insert pricing_rules" ON public.pricing_rules
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update pricing_rules" ON public.pricing_rules;
CREATE POLICY "role gate update pricing_rules" ON public.pricing_rules
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete pricing_rules" ON public.pricing_rules;
CREATE POLICY "role gate delete pricing_rules" ON public.pricing_rules
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- product_categories
DROP POLICY IF EXISTS "role gate select product_categories" ON public.product_categories;
CREATE POLICY "role gate select product_categories" ON public.product_categories
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert product_categories" ON public.product_categories;
CREATE POLICY "role gate insert product_categories" ON public.product_categories
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update product_categories" ON public.product_categories;
CREATE POLICY "role gate update product_categories" ON public.product_categories
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete product_categories" ON public.product_categories;
CREATE POLICY "role gate delete product_categories" ON public.product_categories
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- products
DROP POLICY IF EXISTS "role gate select products" ON public.products;
CREATE POLICY "role gate select products" ON public.products
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert products" ON public.products;
CREATE POLICY "role gate insert products" ON public.products
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update products" ON public.products;
CREATE POLICY "role gate update products" ON public.products
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete products" ON public.products;
CREATE POLICY "role gate delete products" ON public.products
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- reservation_addons
DROP POLICY IF EXISTS "role gate select reservation_addons" ON public.reservation_addons;
CREATE POLICY "role gate select reservation_addons" ON public.reservation_addons
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert reservation_addons" ON public.reservation_addons;
CREATE POLICY "role gate insert reservation_addons" ON public.reservation_addons
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update reservation_addons" ON public.reservation_addons;
CREATE POLICY "role gate update reservation_addons" ON public.reservation_addons
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate delete reservation_addons" ON public.reservation_addons;
CREATE POLICY "role gate delete reservation_addons" ON public.reservation_addons
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- reservations
DROP POLICY IF EXISTS "role gate select reservations" ON public.reservations;
CREATE POLICY "role gate select reservations" ON public.reservations
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert reservations" ON public.reservations;
CREATE POLICY "role gate insert reservations" ON public.reservations
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update reservations" ON public.reservations;
CREATE POLICY "role gate update reservations" ON public.reservations
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate delete reservations" ON public.reservations;
CREATE POLICY "role gate delete reservations" ON public.reservations
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('manager')));

-- settings
DROP POLICY IF EXISTS "role gate select settings" ON public.settings;
CREATE POLICY "role gate select settings" ON public.settings
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert settings" ON public.settings;
CREATE POLICY "role gate insert settings" ON public.settings
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update settings" ON public.settings;
CREATE POLICY "role gate update settings" ON public.settings
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete settings" ON public.settings;
CREATE POLICY "role gate delete settings" ON public.settings
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- site_categories
DROP POLICY IF EXISTS "role gate select site_categories" ON public.site_categories;
CREATE POLICY "role gate select site_categories" ON public.site_categories
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert site_categories" ON public.site_categories;
CREATE POLICY "role gate insert site_categories" ON public.site_categories
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update site_categories" ON public.site_categories;
CREATE POLICY "role gate update site_categories" ON public.site_categories
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete site_categories" ON public.site_categories;
CREATE POLICY "role gate delete site_categories" ON public.site_categories
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- sites
DROP POLICY IF EXISTS "role gate select sites" ON public.sites;
CREATE POLICY "role gate select sites" ON public.sites
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert sites" ON public.sites;
CREATE POLICY "role gate insert sites" ON public.sites
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update sites" ON public.sites;
CREATE POLICY "role gate update sites" ON public.sites
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete sites" ON public.sites;
CREATE POLICY "role gate delete sites" ON public.sites
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- tax_applications
DROP POLICY IF EXISTS "role gate select tax_applications" ON public.tax_applications;
CREATE POLICY "role gate select tax_applications" ON public.tax_applications
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert tax_applications" ON public.tax_applications;
CREATE POLICY "role gate insert tax_applications" ON public.tax_applications
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update tax_applications" ON public.tax_applications;
CREATE POLICY "role gate update tax_applications" ON public.tax_applications
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete tax_applications" ON public.tax_applications;
CREATE POLICY "role gate delete tax_applications" ON public.tax_applications
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));

-- taxes
DROP POLICY IF EXISTS "role gate select taxes" ON public.taxes;
CREATE POLICY "role gate select taxes" ON public.taxes
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert taxes" ON public.taxes;
CREATE POLICY "role gate insert taxes" ON public.taxes
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate update taxes" ON public.taxes;
CREATE POLICY "role gate update taxes" ON public.taxes
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('owner'))) WITH CHECK ((select app.at_least('owner')));
DROP POLICY IF EXISTS "role gate delete taxes" ON public.taxes;
CREATE POLICY "role gate delete taxes" ON public.taxes
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('owner')));


-- ----------------------------------------------------------------------------
-- 6. GRANT HYGIENE for the two never-delete tables
--
-- The lesson from 5a: grants and policies are INDEPENDENT gates, and this
-- project's default privileges hand `authenticated` arwdDxtm on every new table
-- in public. A policy denying DELETE is the right answer, but the grant sitting
-- behind it is what turns the next carelessly-pasted permissive policy into
-- deleted payment history. Close both.
--
-- Only `authenticated` is revoked here. anon is PR 6's, and service_role holds
-- its own grants, so the refund and void code paths are unaffected.
-- ----------------------------------------------------------------------------
REVOKE DELETE ON public.folio_payments FROM authenticated;
REVOKE DELETE ON public.electric_readings FROM authenticated;

COMMIT;

-- ============================================================================
-- VERIFY (read-only, run after applying)
--
-- Query B is the PR 6-READINESS PROOF: it asserts that every (table, operation)
-- pair the admin actually performs is covered by a permissive `authenticated`
-- policy. An empty result means there is no table the admin reads that would
-- lose access when PR 6 revokes anon. Anything it returns is a page PR 6 would
-- break.
-- ============================================================================

-- --- A. RLS is on for all 22. Expect 22 rows, all true. ---------------------
-- select relname, relrowsecurity from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--  where relname in ('addons','blocked_dates','cancellation_rules','categories',
--    'discounts','electric_readings','fees','folio_line_items','folio_payments',
--    'folios','guests','min_stay_rules','pricing_rules','product_categories',
--    'products','reservation_addons','reservations','settings','site_categories',
--    'sites','tax_applications','taxes')
--  order by 1;

-- --- B. COVERAGE PROOF. Expect ZERO rows. -----------------------------------
-- with expected(tbl, cmd) as (values
--   ('addons','SELECT'),('addons','INSERT'),('addons','UPDATE'),('addons','DELETE'),
--   ('blocked_dates','SELECT'),('blocked_dates','INSERT'),('blocked_dates','DELETE'),
--   ('cancellation_rules','SELECT'),('cancellation_rules','INSERT'),
--     ('cancellation_rules','UPDATE'),('cancellation_rules','DELETE'),
--   ('categories','SELECT'),('categories','INSERT'),('categories','DELETE'),
--   ('discounts','SELECT'),('discounts','INSERT'),('discounts','UPDATE'),('discounts','DELETE'),
--   ('electric_readings','SELECT'),('electric_readings','INSERT'),
--   ('fees','SELECT'),('fees','INSERT'),('fees','UPDATE'),('fees','DELETE'),
--   ('folio_line_items','SELECT'),('folio_line_items','INSERT'),('folio_line_items','DELETE'),
--   ('folio_payments','SELECT'),('folio_payments','INSERT'),('folio_payments','UPDATE'),
--   ('folios','SELECT'),('folios','INSERT'),('folios','DELETE'),
--   ('guests','SELECT'),('guests','INSERT'),('guests','UPDATE'),('guests','DELETE'),
--   ('min_stay_rules','SELECT'),('min_stay_rules','INSERT'),
--     ('min_stay_rules','UPDATE'),('min_stay_rules','DELETE'),
--   ('pricing_rules','SELECT'),('pricing_rules','INSERT'),
--     ('pricing_rules','UPDATE'),('pricing_rules','DELETE'),
--   ('product_categories','SELECT'),('product_categories','INSERT'),('product_categories','DELETE'),
--   ('products','SELECT'),('products','INSERT'),('products','UPDATE'),('products','DELETE'),
--   ('reservation_addons','SELECT'),('reservation_addons','INSERT'),('reservation_addons','DELETE'),
--   ('reservations','SELECT'),('reservations','UPDATE'),('reservations','DELETE'),
--   ('settings','SELECT'),('settings','INSERT'),('settings','UPDATE'),
--   ('site_categories','SELECT'),('site_categories','INSERT'),('site_categories','DELETE'),
--   ('sites','SELECT'),('sites','INSERT'),('sites','UPDATE'),('sites','DELETE'),
--   ('tax_applications','SELECT'),('tax_applications','INSERT'),('tax_applications','DELETE'),
--   ('taxes','SELECT'),('taxes','INSERT'),('taxes','UPDATE'),('taxes','DELETE')
-- )
-- select e.tbl, e.cmd, 'NO PERMISSIVE authenticated POLICY' as problem
--   from expected e
--  where not exists (
--    select 1 from pg_policies p
--     where p.schemaname = 'public' and p.tablename = e.tbl
--       and p.permissive = 'PERMISSIVE'
--       and 'authenticated' = any(p.roles)
--       and p.cmd in (e.cmd, 'ALL'))
--  order by 1, 2;
--
-- The two omissions from that list are deliberate, not oversights:
--   folio_payments DELETE and electric_readings DELETE are denied to every
--   role but service_role, by policy AND by revoked grant. The admin never
--   performs them, so they are not access PR 6 could break.

-- --- C. anon is UNTOUCHED. This migration must not have narrowed anything. ---
--        Expect every row true — that is the proof 5b did not do PR 6's job.
-- select tablename,
--        bool_or(roles::text = '{public}' or 'anon' = any(roles)) as anon_still_covered
--   from pg_policies where schemaname = 'public'
--    and tablename in ('addons','blocked_dates','cancellation_rules','categories',
--      'discounts','electric_readings','fees','folio_line_items','folio_payments',
--      'folios','guests','min_stay_rules','pricing_rules','product_categories',
--      'products','reservation_addons','reservations','settings','site_categories',
--      'sites','tax_applications','taxes')
--  group by 1 order by 1;

-- --- D. The two never-delete tables. Expect false, false. -------------------
-- select has_table_privilege('authenticated','public.folio_payments','DELETE'),
--        has_table_privilege('authenticated','public.electric_readings','DELETE');

-- --- E. The helper fails closed for a user with no profile. Expect false. ---
-- select app.at_least('staff');   -- run as a session with no profiles row
