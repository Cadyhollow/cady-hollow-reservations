# `database-setup.sql` drift — reconciliation vs as-built Cady

**Status:** read-only findings catalogue. No fix applied. Do not propagate `database-setup.sql`
until it is regenerated (see *Method*).
**As-built truth:** merged `main` @ `c1c4e2d` — shipped code + applied migrations in `db/migrations/`.
**Live reference:** Cady, Supabase project `dmqyuujhdflfydfhigvn`, catalogue read 2026-07-19
(read-only `information_schema`/`pg_catalog` SELECTs; unmerged branches `reprice-guard`,
`folio-nav-fix`, `supabase-singleton` deliberately excluded).
**Why this matters:** `database-setup.sql` provisions every new client. Our first beta clients
will run POS with taxable goods and charge real cards, so POS-tax and card-surcharge correctness
on the provisioning path are beta-critical.

**Decisions locked** (this doc is the rewrite's spec):
- **`admin_password`:** `settings.admin_password` is **vestigial — not read for auth** (login uses
  the `ADMIN_PASSWORD` env var). Drop its DEFAULT from provisioning purely as **secret hygiene**
  (never commit Cady's password string). The real per-client login secret is the `ADMIN_PASSWORD`
  env var provisioned by `resonation-admin` — that's where "no shared secret" lands, not the SQL.
  See *Curation*.
- **Curation:** value-bearing content is **allowlist, not blocklist** — structure comes wholesale
  from the live dump; every table provisions empty, and only structural column defaults survive.
  See *Method*.

---

## Headline

`database-setup.sql` is **not "slightly drifted" — it is a different, older schema.** It predates
POS/folios, the electric-billing redesign, the tax model, the card surcharge, and even reservation
early/late check-in + `surcharge_amount`. A client provisioned from it runs a pre-2026 generation
of the app. On such a client, **product creation, POS charges, card-payment recording, discounts,
Settings-save, and online booking with a surcharge all fail.** It is effectively unusable for the
current code.

Corollary for sequencing: provisioning is broken across ~10 objects **independent of the tax
model (T2)** — the two tax tables are just 2 of them. Propagation is blocked on a full provisioning
regeneration regardless of whether T2 lands first; T2 is orthogonal to this fix.

---

## Confirmed suspicions (all three)

1. **`products.tax_class` missing** — CONFIRMED. Live: `text NOT NULL DEFAULT 'standard'`; file:
   absent. The `'standard'` DB-level default also answers the T2 "taxed-by-default" question:
   new products are taxable in the column itself, not only in the form.
2. **`category_id`/`in_stock` vs `category`/`active`** — CONFIRMED. Live: `category text NOT NULL
   DEFAULT 'General'`, `active boolean NOT NULL DEFAULT true`. File: `category_id uuid FK`,
   `in_stock boolean`. Name **and** type mismatch — the FK is wrong; `products.category` is a
   denormalized text column, and `product_categories` exists as a separate table.
3. **`settings.id` integer vs uuid** — CONFIRMED. Live: `uuid DEFAULT gen_random_uuid()`; file:
   `integer DEFAULT 1` with `INSERT … VALUES (1)`.

---

## Drift catalogue — beta-critical tables

Each row: what the file has → what shipped code + live expect → effect on a freshly provisioned client.

### `products`
- File: `id, name, price, category_id (uuid FK), in_stock, created_at`.
- Live: `+ tax_class (NN,'standard'), category (NN,'General'), active (NN), description,
  track_inventory (NN), stock_quantity, display_order, variable_price (NN)`; no `category_id`/`in_stock`.
- **Blast radius:** product INSERT rejects (8 unknown columns). Even if forced, POS tax
  `product.tax_class === 'standard'` → `undefined` → **0 tax on a taxable good.** Cannot sell.

### `folio_line_items`
- File: `id, folio_id, description, amount, quantity, notes, voided, created_at`.
- Live: `+ product_id, unit_price (NN), tax_amount (NN), line_total (NN), category, charged_at,
  voided_at, voided_by, reason`; no `amount` (code uses `line_total`).
- **Blast radius:** POS charge INSERT rejects (`product_id/unit_price/tax_amount/line_total/category`
  absent). **No line item can be added.** The electric RPC inserts the same columns.

### `folio_payments`
- File: `id, folio_id, amount, method, note, receipt_sent_at, created_at`.
- Live: `+ status (NN,'completed'), surcharge_amount, square_payment_id, paid_at, reference_number`.
- **Blast radius:** payment INSERT rejects; folio SELECT (`.eq('status','completed').order('paid_at')`)
  errors on missing columns. **Card path: Square charges first, then the record insert fails →
  money taken, no folio record (orphan).**

### `folios`
- File: `id, type (NN), reservation_id, guest_id, guest_name, created_at`.
- Live: `folio_type (NN,'reservation')` **not** `type`; `+ status (NN,'open'), guest_email, label,
  opened_at, closed_at, notes`.
- **Blast radius:** folio creation fails both ways — `folio_type` is unknown, and `type NOT NULL`
  is never supplied. **No folio opens.**

### `reservations`  ← ties directly to the just-shipped surcharge work
- File lacks: `surcharge_amount, early_checkin, early_checkin_fee, late_checkout, late_checkout_fee,
  site_name, special_requests`. Live has all (`surcharge_amount integer NOT NULL DEFAULT 0`).
- **Blast radius:** `api/payment` writes `surcharge_amount` (+ early/late fees) on the reservation
  INSERT → **online booking INSERT fails** on a provisioned client. Breaks the card-surcharge
  feature end-to-end for new clients.

### `discounts`
- File: `type, amount, start_date, end_date, uses_count`.
- Live: `discount_type, discount_value, valid_from, valid_until, times_used` (four renames).
- **Blast radius:** code reads `discountResult.discount_type === 'percent'`; RPC
  `increment_discount_usage` updates `times_used`. **Discounts fully broken** (unknown columns;
  `'percentage'` never equals code's `'percent'`).

### `electric_readings`
- File: old model — `reading_date (NN), kwh, amount, note, email_sent_at`.
- Live: redesign — `billing_month (NN), previous_reading, current_reading, kwh_used,
  rate_per_kwh (0.27), minimum_charge (1500), calculated_amount, final_amount, folio_line_item_id,
  voided + audit (voided_at/by, reason), period_start, period_end, notes`.
- **Blast radius:** electric billing fully broken — the RPC and its fallback both hit missing
  columns; `reading_date NOT NULL` blocks any insert that omits it.

### `taxes`, `tax_applications`
- File: both tables absent.
- Live: present, matching the T1 migration exactly (verified: `uq_tax_applications` COALESCE index;
  CHECK lists `late_checkout`; both directional indexes).
- **Blast radius:** the Taxes admin section 404s (graceful-empty today); **critical once T2 ships.**
  Provision the **tables only — never the PA Sales Tax seed.**

### `terminal_checkouts`
- File lacks: `note, payment_id, completed_at`. Live has them.
- **Blast radius:** the Terminal charge route inserts `note` → INSERT rejects.

### `settings`
- `id`: integer vs uuid (see suspicion 3).
- File missing: `auto_sync_guests, deposit_type, deposit_value, custom_payment_methods (text[]),
  maintenance_mode, maintenance_message` — all written by `handleSave`.
- Type mismatch: `same_day_cutoff_time` is `text` in the file, **`time`** live.
- **Blast radius:** Settings-save fails (unknown columns) on any save.

### Also drifted (lower or non-POS impact)
- **`failed_bookings` table missing entirely** — the "charged but no reservation" safety net;
  `api/payment` inserts into it exactly when a card was charged but booking failed → the safety-net
  insert itself errors.
- **`cancellation_rules`** — different shape: file `days_before_arrival, refund_percentage`; live
  `start_date, end_date, deposit_refundable, refund_percent, cancellation_deadline_days, policy_text`.
- **`sites`** — file lacks the live CHECKs (`site_type IN ('rv_site','cabin','tent')`, `amp_service`,
  `hookups`) and `site_number` UNIQUE; file has a stray `is_active` live lacks; `max_rv_length`
  numeric (file) vs integer (live). NB: the live `site_type` CHECK **corrects an earlier T0 claim**
  that site_type was unconstrained — on Cady it is constrained to 3 values, so the tax model's
  8-type vocabulary is unreachable there.
- **`addons.is_early_checkin`** missing from the file (a dead flag the code still reads).

---

## What provisioning must reproduce (RLS / grants / functions / triggers / buckets)

- **RLS posture (K1):** these POS/folio/guest tables have **RLS OFF** on live —
  `products, product_categories, folios, folio_line_items, folio_payments, electric_readings,
  guests`. The file instead **enables RLS + an allow-all `{public}` policy** for them. Functionally
  equivalent (both leave the table open to anon), so not a break — but a deliberate posture choice.
  Anon online booking is safe either way: `reservations` has `{anon} INSERT`, `settings`/`sites`
  have `{anon} SELECT`, and everything else booking reads carries a `{public} ALL` policy.
- **Functions + trigger missing from the file:**
  - `sync_guest_from_reservation()` + trigger `trg_sync_guest_from_reservation` (AFTER INSERT on
    `reservations`) — auto-adds guests when `settings.auto_sync_guests` is on.
  - `increment_discount_usage(code text)` — bumps `discounts.times_used`.
  - `create_electric_bill(...)`, `void_electric_bill(...)` — both electric RPCs (EXECUTE granted to
    anon/authenticated live); the file has neither.
- **Storage (R):** buckets `logos` + `site-photos`, both public — **file matches live.** (Only the
  `storage.objects` policies differ cosmetically.)
- **Enums (N2):** none app-level — the schema is text+CHECK throughout; nothing enum to provision.

---

## Two beta scenarios, traced

**Taxable POS sale.** Create the product → INSERT rejects (8 missing columns). Past that,
`addProduct` → `folio_line_items` INSERT rejects (`product_id/unit_price/tax_amount/line_total/
category` missing). If the schema were patched but `tax_class` still absent → tax silently 0 on a
taxable good. **Fails at two INSERTs; silent-zero in the degraded case.**

**Real card charge.** Surcharge reads 0 (setting exists, defaults 0). The charge: `admin-card-payment`
debits Square first, then `folio_payments` INSERT rejects (`surcharge_amount/status/square_payment_id/
paid_at` missing) → **card charged, payment unrecorded (orphan).** Upstream, `reservations.surcharge_amount`
missing also breaks the online-booking insert. **Money taken, no record.**

---

## Curation — must NEVER provision

- **Backup / snapshot / platform tables** (exclude entirely): `_backup_email_cleanup_20260611`,
  `electric_readings_backup_20260714`, `products_taxclass_snapshot_20260716`,
  `reservations_backup_optionb`. **`resonation_clients`** is the platform tenant-registry — it holds
  other clients' `supabase_service_key`; categorically not a per-client table.
- **Seed rows** (all Cady-owned — provision the empty tables): `taxes` (PA 6%), `fees`
  (Transaction Fee), `discounts` (2 codes), `addons` (4), `categories` (6), `product_categories`
  (12), `pricing_rules` (9), `min_stay_rules` (3), `cancellation_rules` (3).
- **⚠️ Landmine — Cady-specific column DEFAULTS.** A `pg_dump` of live carries these into the file:
  `settings.admin_password DEFAULT 'Cady7777'`, `pos_enabled DEFAULT true`,
  `park_name DEFAULT 'My Campground'`, `extra_adult_fee 1000`, `total_sites 84`,
  `same_day_cutoff_message` with Cady's phone number.

  **Decision (admin_password — corrected mechanism, Phase 0):** `settings.admin_password` is
  **vestigial — write-only, nullable, and never read for auth.** Login is `password ===
  process.env.ADMIN_PASSWORD` (`app/api/admin-auth/route.ts`) + an `admin_session` cookie; the DB
  column governs nothing. So dropping its DEFAULT is **pure secret hygiene** — the point is to never
  commit Cady's password string (`'Cady7777'`, likely the same as the env var) into a shared file —
  **not** a lockout risk: the column is nullable, the insert simply omits it, and no login breaks.
  The **real per-client login secret is the `ADMIN_PASSWORD` env var**, provisioned by
  `resonation-admin` (Vercel) — that is where the "no shared secret" decision lands, **not** the SQL
  insert. (An earlier draft of this doc framed it as a settings-insert / NOT-NULL / onboarding-supplies
  coupling; that was wrong — corrected here.)
  **Log (do not fix — auth is a parked conversation):** the Settings page's "change admin password"
  field writes `settings.admin_password`, which nothing reads — a **dead no-op** for actual login.

  The other Cady-specific defaults (`pos_enabled`, `park_name`, `extra_adult_fee`, `total_sites`,
  `same_day_cutoff_message`) are removed by the allowlist rule in *Method*.
- **Live-only dead columns** to drop rather than enshrine: `settings.base_adult_rate`,
  `base_child_rate`, `primary_color`, `updated_at`.

---

## Method (for the eventual fix — not done here)

Because live-Cady **is** the as-built truth and the file is a different era, the correct rebuild is
**`pg_dump --schema-only` of Cady → curate**, not a hand-patch of the current file:
1. Dump the live schema (tables, constraints, indexes, RLS, grants, functions, triggers).
2. **Table structure comes wholesale from the live dump** — tables, columns, types, constraints,
   indexes, RLS, grants, functions, triggers. Take-everything: live is the source of truth, so
   structural completeness is correct-by-construction.
3. **Value-bearing content is ALLOWLIST, not blocklist.** Nothing encoding Cady's data or config
   survives unless provably generic to any client:
     - *Seed rows:* provision every table EMPTY. No data row travels. (The curation list above is a
       check, not the filter — the rule is "no rows.")
     - *Column defaults:* strip every default that encodes a value or config; keep only structural
       defaults (`gen_random_uuid()`, `now()`, `voided=false`, `tax_class='standard'`, folio/payment
       status defaults). Any default carrying a name, number, phone, credential, or count is removed.
       `admin_password` per the decision above.
     - *Tables:* exclude the backup/snapshot tables and `resonation_clients` (platform
       tenant-registry — holds other clients' service keys).
   Why allowlist: `admin_password` was caught only because someone inspected defaults. A blocklist
   removes what you remembered; an allowlist removes anything not affirmatively justified as generic,
   so the default nobody thought to look for is excluded by rule.
4. **Live-only dead columns** (`settings.base_adult_rate`, `base_child_rate`, `primary_color`,
   `updated_at`) — drop from provisioning. Confirm `updated_at` isn't trigger-maintained first.
5. Decide RLS posture deliberately (RLS-off as live, or RLS-on + allow-all as the file — both open).
6. Keep the RPCs, `sync_guest_from_reservation`/trigger, and `increment_discount_usage`.
7. Update the onboarding `DATABASE_SETUP_SQL` (`resonation-admin`) in lockstep — the "repo lies about
   the database" trap otherwise recurs for the next client.

   *Open question (log, decide before the rewrite ships):* two hand-maintained provisioning
   definitions (`database-setup.sql` and `resonation-admin`'s `DATABASE_SETUP_SQL`) is the exact
   mechanism that produced this drift. Decide whether one should derive from the other — or both be
   generated from the curated dump — so "keep in lockstep by hand" isn't a standing liability.

**Verification** has three parts; a structural diff alone can pass while a beta-fatal bug survives.
1. **Structural parity:** provision a scratch project from the regenerated file, re-run the
   `information_schema`/`pg_catalog` SELECTs used here, diff against live-Cady. Expect zero
   UNINTENDED drift — matches live except the documented curation (no backup/platform tables, no seed
   rows, stripped value-defaults, dropped dead columns, no `admin_password` default). Intentional
   differences are not failures.
2. **Scenario replay:** against the scratch client, run the actual shipped insert payloads for each
   previously-broken path and confirm each SUCCEEDS — product create, POS sale on a taxable good,
   card charge + `folio_payments` record, discount apply, Settings-save, online booking with a
   surcharge. This directly proves the beta-fatal cases are fixed.
3. **Anon path:** run the online-booking insert through the ANON key, not the service role — a
   service-role insert passes while anon fails on a missing grant/policy. `pg_dump --schema-only`
   carries GRANT statements, so regenerate should reproduce them for free; this asserts it rather
   than assuming it (closes the un-run L1).

---

## Blind spots — status

Closed by this pass: column contracts (P), RLS on/off (K1), policies (K2), routine grants (L2),
triggers (M), constraints incl. FK/CHECK/UNIQUE (N1), enums (N2), indexes (O), row inventory (Q),
storage buckets (R). Remaining, non-blocking: table grants to anon/authenticated (L1) did not run —
minor, since RLS posture is known; exact `storage.objects` policy reconciliation is cosmetic
(buckets match). A repo-vs-file diff still cannot see anything the SELECTs did not cover on tables
outside the sampled set — the "regenerate from a live dump" method sidesteps this by taking live as
the source of truth rather than diffing against it.

**File-derived findings need re-checking against live.** The live `site_type` CHECK contradicted a
T0 claim that was read off the file, not the DB. Since the file is a different era, any claim in T0
or `tax-model-spec.md` sourced from the file rather than live-verified is suspect. Before T2 relies
on the tax spec, flag which spec claims are file-derived and re-verify them against Cady.
