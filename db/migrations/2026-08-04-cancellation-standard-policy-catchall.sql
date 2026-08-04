-- Cady's standard cancellation policy, as an explicit rule — Cady ONLY (Supabase project
-- dmqyuujhdflfydfhigvn). Run once in the Supabase SQL editor. Safe to re-run.
--
-- WHY
-- 90% refund / 7-day deadline is Cady's business rule, but it lived as a hardcoded constant
-- in lib/cancellation-policy.ts and as a column DEFAULT — so the template shipped Cady's
-- cancellation fee to every future client, who would silently retain 10% of a camper's money
-- under a policy nobody at that park had chosen. Those constants become neutral (100% refund,
-- 0-day deadline: full refund up to arrival), and Cady's own policy moves here, into data
-- Cady owns.
--
-- Cady has three holiday rules and NO catch-all, so today every non-holiday booking resolves
-- to the code fallback. This rule makes that fallback explicit and leaves Cady's behaviour
-- byte-for-byte unchanged: same 90%, same 7 days, same deposit treatment, same wording.
--
-- ORDERING — THIS MIGRATION MUST BE APPLIED BEFORE THE CODE CHANGE DEPLOYS.
-- Between the constants becoming 100/0 and this rule existing, every non-holiday booking at
-- Cady would resolve to a 100% refund. Rule first, deploy second. Reversing the order is the
-- only real risk in this piece of work.
--
-- HOW A CATCH-ALL IS EXPRESSED
-- cancellation_rules has no "applies always" flag and start_date/end_date are NOT NULL, so a
-- catch-all is a date range wide enough to contain every plausible arrival. This is not a
-- hack the resolver has to know about: resolveCancellationPolicy() orders matching rules by
-- start_date DESC and takes the first, so a range starting in 1900 sorts below every real
-- rule and loses to any of them. Specific beats general, with no extra ranking logic.
-- The sentinel dates are shared as CATCH_ALL_START / CATCH_ALL_END in
-- lib/cancellation-policy.ts, and the admin editor writes and renders exactly this range.
--
-- policy_text is pulled from settings.cancellation_policy rather than retyped, so the wording
-- campers see after this lands is character-identical to what they see today. (Verified: the
-- settings table holds exactly one row.)

INSERT INTO cancellation_rules (
  name, start_date, end_date,
  refund_percent, cancellation_deadline_days, deposit_refundable,
  policy_text, is_active
)
SELECT
  'Standard Policy',
  '1900-01-01',              -- CATCH_ALL_START
  '2999-12-31',              -- CATCH_ALL_END
  90,                        -- Cady's existing refund percentage
  7,                         -- Cady's existing cancellation deadline, in days
  true,                      -- Cady's existing deposit treatment
  -- Driven off a scalar subquery, NOT "FROM settings": with a FROM the whole INSERT would
  -- select zero rows and silently do nothing if settings were ever empty, which is the one
  -- way this migration could appear to succeed while leaving Cady on the neutral default.
  COALESCE(NULLIF(TRIM((SELECT cancellation_policy FROM settings LIMIT 1)), ''),
           'Cancellations made 7 or more days before arrival will receive a 90% refund. '
           'Cancellations made less than 7 days before arrival are non-refundable. '
           'A 10% booking fee is retained on all cancellations.'),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM cancellation_rules
  WHERE start_date = '1900-01-01' AND end_date = '2999-12-31'
);


-- ── Column defaults, brought in line with the code ──────────────────────────────────────
-- Deliberately AFTER the insert above: that insert names every column explicitly, so it is
-- unaffected either way, but ordering it this way means Cady's standard policy exists as data
-- before anything about the old default is disturbed.
--
-- Without this, Cady's live schema would keep DEFAULT 90 / DEFAULT 7 while database-setup.sql
-- and lib/cancellation-policy.ts say 100 / 0 — a park whose documented schema disagrees with
-- its real one. The drift is close to inert today (the admin editor always writes both columns
-- explicitly, so the default is rarely reached) but it is exactly the kind of quiet
-- disagreement that makes a later reader trust the wrong file.
--
-- Existing rows are NOT touched by a DEFAULT change: Cady's three holiday rules and the
-- Standard Policy inserted above keep the values they were written with. This only governs a
-- future INSERT that omits these columns.
ALTER TABLE cancellation_rules
  ALTER COLUMN refund_percent SET DEFAULT 100,
  ALTER COLUMN cancellation_deadline_days SET DEFAULT 0;


-- Verification (expect: holiday dates → the holiday rule at 90/30;
--               every other date → 'Standard Policy' at 90/7)
--
--   WITH probes(arrival) AS (VALUES
--     ('2026-05-22'::date), ('2026-07-04'::date), ('2026-09-05'::date),
--     ('2026-06-15'::date), ('2026-08-20'::date), ('2027-07-04'::date))
--   SELECT p.arrival,
--          (SELECT r.name FROM cancellation_rules r
--            WHERE r.is_active AND r.start_date <= p.arrival AND r.end_date >= p.arrival
--            ORDER BY r.start_date DESC LIMIT 1) AS resolved_rule
--   FROM probes p ORDER BY p.arrival;
