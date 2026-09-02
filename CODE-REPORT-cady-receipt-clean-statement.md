# Cady — the account statement email, rebuilt

**Branch:** `cady-receipt-clean-statement` off `main` (`f7fee6b`)
**Date:** 2026-09-02
**Nothing merged. NO EMAIL WAS SENT. `billing_mode` untouched — still NULL (= combined).**

---

## In plain English

When you press **Email statement** on a camper's account page, they used to get a wall of plain
text listing *every charge and every payment since the day their account opened* — for a seasonal
camper, years of electric bills — with the one number they actually wanted buried at the bottom.

They now get the clean statement you approved: a styled email with the last 30 days of activity,
oldest first, and the balance at the bottom. It looks like the mockup.

Three things worth knowing:

1. **Only the last 30 days is listed — but the balance is still the whole account.** Older charges
   and payments are not shown, and they are still counted. The line "Since August 3, 2026 · older
   items not shown" says so plainly, and the footer tells the camper to reply if they want the
   full history.
2. **The balance block changes with billing mode.** Right now (combined) they see one line: *Total
   balance due $33.00*. If you switch to separated, seasonal campers additionally get the two
   cards — **Camp Account** and **Seasonal** — above that total, matching what you see on screen.
3. **Nothing else about receipts changed.** The single-stay reservation receipt and the
   "Send seasonal receipt" button render exactly as they did.

**No email was sent to anyone.** I verified the layout by rendering it to files on my machine from
made-up data and opening them in a browser — see "How this was verified" below.

---

## What changed

| File | Lines | What |
|---|---|---|
| `lib/account-statement.ts` | **new**, 300 | The 30-day window, the ordering, the three balance wordings, and both renderers (HTML + text). Pure — no database, no email. |
| `lib/account-statement.test.ts` | **new**, 19 tests | Pins all of the above, including the empty state and the escaping. |
| `app/api/receipt/route.ts` | **+81 / −1** | One new branch that composes the data and calls the renderers. |

That single deleted line is the electric-ids gate, widened so the two cards classify against the
same electric signal every other balance uses:

```diff
-    if (laneReceipt && lineItems.length) {
+    if ((laneReceipt || statementBuckets) && lineItems.length) {
```

**Every other receipt branch in the route is byte-identical** — the whole rest of the diff is
additions. Verified by grepping the diff for deletions: that is the only one.

## Scope — what was and was not touched

| Path | Trigger | Result |
|---|---|---|
| **Account statement** | `receiptType: 'account'`, no `lane`, no reservation | **Rebuilt.** This task. |
| Reservation receipt | `receiptType: 'reservation'`, or any folio with a `reservation_id` | untouched |
| Lane receipt ("Send seasonal receipt") | `lane: 'seasonal' \| 'electric' \| 'store'` | untouched |
| Walk-up receipt | `receiptType: 'walkup'` | untouched — see below |

The gate is exact:

```js
const isAccountStatement = receiptType === 'account' && !onlyLane && !folio.reservation_id
```

### ⚠ The walk-up branch DID share the dump — and was left alone, as instructed

The task said to stop and flag this if it turned out to be true. It is: the old all-history
plain-text dump at the foot of the route is the `else` branch, reached by **both** the account
statement *and* a walk-up receipt. I did **not** change it. The new statement is gated on
`receiptType === 'account'` specifically, so a walk-up still gets the old renderer, unchanged.

**Two facts that make this low-stakes, both verified rather than assumed:**

- **Nothing in the app ever sends `receiptType: 'walkup'`.** Grepping every caller of
  `/api/receipt`, exactly two values are sent: `'reservation'` from the reservation folio
  (`app/admin/folio/[id]/page.tsx:971`) and `'account'` from the guest folio
  (`app/admin/folio/guest/[id]/page.tsx:935`). The walk-up branch is unreachable in practice.
- The one other way to reach it is an odd pre-existing edge — a lane-scoped receipt requested for a
  **non-seasonal** guest — which behaves exactly as it did before this change.

**Nothing is needed from you here** unless you want the walk-up path cleaned up too; say the word
and it is a small follow-up.

## The 30-day window

Hardcoded at 30 days, measured back from the moment the statement is sent, with a
`// TODO(statement-window)` marker where a per-park setting would attach. The setting, its Settings
field and its migration are deliberately **not** built — that is its own task, and a park without
the column must still get a statement.

- A charge is in the window if its `charged_at` is; a payment if its `paid_at` is.
- Rows are sorted **strictly ascending** by timestamp, charges and payments interleaved.
- Payments render **negative and green**; charges render positive in the ordinary text colour.
- A **refund** is a payment with a negative net, so it lands positive — correct, since money handed
  back increases what is owed — and reads "Card refund" rather than "Card payment".
- **No activity in the window** → one muted line, "No activity in the last 30 days", and the
  balance block still renders.
- A row with a missing or unparseable date is **dropped, not dated to today** — inventing a date
  would put old money at the top of a recent-activity list.

## The balance block — the only part that branches on billing mode

**Separated:** two cards — Camp Account (green) and Seasonal (gold) — then the whole-account total.
**Combined:** no cards, just the total.

Both come from the same server-side computation, never from the caller:

```js
const lanes = laneBalances(lineItems, payments || [], { electricLineItemIds: electricIds })
const accountBalance = lanes.accountBalance          // the closing total, both modes
const b = accountBuckets(lanes)                      // the two cards, separated only
```

- Voided charges excluded; payments net of surcharge — the same rule as every balance in the app.
- On an account folio there is no reservation, so `accountBalance` equals the `balanceRemaining`
  the route already computed. **The statement and the folio cannot disagree.**
- **Camp is the account remainder**, so the two cards always sum to the total. The fixture below
  proves it: Camp $33.00 + Seasonal $0.00 = $33.00 = the account balance.
- Three wordings, applied to each card and to the total: positive → "balance due" / "Total balance
  due"; zero → "paid up ✓" / "Paid in full ✓" (green); negative → "credit on account" /
  "Credit on account $X". **Neither a card nor the total ever prints a minus sign** — the wording
  carries it. Pinned by a test.
- Bucket labels come from `getBucketLabels()`, which reads its own guarded select and falls back to
  the built-in "Camp Account" / "Seasonal" when the columns are absent — which they are on Cady, by
  the 3B decision to skip that migration.

## How this was verified — NO EMAIL WAS SENT

**The renderers were deliberately moved out of the route and into `lib/account-statement.ts`,
precisely so this could be checked safely.** Composing the email inside the route would mean the
only way to look at it is to run the route — which needs the live database *and* a staff session,
and leaves a real send one flag away from a real camper.

Instead:

1. A local script built a **fixture folio** (invented data — no database was read) and called the
   exact same `renderAccountStatementHtml()` / `renderAccountStatementText()` the route calls.
2. The output was written to three HTML files: separated, combined, and the empty-activity state.
3. They were served on `127.0.0.1` and opened in a browser to check the layout against
   `RECEIPT-MOCKUP-clean-statement.html`. All three match. The server was stopped afterwards.
4. 19 unit tests pin the window, the ordering, the escaping, the empty state and the three balance
   wordings.

`preview: true` on the route was therefore **not needed and not used**, so the route was never
invoked against production at all. Resend was never called: `emails.send` sits after an
`if (isPreview) return`, and neither path ran.

### The fixture

Charges $155.98 (June/July/Aug/Sept electric, a store sale) + a $1,895.00 seasonal fee; payments
$126.98 + a $1,895.00 seasonal-tagged cheque; one **voided** "Cancelled packet" charge; one card
payment with a $0.75 surcharge. Account balance **$33.00** — Camp $33.00, Seasonal $0.00.

It exercises the things that matter: the voided charge never appears, the card payment shows net of
its surcharge (−$20.00, not −$20.75), and June's electric and the seasonal fee sit **outside** the
window — excluded from the list, still counted in the balance.

### Composed plain-text part — SEPARATED mode

```
ACCOUNT STATEMENT
Cady Hollow Campground · Port Allegany, PA
────────────────────────────────────────────
Hi Rian & Charissa — here's a summary of your account with us as of September 2, 2026.

ACTIVITY
Since August 3, 2026 · older items not shown

  Aug 5   August Electric                     $35.64
  Aug 8   Cash payment                        -$5.00
  Aug 14  Camp store — firewood x3            $24.00
  Aug 21  Card payment                       -$20.00
  Sep 1   September Electric                  $15.00
  Sep 2   Card payment · Square Terminal      -$1.00

────────────────────────────────────────────
Camp Account: $33.00 (balance due)
Seasonal: $0.00 (paid up ✓)
Total balance due: $33.00
────────────────────────────────────────────
This is a summary of recent activity, not your full history.
Need a complete statement or a specific receipt? Just reply and we'll send it.

Cady Hollow Campground · Port Allegany, PA
```

### Composed plain-text part — COMBINED mode (what Cady sends today)

```
ACCOUNT STATEMENT
Cady Hollow Campground · Port Allegany, PA
────────────────────────────────────────────
Hi Rian & Charissa — here's a summary of your account with us as of September 2, 2026.

ACTIVITY
Since August 3, 2026 · older items not shown

  Aug 5   August Electric                     $35.64
  Aug 8   Cash payment                        -$5.00
  Aug 14  Camp store — firewood x3            $24.00
  Aug 21  Card payment                       -$20.00
  Sep 1   September Electric                  $15.00
  Sep 2   Card payment · Square Terminal      -$1.00

────────────────────────────────────────────
Total balance due: $33.00
────────────────────────────────────────────
This is a summary of recent activity, not your full history.
Need a complete statement or a specific receipt? Just reply and we'll send it.

Cady Hollow Campground · Port Allegany, PA
```

### Composed HTML — SEPARATED mode

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#eceff1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#2E6B8A 0%,#1e4f6b 100%);background-color:#2E6B8A;padding:32px 40px;text-align:center;">
<div style="font-size:38px;margin-bottom:6px;">&#127957;&#65039;</div>
<h1 style="margin:0;color:#fff;font-size:21px;font-weight:700;letter-spacing:-0.3px;">Account Statement</h1>
<p style="margin:6px 0 0;color:rgba(255,255,255,0.82);font-size:14px;">Cady Hollow Campground · Port Allegany, PA</p>
  </div>
  <div style="padding:30px 40px 34px;">
<p style="margin:0 0 22px;font-size:15px;color:#374151;line-height:1.55;">Hi Rian &amp; Charissa &mdash; here&apos;s a summary of your account with us as of September 2, 2026.</p>

<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;">Activity</p>
<p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">Since August 3, 2026 &middot; older items not shown</p>
<table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#9ca3af;width:64px;white-space:nowrap;">Aug 5</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#374151;">August Electric</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;text-align:right;white-space:nowrap;color:#374151;">$35.64</td></tr>
          <tr><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#9ca3af;width:64px;white-space:nowrap;">Aug 8</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#374151;">Cash payment</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;text-align:right;white-space:nowrap;color:#15803d;font-weight:600;">&minus;$5.00</td></tr>
          <tr><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#9ca3af;width:64px;white-space:nowrap;">Aug 14</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#374151;">Camp store — firewood x3</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;text-align:right;white-space:nowrap;color:#374151;">$24.00</td></tr>
          <tr><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#9ca3af;width:64px;white-space:nowrap;">Aug 21</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#374151;">Card payment</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;text-align:right;white-space:nowrap;color:#15803d;font-weight:600;">&minus;$20.00</td></tr>
          <tr><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#9ca3af;width:64px;white-space:nowrap;">Sep 1</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#374151;">September Electric</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;text-align:right;white-space:nowrap;color:#374151;">$15.00</td></tr>
          <tr><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#9ca3af;width:64px;white-space:nowrap;">Sep 2</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;color:#374151;">Card payment · Square Terminal</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;text-align:right;white-space:nowrap;color:#15803d;font-weight:600;">&minus;$1.00</td></tr>
    </table>

<div style="margin-top:22px;border-top:2px solid #e5e7eb;padding-top:18px;">
  
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:6px;">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 18px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#15803d;">Camp Account</p>
          <div style="font-size:24px;font-weight:800;letter-spacing:-.5px;color:#15803d;">$33.00</div>
          <div style="font-size:11px;font-weight:600;margin-top:2px;color:#166534;">balance due</div>
        </div>
        </td>
        <td style="width:50%;vertical-align:top;padding-left:6px;">
        <div style="background:#FFFBEB;border:1px solid #fde68a;border-radius:12px;padding:16px 18px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#B4842B;">Seasonal</p>
          <div style="font-size:24px;font-weight:800;letter-spacing:-.5px;color:#B4842B;">$0.00</div>
          <div style="font-size:11px;font-weight:600;margin-top:2px;color:#a16207;">paid up ✓</div>
        </div>
        </td>
      </tr>
    </table>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <tr>
      <td style="border-top:1px solid #f3f4f6;padding-top:14px;font-size:15px;font-weight:700;color:#111827;">Total balance due</td>
      <td style="border-top:1px solid #f3f4f6;padding-top:14px;font-size:22px;font-weight:800;text-align:right;color:#dc2626;">$33.00</td>
    </tr>
  </table>
</div>

<p style="margin:22px 0 0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;">This is a summary of recent activity, not your full history.<br>Need a complete statement or a specific receipt? Just reply and we&apos;ll send it.</p>
  </div>
  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">Cady Hollow Campground · Port Allegany, PA</p>
<p style="margin:5px 0 0;color:#d1d5db;font-size:11px;">Thank you for being part of our community &#127957;&#65039;</p>
  </div>
</div>
</body>
</html>
```

---

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | **clean** |
| `next build` | **compiles** |
| Pure test suite (34 files) | **766 / 766**, 0 fail — was 747, +19 new |
| New lint findings | **none** — `receipt/route.ts` is at **28 errors / 0 warnings**, identical to `main`; the two new lib files contribute **zero** |
| Fee-model diff (`ledger.ts`, `booking-quote.ts`, `pricing.ts`) | **EMPTY** ✅ |
| Files changed | **3** — 1 modified, 2 new |
| Schema change | **none** |
| Emails sent | **ZERO** |
| `billing_mode` | untouched — **NULL** |

⚠️ `api-auth`, `payment-route`, `supabase-cookie` deliberately **not run**: `.env.local` points at
the live database. **Nothing was written to production, and nothing was read from it either** —
the verification used fixtures only.

## Guardrails honoured

- **Branch + PR, no merge, no deploy.** `origin/main` untouched.
- **No email sent.** Verified from fixtures, not from a live folio.
- **No schema change, no migration.**
- **Fee model empty diff.**
- **Cady divergences preserved** — env-token Square, `middleware.ts`, `lib/statement-html.ts`
  (untouched; the new renderers are deliberately named `renderAccountStatement*` to avoid colliding
  with Cady's existing `renderStatementHtml`).
- **No writing test against the live DB.**

## Recommendation

Merge it, then send yourself one statement from your own account page to see it land in a real
inbox before any camper gets one. Your folio is the right one to test with — it is the fixture this
was modelled on, and you are not a paying guest.

Two things I would pick up next, separately: the **walk-up branch** still on the old dump (harmless
today, since nothing sends that type), and making the **30-day window a setting** if 30 turns out to
be the wrong length in practice.
