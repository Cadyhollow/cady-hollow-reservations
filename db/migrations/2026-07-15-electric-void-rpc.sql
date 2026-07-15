-- Electric Billing Redesign · Phase C2 · Void RPC (both halves, atomic).
-- Cady ONLY. Run once in the Supabase SQL editor AFTER the audit-columns ALTER.
-- Safe to re-run (CREATE OR REPLACE + idempotent GRANT). DO NOT RUN until the C2
-- code is reviewed and deployed.
--
-- Keyed on the READING (not the charge): the reading is the surface staff act on
-- (the electric-page History), and it's the only handle for an ORPHAN reading whose
-- charge was hard-deleted. Voids the reading, then best-effort voids the linked
-- charge via folio_line_item_id IF it still exists — for an orphan that UPDATE hits
-- 0 rows, a clean no-op (not an error).
--
-- Atomicity: same construction as create_electric_bill — NO BEGIN/EXCEPTION wrapper,
-- so an unhandled failure aborts the calling statement's transaction and rolls BOTH
-- updates back. A bill is two records that move together, voided or not.
--
-- Idempotency: every UPDATE is guarded WHERE voided = false, so a double-click or a
-- re-void is a no-op — it never re-stamps voided_at/voided_by/reason.
--
-- Security: SECURITY INVOKER (least privilege); both tables have an "Allow all" RLS
-- policy and the app already writes them under anon, so this behaves like today.

CREATE OR REPLACE FUNCTION void_electric_bill(
  p_reading_id uuid,
  p_voided_by  text,
  p_reason     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_line_item_id uuid;
  v_reading_rows int;
  v_charge_rows  int := 0;
BEGIN
  -- 1) Void the reading (only if not already voided). Capture its charge link.
  UPDATE electric_readings
     SET voided = true, voided_at = now(), voided_by = p_voided_by, reason = p_reason
   WHERE id = p_reading_id AND voided = false
   RETURNING folio_line_item_id INTO v_line_item_id;
  GET DIAGNOSTICS v_reading_rows = ROW_COUNT;

  -- 2) Best-effort void the linked charge if it still exists. Orphan (dangling or
  --    NULL link) → 0 rows, no error. If step 2 raises, step 1 rolls back with it.
  IF v_line_item_id IS NOT NULL THEN
    UPDATE folio_line_items
       SET voided = true, voided_at = now(), voided_by = p_voided_by, reason = p_reason
     WHERE id = v_line_item_id AND voided = false;
    GET DIAGNOSTICS v_charge_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('reading_voided', v_reading_rows, 'charge_voided', v_charge_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION void_electric_bill(uuid, text, text) TO anon, authenticated;
