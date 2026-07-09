-- Seasonal Contracts v1 — MIGRATION
-- Target: Cady ONLY (Supabase project dmqyuujhdflfydfhigvn). Do not run elsewhere.
-- Run once in the Supabase SQL editor. Safe to re-run (all statements idempotent).
--
-- Every ADD COLUMN is nullable → safe against every existing read (the sign route
-- selects explicit columns and runs as service-role). The new tables are
-- service-role-only: RLS enabled, ZERO policies, matching the signatures table.

-- ── signatures: contract-packet support (additive, nullable) ────────────────
ALTER TABLE signatures
  ADD COLUMN IF NOT EXISTS document_title text,
  ADD COLUMN IF NOT EXISTS document_text  text,
  ADD COLUMN IF NOT EXISTS packet_id      uuid,
  ADD COLUMN IF NOT EXISTS sign_order     int;
CREATE INDEX IF NOT EXISTS idx_signatures_packet ON signatures(packet_id);

-- ── settings: seasonal contract template body (merge fields, like waiver_text) ─
ALTER TABLE settings ADD COLUMN IF NOT EXISTS contract_text text;

-- ── guests: rig make/model/year (type/length/amperage live on reservations) ──
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS camper_make  text,
  ADD COLUMN IF NOT EXISTS camper_model text,
  ADD COLUMN IF NOT EXISTS camper_year  int;

-- ── seasonal_contracts: one per guest per season; fields snapshotted AT SEND ──
CREATE TABLE IF NOT EXISTS seasonal_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  season_year int NOT NULL,
  status text NOT NULL DEFAULT 'draft',          -- draft|sent|signed|void
  packet_id uuid,
  contract_signature_id uuid REFERENCES signatures(id) ON DELETE SET NULL,
  waiver_signature_id   uuid REFERENCES signatures(id) ON DELETE SET NULL,
  -- snapshotted AT SEND from the guest record; never re-read afterward
  site_number text, season_opens date, season_closes date,
  occupants jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{name, kind:'adult'|'child'}]
  camper_type text, camper_length int, camper_amperage text,
  camper_make text, camper_model text, camper_year int,
  total_due_cents int,                           -- integer cents, display only
  staff_notes text,
  sent_at timestamptz, signed_at timestamptz,
  UNIQUE (guest_id, season_year)
);
CREATE INDEX IF NOT EXISTS idx_seasonal_contracts_guest ON seasonal_contracts(guest_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_contracts_year  ON seasonal_contracts(season_year, status);
ALTER TABLE seasonal_contracts ENABLE ROW LEVEL SECURITY;   -- zero policies, matches signatures

-- ── guest_notes: append-only trail ALONGSIDE the existing guests.notes column ─
CREATE TABLE IF NOT EXISTS guest_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  author text NOT NULL,
  body text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest ON guest_notes(guest_id, created_at DESC);
ALTER TABLE guest_notes ENABLE ROW LEVEL SECURITY;          -- zero policies, matches signatures
