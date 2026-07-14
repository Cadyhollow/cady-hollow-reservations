-- Electric Billing Redesign · Phase A · BACKFILL — billing_month → period_start/end.
-- Cady ONLY (Supabase project dmqyuujhdflfydfhigvn). Run once in the Supabase SQL
-- editor, AFTER 2026-07-14-electric-period-columns.sql. DO NOT RUN until reviewed.
--
-- Convention: timestamped backup · abort-on-mismatch · exact-once · verify.
-- The whole thing is one DO block = one transaction: if any check RAISEs, EVERYTHING
-- rolls back (including the backup) and electric_readings is untouched.
--
-- Mapping: "July 2026" → period_start 2026-07-01, period_end 2026-08-01 (HALF-OPEN:
-- end is the 1st of the NEXT month, the boundary that belongs to the next cycle).
-- Feasibility pass confirmed all 102 live rows match '^[A-Z][a-z]+ [0-9]{4}$'
-- (values May–Nov 2026), so this is expected to touch every row cleanly.
--
-- Exact-once is enforced two ways: (1) the backup table name is fixed and the block
-- refuses to run if it already exists; (2) the UPDATE only touches rows where
-- period_start IS NULL, so a re-run after a partial success is a no-op.

DO $$
DECLARE
  backup_name text := 'electric_readings_backup_20260714';
  bad_count   int;
  filled      int;
BEGIN
  -- 1) Timestamped backup. Refuse to overwrite a prior backup (exact-once guard).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = backup_name) THEN
    RAISE EXCEPTION 'Backup table % already exists — this backfill appears to have run. Review/rename before re-running.', backup_name;
  END IF;
  EXECUTE format('CREATE TABLE %I AS TABLE electric_readings', backup_name);

  -- 2) Abort-on-mismatch: every not-yet-filled row must be "Month YYYY". If even one
  --    is not, RAISE — rolls back the whole transaction, zero rows changed.
  SELECT count(*) INTO bad_count
  FROM electric_readings
  WHERE period_start IS NULL
    AND billing_month !~ '^[A-Z][a-z]+ [0-9]{4}$';
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Aborting backfill: % row(s) have a billing_month not matching "Month YYYY". Nothing changed.', bad_count;
  END IF;

  -- 3) Exact-once backfill: only rows not already filled.
  UPDATE electric_readings
  SET period_start = to_date(billing_month, 'FMMonth YYYY'),
      period_end   = (to_date(billing_month, 'FMMonth YYYY') + interval '1 month')::date
  WHERE period_start IS NULL
    AND billing_month ~ '^[A-Z][a-z]+ [0-9]{4}$';
  GET DIAGNOSTICS filled = ROW_COUNT;

  -- 4) Verify: no parseable row left unfilled.
  SELECT count(*) INTO bad_count
  FROM electric_readings
  WHERE period_start IS NULL
    AND billing_month ~ '^[A-Z][a-z]+ [0-9]{4}$';
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Post-check failed: % parseable row(s) still unfilled. Rolling back.', bad_count;
  END IF;

  RAISE NOTICE 'Backfill complete: % row(s) filled. Pre-image backed up to %.', filled, backup_name;
END $$;

-- Optional post-run spot check (read-only), run separately after the block commits:
--   SELECT billing_month, period_start, period_end, count(*)
--   FROM electric_readings GROUP BY 1,2,3 ORDER BY period_start;
