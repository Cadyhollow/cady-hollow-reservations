-- The To-Do board, phases 1 and 2, ported to Cady Hollow.
--
-- ⚠ THIS RUNS AGAINST THE LIVE PARK (dmqyuujhdflfydfhigvn). Read the additivity section before
-- running it, and take a backup first — that is this repo's standing rule for any migration.
--
-- WHAT IT ADDS: a shared To-Do board for staff (phase 1), plus the two kinds of reminder the
-- system raises by itself (phase 2) — recurring chores, and check-in prep tasks pulled from
-- upcoming arrivals. Ported from campground-reservation-template PRs #40 and #41, where it was
-- built and proven on the Test Sandbox.
--
-- ── ADDITIVE ONLY. THIS IS THE PROPERTY THAT MATTERS ─────────────────────────────────────────
--
-- Every statement below is CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE INDEX IF
-- NOT EXISTS, or a policy/grant on one of the two NEW tables. There is:
--
--   * no ALTER of an existing column's type, default or nullability
--   * no UPDATE, INSERT or DELETE of any existing row
--   * no DROP of anything
--   * no change to any policy or grant on an existing table
--
-- The two columns added to existing tables (`sites.needs_prep`, `settings.checkin_prep_*`) are
-- nullable with defaults, so adding them rewrites nothing: Postgres 11+ stores the default in the
-- catalogue rather than rewriting the heap. `settings` has 1 row, `sites` 40, `reservations` 131 —
-- and all three counts must be IDENTICAL after this runs. That check is the acceptance test.
--
-- Grants and policies on EXISTING tables are untouched, so nothing about who can read a booking,
-- take a payment or edit a rate changes by one bit.
--
-- ── DORMANT ON ARRIVAL ───────────────────────────────────────────────────────────────────────
--
-- Applied on its own, nobody sees anything different:
--   * `tasks` and `task_rules` are created EMPTY — an empty board.
--   * `checkin_prep_enabled` defaults FALSE, so no check-in task is ever raised until an owner
--     switches it on deliberately.
--   * `sites.needs_prep` defaults FALSE on all 40 sites, so even with the master switch on,
--     nothing is raised until the park says which sites it means.
--
-- ── ⚠ THE TWO UNIQUE INDEXES ARE THE WHOLE SAFETY PROPERTY ───────────────────────────────────
--
-- The reminder generator runs on every dashboard load and inserts with ON CONFLICT DO NOTHING;
-- these indexes are what that clause resolves against. Without them the generator does not merely
-- lose its guarantee — it has no conflict target at all and every insert ERRORS.
--
-- THEY ARE DELIBERATELY NOT PARTIAL (`... WHERE rule_id IS NOT NULL`), which is the obvious
-- spelling and the one most likely to be "corrected" later. PostgREST — how the app reaches this
-- database — emits ON CONFLICT (col, col) with no index predicate, and Postgres will NOT infer a
-- partial index from that. Measured on the sandbox before this was written:
--
--     ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- The failure hides, because the row count after a failed insert looks identical to the row count
-- after a successful dedup. A plain unique index constrains exactly the same rows here, since
-- Postgres treats NULLs as distinct: any number of manual tasks (rule_id NULL) coexist.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────
--
-- Both tables follow THIS repo's existing operational posture, verified against `guests`,
-- `blocked_dates` and `folio_line_items` before it was written: select/insert/update = staff+,
-- with matching permissive AND restrictive halves.
--
-- ⚠ THE PERMISSIVE AND RESTRICTIVE HALVES ARE NOT DUPLICATES. The permissive half GRANTS access;
-- drop it and the board goes blank, loudly. The restrictive half ENFORCES the role; drop it and
-- NOTHING BREAKS and the ladder quietly stops biting. Same warning as PR 5b-1 in this repo.
--
-- `tasks` gets NO DELETE (removal is an UPDATE setting removed_at, so the record of who was asked
-- to do what survives). `task_rules` DOES get DELETE — a recurring rule is a setting a park may
-- withdraw, not a record of work, and deleting one leaves its past instances on the board via
-- ON DELETE SET NULL.
--
-- The check-in prep switches and the per-site needs_prep flag live on `settings` and `sites`,
-- which are OWNER-only for UPDATE on this park (verified). That is inherited, not invented here —
-- the app greys those controls out for non-owners to match.
--
-- ── NOTE FOR WHOEVER TOUCHES THE SETTINGS SCREEN ─────────────────────────────────────────────
--
-- `checkin_prep_enabled` / `checkin_prep_lead_days` are deliberately NOT added to
-- app/admin/settings/page.tsx. That page sends ONE payload containing every settings column, so a
-- column missing on a tenant fails the ENTIRE settings save — it would stop an owner editing a
-- rate. They are written from the To-Do board's "Manage reminders" view, which writes only these
-- two columns and only after detecting that they exist.
--
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS throughout.


-- ============================================================
-- 1. tasks — the shared checklist
-- ============================================================
-- `priority` ALLOWS NULL on purpose: NULL means nobody set one, which is what most tasks will be.
-- A NOT NULL DEFAULT would prioritise every task nobody prioritised.
--
-- `removed_at` IS A SOFT DELETE. The board's "×" sets it; the row stays, and every read filters
-- `removed_at IS NULL`. It is also why this table gets no DELETE policy and no DELETE grant.
--
-- `source` distinguishes a typed task from a generated one. All three values exist from the
-- start so phase 2 adds rows rather than semantics.
--
-- The phase-2 columns (rule_id, reservation_id, occurrence_date) are all NULL on a manual task.
CREATE TABLE IF NOT EXISTS public.tasks (
  id              uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  title           text NOT NULL,
  notes           text,
  priority        text CHECK (priority IN ('high', 'medium', 'low')),
  assigned_to     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_at          timestamptz,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now() NOT NULL,
  completed_at    timestamptz,
  completed_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  removed_at      timestamptz,
  source          text DEFAULT 'manual' NOT NULL CHECK (source IN ('manual', 'auto_checkin', 'recurring')),
  rule_id         uuid,   -- FK added after task_rules exists, below
  reservation_id  uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  occurrence_date date
);


-- ============================================================
-- 2. task_rules — the recurring SCHEDULES
-- ============================================================
-- Not a task and never on the board: it is the thing that MANUFACTURES tasks.
--
-- `at_time` is a bare `time`, not a timestamptz, on purpose: a park means "ten in the morning,
-- here", which is a wall-clock time and not an instant.
--
-- `last_generated_on` is a WATERMARK, not a schedule — the last local date this rule was brought
-- up to, so a rule created in March does not retroactively manufacture five months of missed
-- chores the first time somebody opens the dashboard.
--
-- Pause is `active = false`: a paused rule generates nothing, and the instances it already made
-- stay on the board, because they are real work somebody may still owe.
CREATE TABLE IF NOT EXISTS public.task_rules (
  id                 uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  title              text NOT NULL,
  notes              text,
  priority           text CHECK (priority IN ('high', 'medium', 'low')),
  assigned_to        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  freq               text NOT NULL CHECK (freq IN ('daily', 'weekly', 'monthly')),
  -- 0-6, Sunday..Saturday, matching JavaScript's Date.getDay() so the board's day picker and the
  -- generator cannot disagree about which end of the week is 0.
  byweekday          int[],
  bymonthday         int CHECK (bymonthday BETWEEN 1 AND 31),
  at_time            time NOT NULL,
  active             boolean DEFAULT true NOT NULL,
  created_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz DEFAULT now() NOT NULL,
  last_generated_on  date
);

-- tasks.rule_id -> task_rules(id), added here because the two tables reference each other's
-- order of creation. ON DELETE SET NULL: deleting a rule leaves the work people already did.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_rule_id_fkey'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_rule_id_fkey
      FOREIGN KEY (rule_id) REFERENCES public.task_rules(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ============================================================
-- 3. Indexes — read the long note at the top before changing the two unique ones
-- ============================================================
-- The board's only query is "everything not removed". Partial, so it stays cheap as completed
-- history accumulates.
CREATE INDEX IF NOT EXISTS tasks_board_idx
  ON public.tasks (created_at DESC)
  WHERE removed_at IS NULL;

-- One instance per rule per date.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_rule_occurrence_uniq
  ON public.tasks (rule_id, occurrence_date);

-- One check-in prep task per reservation, ever — including after it has been ticked off or
-- dismissed, which is exactly what stops a dismissed prep task coming straight back.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_reservation_uniq
  ON public.tasks (reservation_id);


-- ============================================================
-- 4. Config — two settings columns and one per-site flag
-- ============================================================
-- Both default to the dormant value. lead_days 1 = "the day before".
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS checkin_prep_enabled   boolean DEFAULT false;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS checkin_prep_lead_days integer DEFAULT 1;

-- FALSE on all 40 sites deliberately: a park that switches check-in prep on should get nothing
-- until it says which sites it means, rather than 40 prep tasks a day.
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS needs_prep boolean DEFAULT false;


-- ============================================================
-- 5. RLS — matching this repo's existing operational tables
-- ============================================================
ALTER TABLE public.tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_rules ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- PERMISSIVE — what each role MAY do
-- ------------------------------------------------------------
-- tasks: select=staff insert=staff update=staff delete=nobody
DROP POLICY IF EXISTS "authenticated select tasks" ON public.tasks;
CREATE POLICY "authenticated select tasks" ON public.tasks
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert tasks" ON public.tasks;
CREATE POLICY "authenticated insert tasks" ON public.tasks
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update tasks" ON public.tasks;
CREATE POLICY "authenticated update tasks" ON public.tasks
  FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
-- no DELETE policy: denied to authenticated by absence. Removal is an UPDATE to removed_at.

-- task_rules: select=staff insert=staff update=staff delete=STAFF (see the note at the top)
DROP POLICY IF EXISTS "authenticated select task_rules" ON public.task_rules;
CREATE POLICY "authenticated select task_rules" ON public.task_rules
  FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated insert task_rules" ON public.task_rules;
CREATE POLICY "authenticated insert task_rules" ON public.task_rules
  FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated update task_rules" ON public.task_rules;
CREATE POLICY "authenticated update task_rules" ON public.task_rules
  FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "authenticated delete task_rules" ON public.task_rules;
CREATE POLICY "authenticated delete task_rules" ON public.task_rules
  FOR DELETE TO authenticated USING ((select app.at_least('staff')));

-- ------------------------------------------------------------
-- RESTRICTIVE — what makes the set above BITE. NOT duplicates; see the warning at the top.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "role gate select tasks" ON public.tasks;
CREATE POLICY "role gate select tasks" ON public.tasks
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert tasks" ON public.tasks;
CREATE POLICY "role gate insert tasks" ON public.tasks
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update tasks" ON public.tasks;
CREATE POLICY "role gate update tasks" ON public.tasks
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));

DROP POLICY IF EXISTS "role gate select task_rules" ON public.task_rules;
CREATE POLICY "role gate select task_rules" ON public.task_rules
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate insert task_rules" ON public.task_rules;
CREATE POLICY "role gate insert task_rules" ON public.task_rules
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate update task_rules" ON public.task_rules;
CREATE POLICY "role gate update task_rules" ON public.task_rules
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((select app.at_least('staff'))) WITH CHECK ((select app.at_least('staff')));
DROP POLICY IF EXISTS "role gate delete task_rules" ON public.task_rules;
CREATE POLICY "role gate delete task_rules" ON public.task_rules
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((select app.at_least('staff')));


-- ============================================================
-- 6. GRANTS — on the two NEW tables only
-- ============================================================
-- Grants and policies are independent gates: a policy is only consulted if the role already holds
-- the table privilege. Stated positively so DELETE on `tasks` is absent by construction, then
-- revoked by name as well — the second lock on the never-delete door.
GRANT SELECT, INSERT, UPDATE ON public.tasks TO authenticated;
REVOKE DELETE ON public.tasks FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_rules TO authenticated;

-- anon reaches nothing. This park currently hands anon zero table privileges (PR 6) and its
-- default privileges for `postgres`-owned tables already exclude anon — but a table created by a
-- different owner would not inherit that, and a grant nobody looked at is exactly the failure
-- worth pre-empting. Explicit, so this file is correct on its own.
REVOKE ALL ON public.tasks      FROM anon;
REVOKE ALL ON public.tasks      FROM PUBLIC;
REVOKE ALL ON public.task_rules FROM anon;
REVOKE ALL ON public.task_rules FROM PUBLIC;
