-- ============================================================================
-- Security lockdown PR 5a — the profiles table (auth foundation)
-- Cady only (project dmqyuujhdflfydfhigvn). Template + onboarding propagation is PR 7.
--
-- One row per admin user, keyed to auth.users. This is the table 5b's role
-- enforcement reads; NOTHING reads it in 5a. Creating it here keeps the schema
-- change separate from the enforcement change, so 5b's review is about policy
-- logic rather than about whether a column exists.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   • No user_role() / at_least() helper functions — those are 5b, where the
--     policies that call them land in the same migration and can be reviewed
--     together. A helper with no callers is a thing to misread later.
--   • No role-scoped policies on any OTHER table. Adding them now would change
--     what an authenticated user can reach while 5a is still authentication-only.
--   • No enforcement of any kind. A role stored here grants and denies nothing
--     until 5b.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  full_name   text,
  -- Owner > Manager > Staff. CHECK rather than an enum: adding a tier to an enum
  -- needs ALTER TYPE, which does not run inside a transaction on older Postgres,
  -- while widening a CHECK is a plain ALTER TABLE.
  role        text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff')),
  -- Deactivation rather than deletion: folio and booking history should keep
  -- pointing at a real person. 5c's account screen sets this.
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- GRANTS — the part that is easy to miss and expensive to miss.
--
-- This project's default privileges grant arwdDxtm (ALL) to anon AND authenticated
-- on every newly created table in public:
--
--   select defaclacl from pg_default_acl d
--     join pg_namespace n on n.oid = d.defaclnamespace
--    where n.nspname = 'public';
--   -> {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,...}
--
-- So CREATE TABLE alone would have handed anon full read AND write on a table of
-- staff email addresses and roles — writable meaning any visitor could promote
-- themselves to owner the moment 5b starts reading this column. RLS would not
-- save it either: the permissive policies PR 6 has yet to drop are on other
-- tables, but a future "allow all" pasted onto this one would combine with the
-- grant. Revoke explicitly, and do not rely on the absence of a policy.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.profiles FROM PUBLIC;

-- authenticated gets SELECT only. Writes go through service-role code paths (the
-- seed script now, 5c's owner-gated account routes later), never from a browser
-- session — otherwise a user could UPDATE their own role column to 'owner'.
--
-- REVOKE FIRST, and specifically FROM authenticated. `REVOKE ... FROM PUBLIC`
-- above does NOT remove a grant held by a named role, and the default privilege
-- shown in the comment above grants authenticated arwdDxtm by name. Verified: on
-- the first pass this migration ran without the line below, and afterwards
--
--   has_table_privilege('authenticated','public.profiles','UPDATE')  -> true
--
-- RLS still denied the write (no UPDATE policy exists), so it was not reachable
-- — but the grant sat there waiting for the first permissive policy anyone ever
-- pastes onto this table. Grants and policies are independent gates; close both.
REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;

-- ----------------------------------------------------------------------------
-- The one policy: a signed-in user may read their OWN row.
--
-- This is not role enforcement. It is what lets the app answer "who am I", and
-- it is scoped to a single row so one staff member cannot enumerate the others'
-- email addresses. Owner-facing listing of ALL users is 5c, server-side, over
-- service-role — not by widening this.
--
-- No INSERT/UPDATE/DELETE policy exists on purpose: with RLS on and no policy,
-- those are denied to authenticated even though service_role (which bypasses
-- RLS) can still do them.
-- ----------------------------------------------------------------------------
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

COMMIT;


-- ============================================================================
-- VERIFY (read-only, after applying)
-- ============================================================================
-- select relrowsecurity from pg_class where relname = 'profiles';
--                                                      -- expect: t
--
-- select has_table_privilege('anon','public.profiles','SELECT') as anon_select,
--        has_table_privilege('anon','public.profiles','UPDATE') as anon_update,
--        has_table_privilege('authenticated','public.profiles','SELECT') as auth_select,
--        has_table_privilege('authenticated','public.profiles','UPDATE') as auth_update;
--                                                      -- expect: f, f, t, f
--
-- select policyname, cmd, roles::text from pg_policies
--  where tablename = 'profiles';
--                                                      -- expect: exactly one SELECT policy
--
-- select id, email, role, active from public.profiles;
--                                                      -- expect: the seeded owner, after
--                                                      --         scripts/seed-owner.mjs runs
-- ============================================================================
