# `database-setup.sql` — verification kit

Run against a **fresh throwaway scratch Supabase project** provisioned by pasting the regenerated
`database-setup.sql` into its SQL editor. Zero DDL touches Cady/Template/Lakeshore. Three parts;
a structural diff alone can pass while a beta-fatal bug survives, so parts 2 and 3 run the real
inserts.

---

## Part 1 — Structural parity (scratch vs live-Cady)

On the scratch project, re-run the same catalogue SELECTs used in the reconciliation (P, K1, K2,
L1, L2, M, N1, N2, O, R) and diff against the live-Cady outputs. Expect **zero UNINTENDED drift** —
scratch matches live **except** these **documented, intentional** differences (not failures):

- **Tables absent** on scratch: `_backup_email_cleanup_20260611`, `electric_readings_backup_20260714`,
  `products_taxclass_snapshot_20260716`, `reservations_backup_optionb`, `resonation_clients`.
- **Zero data rows** everywhere except **one** `settings` row.
- **Dropped columns** on `settings`: `base_adult_rate`, `base_child_rate`, `primary_color`, `updated_at`.
- **Neutralized column defaults**: `settings.admin_password` (no default), `park_name` (no default),
  `extra_adult_fee` 1000→0, `extra_child_fee` 500→0, `accent_color` `#3DBDD4`→`#2D6A4F`,
  `season_start`/`season_end` → no default, `plan` ridgeline→trailhead, `pos_enabled` true→false,
  `total_sites` 84→0, `total_cabins` 3→0, `waiver_enabled` true→false, `same_day_cutoff_message`
  (Cady phone → generic); `electric_readings.rate_per_kwh` 0.27→0, `minimum_charge` 1500→0.
- **Storage** `objects` policies are the clean named set (not live's auto-named `mjc347_*`) — functionally identical.

Everything else — every kept table's columns/types/NOT NULL/CHECK/UNIQUE/FK, all indexes, the RLS
on/off split, the policies, the table & sequence GRANTs, the 4 functions, the trigger — must match live.

Focused assertions after Part 1:
```sql
-- admin_password carries NO default
SELECT column_default FROM information_schema.columns
WHERE table_name='settings' AND column_name='admin_password';           -- expect: NULL

-- exactly one settings row, all-neutral (no Cady data)
SELECT count(*) FROM settings;                                          -- expect: 1
SELECT park_name, park_phone, extra_adult_fee, total_sites, total_cabins,
       pos_enabled, plan, accent_color, waiver_enabled, admin_password
FROM settings;
-- expect: New Campground | '' | 0 | 0 | 0 | false | trailhead | #2D6A4F | false | NULL

-- the RLS-off tables really are off (parity)
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace='public'::regnamespace
  AND relname IN ('products','folios','folio_line_items','folio_payments',
                  'electric_readings','terminal_checkouts','product_categories','guests');
-- expect: all rls_enabled = false
```

---

## Part 2 — Scenario replay (the six previously-broken paths must SUCCEED)

Run top-to-bottom on the scratch project (service-role SQL editor). Each statement must succeed;
capture the `RETURNING` ids to thread through. These mirror the shipped code's insert payloads.

```sql
-- A test site (also proves sites insert + the site_type CHECK)
INSERT INTO sites (site_number, site_type, base_rate, amp_service, hookups)
VALUES ('T1', 'rv_site', 5000, '30amp', 'full') RETURNING id;                     -- :site_id

-- 1) PRODUCT CREATE  (products/page.tsx payload)
INSERT INTO products (name, description, category, price, tax_class, track_inventory,
                      stock_quantity, active, display_order, variable_price)
VALUES ('Test Firewood', 'bundle', 'Camping Supplies', 800, 'standard', false,
        NULL, true, 0, false) RETURNING id;                                       -- :product_id

-- 2) POS SALE on a taxable good  (folio open + folio_line_items with tax baked into line_total)
INSERT INTO folios (folio_type, status, guest_name, guest_email)
VALUES ('walkin', 'open', 'Test Guest', '') RETURNING id;                         -- :folio_id
INSERT INTO folio_line_items (folio_id, product_id, description, quantity,
                              unit_price, tax_amount, line_total, category, notes)
VALUES (:'folio_id', :'product_id', 'Test Firewood', 1, 800, 48, 848, 'Camping Supplies', NULL)
RETURNING id;                                                                     -- proves tax_amount/line_total

-- 3) CARD CHARGE record  (admin-card-payment folio_payments insert)
INSERT INTO folio_payments (folio_id, method, amount, surcharge_amount, status, square_payment_id, note)
VALUES (:'folio_id', 'card', 878, 30, 'completed', 'sq_test_123', 'Test card payment')
RETURNING id;                                                                     -- proves surcharge_amount/status/square_payment_id

-- 4) DISCOUNT apply  (discount_type/discount_value + the increment RPC on times_used)
INSERT INTO discounts (code, discount_type, discount_value, is_active)
VALUES ('TEST10', 'percent', 10, true) RETURNING id;
SELECT increment_discount_usage('TEST10');
SELECT times_used FROM discounts WHERE code='TEST10';                             -- expect: 1

-- 5) SETTINGS-SAVE  (the columns the old file lacked — must not error on unknown column)
UPDATE settings SET
  auto_sync_guests = true, deposit_type = 'percentage', deposit_value = 50,
  custom_payment_methods = '{Venmo,Zelle}'::text[], maintenance_mode = true,
  maintenance_message = 'Back soon', extra_adult_fee = 1000, total_sites = 50;

-- 6) ONLINE BOOKING with surcharge  (api/payment reservation insert)
INSERT INTO reservations (site_id, status, arrival_date, departure_date, num_adults, num_children,
  guest_name, guest_email, guest_phone, base_nightly_rate, total_price, amount_paid, payment_type,
  surcharge_amount, early_checkin, early_checkin_fee, late_checkout, late_checkout_fee,
  fees_total, discount_amount)
VALUES (:'site_id', 'confirmed', '2026-08-01', '2026-08-03', 2, 0,
  'Test Booking', 'test@example.com', '5551234', 5000, 10350, 10350, 'full',
  350, true, 3000, false, 0, 0, 0) RETURNING id;                                 -- proves surcharge_amount + early_checkin*
```
All six succeed → the beta-fatal INSERT failures are fixed. (In the SQL editor without `psql`
variables, paste the returned ids in place of `:'folio_id'` / `:'product_id'` / `:'site_id'`.)

---

## Part 3 — Anon path (booking through the anon role, not service role)

A service-role insert can pass while anon fails on a missing grant/policy. Run the booking insert
as **anon**:

**Option A — in the SQL editor:**
```sql
SET ROLE anon;
INSERT INTO reservations (status, arrival_date, departure_date, num_adults, num_children,
  guest_name, guest_email, base_nightly_rate, total_price, surcharge_amount)
VALUES ('confirmed', '2026-08-05', '2026-08-07', 2, 0,
        'Anon Test', 'anon@example.com', 5000, 10000, 0);
RESET ROLE;
-- must succeed → proves the "Allow public insert for booking" anon policy + GRANT are present
```

**Option B — via the REST API with the scratch project's ANON key** (most faithful to the app):
```bash
curl -sS -X POST "$SCRATCH_URL/rest/v1/reservations" \
  -H "apikey: $SCRATCH_ANON_KEY" -H "Authorization: Bearer $SCRATCH_ANON_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"status":"confirmed","arrival_date":"2026-08-05","departure_date":"2026-08-07",
       "num_adults":2,"num_children":0,"guest_name":"Anon Test","guest_email":"anon@example.com",
       "base_nightly_rate":5000,"total_price":10000,"surcharge_amount":0}'
# HTTP 201 → anon booking works
```
Also confirm anon can **read** what booking needs:
```bash
curl -sS "$SCRATCH_URL/rest/v1/settings?select=park_name" -H "apikey: $SCRATCH_ANON_KEY"   # 1 row
curl -sS "$SCRATCH_URL/rest/v1/sites?select=site_number" -H "apikey: $SCRATCH_ANON_KEY"     # ok
```

---

## Pass criteria
- **Part 1:** zero drift beyond the documented curation list; the focused assertions hold.
- **Part 2:** all six statements succeed.
- **Part 3:** the anon booking insert returns success and anon reads of `settings`/`sites` work.

If all three pass, the regenerated `database-setup.sql` provisions a working, current-generation,
Cady-data-free client. (Delete the scratch project afterward.)
