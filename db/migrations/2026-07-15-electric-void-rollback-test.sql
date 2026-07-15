-- Electric Billing Redesign · Phase C2 · REQUIRED rollback test for the void RPC.
-- Run in the Supabase SQL editor AFTER 2026-07-15-electric-void-rpc.sql is applied.
-- Proves a mid-void failure leaves NOTHING half-voided (reading voided but charge not).
--
-- How it works: pick a real non-voided reading that still has a live charge (so BOTH
-- updates would run). Install a temporary trigger that makes the CHARGE update fail —
-- simulating a failure on the second table, mid-void. Call void_electric_bill(): the
-- reading update succeeds, the charge update fires the trigger and raises, and the
-- whole RPC must roll back. We then assert the reading is STILL non-voided.
--
-- Net effect on the DB: none. The reading update is rolled back by the inner handler's
-- savepoint; the temp trigger + function are dropped before the block ends. PASS is
-- signalled by "Success" + the PASS notice (any failure path RAISEs → shows an error).

DO $$
DECLARE
  v_reading uuid;
  v_still_active boolean;
  v_raised boolean := false;
BEGIN
  SELECT er.id INTO v_reading
    FROM electric_readings er
    JOIN folio_line_items fli ON fli.id = er.folio_line_item_id
   WHERE er.voided = false AND fli.voided = false
   LIMIT 1;
  IF v_reading IS NULL THEN
    RAISE EXCEPTION 'No non-voided reading with a live charge to test against.';
  END IF;

  -- Temp trigger: any attempt to set folio_line_items.voided = true raises.
  CREATE OR REPLACE FUNCTION _c2_void_rollback_boom() RETURNS trigger LANGUAGE plpgsql AS $b$
  BEGIN RAISE EXCEPTION 'forced failure voiding the charge (rollback test)'; END; $b$;
  CREATE TRIGGER _c2_void_rollback_trg
    BEFORE UPDATE ON folio_line_items
    FOR EACH ROW WHEN (NEW.voided = true)
    EXECUTE FUNCTION _c2_void_rollback_boom();

  -- Attempt the void; the charge update trips the trigger → RPC raises → both updates
  -- roll back to this block's savepoint.
  BEGIN
    PERFORM void_electric_bill(v_reading, 'ROLLBACK TEST', 'rollback test');
  EXCEPTION WHEN others THEN
    v_raised := true;
    RAISE NOTICE 'Void raised as expected: %', SQLERRM;
  END;

  -- Remove the temp trigger + function (net-zero).
  DROP TRIGGER IF EXISTS _c2_void_rollback_trg ON folio_line_items;
  DROP FUNCTION IF EXISTS _c2_void_rollback_boom();

  -- The reading must NOT have been left voided.
  SELECT (voided = false) INTO v_still_active FROM electric_readings WHERE id = v_reading;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED: void did not raise (expected the forced charge-void failure).';
  END IF;
  IF NOT v_still_active THEN
    RAISE EXCEPTION 'TEST FAILED: reading was left voided — the void was NOT atomic (half-voided).';
  END IF;

  RAISE NOTICE 'ROLLBACK TEST PASSED: charge void failed and the reading void rolled back (atomic). Reading % untouched.', v_reading;
END $$;
