@AGENTS.md

# CLAUDE.md — cady-hollow-reservations  ⚠️ LIVE PRODUCTION

*Loaded automatically each Code session. Read first — this repo is different from the others. Full picture: `resonation-ops/OPS.md`.*

## What this repo is
The **live, revenue-generating** park: book.cadyhollow.com, real guests, real money, ~120 reservations, a working Square terminal. It is a **separate repo on the env-token model** (predates the OAuth/resolver template). `main` **auto-deploys straight to paying guests with no gate.** Treat everything here as production surgery.

## ⚠️ Two landmines — know these cold
1. **`.env.local` points at the LIVE production database** with a working service key. Tests run against production. **Never run a test that writes** (insert/update/delete, including settings mutations like `withSeason()`/`withGates()`). Safe tests read fixtures and invalidate `SQUARE_ACCESS_TOKEN` so acceptances die at Square before any insert. *(This should be fixed by separating test creds from prod — until then, treat it as armed.)*
2. **Cady lacks features the template has** (e.g. Square self-serve → no `square_connections` table). **Never wholesale-copy a file from the template** — you'd import code that selects a missing column and take all bookings offline. **Cherry-pick** the specific functions, and **grep the diff** to prove nothing extra rode along. *(The booking horizon used to be this example and no longer is — it was ported 2026-08-18, column first, code second. That ordering is the rule the example was teaching.)*

## Never touch
- Fee model (`booking-quote.ts`, `pricing.ts`, `ledger.ts`) — Cady's fee model differs; empty diff required.
- The env-token Square path, terminal, folios, refunds — off the path of any date-constraint work.

## Gates — everything meaningful here is Tier 3 (Charissa only)
Merging to `main` = deploying to paying guests → **always Charissa, deliberately, off-peak, with a verify-after.** Any DB write, any deletion, any real-money/hardware test → Charissa. Build on a branch, prove read-only, stop for review.

## On every session
Confirm `pwd` + `git remote -v` + branch. Branch off `main`; never commit or merge to `main`. Assume any action could affect a real guest's booking until proven otherwise.

---

## Code: the paths (filled 2026-08-18)

### Landmine 1, concretely
- `.env.local` → `NEXT_PUBLIC_SUPABASE_URL=https://dmqyuujhdflfydfhigvn.supabase.co`. **That is the live park** (and the project that also hosts the `resonation_clients` registry). Verified 2026-08-18.
- There is **no `test` script in `package.json`** here — only `dev`, `build`, `start`, `lint`. Tests are run explicitly, e.g. `node --test --test-timeout=180000 lib/payment-route.test.ts`. So a test run is never accidental; it is always something you typed. Type it knowing where it points.
- Test files on `main`: `lib/api-auth.test.ts`, `lib/bookability.test.ts`, `lib/booking-quote.test.ts`, `lib/cancellation-policy.test.ts`, `lib/electric-periods.test.ts`, `lib/payment-route.test.ts`, `lib/refundable.test.ts`, `lib/square-env.test.ts`, `lib/supabase-cookie.test.ts`.
- `lib/payment-route.test.ts` documents its own safety contract in its header (invalid `SQUARE_ACCESS_TOKEN`; a gated booking returns before the insert, an accepted one dies at Square before the insert). Read that header before running it, and re-read it after any edit — the safety is in the setup, not in the test names.
- The template's hermetic helpers `withGates()` / `withSeason()` **write to `settings`**. They do not exist in this repo. Do not port them here while `.env.local` points at prod.

### Season / bookability logic — Cady's own, NOT the template's
- **`lib/bookability.ts`** — Cady's version. Exports `checkBookability()` (the composition chokepoint), `checkSeason()`, `monthDayToISO()`, `nightsBetween()`, `fetchDateFacts()`, `checkDateFacts()`, `ruleAppliesToSite()`, `resolveMinNights()`.
- **`checkSeason()` is arrival-only.** The template's whole-stay `checkSeasonSpan()` is **not on `main` here** — that is the open closed-season hole, and it is exactly what the unmerged branch `closed-season-port` (commit `c98ec02`, "Closed season, step A: check the WHOLE STAY on the public path") addresses. Step B (staff override) is deferred; it needs a Cady-schema test tenant.
- **`lib/season.ts` is a different thing entirely** — `currentSeasonYear()`, for seasonal contracts. Don't confuse it with closed-season enforcement.
- Tests: `lib/bookability.test.ts` (pure), `lib/payment-route.test.ts` (route-level).

### The two reservation-insert routes
- `app/api/payment/route.ts` — public/guest. Imports `checkBookability, nightsBetween, ruleAppliesToSite` from `@/lib/bookability`, plus `computeBookingQuote/checkDiscount/resolveNightlyRate`, `cardSurchargeFor`, `sendConfirmationEmails`, and `SQUARE_API_BASE` from `@/lib/square-env`.
- `app/api/manual-booking/route.ts` — staff. Gated by `await requireRole(request, 'staff')` and **that is its only gate**: it does **not** call `checkBookability`, `checkSeason`, or any horizon check. Staff can book any date today. Know this before assuming a public-path fix covers the park.
- `app/api/availability/route.ts` — Cady **does** have this. It does **not** call `checkBookability`; it composes the pieces itself (`checkSeasonSpan, checkHorizon, fetchDateFacts, checkDateFacts, resolveMinNights, ruleAppliesToSite, DEFAULT_CLOSED_MESSAGE`), so **every new date rule has to be wired here a second time** or search and create drift. It feeds the calendar, so a season/date change that skips it makes the calendar disagree with the booking gate.
- Other routes that write `reservations`: `app/api/admin-card-payment/route.ts`, `app/api/receipt/route.ts`, `app/api/reservation-cancel/route.ts`, `app/api/send-waiver/route.ts`, `app/api/sign/[token]/route.ts`, `app/api/sync-guests/route.ts`. A date-constraint change touches the first two insert paths; the rest are listed so a "which routes write bookings" question doesn't get re-derived under pressure.

### Settings save
- `app/admin/settings/page.tsx` → `handleSave()` (~line 430); client-side Supabase write (`from('settings').update(payload).eq('id', settingsId)` / `.insert(payload)`). Guarded by RLS only. Same shape as the template but **different line numbers and a different column set** — never diff-copy the file.

### Fee model — empty diff required
`lib/booking-quote.ts`, `lib/pricing.ts`, `lib/ledger.ts`. Guard test: `lib/booking-quote.test.ts`. Cady's arithmetic differs from the template's; a "sync from template" here is a money bug.

### What Cady does and does NOT have (verified against `origin/main`, 2026-08-18)
**Does not have — do not reference these or any column they read:**
- Horizon/season **staff overrides**: no `allowBeyondHorizon`, no `useHorizonOverride`/`HorizonOverrideNotice`, no `SeasonOverride`. Deliberate, not missing — Cady's staff path (`/api/manual-booking`) applies no date rules at all, so staff can already book any date and there is nothing to override.
- Square self-serve: no `square_connections`, no `lib/square-credentials.ts`, no `getSquareCredentials`, no `lib/square-oauth.ts`.
- Terminal poll-recording: no `settleTerminalCheckout`.
- Square OAuth routes: no `app/api/square/*` (the template's OAuth/connect endpoints).

**Has (ported from the template — public path only):**
- Booking horizon: `max_advance_days` on `settings` (**NULL on the live park = no limit**), `checkHorizon`/`resolveMaxAdvanceDays`/`horizonLastArrival`/`HORIZON_SERVER_SLACK_DAYS` in `lib/bookability.ts`, wired into `checkBookability`, `/api/availability`, the `HomeClient` arrival picker, the `/book` interstitial, and the Settings "Booking Window" field. Arrival-only; the server allows 1 day of slack, the client none.
- Whole-stay season: `checkSeasonSpan`, `isNightInSeason`, hardened `parseMonthDay`, `seasonLastNight`, `monthDayLabel` — all in `lib/bookability.ts`.

**Has, and the template does not — so template code will not know about these:**
`lib/season.ts`, `lib/contracts.ts` + `lib/contract-server.ts`, `lib/electric-periods.ts`, `lib/tax-applications.ts`, `lib/applies-to.ts`, `lib/statement-html.ts`, `lib/supabase-cookie.ts`, `lib/supabase.ts`; routes `app/api/seasonal-contracts`, `app/api/seasonals`, `app/api/guest-notes`, `app/api/packet`; a top-level `components/` directory, `docs/`, and a root `database-setup.sql`.

**Square, here:** env-token only — `lib/square-env.ts` (`SQUARE_API_BASE`), `lib/square-terminal.ts`, and `process.env.SQUARE_ACCESS_TOKEN` read directly.

**Auth, here:** `middleware.ts` (the template has renamed this to `proxy.ts` for Next 16 — **do not port the rename**, it is a separate change with its own risk), `lib/admin-auth.ts`, `lib/require-role.ts`, `lib/roles.ts`, `lib/supabase-cookie.ts`. `requireAdmin` is async — await it.

### Schema
- `db/migrations/` — dated `.sql` files, most recent `2026-08-11-pr5b1-authenticated-role-policies.sql`. Also a root `database-setup.sql` (historical; the canonical schema for the *fleet* lives in `resonation-admin`, not here — Cady predates it and is not provisioned from it).
- Any migration here runs against the live park. Tier 3, always, with a backup.

### Working tree caveat
This checkout is frequently parked on the unmerged `closed-season-port` branch and carries an untracked `.claude/`. Run `git branch --show-current` before you touch anything, and branch off `origin/main`, not off whatever is checked out.

## Communicating with Charissa (read this — it matters)

Charissa is the product owner and decision-maker. She holds a doctorate in music and conducting, and has been learning software hands-on through this project since April 2026. She is highly intelligent and follows precise directions extremely well — but she is not a career developer, and code-specific jargon is not her native language. Communicate accordingly:

- **Plain English first.** Lead every report and message with what happened and what it means, in ordinary language. Put technical detail afterward or in a clearly-labeled section she can skip. Never make her decode a wall of terminal output to find the point.
- **Define terms the first time.** The first use of any acronym or code term in a message (API, PR, RLS, env var, migration, branch, CI, etc.) gets a few plain words of explanation. Don't assume; don't make her look it up.
- **Always give a recommendation.** When there's a choice, say what you'd do and why — not just a menu of options. She values and relies on that judgment.
- **Step-by-step for anything she does.** If she needs to test, click, paste, run, or check something, give numbered, literal steps: where to click, what to type, and what she should expect to see. Assume she'll follow them exactly, so they must be exact and complete.
- **Say why it matters in human terms.** Signal risk and importance with plain language ("this changes the live site real guests are booking on right now"), not by relying on jargon to carry the weight.

The goal is only ever to simplify the language, never the work. She handles complex, careful work well when it's explained clearly.
