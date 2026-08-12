-- ============================================================
-- ResoNation Campground Reservation System — Provisioning Script
-- Run this entire file in the Supabase SQL Editor for each new client.
-- ============================================================
--
-- REGENERATED 2026-07-19 from a schema-only pg_dump of live Cady
-- (project dmqyuujhdflfydfhigvn), then CURATED per docs/database-setup-drift.md.
-- The prior version of this file was a pre-POS / pre-electric / pre-tax / pre-surcharge
-- schema and could not provision a working current-generation client.
--
-- LOCKED DOWN 2026-08-12 (security PR 7-2). Until this stage the file reproduced live-Cady's
-- posture as it stood on 2026-07-19 — RLS off on the POS/folio/guest tables, `{public}`
-- allow-all policies everywhere else, and `GRANT ALL ... TO anon`. Security PRs 1 through 6
-- then hardened Cady's own database through db/migrations/, and none of it came back here. So
-- every client provisioned between those dates launched on the PRE-PR-1 posture: the anon
-- publishable key could read and write every table, including `settings`. This stage folds
-- those six migrations into the artifact new clients are actually built from.
--
-- The target is Cady's live catalogue, and these are the numbers to match:
--   anon table grants 0 · `{public}` policies 0 · authenticated policies 87 permissive
--   + 88 restrictive · RLS on every table · profiles present (RLS on, 1 policy)
--   · app.user_role/app.at_least SECURITY DEFINER with search_path='' · storage 8 policies
--   (2 public read, 6 role-gated write).
--
-- WHAT THIS FILE IS. A provisioning artifact — the schema a NEW client is built from. Nothing
-- reads it at runtime, and editing it changes no existing database, Cady's included. Applying
-- the same posture to a client already provisioned from an older copy is a migration, not an
-- edit here (PR 7-4).
--
-- SOURCE MIGRATIONS folded in, for anyone reconciling this against Cady:
--   db/migrations/2026-08-10-pr2-table-hardening.sql               (RLS + search_path + admin_password)
--   db/migrations/2026-08-10-pr4a-fix-increment-discount-usage.sql (the p_code rebuild)
--   db/migrations/2026-08-11-pr5a-profiles.sql                     (profiles + its grants)
--   db/migrations/2026-08-11-pr5b1-authenticated-role-policies.sql (the helper + 174 policies)
--   db/migrations/2026-08-12-pr6-revoke-anon.sql                   (the revoke + storage)
--
-- CURATION APPLIED (allowlist — structure wholesale from live; value-bearing content only
-- if provably generic). Anything below is an INTENTIONAL difference from live-Cady:
--   • EXCLUDED tables (Cady operational / platform, never per-client):
--       _backup_email_cleanup_20260611, electric_readings_backup_20260714,
--       products_taxclass_snapshot_20260716, reservations_backup_optionb,
--       resonation_clients (platform tenant-registry — holds other clients' service keys).
--   • SEED ROWS: none. Every table provisions EMPTY except the single required settings row.
--   • DROPPED dead columns: settings.base_adult_rate, base_child_rate, primary_color, updated_at.
--   • admin_password: the COLUMN IS GONE (PR 2 dropped it live). It was vestigial — written by
--       the Settings page, never read for auth — but `settings` is a table the anon key could
--       read, so on a provisioned client it published a password-shaped string to anyone who
--       asked. Verified on the lakeshore-camp-demo tenant, which returns one today. Not a
--       default to neutralise: a column to not create.
--   • NEUTRALIZED Cady-config column defaults (see the settings table):
--       park_name (no default), extra_adult_fee 1000→0, extra_child_fee 500→0,
--       accent_color #3DBDD4→#2D6A4F, season_start/end → NULL, plan ridgeline→trailhead,
--       pos_enabled true→false, total_sites 84→0, total_cabins 3→0, waiver_enabled true→false,
--       same_day_cutoff_message (Cady phone) → generic,
--       electric_readings.rate_per_kwh 0.27→0, minimum_charge 1500→0 (Cady electric rates).
--   • RLS / grants / policies reproduce live's posture as of PR 6: RLS ON for every table,
--     the anon role holding no table privilege at all, and the admin reaching data as
--     `authenticated` through the role-gated policy set. See ROW LEVEL SECURITY below.
--   • Storage buckets (logos, site-photos) are generic infra, provisioned explicitly below —
--     public read, role-gated write.
--
-- The settings bootstrap row (one row; sign-off 2026-07-19) carries only neutral placeholders.
-- ============================================================


-- ============================================================
-- FUNCTIONS (created before the tables they reference)
-- ============================================================
-- These function bodies reference tables created further down. pg_dump disables body
-- validation for exactly this reason (functions are emitted before tables). Required for
-- the SQL-language increment_discount_usage, whose body IS resolved at CREATE time.
-- The whole file runs as one SQL-editor session, so this SET applies throughout.
SET check_function_bodies = false;

-- EVERY function below pins `SET search_path = public, pg_temp` (PR 2). An unpinned search_path
-- lets whoever calls the function decide which schema `folio_line_items` resolves to, so a
-- caller able to create a table in a schema earlier on their path gets the function to write to
-- theirs instead. None of these are SECURITY DEFINER, so that is a smaller hole than it is on
-- app.at_least() further down — but it is free to close and the reason to close it is the same.
-- Do not remove the SET when editing a body.
CREATE OR REPLACE FUNCTION public.create_electric_bill(
  p_folio_id uuid, p_guest_id uuid, p_billing_month text, p_period_start date, p_period_end date,
  p_description text, p_amount_cents integer, p_previous_reading numeric, p_current_reading numeric,
  p_kwh_used numeric, p_rate_per_kwh numeric, p_minimum_charge integer, p_calculated_amount integer,
  p_final_amount integer
) RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_line_item_id uuid;
  v_reading_id   uuid;
BEGIN
  INSERT INTO folio_line_items
    (folio_id, product_id, description, quantity, unit_price, tax_amount, line_total, category)
  VALUES
    (p_folio_id, NULL, p_description, 1, p_amount_cents, 0, p_amount_cents, 'Fees')
  RETURNING id INTO v_line_item_id;

  INSERT INTO electric_readings
    (guest_id, billing_month, period_start, period_end, previous_reading, current_reading,
     kwh_used, rate_per_kwh, minimum_charge, calculated_amount, final_amount, folio_line_item_id)
  VALUES
    (p_guest_id, p_billing_month, p_period_start, p_period_end, p_previous_reading, p_current_reading,
     p_kwh_used, p_rate_per_kwh, p_minimum_charge, p_calculated_amount, p_final_amount, v_line_item_id)
  RETURNING id INTO v_reading_id;

  RETURN jsonb_build_object('line_item_id', v_line_item_id, 'reading_id', v_reading_id);
END;
$$;

-- The parameter is `p_code`, NOT `code`, and that is the whole point of this signature.
--
-- This function used to read `increment_discount_usage(code text)` with the body
--
--     update discounts set times_used = times_used + 1 where discounts.code = code;
--
-- In a SQL-language function an unqualified `code` on the right-hand side resolves to the
-- COLUMN, not the parameter — so the predicate was `discounts.code = discounts.code`, true for
-- every row, and one camper redeeming one code burned a use off EVERY discount the park had.
-- On a park with a max_uses limit that silently exhausts codes nobody redeemed. Prefixing the
-- parameter removes the ambiguity outright; qualifying the column alone would not.
--
-- `coalesce(times_used, 0)` because the column is nullable and NULL + 1 is NULL, which reads as
-- "never used" forever. Fixed live in db/migrations/2026-08-10-pr4a-fix-increment-discount-usage.sql
-- and folded in here so a provisioned client does not ship with it.
CREATE OR REPLACE FUNCTION public.increment_discount_usage(p_code text) RETURNS void
  LANGUAGE sql
  SET search_path = public, pg_temp
  AS $$
  update discounts set times_used = coalesce(times_used, 0) + 1 where discounts.code = p_code;
$$;

CREATE OR REPLACE FUNCTION public.sync_guest_from_reservation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_enabled boolean;
  v_email text;
  v_site_number text;
  v_existing_id uuid;
  v_existing_last_visit date;
BEGIN
  SELECT auto_sync_guests INTO v_enabled FROM settings LIMIT 1;
  IF v_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  v_email := lower(trim(coalesce(NEW.guest_email, '')));
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  SELECT site_number INTO v_site_number FROM sites WHERE id = NEW.site_id;

  SELECT id, last_visit INTO v_existing_id, v_existing_last_visit
  FROM guests WHERE lower(email) = v_email LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO guests (name, email, phone, site_number, last_visit, is_seasonal)
    VALUES (coalesce(NEW.guest_name, ''), NEW.guest_email, coalesce(NEW.guest_phone, ''),
            coalesce(v_site_number, ''), NEW.arrival_date::date, false);
  ELSE
    IF NEW.arrival_date::date > coalesce(v_existing_last_visit, '0001-01-01'::date) THEN
      UPDATE guests
      SET last_visit = NEW.arrival_date::date, site_number = coalesce(v_site_number, site_number)
      WHERE id = v_existing_id;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_electric_bill(
  p_reading_id uuid, p_voided_by text, p_reason text
) RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_line_item_id uuid;
  v_reading_rows int;
  v_charge_rows  int := 0;
BEGIN
  UPDATE electric_readings
     SET voided = true, voided_at = now(), voided_by = p_voided_by, reason = p_reason
   WHERE id = p_reading_id AND voided = false
   RETURNING folio_line_item_id INTO v_line_item_id;
  GET DIAGNOSTICS v_reading_rows = ROW_COUNT;

  IF v_line_item_id IS NOT NULL THEN
    UPDATE folio_line_items
       SET voided = true, voided_at = now(), voided_by = p_voided_by, reason = p_reason
     WHERE id = v_line_item_id AND voided = false;
    GET DIAGNOSTICS v_charge_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('reading_voided', v_reading_rows, 'charge_voided', v_charge_rows);
END;
$$;


-- ============================================================
-- TABLES  (dependency order; foreign keys inline)
-- ============================================================

CREATE TABLE IF NOT EXISTS sites (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  site_number text NOT NULL,
  site_type text NOT NULL,
  amp_service text,
  max_rv_length integer,
  hookups text,
  is_available boolean DEFAULT true,
  base_rate integer NOT NULL,
  description text,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  in_rotation boolean DEFAULT false,
  photo_url text,
  photo_url_2 text,
  CONSTRAINT sites_site_number_key UNIQUE (site_number),
  CONSTRAINT sites_amp_service_check CHECK (amp_service = ANY (ARRAY['30amp','30_50amp','none'])),
  CONSTRAINT sites_hookups_check CHECK (hookups = ANY (ARRAY['full','water_electric','none'])),
  CONSTRAINT sites_site_type_check CHECK (site_type = ANY (ARRAY['rv_site','cabin','tent']))
);

CREATE TABLE IF NOT EXISTS guests (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  name text NOT NULL,
  email text DEFAULT '',
  phone text DEFAULT '',
  site_number text DEFAULT '',
  is_seasonal boolean DEFAULT false,
  season_start date,
  season_end date,
  notes text DEFAULT '',
  last_visit date,
  email_opt_out boolean DEFAULT false,
  is_monthly boolean DEFAULT false,
  electric_billing_enabled boolean DEFAULT false,
  camper_make text,
  camper_model text,
  camper_year integer,
  camper_type text,
  camper_length integer,
  camper_amperage text,
  home_street text,
  home_city text,
  home_state text,
  home_zip text
);

CREATE TABLE IF NOT EXISTS taxes (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  name text NOT NULL,
  rate numeric NOT NULL,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS addons (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  description text,
  price integer NOT NULL,
  is_active boolean DEFAULT true,
  is_early_checkin boolean DEFAULT false,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  name text NOT NULL,
  display_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  name text NOT NULL,
  description text DEFAULT '',
  category text DEFAULT 'General' NOT NULL,
  price integer DEFAULT 0 NOT NULL,
  tax_class text DEFAULT 'standard' NOT NULL,
  track_inventory boolean DEFAULT false NOT NULL,
  stock_quantity integer,
  active boolean DEFAULT true NOT NULL,
  display_order integer DEFAULT 0,
  variable_price boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS fees (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  amount numeric NOT NULL,
  applies_to text DEFAULT 'all',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  card_only boolean DEFAULT false,
  CONSTRAINT fees_type_check CHECK (type = ANY (ARRAY['percentage','flat']))
);

CREATE TABLE IF NOT EXISTS discounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  code text NOT NULL,
  description text,
  discount_type text,
  discount_value integer NOT NULL,
  valid_from date,
  valid_until date,
  max_uses integer,
  times_used integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT discounts_code_key UNIQUE (code),
  CONSTRAINT discounts_discount_type_check CHECK (discount_type = ANY (ARRAY['percent','flat']))
);

CREATE TABLE IF NOT EXISTS cancellation_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  deposit_refundable boolean DEFAULT true,
  -- Neutral: full refund up to arrival. These were 90/7, which is Cady's own cancellation
  -- fee rather than a fact about campgrounds, and a column default that moves money must not
  -- surprise a park that never configured one. Must agree with DEFAULT_REFUND_PERCENT /
  -- DEFAULT_DEADLINE_DAYS in lib/cancellation-policy.ts. Cady's 90/7 now lives in an explicit
  -- all-dates "Standard Policy" rule instead.
  refund_percent integer DEFAULT 100,
  cancellation_deadline_days integer DEFAULT 0,
  policy_text text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  name text,
  campground_id uuid
);

CREATE TABLE IF NOT EXISTS broadcast_emails (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  subject text NOT NULL,
  message text NOT NULL,
  recipient_count integer DEFAULT 0,
  bypassed_opt_out boolean DEFAULT false,
  sent_by text DEFAULT 'admin'
);

CREATE TABLE IF NOT EXISTS failed_bookings (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  guest_name text,
  guest_email text,
  guest_phone text,
  amount_paid integer,
  square_payment_id text,
  error_message text,
  attempted_arrival date,
  attempted_departure date,
  site_id uuid,
  created_at timestamptz DEFAULT now()
);

-- settings — the config singleton. Cady-config defaults NEUTRALIZED (see header);
-- structural + generic defaults kept. Exactly one row is inserted at the end of this file.
CREATE TABLE IF NOT EXISTS settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  park_name text NOT NULL,
  park_tagline text,
  park_email text,
  park_phone text,
  park_address text,
  park_website text,
  check_in_time text DEFAULT '2:00 PM',
  check_out_time text DEFAULT '12:00 PM',
  extra_adult_fee integer DEFAULT 0,
  extra_child_fee integer DEFAULT 0,
  base_occupancy_adults integer DEFAULT 2,
  base_occupancy_children integer DEFAULT 2,
  cancellation_policy text,
  logo_url text,
  created_at timestamptz DEFAULT now(),
  season_start text,
  season_end text,
  closed_season_message text DEFAULT 'We are closed for the season. We look forward to welcoming you back next year!',
  same_day_cutoff_time time without time zone DEFAULT '11:00:00',
  accent_color text DEFAULT '#2D6A4F',
  show_site_map boolean DEFAULT false,
  -- NO admin_password COLUMN. It was dropped live in PR 2 and must not come back: it was
  -- write-only (the Settings page set it, nothing read it for auth), and `settings` is the one
  -- table every public page reads, so on a provisioned client it published a password-shaped
  -- string over the anon key. Login is per-user Supabase Auth; there is no password in this
  -- schema at all.
  park_location text,
  logo_shape text DEFAULT 'circle',
  confirmation_message text,
  waiver_enabled boolean DEFAULT false,
  waiver_text text,
  same_day_cutoff_message text DEFAULT 'Same-day reservations are not available online. Please call us to book.',
  plan text DEFAULT 'trailhead',
  maintenance_mode boolean DEFAULT false,
  maintenance_message text DEFAULT 'We are temporarily unavailable for online reservations. Please call us to book your stay!',
  sender_email text DEFAULT '',
  reply_to_email text DEFAULT '',
  sender_name text DEFAULT '',
  use_custom_sender boolean DEFAULT false,
  card_surcharge_percent numeric DEFAULT 0,
  early_checkin_enabled boolean DEFAULT false,
  early_checkin_price integer DEFAULT 0,
  early_checkin_time text DEFAULT '12:00',
  early_checkin_show_customers boolean DEFAULT false,
  late_checkout_enabled boolean DEFAULT false,
  late_checkout_price integer DEFAULT 0,
  late_checkout_time text DEFAULT '12:00',
  late_checkout_show_customers boolean DEFAULT false,
  electric_bill_message text DEFAULT '',
  square_terminal_device_id text DEFAULT '',
  square_terminal_name text DEFAULT '',
  pos_enabled boolean DEFAULT false,
  total_sites integer DEFAULT 0,
  total_cabins integer DEFAULT 0,
  max_credit_amount integer DEFAULT 0,
  auto_sync_guests boolean DEFAULT false,
  deposit_type text DEFAULT 'first_night',
  deposit_value integer DEFAULT 0,
  custom_payment_methods text[] DEFAULT '{}'::text[],
  contract_text text,
  theme text DEFAULT 'light',
  hero_image_url text
);

CREATE TABLE IF NOT EXISTS reservations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  site_id uuid REFERENCES sites(id),
  status text DEFAULT 'confirmed',
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  num_adults integer DEFAULT 2 NOT NULL,
  num_children integer DEFAULT 0 NOT NULL,
  guest_name text NOT NULL,
  guest_email text NOT NULL,
  guest_phone text,
  base_nightly_rate integer NOT NULL,
  extra_guest_fee_total integer DEFAULT 0,
  addons_total integer DEFAULT 0,
  discount_amount integer DEFAULT 0,
  total_price integer NOT NULL,
  amount_paid integer DEFAULT 0,
  payment_type text,
  square_payment_id text,
  waiver_signed boolean DEFAULT false,
  waiver_signed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  discount_code text DEFAULT '',
  special_requests text DEFAULT '',
  site_name text DEFAULT '',
  confirmation_number text DEFAULT '',
  checked_in boolean DEFAULT false,
  camper_type text DEFAULT '',
  camper_length integer DEFAULT 0,
  camper_amperage text DEFAULT '',
  fees_total integer DEFAULT 0,
  payment_method text,
  early_checkin boolean DEFAULT false,
  early_checkin_fee integer DEFAULT 0,
  late_checkout boolean DEFAULT false,
  late_checkout_fee integer DEFAULT 0,
  surcharge_amount integer DEFAULT 0 NOT NULL,
  CONSTRAINT reservations_payment_type_check CHECK (payment_type = ANY (ARRAY['deposit','full','unpaid','cash','other'])),
  CONSTRAINT reservations_status_check CHECK (status = ANY (ARRAY['pending','confirmed','cancelled','manual']))
);

CREATE TABLE IF NOT EXISTS blocked_dates (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  site_id uuid REFERENCES sites(id),
  date date NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  site_type text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  nightly_rate integer NOT NULL,
  priority integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  site_ids text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS min_stay_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  site_type text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  min_nights integer NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  site_ids text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS folios (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest_name text DEFAULT '' NOT NULL,
  guest_email text DEFAULT '',
  folio_type text DEFAULT 'reservation' NOT NULL,
  status text DEFAULT 'open' NOT NULL,
  label text DEFAULT '',
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  notes text DEFAULT '',
  guest_id uuid
);

CREATE TABLE IF NOT EXISTS folio_line_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  folio_id uuid NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  unit_price integer DEFAULT 0 NOT NULL,
  tax_amount integer DEFAULT 0 NOT NULL,
  line_total integer DEFAULT 0 NOT NULL,
  category text DEFAULT '',
  charged_at timestamptz DEFAULT now(),
  notes text,
  voided boolean DEFAULT false NOT NULL,
  voided_at timestamptz,
  voided_by text,
  reason text
);

CREATE TABLE IF NOT EXISTS folio_payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  folio_id uuid NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  method text DEFAULT 'cash' NOT NULL,
  amount integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'completed' NOT NULL,
  reference_number text DEFAULT '',
  square_payment_id text DEFAULT '',
  note text DEFAULT '',
  paid_at timestamptz DEFAULT now(),
  surcharge_amount integer DEFAULT 0,
  receipt_sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS reservation_addons (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  reservation_id uuid REFERENCES reservations(id),
  addon_id uuid REFERENCES addons(id),
  quantity integer DEFAULT 1,
  price_at_booking integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS electric_readings (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  guest_id uuid REFERENCES guests(id) ON DELETE CASCADE,
  billing_month text NOT NULL,
  previous_reading numeric DEFAULT 0,
  current_reading numeric DEFAULT 0,
  kwh_used numeric DEFAULT 0,
  rate_per_kwh numeric DEFAULT 0,
  minimum_charge integer DEFAULT 0,
  calculated_amount integer DEFAULT 0,
  final_amount integer DEFAULT 0,
  folio_line_item_id uuid,
  notes text DEFAULT '',
  voided boolean DEFAULT false NOT NULL,
  period_start date,
  period_end date,
  voided_at timestamptz,
  voided_by text,
  reason text
);

CREATE TABLE IF NOT EXISTS tax_applications (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  tax_id uuid NOT NULL REFERENCES taxes(id) ON DELETE CASCADE,
  applies_to_type text NOT NULL,
  applies_to_key text,
  CONSTRAINT tax_applications_applies_to_type_check CHECK (applies_to_type = ANY (ARRAY['site_type','product','addon','fee','early_checkin','late_checkout','extra_guest']))
);

CREATE TABLE IF NOT EXISTS terminal_checkouts (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  folio_id uuid REFERENCES folios(id) ON DELETE CASCADE,
  square_checkout_id text NOT NULL,
  amount integer NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  payment_id text DEFAULT '',
  device_id text DEFAULT '',
  note text DEFAULT '',
  completed_at timestamptz,
  surcharge_amount integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS signatures (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  doc_type text DEFAULT 'booking_waiver' NOT NULL,
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES guests(id) ON DELETE SET NULL,
  signer_name text,
  signer_email text,
  sign_token text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  sent_at timestamptz DEFAULT now(),
  agreed boolean DEFAULT false NOT NULL,
  signed_name text,
  signed_text_snapshot text,
  signed_at timestamptz,
  ip_address text,
  user_agent text,
  notes text,
  document_title text,
  document_text text,
  packet_id uuid,
  sign_order integer,
  CONSTRAINT signatures_sign_token_key UNIQUE (sign_token)
);

CREATE TABLE IF NOT EXISTS seasonal_contracts (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  status text DEFAULT 'draft' NOT NULL,
  packet_id uuid,
  contract_signature_id uuid REFERENCES signatures(id) ON DELETE SET NULL,
  waiver_signature_id uuid REFERENCES signatures(id) ON DELETE SET NULL,
  site_number text,
  season_opens date,
  season_closes date,
  occupants jsonb DEFAULT '[]'::jsonb NOT NULL,
  camper_type text,
  camper_length integer,
  camper_amperage text,
  camper_make text,
  camper_model text,
  camper_year integer,
  total_due_cents integer,
  staff_notes text,
  sent_at timestamptz,
  signed_at timestamptz,
  CONSTRAINT seasonal_contracts_guest_id_season_year_key UNIQUE (guest_id, season_year)
);

CREATE TABLE IF NOT EXISTS guest_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  author text NOT NULL,
  body text NOT NULL
);

CREATE TABLE IF NOT EXISTS site_categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id uuid NOT NULL,
  category_id bigint NOT NULL
);

-- profiles — one row per admin user, keyed to auth.users (PR 5a).
--
-- This is the table the whole role model rests on: app.user_role() reads it, every policy below
-- calls app.at_least(), and lib/require-role.ts in the app resolves a request's role from it.
-- A client provisioned without it has no way to express who anyone is.
--
-- IT PROVISIONS EMPTY. Onboarding seeds the client's first Owner over the service-role admin API
-- (PR 7-3); until then the client has no accounts and nobody can sign in, which is the correct
-- state for a database with no owner yet rather than a problem to solve with a default row.
--
-- Owner > Manager > Staff as a CHECK rather than an enum: widening a CHECK is a plain ALTER
-- TABLE, while adding a value to an enum needs ALTER TYPE, which does not run inside a
-- transaction on older Postgres. The three tiers must stay in step with the ladder in
-- app.at_least() below and with RANK in the app's lib/roles.ts.
--
-- `active` rather than deleting a user: folio and booking history should keep pointing at a real
-- person. Deactivating is what the Owner's account screen does, and app.user_role() returns NULL
-- for an inactive user, so the next request they make has no role at all.
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  full_name   text,
  role        text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- INDEXES (non-PK / non-UNIQUE)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest ON public.guest_notes USING btree (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seasonal_contracts_guest ON public.seasonal_contracts USING btree (guest_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_contracts_year ON public.seasonal_contracts USING btree (season_year, status);
CREATE INDEX IF NOT EXISTS idx_signatures_guest ON public.signatures USING btree (guest_id);
CREATE INDEX IF NOT EXISTS idx_signatures_packet ON public.signatures USING btree (packet_id);
CREATE INDEX IF NOT EXISTS idx_signatures_reservation ON public.signatures USING btree (reservation_id);
CREATE INDEX IF NOT EXISTS idx_signatures_status ON public.signatures USING btree (doc_type, status);
CREATE INDEX IF NOT EXISTS idx_signatures_token ON public.signatures USING btree (sign_token);
CREATE INDEX IF NOT EXISTS idx_tax_applications_target ON public.tax_applications USING btree (applies_to_type, applies_to_key);
CREATE INDEX IF NOT EXISTS idx_tax_applications_tax ON public.tax_applications USING btree (tax_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_applications ON public.tax_applications USING btree (tax_id, applies_to_type, COALESCE(applies_to_key, ''::text));


-- ============================================================
-- TRIGGER
-- ============================================================
DROP TRIGGER IF EXISTS trg_sync_guest_from_reservation ON public.reservations;
CREATE TRIGGER trg_sync_guest_from_reservation
  AFTER INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.sync_guest_from_reservation();


-- ============================================================
-- APP SCHEMA + THE ROLE HELPER   (security PR 5b-1)
-- ============================================================
-- Every policy in the next section is one call to app.at_least(). This is where the ladder is
-- actually decided, so it is the highest-value function in the schema and it is written to fail
-- closed in every direction.
--
-- SECURITY DEFINER because public.profiles carries RLS with a self-row-only SELECT policy.
-- Reading it from inside a policy on another table would otherwise re-enter RLS on every row;
-- DEFINER evaluates it once, as the owner, which also means profiles' own policy never has to be
-- widened to make roles work.
--
-- `SET search_path = ''` with fully-qualified names throughout, and this one is not optional: an
-- unpinned search_path on a DEFINER function is a privilege-escalation primitive. A caller who
-- can create a table in any schema earlier on the path substitutes their own `profiles` and the
-- function cheerfully reads their role out of it. The empty path makes that impossible.
--
-- FAIL CLOSED IS THE DESIGN. A user with no profiles row, a deactivated user, and an
-- unrecognised role all fall through to 0 >= n, which is false. An unrecognised `minimum`
-- maps to 99, so a TYPO IN A POLICY DENIES rather than grants. Both comparisons are total.
-- This is what keeps the model safe if public signup is ever switched back on for a project.
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app TO authenticated;

CREATE OR REPLACE FUNCTION app.user_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT p.role FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.active
$fn$;

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


-- ============================================================
-- ROW LEVEL SECURITY  —  ON FOR EVERY TABLE
-- ============================================================
-- This file used to switch RLS on for 20 tables and leave it OFF for the POS/folio/guest ones,
-- as live-Cady stood in July. Combined with the `{public}` allow-all policies and the anon
-- GRANT further down, that left a provisioned client's entire database readable and writable
-- with the publishable key that ships in the browser. PR 5b-1 and PR 6 closed it on Cady; this
-- is the same close, at provisioning time.
--
-- Two shapes below, and the difference is deliberate.

-- 1. Tables the ADMIN reaches from the browser. RLS on, and the authenticated policy set in the
--    next section is what grants access — nothing else does.
ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electric_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folio_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folio_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.min_stay_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;

-- 2. Tables NOTHING reaches from a browser. RLS ON WITH NO POLICY AT ALL, which denies every
--    API role outright while service_role (which bypasses RLS) still works. These are read and
--    written only by server code holding the service key: outbound email history, the
--    charged-but-not-booked safety net, guest notes, seasonal contracts, e-signatures, and the
--    Square terminal handshake. Adding a policy here is not a small change — it is a decision to
--    expose the table to the browser.
ALTER TABLE public.broadcast_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failed_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasonal_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_checkouts ENABLE ROW LEVEL SECURITY;

-- 3. profiles. RLS on, and exactly ONE policy: a signed-in user may read their OWN row.
--    That is not role enforcement, it is what lets the app answer "who am I", and it is scoped
--    to a single row so one staff member cannot enumerate their colleagues' email addresses.
--    Listing all users is an Owner-only server-side operation over the service key.
--
--    NO INSERT/UPDATE/DELETE POLICY, ON PURPOSE. With RLS on and no policy those are denied to
--    `authenticated` — which is what stops a signed-in user UPDATEing their own `role` column to
--    'owner'. The grants below close the same door from the other side; see the note there.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'profiles'
       AND policyname = 'Users read their own profile'
  ) THEN
    CREATE POLICY "Users read their own profile" ON public.profiles
      FOR SELECT TO authenticated USING (auth.uid() = id);
  END IF;
END $$;


-- ============================================================
-- THE AUTHENTICATED POLICY SET  (security PR 5b-1)
-- 87 permissive + 88 restrictive — 86 + 88 below, plus profiles' SELECT above.
-- ============================================================
--
-- ⚠ THE PERMISSIVE AND RESTRICTIVE HALVES ARE NOT DUPLICATES OF EACH OTHER. DO NOT
--   "DEDUPLICATE" THEM. ⚠
--
-- They look like the same predicates written twice, and every instinct says to delete one. Here
-- is what each half does, because deleting the wrong one is silent:
--
--   PERMISSIVE policies are OR'd together. They are what GRANTS access — with the `{public}`
--   allow-all policies gone, these are the only reason a logged-in admin can read anything at
--   all. Drop these and the admin goes blind: every folio page, the guest directory, the POS
--   and electric billing stop working at once, loudly.
--
--   RESTRICTIVE policies are AND'd. They are what ENFORCES the role. Drop these and NOTHING
--   BREAKS — every page still works, every admin still sees their screens — and the ladder
--   quietly stops biting wherever a permissive policy is more generous than intended. That is
--   the failure this warning exists for: the dangerous half to delete is the half whose deletion
--   has no symptoms.
--
--   The predicates mirror each other so that the failure mode of losing EITHER half is a
--   redundant policy rather than an open one. That is a safety property of the pair, not
--   evidence that one is spare.
--
-- PER COMMAND rather than one FOR ALL policy, deliberately: FOR ALL is checked by USING for
-- DELETE and by WITH CHECK for INSERT, so a single policy cannot express a different minimum
-- role per command — which is exactly what the money carve-outs need.
--
-- THE LADDER:
--   config & pricing (14 tables) : SELECT staff+, write owner-only
--   operational      (8 tables)  : staff+, with four carve-outs —
--        folio_payments UPDATE (the void)            -> manager+
--        reservations / folios DELETE                -> manager+
--        electric_readings INSERT/UPDATE             -> manager+
--        folio_payments / electric_readings DELETE   -> nobody (no policy AND no grant)
--
-- Changing a minimum here means changing it in BOTH halves and in the app's route→role map
-- (lib/admin-pages.ts and each route's requireRole call). Lifted verbatim from
-- db/migrations/2026-08-11-pr5b1-authenticated-role-policies.sql so the artifact and the
-- database it reproduces cannot disagree.

-- ------------------------------------------------------------
-- PERMISSIVE — what each role MAY do (86)
-- ------------------------------------------------------------

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


-- ------------------------------------------------------------
-- RESTRICTIVE — what makes the set above BITE (88). See the warning above.
-- ------------------------------------------------------------

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


-- ============================================================
-- GRANTS
-- ============================================================
-- GRANTS AND POLICIES ARE INDEPENDENT GATES. A policy is only ever consulted if the role
-- already holds the table privilege, so closing one and leaving the other open leaves a live
-- re-entry point. PR 5a learned this the expensive way on `profiles`: the table had RLS and no
-- write policy, and `authenticated` still held UPDATE from the project's default privileges —
-- unreachable that day, waiting for the first permissive policy anyone ever pasted onto it.
-- Both gates are closed here, for every role.

-- USAGE ON SCHEMA public stays granted to anon, deliberately. Removing it makes PostgREST fail
-- during schema introspection — 500s instead of clean permission-denied — and it is the TABLE
-- privileges below that gate the data, not schema usage.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ALL to the two roles that legitimately hold data privileges. `anon` is NOT in this list and
-- must not be added: since PR 6 nothing reaches the database as anon. The camper booking flow
-- runs through server-side service-role code, the public pages read server-side, and the admin
-- runs as `authenticated`. This line used to read `TO anon, authenticated, service_role`, and
-- that single word is what made every provisioned client's database world-readable.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Carve-outs, applied AFTER the blanket grant above so the blanket cannot undo them.
--
-- The two never-delete tables: payment history and electric readings are voided, never removed.
-- A policy denying DELETE is the right answer and the revoked grant is the second lock (PR 5b-1).
REVOKE DELETE ON public.folio_payments FROM authenticated;
REVOKE DELETE ON public.electric_readings FROM authenticated;

-- profiles: SELECT and nothing more (PR 5a). Writes go through service-role code only — the
-- Owner's account screen and onboarding's Owner-seed. Without the REVOKE, `authenticated` would
-- hold UPDATE on the very column that decides what `authenticated` is allowed to do.
-- REVOKE FROM authenticated BY NAME: `REVOKE ... FROM PUBLIC` does not remove a grant held by a
-- named role, and the project's default privileges grant `authenticated` arwdDxtm by name.
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.profiles FROM PUBLIC;
REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;

-- anon holds nothing. This is not belt-and-braces for the omission above — it is REQUIRED.
-- A fresh Supabase project ships default privileges that grant anon arwdDxtm on every table
-- created in `public`, so every table above already carries an anon grant by the time this file
-- reaches this line, whether or not anyone ever wrote GRANT ... TO anon. Schema-wide rather than
-- a list of table names so nothing added later is missed.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ⚠ THIS BLOCK GOVERNS THE FUTURE, NOT THE PRESENT — DO NOT REMOVE IT. ⚠
--
-- Everything above closes today's catalogue. This closes tomorrow's. Supabase's stock default
-- privileges re-grant anon full access to every NEWLY CREATED table in `public`, so without
-- these four lines the next migration that adds a table silently reopens anon's access to it —
-- and only to it, so the tables anyone thinks to check still look correct. The symptom is a hole
-- in one table nobody looked at, months later.
--
-- Both forms are needed: the unqualified one applies to the role running this file, the
-- FOR ROLE postgres one to the role that owns objects created through the Supabase dashboard
-- and the Management API. Removing either leaves half the door open.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;


-- ============================================================
-- STORAGE BUCKETS + POLICIES  (generic infra — every client needs these)
-- ============================================================
-- Wrapped best-effort: the Supabase Management API (/database/query) used by the onboarding tool
-- can't reach the `storage` schema, so this section no-ops there (onboarding provisions buckets
-- via the Storage REST API and the same policies separately — app/api/onboard/route.ts, which
-- MUST be kept in step with the policies below). In the SQL editor, `storage` is reachable and
-- this runs normally. The EXCEPTION rolls back only this subtransaction, so the public-schema
-- work above still commits.
--
-- PUBLIC READ, ROLE-GATED WRITE (PR 6). Both buckets are marked public and the booking site
-- displays these images, so SELECT stays open to everyone — that part is unchanged. What changed
-- is the other three verbs. The previous policies were role `{public}` for INSERT, UPDATE and
-- DELETE with names that claimed otherwise ("Allow admin upload to logos"), which meant any
-- visitor with the publishable key could upload, overwrite and DELETE every logo and site photo
-- on a provisioned client. The delete half of that is worse than the upload half.
--
-- THE TWO BUCKETS ARE GATED DIFFERENTLY, deliberately:
--   logos       — written only by /admin/settings, an Owner page                    -> owner
--   site-photos — written by /admin/sites (Owner) AND /admin/send-email, a MANAGER
--                 page (broadcast-email images)                                     -> manager
-- Gating site-photos at owner would break a Manager's broadcast-email image upload.
DO $$ BEGIN
  INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true) ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.buckets (id, name, public) VALUES ('site-photos', 'site-photos', true) ON CONFLICT (id) DO NOTHING;

  -- Drop the unrestricted set by every name it has been provisioned under, so re-running this
  -- file on a client created from an older copy actually closes the hole rather than adding
  -- eight new policies alongside the eight open ones.
  DROP POLICY IF EXISTS "Allow public read on logos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow read on logos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow upload on logos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow update on logos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow delete on logos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow public read on site-photos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow read on site-photos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow upload on site-photos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow update on site-photos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow delete on site-photos" ON storage.objects;

  -- Reads: unchanged behaviour, explicit about it.
  DROP POLICY IF EXISTS "public read logos" ON storage.objects;
  CREATE POLICY "public read logos" ON storage.objects
    AS PERMISSIVE FOR SELECT TO public USING (bucket_id = 'logos');
  DROP POLICY IF EXISTS "public read site-photos" ON storage.objects;
  CREATE POLICY "public read site-photos" ON storage.objects
    AS PERMISSIVE FOR SELECT TO public USING (bucket_id = 'site-photos');

  -- Writes: authenticated only, role-gated. app.at_least() is SECURITY DEFINER and resolves the
  -- caller's role from their JWT here exactly as it does in the public-schema policies.
  DROP POLICY IF EXISTS "owner write logos" ON storage.objects;
  CREATE POLICY "owner write logos" ON storage.objects
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'logos' AND (SELECT app.at_least('owner')));
  DROP POLICY IF EXISTS "owner update logos" ON storage.objects;
  CREATE POLICY "owner update logos" ON storage.objects
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (bucket_id = 'logos' AND (SELECT app.at_least('owner')))
    WITH CHECK (bucket_id = 'logos' AND (SELECT app.at_least('owner')));
  DROP POLICY IF EXISTS "owner delete logos" ON storage.objects;
  CREATE POLICY "owner delete logos" ON storage.objects
    AS PERMISSIVE FOR DELETE TO authenticated
    USING (bucket_id = 'logos' AND (SELECT app.at_least('owner')));

  DROP POLICY IF EXISTS "manager write site-photos" ON storage.objects;
  CREATE POLICY "manager write site-photos" ON storage.objects
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'site-photos' AND (SELECT app.at_least('manager')));
  DROP POLICY IF EXISTS "manager update site-photos" ON storage.objects;
  CREATE POLICY "manager update site-photos" ON storage.objects
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (bucket_id = 'site-photos' AND (SELECT app.at_least('manager')))
    WITH CHECK (bucket_id = 'site-photos' AND (SELECT app.at_least('manager')));
  DROP POLICY IF EXISTS "manager delete site-photos" ON storage.objects;
  CREATE POLICY "manager delete site-photos" ON storage.objects
    AS PERMISSIVE FOR DELETE TO authenticated
    USING (bucket_id = 'site-photos' AND (SELECT app.at_least('manager')));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Storage provisioning skipped (storage schema not reachable in this context); handled separately by onboarding.';
END $$;


-- ============================================================
-- SETTINGS BOOTSTRAP ROW  (exactly one; required — 38 code sites do settings.single()).
-- Neutral placeholders only. No Cady data, and no credential of any kind — the admin_password
-- column no longer exists (see the settings table above), and login is per-user Supabase Auth
-- against an account onboarding seeds into `profiles`.
-- ============================================================
INSERT INTO settings (
  park_name, park_tagline, park_email, park_phone, park_address, park_website, park_location,
  logo_url, logo_shape, accent_color, show_site_map,
  check_in_time, check_out_time, same_day_cutoff_time, same_day_cutoff_message,
  season_start, season_end, closed_season_message,
  base_occupancy_adults, base_occupancy_children, extra_adult_fee, extra_child_fee,
  cancellation_policy, confirmation_message,
  waiver_enabled, waiver_text, contract_text,
  plan, pos_enabled, card_surcharge_percent,
  maintenance_mode, maintenance_message,
  sender_email, reply_to_email, sender_name, use_custom_sender,
  early_checkin_enabled, early_checkin_price, early_checkin_time, early_checkin_show_customers,
  late_checkout_enabled, late_checkout_price, late_checkout_time, late_checkout_show_customers,
  electric_bill_message, square_terminal_device_id, square_terminal_name,
  total_sites, total_cabins, max_credit_amount,
  auto_sync_guests, deposit_type, deposit_value, custom_payment_methods
)
SELECT
  'New Campground', '', '', '', '', '', '',
  NULL, 'circle', '#2D6A4F', false,
  '2:00 PM', '12:00 PM', '11:00:00', 'Same-day reservations are not available online. Please call us to book.',
  NULL, NULL, 'We are closed for the season. We look forward to welcoming you back next year!',
  2, 2, 0, 0,
  '', '',
  false, '', '',
  'trailhead', false, 0,
  false, 'We are temporarily unavailable for online reservations. Please call us to book your stay!',
  '', '', '', false,
  false, 0, '', false,
  false, 0, '', false,
  '', '', '',
  0, 0, 0,
  false, 'first_night', 0, '{}'::text[]
WHERE NOT EXISTS (SELECT 1 FROM settings);


-- ============================================================
-- DONE.  Next steps for onboarding a new client:
--   1. Seed the client's first Owner — an auth.users row plus a matching `profiles` row with
--      role 'owner'. This schema provisions ZERO accounts, so until it happens nobody can sign
--      in at all. Onboarding does it over the service-role admin API (PR 7-3); by hand it is
--      scripts/seed-user.mjs, which is also the break-glass path if every Owner is locked out.
--   2. Disable public signup on the new Supabase project (Auth settings → `disable_signup`).
--      The role model already fails closed for a signed-up stranger — app.at_least() returns
--      false with no `profiles` row — but leaving signup on lets anyone mint an `authenticated`
--      JWT against the project, and that is a gate that should not be left open.
--   3. Fill in park details on the admin Settings page.
--   4. Add sites, then products/add-ons/fees/taxes as needed.
--   5. Configure Square + verify the email sending domain.
--
-- VERIFY the posture landed (run against the new project; these are the numbers to match):
--   select count(*) from information_schema.role_table_grants
--     where table_schema='public' and grantee='anon';                        -- expect 0
--   select count(*) from pg_policies where schemaname='public'
--     and roles::text='{public}';                                            -- expect 0
--   select permissive, count(*) from pg_policies where schemaname='public'
--     and roles::text='{authenticated}' group by 1;                          -- expect 87 / 88
--   select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--     where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;   -- expect 0
--   select pg_get_function_identity_arguments(oid) from pg_proc
--     where proname='increment_discount_usage';                              -- expect p_code text
-- ============================================================
