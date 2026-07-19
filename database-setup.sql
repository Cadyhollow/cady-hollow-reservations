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
-- CURATION APPLIED (allowlist — structure wholesale from live; value-bearing content only
-- if provably generic). Anything below is an INTENTIONAL difference from live-Cady:
--   • EXCLUDED tables (Cady operational / platform, never per-client):
--       _backup_email_cleanup_20260611, electric_readings_backup_20260714,
--       products_taxclass_snapshot_20260716, reservations_backup_optionb,
--       resonation_clients (platform tenant-registry — holds other clients' service keys).
--   • SEED ROWS: none. Every table provisions EMPTY except the single required settings row.
--   • DROPPED dead columns: settings.base_adult_rate, base_child_rate, primary_color, updated_at.
--   • admin_password: NO default (vestigial column; login uses the ADMIN_PASSWORD env var).
--       Never embed a password value in a shared artifact.
--   • NEUTRALIZED Cady-config column defaults (see the settings table):
--       park_name (no default), extra_adult_fee 1000→0, extra_child_fee 500→0,
--       accent_color #3DBDD4→#2D6A4F, season_start/end → NULL, plan ridgeline→trailhead,
--       pos_enabled true→false, total_sites 84→0, total_cabins 3→0, waiver_enabled true→false,
--       same_day_cutoff_message (Cady phone) → generic,
--       electric_readings.rate_per_kwh 0.27→0, minimum_charge 1500→0 (Cady electric rates).
--   • RLS / grants / functions / triggers reproduce live's posture AS-IS (parity, not a
--     security redesign): RLS is OFF on the POS/folio/guest tables live, ON elsewhere.
--   • Storage buckets (logos, site-photos) are generic infra, provisioned explicitly below.
--
-- The settings bootstrap row (one row; sign-off 2026-07-19) carries only neutral placeholders.
-- ============================================================


-- ============================================================
-- FUNCTIONS (created before the trigger + tables that the trigger reads)
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_electric_bill(
  p_folio_id uuid, p_guest_id uuid, p_billing_month text, p_period_start date, p_period_end date,
  p_description text, p_amount_cents integer, p_previous_reading numeric, p_current_reading numeric,
  p_kwh_used numeric, p_rate_per_kwh numeric, p_minimum_charge integer, p_calculated_amount integer,
  p_final_amount integer
) RETURNS jsonb
  LANGUAGE plpgsql
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

CREATE OR REPLACE FUNCTION public.increment_discount_usage(code text) RETURNS void
  LANGUAGE sql
  AS $$
  update discounts set times_used = times_used + 1 where discounts.code = code;
$$;

CREATE OR REPLACE FUNCTION public.sync_guest_from_reservation() RETURNS trigger
  LANGUAGE plpgsql
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
  refund_percent integer DEFAULT 90,
  cancellation_deadline_days integer DEFAULT 7,
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
  admin_password text,
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
  contract_text text
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
-- ROW LEVEL SECURITY  (parity with live: ON for these tables, OFF for the
-- POS/folio/guest tables — electric_readings, folio_line_items, folio_payments,
-- folios, guests, product_categories, products, terminal_checkouts.)
-- ============================================================
ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failed_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.min_stay_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasonal_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;

-- Policies (reproduced verbatim from live; guarded for re-runnability).
-- guest_notes, seasonal_contracts, signatures: RLS ON with NO policy = service-role only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='failed_bookings' AND policyname='Allow all') THEN
    CREATE POLICY "Allow all" ON public.failed_bookings USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='addons' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.addons TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='addons' AND policyname='Allow all operations on addons') THEN
    CREATE POLICY "Allow all operations on addons" ON public.addons USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='blocked_dates' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.blocked_dates TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='blocked_dates' AND policyname='Allow all operations on blocked_dates') THEN
    CREATE POLICY "Allow all operations on blocked_dates" ON public.blocked_dates USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cancellation_rules' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.cancellation_rules TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cancellation_rules' AND policyname='Allow all operations on cancellation_rules') THEN
    CREATE POLICY "Allow all operations on cancellation_rules" ON public.cancellation_rules USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='discounts' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.discounts TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='discounts' AND policyname='Allow all operations on discounts') THEN
    CREATE POLICY "Allow all operations on discounts" ON public.discounts USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='min_stay_rules' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.min_stay_rules TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='min_stay_rules' AND policyname='Allow all operations on min_stay_rules') THEN
    CREATE POLICY "Allow all operations on min_stay_rules" ON public.min_stay_rules USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pricing_rules' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.pricing_rules TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pricing_rules' AND policyname='Allow all operations on pricing_rules') THEN
    CREATE POLICY "Allow all operations on pricing_rules" ON public.pricing_rules USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservation_addons' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.reservation_addons TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservation_addons' AND policyname='Allow all operations on reservation_addons') THEN
    CREATE POLICY "Allow all operations on reservation_addons" ON public.reservation_addons USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservations' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.reservations TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservations' AND policyname='Allow all operations on reservations') THEN
    CREATE POLICY "Allow all operations on reservations" ON public.reservations USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservations' AND policyname='Allow public insert for booking') THEN
    CREATE POLICY "Allow public insert for booking" ON public.reservations FOR INSERT TO anon WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.settings TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='Allow all operations on settings') THEN
    CREATE POLICY "Allow all operations on settings" ON public.settings USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='Allow public read for booking') THEN
    CREATE POLICY "Allow public read for booking" ON public.settings FOR SELECT TO anon USING (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sites' AND policyname='Allow all for authenticated users') THEN
    CREATE POLICY "Allow all for authenticated users" ON public.sites TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sites' AND policyname='Allow all operations on sites') THEN
    CREATE POLICY "Allow all operations on sites" ON public.sites USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sites' AND policyname='Allow public read for booking') THEN
    CREATE POLICY "Allow public read for booking" ON public.sites FOR SELECT TO anon USING (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='fees' AND policyname='Allow all operations for authenticated admin') THEN
    CREATE POLICY "Allow all operations for authenticated admin" ON public.fees USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='taxes' AND policyname='Allow all on taxes') THEN
    CREATE POLICY "Allow all on taxes" ON public.taxes USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tax_applications' AND policyname='Allow all on tax_applications') THEN
    CREATE POLICY "Allow all on tax_applications" ON public.tax_applications USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='categories' AND policyname='allow all') THEN
    CREATE POLICY "allow all" ON public.categories USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='site_categories' AND policyname='allow all') THEN
    CREATE POLICY "allow all" ON public.site_categories USING (true) WITH CHECK (true); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='broadcast_emails' AND policyname='Service role full access') THEN
    CREATE POLICY "Service role full access" ON public.broadcast_emails USING (true); END IF;
END $$;


-- ============================================================
-- GRANTS  (reproduce live: schema usage + ALL on every table/sequence to the API roles.
-- These make the RLS-OFF tables reachable by the anon key, exactly as on live.)
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;


-- ============================================================
-- STORAGE BUCKETS + POLICIES  (generic infra — every client needs these)
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('site-photos', 'site-photos', true) ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='Allow public read on logos') THEN
    CREATE POLICY "Allow public read on logos" ON storage.objects FOR SELECT USING (bucket_id = 'logos'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='Allow upload on logos') THEN
    CREATE POLICY "Allow upload on logos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'logos'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='Allow public read on site-photos') THEN
    CREATE POLICY "Allow public read on site-photos" ON storage.objects FOR SELECT USING (bucket_id = 'site-photos'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='Allow upload on site-photos') THEN
    CREATE POLICY "Allow upload on site-photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'site-photos'); END IF;
END $$;


-- ============================================================
-- SETTINGS BOOTSTRAP ROW  (exactly one; required — 38 code sites do settings.single()).
-- Neutral placeholders only. No admin_password (login uses the ADMIN_PASSWORD env var,
-- set per-client by onboarding). No Cady data.
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
--   1. Set the ADMIN_PASSWORD env var (per-client) in Vercel — this is the admin login secret.
--   2. Fill in park details on the admin Settings page.
--   3. Add sites, then products/add-ons/fees/taxes as needed.
--   4. Configure Square + verify the email sending domain.
-- ============================================================
