# Tax Model — Design Spec

**Repo:** cady-hollow-reservations (develop on Cady → validate → propagate to template + Lakeshore)
**Status:** Design draft, 2026-07-16. **T0 feasibility pass complete** — findings folded in below; several spec premises corrected (add-ons, decision #9's blast radius, calendar classification). **Not built.**
**Blocks:** the card-surcharge unification (see *Downstream* below). **Is blocked by:** nothing.

---

## Why this exists

This began as a small task: the card surcharge is 3.5% online and 3% in person, make it settable. Investigation found the rate bug was real but shallow — and that the actual requirement ("surcharge the total **excluding tax**") is **uncomputable**, because tax isn't a concept the system has.

**The finding that ended the surcharge project:**
- **Reservations have no tax at all.** `computePricing` (`lib/pricing.ts:98-206`) has no tax parameter and emits no tax line. Booking, wizard, walk-in, and calendar extension cannot tax a stay. **A campground that charges lodging tax cannot use ResoNation today.**
- **Nothing marks a `fees` row as a tax.** No flag, no type, no reserved name. `card_only` is the only semantic boolean and it means "waived for cash," not "is a tax."
- **The admin UI is titled "Taxes & Fees"** (`app/admin/fees/page.tsx:137`) with placeholder **"e.g. PA State Tax"** (`:150`). The product *invites* clients to enter tax as a fee row while giving the code no way to distinguish "Sales Tax 6%" from "Resort Fee 3%." They are byte-for-byte the same shape. **This is a trap a beta client walks into on day one.**
- **POS tax is hardcoded 6% in five files.** Client #2 in another state silently charges Pennsylvania's rate.

So: tax first, surcharge second. The order is forced.

---

## The model

*Derived by Charissa from first principles; it matches the standard POS/PMS approach.*

### 1. Taxes are first-class entities

New `taxes` table:

| column | type | notes |
|---|---|---|
| `id` | uuid | |
| `name` | text NOT NULL | "PA State Sales Tax", "Potter County Lodging Tax" |
| `rate` | numeric NOT NULL | 6.0, 2.5 — decimals required (cf. the 4.1%/3.4% requirement) |
| `is_active` | boolean DEFAULT true | |
| `display_order` | int | optional, for consistent ordering on invoices |

**No "type" column.** A tax has no intrinsic kind — what it applies to *is* its scoping (below). This is what makes "lodging tax vs sales tax" fall out without special-casing.

### 2. Taxability is config on the thing being sold

New `tax_applications` table (polymorphic):

| column | type | notes |
|---|---|---|
| `tax_id` | uuid FK → taxes | |
| `applies_to_type` | text | `'site_type'` \| `'product'` \| `'addon'` \| `'fee'` \| `'early_checkin'` \| `'late_checkin'` \| `'extra_guest'` |
| `applies_to_key` | text NULL | the site type (`'rv_site'`), or a product/addon/fee id; **NULL** for the settings-priced singletons (early/late check-in, extra guest) |

**Sites are taxed by site TYPE, not per site** (decided 2026-07-16). Vocabulary already exists: `rv_site`, `cabin`, `tent`, `yurt`, `tiny_home`, `lodge`, `glamping`, `treehouse`. Five-ish checkboxes instead of fifty. Per-site oddities are handled by the exempt toggle below, not by config.

**Stacking is flat on base.** 6% + 2% = 8% of base. Never compounding. (US-standard.)

**Rounding is per line, per tax.** Each tax rounds to integer cents independently against its own base.

### 3. Tax is computed and STORED — never folded into a price, never re-derived

This is the load-bearing principle. Everything downstream (statements, reports, refunds, the surcharge) is trivial if this holds and impossible if it doesn't.

**Store the per-tax breakdown, not one total.** A single `tax_amount: 420` cannot answer *"how much Potter County lodging tax did I collect in Q2?"* — which is exactly what a client needs in order to **file**. Two stacked taxes need two separate amounts or the reports are useless.

**Snapshot name and rate into the record.** Storing only `tax_id` means every historical invoice silently rewrites itself when a rate changes next year. Same rule as `surcharge_amount`.

Breakdown shape (jsonb):
```json
[{ "tax_id": "…", "name": "PA State Sales Tax", "rate": 6.0, "amount": 420 }]
```

Storage sites:
- `folio_line_items` — `tax_amount` (integer cents) **already exists**; add `tax_breakdown` jsonb.
- `reservations` — add `tax_amount` (integer cents) + `tax_breakdown` jsonb.

**`line_total` and `total_price` stay tax-INCLUSIVE.** They represent what's owed, and ~14 balance-summation sites depend on that meaning (see the electric-billing spec's Phase D list). Do **not** change their semantics. The non-tax base is derived by subtraction:

```
nonTaxBase = Σ(line_total) − Σ(tax_amount)   +   (reservation.total_price − reservation.tax_amount)
```

POS already follows this pattern (`lineTotal = (price + taxAmount) * qty`). Reservations adopt it.

**Migration note — this is free for existing data.** Existing reservations have no tax, so `tax_amount = 0` and their `total_price` is already "tax-inclusive with zero tax." No backfill needed; no balance moves.

### 4. Escape hatch: per-reservation tax-exempt toggle

One checkbox on a reservation. Covers:
- the **30-day lodging exemption** (deliberately not modeled — see Decisions)
- **tax-exempt organizations** — churches, nonprofits, government rates (real for campgrounds, and no per-item checkbox can express them)
- anything not anticipated

When set, no taxes compute for that reservation. Stored on the record, not derived.

### 5. `computePricing` gains tax

- Takes the active taxes + applications.
- Computes tax per component (site nights by type, extra guest, addons, early/late check-in, fees).
- Emits a tax breakdown and a tax total.
- `cashTotal` includes tax (unchanged meaning: what's owed).
- **Surcharge base = `cashTotal − taxTotal`.**

---

## Decisions made

| # | Decision | Rationale |
|---|---|---|
| 1 | Taxes are first-class rows (name + rate), not fee rows | Nothing can mark a fee as tax; the whole blocker |
| 2 | No "type" on a tax — scoping *is* the meaning | Lodging vs sales falls out without special cases |
| 3 | Taxability config is many-to-many with sellable things | "Some items taxed, some not"; stacking works free |
| 4 | **Sites taxed per site-TYPE, not per site** | 5 checkboxes vs 50; oddities go to the exempt toggle |
| 5 | Stacking is **flat on base**, never compounding | US-standard |
| 6 | Rounding **per line, per tax** | Avoids cent drift; matches POS |
| 7 | **Per-tax breakdown stored**, not a single total | Clients must file per-tax; a total can't answer that |
| 8 | **Snapshot name + rate** into the record | History must not move when rates change |
| 9 | `line_total` / `total_price` stay **tax-inclusive**; non-tax base by subtraction | ~14 balance sites depend on the current meaning |
| 10 | **30-day lodging exemption NOT modeled** | Handled by the per-reservation exempt toggle instead |
| 11 | **Per-reservation tax-exempt toggle** | Covers 30-day, nonprofits, government, and the unforeseen |
| 12 | V1 = model + math + display + **reports** | A client cannot file without the reports |

---

## Scope (V1 = all of it)

**Model & math**
- `taxes` + `tax_applications` tables; admin UI to create/edit taxes
- Tax checkboxes on: site types, products, addons, fees, early/late check-in, extra guest
- Per-reservation tax-exempt toggle
- `computePricing` emits tax; POS tax reads the tax model instead of hardcoded 6%
- Tax + breakdown stored on `reservations` and `folio_line_items`

**Display** — *most of the work; no tax line exists on a reservation anywhere today*
- Booking page price breakdown
- Confirmation email
- Folio pages (reservation / guest / walk-in)
- `buildLedger` → emailed statements + receipts
- Wizard, walk-in, calendar extension

**Reports**
- Tax collected **by tax, by period** (the filing number)
- Must read stored breakdowns, never recompute

**Explicitly out of scope**
- Multi-jurisdiction rule engines (that's Avalara/TaxJar's business — "flexible for common cases," not general)
- Tax-inclusive quoted pricing
- The card-surcharge unification (separate, downstream — below)

---

## Migration

**Cady is clean** — no stay tax exists, so nothing to untangle there.

1. Seed `taxes` with **"PA Sales Tax", 6.0** (matching today's hardcoded POS rate).
2. `tax_applications`: for every product with `tax_class = 'standard'`, apply that tax. `'exempt'` products get nothing. This preserves current POS behavior exactly.
3. Sites: **no taxes applied** (Cady charges no stay tax) — preserves current behavior.
4. Replace the hardcoded `Math.round(price * 0.06)` in **five files** with the tax model:
   - `app/admin/folio/[id]/page.tsx:272`
   - `app/admin/folio/guest/[id]/page.tsx:165`
   - `app/admin/folio/walkin/[id]/page.tsx:128`
   - `app/admin/walkin-booking/page.tsx:245`
   - `app/admin/new-reservation/page.tsx:19` (`posLineTax` helper)
   → centralize into **one** helper; do not leave five copies (cf. `loadSquareCard` × 5, `notVoided`).
5. **Onboarding SQL** (`resonation-admin/app/api/onboard/route.ts` `DATABASE_SETUP_SQL`) must include the new tables — the **`CREATE TABLE`s only, never the Cady seed** (see Propagation) — or new clients provision without the tables (the "repo lies about the database" trap) *or*, worse, inherit PA's 6%.
6. Any client who typed a tax into Taxes & Fees needs that row migrated to `taxes`. Cady hasn't; a check should still exist before onboarding anyone.

(The Taxes & Fees screen **keeps its name** — it's accurate now that taxes have their own section — and the "e.g. PA State Tax" placeholder was dropped from the *fee* form in T1.)

**⚠️ Hard blocker for propagation — the `database-setup.sql` products drift (found in T1).** `database-setup.sql`'s `products` table omits `tax_class` entirely (it also still says `category_id`/`in_stock` where the live table has `category`/`active`). Onboarding provisions new clients from this file. So a client provisioned from it gets a `products` table with **no `tax_class` column** — and the POS tax check `product.tax_class === 'standard'` evaluates `undefined === 'standard'` → **false → every product charges zero tax, silently, forever.** This is not a cosmetic cleanup: it's a live correctness defect for any client not seeded by hand. **Lakeshore may be in this state right now.** Action items, each independent of the tax build:
   - **Its own read-only check**, before any propagation: does each existing client's live `products` table actually have `tax_class`? (Cady does; the repo file lies. Confirm Lakeshore and the template.)
   - Reconcile `database-setup.sql` `products` (and the onboarding `DATABASE_SETUP_SQL`) with the live schema **before** the tax tables ship to anyone — otherwise the tax model provisions on top of a products table that was already broken.
   - **Do not act on this in T1.** Logged here so it isn't lost; it blocks *propagation*, not Cady's T1/T2.

**Verification pattern** (same as the electric work): capture a per-folio/per-reservation baseline before any change; after, require **zero differences** for Cady, since Cady's config reproduces current behavior exactly. If any number moves, the migration is wrong.

---

## Downstream: the card surcharge

Once tax is separable, the surcharge is a subtraction, not a feature.

**Already decided (2026-07-16), pending this project:**
- **Model B** — the surcharge becomes **its own rate setting**, not a `fees` row. A surcharge has no natural `applies_to`, can't sensibly be flat, and can't sensibly be multiple. Modeling it as an item-scoped fee is what caused the whole mess. It can still *live on the Taxes & Fees screen* — storage and placement are separate.
- **Base = the total excluding tax**, regardless of item type. `nonTaxBase` above.
- **Formula** (booking's, generalized):
  ```
  surcharge = round( min(payment, cashTotal) × cardFeeCents / cashTotal )
  ```
  The `min()` cap means an overpayment/credit is never surcharged.
- `settings.card_surcharge_percent` (numeric, currently **3**, **never written by the app**) is dead and gets retired or repurposed as the Model B setting.
- Cady's `fees` row "Transaction Fee" (percentage, 3.5, `card_only`, `applies_to = "rv_site,cabin,tent,addons"`) is retired in the same move.

**Known live bugs to fix with it:**
- **Folio "send to terminal" (`folio/[id]:417-419`) already surcharges on top of POS tax** — the exact error the requirement forbids. Live at Cady now (pennies, but real).
- **In-person paths charge 3%** from the dead settings column while booking charges 3.5% from the fee row.
- **New clients charge 0% in person** — they set a card fee in Taxes & Fees, it applies to online booking only, and every in-person path reads the unwritable `card_surcharge_percent` (default 0). **This is the real defect**, worse than Cady's stale 3%.
- `/admin/manual-booking` — **NOT dead** (correction, 2026-07-16): it's off the dashboard, but the admin **map links to it** (`app/admin/map/page.tsx:110` — click an available site → `router.push('/admin/manual-booking?site_id=…')`). So it is a live, reachable path, not deletable as a no-op. Left untouched by the surcharge unification (repointing the map is a UX change with its own site-preselect decision — `new-reservation`/`walkin-booking` don't read a `site_id` param and clear the site on date change). **Its own pass, and it carries an open question to resolve then:** an earlier finding recorded it sending `surchargeAmount: 0` to the charge API. If it only creates **unpaid holds** (payment collected later at the folio, which now surcharges correctly), then `0` is correct and there is **no bug**. If it can **charge** at booking time, `surchargeAmount: 0` is a **live undercharge on a linked path**. Not investigated yet — recorded here to settle when manual-booking gets its own pass.

**Note:** the rate-source fix is separable and does *not* depend on tax. It could ship on its own at any point to close the 3%/3.5% gap and the new-client 0% trap, leaving "excluding tax" for after this project.

---

## Answered (Charissa, 2026-07-16)

- **Add-ons are the `addons` table, id-keyed** (my earlier "add-ons live in settings" was wrong — the only settings reference is `settings.addons_total`, a rolled-up counter). So `tax_applications` reaches them uniformly, exactly like products: `applies_to_type='addon'`, `applies_to_key=addon.id`. One fewer special case — they are **not** settings-priced singletons. (Full detail under T0 findings below.)
- **Taxable category list is complete** as listed. Products are configured **individually** (already rows with `tax_class`).
- **Fees are taxable** → per-fee tax checkboxes in V1.
- **Tax admin UI lives in the existing Fees screen.** No new screen; add a Taxes section. **The screen keeps its "Taxes & Fees" name — which becomes accurate rather than misleading.** Drop the "e.g. PA State Tax" placeholder from the *fee* form.
- **`tax_class` on products is retired**, replaced by tax checkboxes. Migration maps `'standard'` → apply the seeded tax, `'exempt'` → none. *Verify nothing else reads it first.*
- **Voiding a charge voids its tax; a refund returns tax too.**
  - **Already works by construction for POS:** `line_total = (price + taxAmount) * qty`, so tax lives *inside* the line total and voiding the line drops the tax with it. Nothing to build.
  - **But: tax reports MUST exclude voided rows.** Same `notVoided` lesson as electric Phase D — otherwise a client files on tax that was refunded. This is the one real void/tax interaction.

## T0 feasibility findings (Code, 2026-07-16) — spec corrections

**Add-ons are a TABLE, not settings.** (`addons`: id, name, description, price, is_active, display_order; joined via `reservation_addons`.) The earlier "add-ons live in settings" answer was wrong — the only settings reference is `settings.addons_total`, a rolled-up counter. **This simplifies the model:** add-ons are id-keyed exactly like products (`applies_to_type='addon'`, `applies_to_key=addon.id`). One fewer special case; they are **not** early/late-checkin-style singletons.
- The addon TS type carries a dead `is_early_checkin` flag from a since-rebuilt early-check-in feature. **Not live at Cady; remove it.** ⚠️ **Check first:** is a leftover "Early Check-In" addon row still in the table, possibly `is_active`? If so a camper could buy it as an add-on *and* pay the settings-priced early fee. Dead data from a rebuild — verify, don't assume.

**⚠️ Decision #9's protection is narrower than originally written.** Keeping `total_price` tax-inclusive protects the balance sites — but there are **three** reader classes, and two break:
- **(a) Balance/display** (`total_price − amount_paid`, "$X total") — **safe.** This is the ~14-site majority #9 protects. ✅
- **(b) Itemization-by-subtraction** — **BREAKS.** `folio/[id]:487`: `rSiteCharge = total_price − rExtraGuest − rAddons − rEarly − rLate − rFees + rDiscount`, with the site charge as the *reconciling remainder*; `:512` `leftover` folds anything unaccounted-for. Same pattern in `api/receipt/route.ts:53` and `lib/ledger.ts`. Once `total_price` carries stay tax, that tax has no line to land on and **silently inflates the site charge.** This is reconciling **arithmetic**, not display — T4 must **subtract a tax line**, not just add a display row.
- **(c) Revenue reports** — **BREAKS. Biggest omission in the original spec.** `reports/page.tsx:389`: `stayDateRevenue = reservations.reduce((s,r) => s + r.total_price, 0)` (also `:430` monthly, `:448` by site-type, `:456` per-site). **Tax is a liability, not revenue.** Once `total_price` is tax-inclusive, every revenue figure inflates by the stay tax — and a client reading "revenue" *plus* the new tax report **sees tax twice.** **Existing revenue aggregates MUST net out `tax_amount`.** This is a required fix, not an option.

**Calendar is a CHARGING surface, not display.** `calendar:909` `newTotal = total_price + delta`; `:941` `.update({ total_price: newTotal })`; `:1000` surcharges/charges `payBaseCents`. It loads **zero line items** and computes the delta with **no tax** — extending a taxed stay would add **untaxed nights** and leave the stored `tax_amount` stale. **Moves from T4-display into T3-charging.**

**General rule this implies:** *anywhere `reservations.total_price` is written, `tax_amount` + `tax_breakdown` must be recomputed and written with it.* Reservations have **no `voided` column** (only `status`: pending/confirmed/cancelled/manual), so there's no per-line void to lean on. Full cancellation is catchable via `status='cancelled'` (reports already filter it — the tax report must copy that filter). **A partial refund on a stay** (reduce nights, comp a fee) has **no tax-reversal mechanism** — the stored `tax_amount` won't move unless the edit path recomputes it. "A refund returns tax too" is true for POS (tax lives inside `line_total`) but **unbuilt for reservations.**

**"Tax collected" is a compliance-sensitive misnomer.** `folio_payments` carries **no tax and no line linkage** (amount, method, note, surcharge_amount, status), and both charging routes are generic sinks. Tax is knowable **only by accrual** — what was *charged* on non-voided lines — never by cash. A folio charged $6 tax and half-paid still reports $6. Many small businesses file sales tax on a **cash basis**; cash-basis here would require linking payments to lines (a large architectural change, deliberately not in scope). **Label the report "Tax charged (accrual)" and document the limitation.**

**`site_type` is unconstrained free text** — no enum, no CHECK; the eight-value vocabulary is duplicated as inline label maps in ≥6 files (closest to a list: `fees/page.tsx:17 APPLIES_TO_OPTIONS`). A client with a site type outside those eight would get a site with **no tax-config checkbox**. **Decision: derive the tax-config option list from `SELECT DISTINCT site_type FROM sites`** rather than a hardcoded vocabulary — more robust, nothing to enforce at onboarding. Label maps are presentation-only and fall through to the raw value, so an unknown type displays fine. Promote `APPLIES_TO_OPTIONS` to a shared constant rather than hand-copying a seventh map. **Site types are configured from the tax-side panel ONLY — there is intentionally no item-side (per-site) checkbox.** This is not an omission: taxation is per *type*, not per site, and there is no per-site edit surface to host one (site_type is just a free-text field on a site). The other item-side lenses exist because add-ons/fees/singletons *are* individually-priced things with their own edit forms; a single site isn't.

**`tax_class` retirement touches ~10 sites, not 5.** Beyond the five tax-calc sites: the config UI (`products/page.tsx` 17/37/92/208/274 — the standard/exempt dropdown + "No tax"/"Taxable" label), **four display badges** (`folio/[id]:1146`, `folio/guest:784`, `folio/walkin:619`, `walkin-booking:895`), and cart plumbing (`new-reservation` 20/273/1041 threads it through `posLineTotal`, the insert payload, and the cart push). Plan T7 for ~10 edit sites.

**The shared POS helper is viable.** All five hardcoded sites are per-unit `(unitPrice, taxability) → taxCents`; callers multiply by qty. Signature becomes roughly `posLineTax(unitPrice, productId, taxCtx) → { amount, breakdown }`. Two wrinkles: (a) it must return the **per-tax breakdown**, not just a total, so line inserts can populate `tax_breakdown`; (b) **custom items** (`folio/[id]:303`, `product_id = null`) hardcode `tax_amount: 0` — the helper needs a no-product path. Precedent for centralizing exists (`loadSquareCard`×5, `notVoided`).

**Nothing here blocks the model.** The polymorphic `tax_applications` design is sound and add-ons being a table makes it cleaner.

---

## ⚠️ Cady is the control group — which means Cady cannot test the feature

Every phase below is a provable no-op **for Cady**, precisely *because* Cady charges no stay tax. The zero-diff proves nothing broke. It proves **nothing** about whether stay tax works — the capability this project exists to deliver.

**A tax fixture is required**, and it's the analogue of the wedged test account that carried the electric work: configure a real tax, apply it to a site type, book a test reservation on the C2 test account, and verify the **whole chain** — pricing → storage → folio itemization → statement → receipt → reports → surcharge base — then turn it off. Without it, T3–T5 ship untested for the clients they're for.

---

## Phase plan

Each phase: read-only check → build → `tsc` + `npm run build` (separately, **never chained**) → stop and report → commit → preview → merge → verify. **Code before schema, always.**

- **T0 — Feasibility pass.** ✅ Done 2026-07-16; findings folded in above.
- **T1 — Model + config, dormant.** ✅ Done 2026-07-16. `taxes` + `tax_applications`; Taxes section in the Fees screen with a **tax-side "Applies To" panel** (site types via `SELECT DISTINCT site_type`, products, add-ons, fees, singletons); **item-side tax checkboxes** on add-ons, fees, and the three settings singletons (early check-in, late check-out, extra guest) — both lenses write the same rows. Seed **"PA Sales Tax" 6.0**; map products `tax_class='standard'` → applied. **Products are the one exception — no item-side checkbox on the products page**, and the tax-side panel shows products **read-only (disabled)** with the hint "Set on the Products page until the tax switchover" — visible seeded state, no editable second control, still round-trips on save (see T2). Singleton type is `late_checkout` (not the spec's original `late_checkin` — that named a charge with no referent). **Nothing outside the config UI reads it.** Pure no-op.
- **T2 — POS reads the model.** Replace the **five** hardcoded `Math.round(price * 0.06)` copies with **one** shared helper returning `{ amount, breakdown }`, incl. a no-product path for custom items. Cady's seeded config makes output byte-identical (`6/100 === 0.06`). Provable no-op — baseline diff, zero differences. **Two T2-only tasks that were deliberately kept out of T1:**
  - **Retire the products `standard`/`exempt` dropdown — don't merely swap it.** Under the tax model "standard" has no referent ("standard *which* tax?"); products join the same item-side checkbox picker everything else uses. Held out of T1 on purpose: products already have a **live** control (`tax_class`) driving real POS behavior, so a second, dormant per-product control would let the two silently diverge — and the divergence would surface *here at T2* as a behavior change during the one phase whose whole claim is "provable no-op." The swap belongs atomically with the POS switchover. (Note: the T1 tax-side panel *does* list products — the seed writes `('product', id)` rows and the panel must round-trip them — but **disabled/read-only**, so there is no editable dormant control to diverge; it just shows the seeded state. Re-enable them here at T2, and the catch-up below reconciles.)
  - **Re-run `tax_class='standard'` → `tax_applications` as an idempotent catch-up.** The T1 seed maps only products that existed at seed time; any product added between the seed and the T2 switchover is otherwise missed. Make it exact-once per product (skip products that already carry the tax) so it's safe to re-run. The baseline zero-diff gate catches any product whose taxation the two controls disagree on.
  - **New products are `standard` (taxed) by default today — the T2 UI must preserve that.** Verified in T1: the products form's `blank()` seeds `tax_class: 'standard'` and the insert sends it (`app/admin/products/page.tsx:37,107`), so a product created with no explicit choice is **taxable**. When the standard/exempt dropdown becomes tax checkboxes, a brand-new product with nothing ticked must still get the seeded tax applied by default, or we silently flip the whole system to **untaxed-by-default** — a real behavior change that the zero-diff baseline (existing products only) would *not* catch, because it only bites products created after the switchover. (Caveat: the *DB-level* default of the live `tax_class` column can't be read from the repo — `database-setup.sql` omits the column entirely, the drift below — so confirm the live column default during T2; the app-layer default is unambiguously `standard`.)
  - **Verification: the zero-diff baseline has a hole here — close it with a separate check.** The baseline snapshots *existing* products, so the untaxed-by-default flip would only affect products created *after* T2 and would pass the diff **green**. Add an explicit post-switchover check, independent of the baseline: **create a new product, tick nothing, and confirm it comes out taxed** (seeded tax applied). Green baseline is necessary but not sufficient for this phase.
- **T3 — Reservations gain tax (charging surfaces).** `computePricing` emits tax; `reservations.tax_amount` + `tax_breakdown`; **calendar delta computes and writes tax**; the rule *"anywhere `total_price` is written, tax is rewritten"* applies to every edit path. **This is the phase that unblocks lodging-tax clients — and the first phase the tax fixture must exercise.**
  - **⚠️ Early check-in / late check-out exist TWICE — as POS products AND as settings-priced singletons — and the tax model can tax them via two different paths.** Found during the T1 seed at Cady: two POS `products` named "Early Check-In" / "Late Check-Out" (staff sell them at the counter; they'd carried `tax_class='none'`, since set to `exempt`). The *same real-world charge* is also the `early_checkin` / `late_checkout` settings singleton. So under the model a charge can be configured `applies_to_type='product'` (keyed to the product id) on one path and `applies_to_type='early_checkin'`/`'late_checkout'` on the other — taxed one way, untaxed the other, with no reconciliation. **Resolve when the singletons get wired:** decide which path is authoritative for these charges (likely: if a POS product exists for it, the product config wins and the singleton path is suppressed, or vice-versa), or at minimum surface the collision in the admin UI so an operator can't silently tax it twice or inconsistently. Note this is also why the seed's abort-on-mismatch fired — the `none` tax_class was a symptom of these dual-nature items.
- **T4 — Itemization + display.** **Fix the subtraction sites first** (`folio/[id]:487/:512`, `api/receipt:53`, `lib/ledger.ts`) to *subtract a tax line* — this is arithmetic, not decoration. Then tax rows on booking, confirmation email, folios, statements, receipts, wizard, walk-in.
- **T5 — Reports.** **Net existing revenue aggregates out of `tax_amount`** (`reports` 389/430/448/456) — required, or tax double-counts. Add **"Tax charged (accrual)"** by tax, by period, reading stored breakdowns, **void-filtered**, and copying the existing `status != 'cancelled'` filter.
- **T6 — Per-reservation tax-exempt toggle.**
- **T7 — Retire `tax_class`** (~10 sites: 5 calc + config UI + 4 badges + cart plumbing). Code before schema: stop reading, deploy, then drop. Also remove the dead `is_early_checkin` addon flag.

Then, separately: **the card-surcharge unification** (see *Downstream*).

**Propagation** (template + Lakeshore + onboarding SQL) after Cady validates — carries the **schema (the two tables), NOT the seed.** The `2026-07-16-tax-model-seed.sql` script is a **Cady-only migration**, not onboarding: it seeds *PA's* 6% and maps *Cady's* products. New clients must get **empty** `taxes` / `tax_applications` and configure their own — so the seed must **never** go into `DATABASE_SETUP_SQL`, or every new client silently inherits Pennsylvania's rate. Onboarding gets the `CREATE TABLE`s only.
