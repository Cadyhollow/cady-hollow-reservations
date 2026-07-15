# Electric Billing Redesign — Design Spec

**Repo:** cady-hollow-reservations (develop on Cady → validate → propagate to template + Lakeshore later)
**Status:** Design locked. **Phases A + B shipped to production and verified (2026-07-14). Phase D in progress (2026-07-15) — C and D have been FLIPPED, see build order.** Build in phases, verify each before the next.

**Progress:**
- **Phase A — DONE, live, verified (2026-07-14).** `voided` added to `folio_line_items` + `electric_readings`; `period_start`/`period_end` (DATE) added to `electric_readings`; 102 readings backfilled to correct half-open periods (0 null, 0 integrity failures); `billing_month` retained in parallel. Pre-image backup at `electric_readings_backup_20260714` (102 rows) — **keep until Phase C is validated.** New: `lib/electric-periods.ts` (pure string/UTC period math) + `lib/electric-periods.test.ts` (18/18, incl. June→July 1 seam). `billGuard` + `prepareBill()` wired into `app/admin/electric-billing/page.tsx`. **Guard is dormant by design** until Phase E. Prod commit `fc3a4f6`.
- **Phase B — DONE, live, rollback-proven (2026-07-14).** `create_electric_bill(...)` RPC live (`SECURITY INVOKER`, granted anon/authenticated), writes charge + reading **atomically** in one plpgsql function with **no exception handler** (so an unhandled failure aborts the calling statement's transaction and rolls the charge back — this is what makes it atomic; do NOT wrap it in `BEGIN/EXCEPTION`). `sendBill` rewired to call it, with an **Option A scoped fallback**: falls back to the old two-insert path *only* on the specific "function does not exist" signal (`PGRST202`/`42883`/message match) — every other RPC error surfaces and aborts, no silent masking. Fallback is now dormant (function exists). New bills now carry `period_start`/`period_end`, closing the Phase A gap where the guard only saw backfilled history. **Rollback test PASSED on live:** forced FK failure on the reading left 0 orphan charges, 0 sentinel leftovers, table totals identical. Prod commit `1ae7ca2`.
  - *Carried forward:* the now-dead Option A fallback in `sendBill` can be removed in a tiny follow-up (optional; harmless as-is).
- **Phase D — IN PROGRESS (2026-07-15).** Running before C (see build order).

**Origin:** Wrong-month bills were being sent because the page defaulted to the current month while billing is usually for the previous month. Read-only investigation (Code, 2026-07-14) found the deeper problem: bills are dual-recorded and there is no safe correction path. This spec fixes prevention *and* correction.

**Source of truth (decided 2026-07-14):** When the system asks "has this period already been billed?", **the charge (money on the folio) is the authority — not the reading.** "A bill exists" means "there is a non-voided charge on the guest's folio for that period." The `electric_readings` row is supporting meter data; it must never claim a bill exists when no charge does. This resolves the orphan case (a reading whose charge was deleted is stale data, not a real bill) and drives the guard, the backfill reconciliation, and cleanup.

**Feasibility findings that changed this spec:**
- **`voided` does NOT exist on `folio_line_items` in the live DB.** It was assumed vestigial-but-present; it is absent. Existing code at `folio/[id]:413` filters `!i.voided`, which has been a **silent no-op all along** (`undefined` on every row → keeps everything). The column must be *added* (to both tables), and that phantom filter made real.
- **`voided` must go on `electric_readings` too**, not just the charge — the reading needs its own void signal so a voided reading can't linger as a future orphan.
- **Backfill is safe:** all 102 `billing_month` rows parse cleanly (format `^[A-Z][a-z]+ \d{4}$`, values May–Nov 2026). Note: `billing_month` carries no day, so all backfilled periods are whole calendar months — historical data will look perfectly month-aligned even though future bills may not be.
- **Test account (`bc338372…`, site C2, your own):** confirmed messy in exactly the useful way — **May 2026 billed twice** (2 readings + 2 line items, $29.97 and $56.70 → an exact-range duplicate; both correctly backfilled to the identical May range) and a **November orphan** (reading for $119.98 whose charge was hard-deleted → the wedge, in real data). This is the cleanup target for **Phase C**. *(Corrects an earlier note: these will NOT make the guard fire on ship — the guard is dormant until Phase E. See the Phase A build-order note.)*
- **Balance-summation sites: ~14, not 10.** The original feasibility pass undercounted and **mislabeled three sites as "payments-only"** that do sum `line_total`: `app/api/guests/balances/route.ts:49`, `app/api/seasonals/list/route.ts:47`, `app/admin/reservations/page.tsx:126`. Plus **2 revenue sums** (`reports.tsx:324` `monthlyRevenue`, `:311` `glLikeData`) — **in scope for Phase D** (decided 2026-07-15: a voided charge is not revenue). `lib/ledger.ts` (powers the emailed statement) is the critical one and has no void concept at all.
- **⚠️ Phase D is TWO coupled edits per site: fetch `voided`, then filter it.** A `.filter(notVoided)` is **silently inert** unless the select actually fetches the column. This is a **live latent bug today**: `reports.tsx` already filters `!i.voided` at `1204/1208/1220`, but its select (`:348`) omits `voided`, so those filters do nothing right now — the same class of bug that made `folio/[id]:413` inert before Phase A. The filter is the visible half; **the select is the half that's easy to forget and silently wrong.** A site is not "done" until both edits are in. Sites already using `select('*')` fetch `voided` for free and are safe; sites with explicit column lists or nested joins must have `voided` added (e.g. `folios/page.tsx:59` needs it added *inside the embedded select*).
- **Timezone seam:** `DATE` columns parse as UTC midnight via JS `new Date('2026-07-01')`. All boundary/overlap math must compare on date strings or in UTC — never via local-time `Date` — or risk an off-by-one exactly at the June→July 1 seam.
- **RLS/read path:** the page reads under the anon key, not the service role used for recon. The new period-overlap SELECT must run under that same anon/RLS context or it silently returns nothing and the guard never fires. Verify before trusting it.

---

## The core problem this fixes

A "bill" is **two records** written non-atomically:
- the **charge** — a `folio_line_items` row (the money, on the guest_account folio)
- the **reading** — an `electric_readings` row (meter reading + `billing_month`, linked back via `folio_line_item_id`)

Today's only correction is a hard-delete of the charge on the guest folio. That deletes the money half but **leaves the reading behind**, and it's the reading that gates future billing. Result: fixing a wrong bill silently wedges the real month later (the surviving reading makes the page think that month is already billed). This spec makes the two halves always move together.

**Known data note:** the checked-in schema file (`database-setup.sql`) is stale and does not match the live database — columns the code writes (`billing_month`, `kwh_used`, etc.) exist only in production, with no migration capturing them. Every schema change below must follow the established discipline: **deploy code before `ALTER TABLE`**, back up first, exact-once, verify, `npm run build` before commit, commit separately (never chain `build && commit`).

---

## Decision 1 — Flexible billing periods + a warn-don't-block guard

### Period model
- Every bill carries **`period_start`** and **`period_end`** (two `DATE` values — no time component, no timezone drift).
- Fully flexible: calendar months, June 10–July 10, multi-month, stub periods — all valid.
- **There are no bill "types."** A bill is a bill. Send as many bills as needed, for any reason (move-outs, re-reads, corrections). A move-out final bill is just a bill with different dates.
- The **email/statement title derives from the range**, e.g. `Electric Bill 6/10/26–7/10/26`.
- Periods are **half-open `[start, end)`**: the start date belongs to the period, the end date is the boundary that belongs to the *next* period. (This matches how meters are read — the morning reading that ends one cycle begins the next.)

### The guard (warns, never blocks)
Checked against **active (non-voided) bills**, where "a bill" is authoritatively a **non-voided charge on the folio** for that period (see Source of truth). The guard resolves period → charge; the reading is not the authority. Requires the `voided` column to exist (added in Phase A):
1. **Exact same range** as an existing active bill → **hard confirm** ("You already billed this identical period — send again?"). This is the fat-finger double-send.
2. **True positive-width overlap** with an existing active bill → **warning** ("This overlaps 6/25–6/30 of an existing bill — those days may be billed twice — continue?").
3. **Boundary touch** (one bill's end date equals another's start date) → **silent**. This is the normal consecutive-cycle case and must never warn.
4. **Fully separate ranges** → **silent**.

Overlap rule, precisely: two periods overlap only if one starts *strictly before* the other ends on both sides (positive-width shared span). A shared boundary date is **not** an overlap.

**Nothing is ever blocked.** The guard interrupts only the two patterns that are almost always mistakes; everything else flows.

### Migration gotcha
Adding `period_start`/`period_end` and any uniqueness/guard support requires backfilling from the existing `billing_month` text (`"July 2026"` → `2026-07-01`..`2026-07-31` or agreed convention). The **test account** has duplicate test bills through November — clear/void those before building any index that assumes uniqueness, or it won't build.

---

## Decision 2 — Void mechanism (un-wedges corrections)

A void treats the bill as **one unit** and handles both records together.

- **2a — Void, not delete.** Set a `voided` boolean to `true` on the `folio_line_items` charge, and the same on the linked `electric_readings` reading. Records are retained, not destroyed. **Note:** `voided` does not exist on either table in the live DB — it is *added* (Phase A), not activated. The existing `!i.voided` filter at `folio/[id]:413` is currently a silent no-op and must be made real once the column exists.
- **2b — Atomic, both halves.** Voiding the charge also voids its reading in **one transaction** (Supabase RPC) — fully succeeds or fully fails, never half. This is non-negotiable; it's the fix for the two records drifting apart.
- **2c — Audit trail.** Capture `voided_at`, `voided_by` (staff member), and a free-text `reason` ("wrong month," "misread meter," "duplicate").
- **2d — Customer never sees the void.** Voided bills **vanish** from customer-facing statements and customer-facing balances (clean slate — no "VOIDED" line). On the **admin side**, voided rows remain fully visible as the audit trail.

**Consequence for balance math:** balance is computed live everywhere as `Σ line_total − Σ (payment − surcharge)`. Every balance calculation and every customer statement must filter `WHERE voided = false`. This filter must be applied **consistently across all sites** (electric page, guest folio, ledger statement email). Centralize the void-filter idiom rather than inlining it in each file (same lesson as `planAtLeast()` centralization). If one spot forgets it, that customer's balance silently re-includes a voided charge.

**Void also un-wedges billing:** voided rows are invisible to the Decision 1 guard, so voiding a wrong bill frees you to re-bill that period. This is what fixes the wedged test account.

---

## Decision 3 — No adjustment/credit entry type (deliberately out of scope)

**Corrections are handled by void-and-rebill:** void the wrong bill (clean, both halves), then send a new correct bill for that period (guard ignores the voided row). This covers wrong-amount cases too — void the wrong amount, bill the right one.

**Credits are handled by the existing guest-folio credit mechanism.** If an electric customer needs money back or a goodwill credit, add a credit on their guest folio — same as any other credit. Electric billing does **not** get its own adjustment/credit-memo entry type.

> **Documented intent:** "How do I credit an electric customer?" → add a credit on their guest folio. This omission is intentional, not a gap. Do not "fix" it by building a duplicate correction path inside electric billing.

---

## Decision 4 — Atomic write for new bills

Creating a bill currently does two separate inserts (charge, then reading) that can drift apart if one fails — the root structural weakness. Fix: write both in **one transaction** (Supabase RPC / Postgres function) that inserts charge + reading together and either fully commits or fully rolls back. Symmetric with Decision 2b — a bill is always two records that move together, whether being created or voided. Highest-leverage correctness fix in the feature because it removes the half-written state at the source.

**Required test:** deliberately force a mid-write failure and confirm the rollback leaves *nothing* behind (no orphan charge, no orphan reading). This is the test people skip.

---

## Page shape (resting state vs. billing action)

The electric page has **two jobs with opposite needs**, and the design separates them:

### Lookup / view (the common case — must be instant)
- Page opens **straight into a readable list**, ordered by **site number** (default), with **no date entry required**.
- **Search field** on top filters the list live by **name or site number** (same pattern as reservations).
- Click a camper → see stats, balance, history; **take a payment right there** (folio flow — collecting a payment creates no electric charge, so no billing guard applies).
- This path has **zero friction**. Someone's at the counter to pay; you glance and go.

### Billing (the deliberate action — carries the prevention stack)
Entered explicitly via **"Bill Electric"**, not on page load. Three prevention layers:
1. **Gate:** billing is gated on a **deliberate period confirmation**. Period fields **pre-fill to the previous period** (the right answer ~11 months of 12), but bills/amounts don't render until you **confirm the range**. (Pre-filling the *right* default + requiring a conscious confirm — flips the old default from working against you to working for you, without the friction of a blank form re-typed every time.)
2. **Guard:** the Decision 1 overlap/duplicate warnings.
3. **Send confirm:** names the exact range in plain language before anything sends — "Bill electric for **June 1–30, 2026** to N campers?" — reading back whatever range was set.

(Optional future setting: make the send-confirm client-configurable. Ship all three layers **on by default**.)

---

## Reminder of existing behavior to preserve

- **"Bill Electric"** is the only charge-creating action (two inserts today → one atomic RPC after Decision 4).
- **"Send Statement"** does **no DB writes** — it re-emails the current live ledger and never creates a charge. Keep it that way. After this redesign it re-sends whatever the folio currently says (now correctly excluding voided rows).
- Electric charges land on the guest's **guest_account** folio; balance math unchanged except for the void filter.

---

## Suggested build order (one verifiable slice at a time)

Before building: **read-only feasibility pass** — confirm this design fits the *actual live schema* (not the stale file) and flag anything missed. No building.

Then, each phase: build → `npm run build` → verify against the **wedged test account** → commit separately → stop → report. Never chain `build && commit`.

- **Phase A — Columns + period model + guard.** Add `voided` (boolean, default false) to **both** `folio_line_items` and `electric_readings` up front, so the guard is built correctly against a real column from the start. Add `period_start`/`period_end` (DATE); backfill periods from `billing_month` (keep `billing_month` in parallel — nothing reads the new columns yet). Implement half-open overlap/exact-match detection (compare in UTC / on date strings — never local-time `Date`). Wire the warn-don't-block guard, resolving period → **charge** (authority), ignoring voided rows. Verify the overlap SELECT runs under the anon/RLS context.
  - **Guard is dormant in Phase A — this is correct, not a gap.** The old month-dropdown gate still shadows it: any month with an existing reading shows "✓ Billed" and disables the button, so `prepareBill()` never runs for it, so the guard can't fire through today's UI. The guard is tested infrastructure (18/18 unit tests incl. the June→July 1 seam) that stays inert until **Phase E** replaces the month dropdown + sent-gate with flexible period entry — that's where the guard becomes reachable and gets its live demonstration. Do NOT borrow Phase E work forward into Phase A to make the guard fire early (scope creep). (Corrects an earlier "watch it fire on the test account" note — it won't, by design.)
  - **Known Phase A bypasses (fine now, real to-dos later):** `sendAllBills` (bulk send) calls `sendBill` directly, bypassing the guard → bulk path gets guard coverage in **Phase E**. `sendBill` does not write `period_start`/`period_end` on new bills → that starts in **Phase B** (atomic write). So in Phase A the guard only ever sees *backfilled history*, not post-deploy bills.
  - **Ship ordering:** commit code first (separately, no chaining) → deploy code → **then** run the two ALTERs against live → **then** run the backfill. Code before schema, always (the `seasonal_enabled` lesson).
- **Phase B — Atomic new-bill write (Decision 4).** RPC that writes charge + reading in one transaction, now including `period_start`/`period_end` on the new reading. Test forced-failure rollback.
- **Phase D — Balance/statement void-filter. ⚠️ RUNS BEFORE PHASE C (flipped 2026-07-15).** *Why the flip:* with **zero rows voided today**, applying the void filters is a **provable no-op** — nothing observable changes, making it the safest possible deploy. Doing D first means that when C's void mechanism lands, voiding works correctly everywhere immediately, instead of shipping a void button whose voids aren't respected by any balance until a later phase.
  - **Centralization (decided 2026-07-15): a shared `notVoided` predicate + `sumLineTotals` helper in `lib/ledger.ts`, applied at the SUMMATION step — NOT `.eq('voided', false)` at the query.** This is forced by Decision 2d: admin pages must still *display* voided rows (the audit trail) while excluding them from balances. Query-level filtering strips voided rows before they reach the client → admin can't show them → breaks the audit trail. Filtering at the sum keeps them visible but out of the math. Query filtering also can't cover `buildLedger` (it receives arrays, not queries). Also add `voided?` to `LedgerLineItem` and filter `lineItems` through `notVoided` at the top of `buildLedger`, so the emailed statement's **display and balance both** drop voided rows (customer-facing paths need voided gone from display too — Decision 2d).
  - **Two coupled edits per site: fetch `voided`, then filter it.** See the ⚠️ finding above. A site isn't done until both are in.
  - **Scope includes revenue reports** (`monthlyRevenue`, `glLikeData`) — a voided charge is not revenue. Note: this means voiding retroactively corrects past revenue reports (intended).
  - **Verification (must prove the no-op):** capture a per-folio `Σ line_total` + full balance **baseline snapshot before any change**; logical proof on real data (unfiltered vs. `voided != true` sums must be equal for every folio, since 0 rows are voided); after deploy, re-run the identical read-only script and **diff → require zero differences**; re-confirm `voided = true` count is still 0 at verification time (the precondition the no-op claim rests on).
- **Phase C — Void mechanism (Decision 2).** RPC to void both halves atomically; `voided_at`/`voided_by`/`reason`. Verify on the test account: void the May duplicate and the Nov orphan, confirm you can then re-bill those periods. **This is where `electric_readings_backup_20260714` earns its keep — keep the backup until C is validated, since C is the first phase that MODIFIES existing readings rather than adding to them.**
  - **Admin display of voided rows needs visual treatment.** Per Decision 2d admin surfaces still show voided rows, but nothing marks them — so post-C an admin folio would show a charge that mysteriously isn't in the balance with no indication why. Voided rows need strikethrough / a "VOIDED" tag / greying on admin surfaces. In scope for C.
  - Note: the `folio/[id]:413` `!i.voided` filter became **functional automatically** once Phase A added the column (its fetches use `select('*')`), so it no longer needs "making real" — verify only.
- **Phase E — Page shape + prevention UI.** Readable list (site-ordered) + name/site search; replace the month dropdown + "✓ Billed" sent-gate with flexible period entry; "Bill Electric" gated on period confirm (pre-filled to previous); send-time confirmation naming the range; **route bulk send (`sendAllBills`) through the guard too.** This is where the guard becomes live and demonstrable.

**Propagation:** after full validation on Cady, propagate to template + Lakeshore via the standard workflow (`cp` + individual git pushes), each on its own deploy. Not before Cady is proven.

---

## Decisions log (so intent survives)

| # | Decision | Rationale |
|---|----------|-----------|
| 0 | **Charge (folio money) is the source of truth** for "is this billed?", not the reading | Billing is fundamentally about money charged; a reading must not claim a bill exists when no charge does. Resolves the orphan case |
| 0 | `voided` added to **both** `folio_line_items` and `electric_readings` (added, not activated — it doesn't exist yet) | Reading needs its own void signal to avoid future orphans; the existing `!i.voided` filter is a silent no-op today |
| 1 | Flexible `period_start`/`period_end` date ranges; no bill types | Clients bill on varied cycles; a move-out bill is just different dates |
| 1 | Guard warns, never blocks; catches exact-match (hard confirm) + positive-width overlap (warning); boundary-touch silent | Protect against the two real mistake patterns without caging legitimate second bills |
| 2 | Void (not delete), atomic both-halves, with audit trail | Deleting one half orphans the reading and wedges future billing |
| 2d | Customer never sees voids; admin retains full trail | Clean customer statement; full operator history |
| 2d | **Void filter applied at the SUM step, not query-level** (shared `notVoided`/`sumLineTotals` in `lib/ledger.ts`) | Forced by 2d: query-level filtering strips voided rows before admin can display them, breaking the audit trail |
| — | **Phase D runs BEFORE Phase C** (flipped 2026-07-15) | With 0 rows voided, D is a provable no-op — safest deploy; and it means C's voids are respected everywhere immediately instead of half-wired |
| — | **Revenue reports exclude voided charges** (decided 2026-07-15) | A voided charge was reversed; it was never revenue. Accepts that voiding retroactively corrects past reports |
| 3 | No adjustment/credit type in electric billing | Void-and-rebill + existing guest-folio credit already cover every case |
| 4 | New bills written atomically (one transaction) | Removes the half-written-bill root cause |
| — | Lookup instant/ungated; friction only on the billing action | Page has two jobs with opposite friction needs |
