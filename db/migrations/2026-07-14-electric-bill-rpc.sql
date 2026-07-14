-- Electric Billing Redesign · Phase B · Atomic new-bill write (Decision 4).
-- Cady ONLY (Supabase project dmqyuujhdflfydfhigvn). Run once in the Supabase SQL
-- editor. Safe to re-run (CREATE OR REPLACE + idempotent GRANT). DO NOT RUN until the
-- Phase B code is reviewed and deployed — code ships first with a scoped "function
-- does not exist" fallback (Option A), so billing keeps working before this lands.
--
-- Why: creating a bill is two records (the charge on folio_line_items + the reading
-- on electric_readings). Today they're inserted separately and can drift apart if one
-- fails — that's how orphans (charge without reading, or vice-versa) are born. This
-- function writes BOTH inside a single function call = one transaction: any failure
-- rolls back everything, so a bill is always whole or absent, never half.
--
-- Atomicity note: a plpgsql function runs inside the calling statement's transaction.
-- An unhandled exception (e.g. the reading's FK fails) aborts that transaction and
-- rolls back the charge insert too. No explicit BEGIN/EXCEPTION is needed — and we
-- deliberately DON'T add one, so failures propagate cleanly to the caller.
--
-- Security: SECURITY INVOKER (least privilege). Both tables have an "Allow all"
-- RLS policy and anon already inserts into them directly today, so running as the
-- caller behaves exactly like the current direct inserts. No SECURITY DEFINER.

CREATE OR REPLACE FUNCTION create_electric_bill(
  p_folio_id         uuid,
  p_guest_id         uuid,
  p_billing_month    text,
  p_period_start     date,
  p_period_end       date,
  p_description      text,
  p_amount_cents     integer,
  p_previous_reading numeric,
  p_current_reading  numeric,
  p_kwh_used         numeric,
  p_rate_per_kwh     numeric,
  p_minimum_charge   integer,
  p_calculated_amount integer,
  p_final_amount     integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_line_item_id uuid;
  v_reading_id   uuid;
BEGIN
  -- 1) The charge (money on the folio). Mirrors the current sendBill insert exactly.
  INSERT INTO folio_line_items
    (folio_id, product_id, description, quantity, unit_price, tax_amount, line_total, category)
  VALUES
    (p_folio_id, NULL, p_description, 1, p_amount_cents, 0, p_amount_cents, 'Fees')
  RETURNING id INTO v_line_item_id;

  -- 2) The reading (meter data), linked to the charge just created. Includes the
  --    Phase A period columns + billing_month in parallel. If THIS fails, step 1 is
  --    rolled back with it.
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

GRANT EXECUTE ON FUNCTION create_electric_bill(
  uuid, uuid, text, date, date, text, integer, numeric, numeric, numeric, numeric, integer, integer, integer
) TO anon, authenticated;
