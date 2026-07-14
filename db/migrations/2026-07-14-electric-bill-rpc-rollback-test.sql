-- Electric Billing Redesign · Phase B · REQUIRED rollback test for Decision 4.
-- Run in the Supabase SQL editor AFTER 2026-07-14-electric-bill-rpc.sql is applied.
-- This is the whole point of Phase B: prove a mid-write failure leaves NOTHING behind.
--
-- How it works: call create_electric_bill() with a REAL folio (so the charge insert
-- succeeds) but a BOGUS guest_id (a random uuid not in guests). The charge inserts,
-- then the reading insert violates electric_readings.guest_id's FK and raises — which
-- must roll the charge back too. We then count charge rows carrying our unique
-- sentinel description; PASS requires exactly ZERO.
--
-- Net effect on the DB: none. The only write attempted (the charge) is rolled back;
-- the sentinel description makes any leak identifiable and harmless. Safe to run live.

DO $$
DECLARE
  v_folio       uuid;
  v_bad_guest   uuid := gen_random_uuid();                               -- not in guests → FK violation
  v_desc        text := 'ROLLBACK-TEST electric ' || gen_random_uuid()::text;  -- unique sentinel
  v_charge_rows int;
  v_raised      boolean := false;
BEGIN
  SELECT id INTO v_folio FROM folios LIMIT 1;
  IF v_folio IS NULL THEN RAISE EXCEPTION 'No folio available to test against.'; END IF;

  -- Attempt the atomic write; the reading insert should raise on the bad guest_id.
  -- The inner block's exception handler establishes the rollback boundary (savepoint),
  -- so on failure the charge insert done inside the function is undone.
  BEGIN
    PERFORM create_electric_bill(
      v_folio,            -- p_folio_id (valid → charge insert succeeds)
      v_bad_guest,        -- p_guest_id (INVALID → reading insert fails)
      'Rollback Test 2026',
      DATE '2026-01-01',  -- p_period_start
      DATE '2026-02-01',  -- p_period_end
      v_desc,             -- p_description (sentinel)
      1234,               -- p_amount_cents
      0, 0, 0, 0.27,      -- previous, current, kwh, rate
      1500, 1234, 1234    -- minimum_charge, calculated_amount, final_amount
    );
  EXCEPTION WHEN others THEN
    v_raised := true;
    RAISE NOTICE 'Function raised as expected: %', SQLERRM;
  END;

  SELECT count(*) INTO v_charge_rows FROM folio_line_items WHERE description = v_desc;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED: function did not raise (expected a reading FK violation).';
  END IF;
  IF v_charge_rows <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: % orphan charge row(s) survived — the write is NOT atomic.', v_charge_rows;
  END IF;

  RAISE NOTICE 'ROLLBACK TEST PASSED: reading insert failed and 0 charge rows remain (atomic).';
END $$;
