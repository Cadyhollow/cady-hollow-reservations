# Cady 3B-5 — the separated-mode folio payment path, fixed

**Branch:** `cady-3b5-fix-separated-payment-path` off `main` (`f7fee6b`, i.e. after #52/#53/#54)
**Date:** 2026-09-02
**Nothing merged. Nothing deployed. `settings.billing_mode` untouched — still NULL (= combined).**

---

## In plain English

Separated billing was switched on, and the seasonal campers' folio page broke in two ways. Both are
fixed here, on a branch, so you can look at it before anything goes live.

**The blocker:** the big blue "Collect Payment" button at the bottom of a seasonal camper's account
page sent staff to a page this park doesn't have. It showed an error instead of a payment screen.
Worse, the Camp / Seasonal / Pay-both buttons I built last week live *inside* the payment box that
button was supposed to open — so for the exact campers they were built for, they could never be
reached at all. **That one is my miss.** I built the doors and never walked the path to them.

**The confusing part:** that same page showed a box per category — Electric, Store, Seasonal,
Unassigned — each with an amount labelled *due*. Almost none of this park's payments are labelled
with a category (15 out of 652), so all the money that had actually been paid piled into
"Unassigned" while each category still showed its full charges as owed. The page was telling staff
a camper owed for electric and store charges they had already paid.

**What it looks like now:** one "Collect Payment" button that opens the payment box in both modes,
with Camp / Seasonal / Pay both waiting inside for seasonal campers. Above it, the same two cards —
**Camp Account** and **Seasonal** — you already see on the campers page and the guest directory.

**And the long list of transactions is now folded away by default** on a seasonal camper's page, in
separated mode. So opening a camper is: two cards, a one-line "View transaction history" you can
tap, and the Collect Payment button — instead of scrolling past a year of entries to reach the
button. Nothing was deleted: tap the line and the whole ledger opens, every row, exactly as before.

**In combined mode — which is what the park is running right now — this page is unchanged.** Every
addition is switched off unless separated mode is on.

---

## Bug 1 — the 404. Fixed.

`app/admin/folio/guest/[id]/page.tsx`. Before, one button for separated campers, another for
everyone else:

```js
{laneView ? (
  <button onClick={() => router.push(`/admin/checkout?guestId=${guestId}`)}>…   // ← no such route
) : (
  <button onClick={() => { …setShowPayment(true) }}>…                            // ← the real modal
)}
```

`app/admin/checkout/` **does not exist in this repo** (verified: `ls` → No such file or directory).

Now there is **one** button. Both modes call `setShowPayment(true)`; the only difference is what is
pre-selected, and both decide it the same way — *by what is actually outstanding*:

| Mode | Pre-selects | Amount pre-filled |
|---|---|---|
| **Separated + seasonal** | the **Seasonal** door if a seasonal balance is outstanding, else **Camp** | that bucket's own balance, from `buckets[b].balance` |
| **Combined** (today) | Seasonal lane if a seasonal fee is outstanding, else whole account | unchanged — `seasonalDue` or `totalDue` |

The combined branch is the pre-existing code moved into an `else`, **character for character**:
same `seasonalDue` derivation, same `setPaymentLane`, same prefill rule, same
`setCashTendered(''); setShowPayment(true)`, same button `style`, same label. Diffed against
`main` line by line.

The `router.push('/admin/checkout…')` call is **gone**. The only `/admin/checkout` text left in
this file is the comment explaining what used to be there and why it was wrong.

## Bug 2 — the phantom per-lane view. Removed.

The ~85-line `laneView` grouped block is deleted. In its place:

1. **`AccountBucketCards`** above the ledger, gated on `laneView && buckets` — the same component
   and therefore the same two-account framing as the campers page and the guest directory.
2. **The flat chronological ledger now renders in BOTH modes.** Its gate changed from
   `ledgerEvents.length > 0 && !laneView` to `ledgerEvents.length > 0`. In combined mode
   `laneView` is already `false`, so this is a no-op there — it only means separated mode *keeps*
   the audit trail instead of swapping it out.
3. **No per-lane subtotal labelled "due" remains anywhere on the page.**

**Camp cannot overstate, by construction.** It is the *account remainder* — the true account
balance minus the seasonal half — not "camp charges minus camp-tagged payments". So the two cards
always sum to the account balance the ledger prints beneath them, no matter how few payments carry
a lane.

### Nothing was lost with it
The grouped view did one useful thing the cards and the ledger don't: a **"File this payment
under…" / "Move to…"** picker to tag a payment's lane. That control has been **relocated onto the
ledger rows themselves**, still gated `laneView && …` so it never appears in combined mode. It sets
`lane` and nothing else — no amount moves, so the account balance cannot change, only which bucket
the money offsets.

## 2b — the ledger now folds by default (added to the task after the first pass)

On a **separated + seasonal** folio the two cards are the primary view, so the chronological ledger
**collapses behind a toggle** and opens on tap:

```
▸ VIEW TRANSACTION HISTORY                                    47 entries
```

Everyday use is now **two cards → Collect Payment**, with the ledger one tap away instead of
dominating the screen and pushing the payment button below the fold.

**Folded, never removed.** Opening it restores the complete ledger — every row, the existing
"Show earlier activity" fold, the lane pickers, and the totals footer. Nothing is filtered; the
audit trail is intact, just not the first thing on screen. The toggle carries `aria-expanded` and
the entry count, so what is behind it is stated rather than hidden.

**Combined mode cannot fold.** The gate is:

```js
const ledgerOpen = !laneView || showLedger
```

`!laneView` short-circuits **before** `showLedger` is ever consulted, so on a combined-mode folio
the ledger is open unconditionally — the toggle is not rendered at all, and flipping the state could
not close it even if something tried. Combined renders the original header row and body exactly as
today.

### One judgment call, easy to reverse
A separated seasonal folio now shows **three** ways to start a payment: a "Take a payment" button on
each card (which opens straight onto that account's door) and the big **Collect Payment** button
below (which picks the door by what is outstanding). I kept all three, because the task describes
the target as "two cards + the Collect Payment button" and the per-card buttons *are* the doors this
PR exists to make reachable. If it reads as clutter on the real screen, dropping the per-card
buttons is a one-line change — remove `onTakePayment` from the `AccountBucketCards` call and the
cards go back to being display only. Say the word.

---

## The `/admin/checkout` sweep — every hit in the repo

| # | File:line | What it is | Resolution |
|---|---|---|---|
| 1 | `app/admin/seasonals/SeasonalSections.tsx:136` | **comment only** — my 3B-2 note recording the divergence | none needed. Live `payHref` → `/admin/folio/guest/${g.id}?bucket=${bucket}` ✓ |
| 2 | `app/admin/seasonals/page.tsx:256` | **comment only** — same divergence note | none needed. Live `href` → `/admin/folio/guest/${r.guest_id}` ✓ |
| 3 | `app/admin/folio/guest/[id]/page.tsx:867` | **the live `router.push` — the bug** | **removed.** Replaced by the in-page modal |

**Live routes to `/admin/checkout` when done: ZERO.** ✓

### Every route reached from a `separated`/`laneView`-gated branch — target existence proven

| Target | From | Exists? |
|---|---|---|
| `/admin/folio/guest/[id]` | SeasonalSections `payHref`, guests page, electric-billing ×2 | ✅ `app/admin/folio/guest/[id]/page.tsx` |
| `/admin/seasonals` | dashboard, electric-billing | ✅ |
| `/admin/seasonals/[guestId]` | guests page (`justFlagged`) | ✅ — and this link is **byte-identical on `main`**, not separated-gated |
| `/admin/seasonals/meters` | electric-billing | ✅ |
| `/admin/electric-billing` | SeasonalSections, dashboard | ✅ |
| `/admin/guests?mode=payment` | dashboard | ✅ |

### Other separated surfaces presenting a per-lane figure as "due"

Checked all four. **None found.**

- `app/admin/guests/page.tsx:465` — two lines, `labels.camp` / `labels.seasonal`, Camp as the
  remainder. Two accounts, not lanes. ✓
- `app/components/AccountBucketCards.tsx` — two cards only. "Electric, store and everything else"
  is the Camp card's *subtitle*, not a figure. ✓
- `app/admin/electric-billing/page.tsx` — `shownBalance` shows the **Camp** balance via
  `campFromAccount` / `seasonalBalanceOf`. ✓
- `app/admin/folio/guest/[id]/page.tsx` — fixed here. ✓

One deliberate non-hit: `ReceiptButtons` (`folio/guest/[id]` ~line 893) still passes the seasonal
lane's `charges` / `paid` — that is **data for the seasonal receipt**, which is genuinely about the
seasonal lane, and it passes an explicit `untagged` figure alongside so it is honest about
unlabelled money. Not a balance shown as owed. Left alone.

---

## Every seasonal-payment entry point, traced in code

The root failure was a door built and never connected, so here is every path to "take a payment"
for a seasonal camper in separated mode, one by one.

### 1. Admin dashboard → `app/admin/page.tsx:547`
Tile "Take a Payment" → `/admin/guests?mode=payment`. Route exists. It is a **hand-off to entry
point 3**, not a payment screen of its own. There is no other payment link on the dashboard
(all 11 tiles listed and checked). **✓ reaches the modal, via 3.**

### 2. Seasonal camper page → `app/admin/seasonals/[guestId]/page.tsx:536` → `SeasonalSections.tsx:133`
Renders `AccountBucketCards` with
`payHref={bucket => `/admin/folio/guest/${g.id}?bucket=${bucket}`}` (line 141), plus a
"Take a payment" link at line 173 that adds `?bucket=seasonal` in separated mode. Both land on the
guest folio **with the bucket in the URL**, which entry point 4 consumes. **✓ opens the modal on
the right door.**

### 3. Guest directory → `app/admin/guests/page.tsx:425`
In `?mode=payment`, tapping a row runs `router.push('/admin/folio/guest/' + g.id)`. Route exists.
No `?bucket=`, so the folio applies its own default. The row itself shows Camp / Seasonal as two
figures (line 465). **✓ reaches the modal.**

### 4. Guest folio → `app/admin/folio/guest/[id]/page.tsx` — **the one that was broken**
Two ways in, both now correct:
- **The `?bucket=` deep link** (from 2): read at line 149 into a `useRef`, consumed at line 601 in
  an effect that waits for `buckets` to exist before firing — so it can never pre-fill `$0.00` and
  quietly offer to take nothing — then `setPayBucket(want)` + `setShowPayment(true)`. One-shot: the
  ref is cleared, so it never fights an operator who picks a different door.
- **The "Collect Payment" button** (line ~843): **fixed in Bug 1 above.** Opens the modal in both
  modes.

Inside the modal, gated `laneView && buckets` (line ~983): **Camp Account / Seasonal / Pay both**.
Otherwise the original four boxes, untouched. **✓ the doors are now reachable.**

### 5. Electric billing → `app/admin/electric-billing/page.tsx:992, 1477`
`folio-receipt` and a card payment both `router.push('/admin/folio/guest/' + row.guest.id)` — into
entry point 4. Route exists. **✓ reaches the modal.**

### 6. Reservation folio → `app/admin/folio/[id]/page.tsx` — **states its behaviour, as asked**
This page has **no** `billingMode`, **no** `is_seasonal`, **no** `paymentLane`, and **no**
`/admin/checkout`. Its payment button (line 962) prefills `totalDue` and opens its own modal.

**So yes, a seasonal camper's payment can be taken here — and it records as an untagged payment
against that reservation's folio.** In separated mode an untagged payment *is* Camp money (Camp is
the account remainder), so it lands in the Camp account and the two cards still sum correctly. It
is not wrong, but it offers no Seasonal door: a seasonal fee taken on this screen files as Camp.
Adding the cards here was **explicitly deferred** in the 3B plan (215 lines of drift, lowest
value). Left as-is; flagging it so it is a known limitation, not a surprise.

---

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | **clean** |
| `next build` | **compiles** |
| Pure test suite (33 files) | **747 / 747**, 0 fail — same as the 3B-1 baseline |
| New lint findings | **none** — the changed file lints **8 problems (7 errors, 1 warning)** on both `main` and this branch, same rules, line numbers shifted only |
| Fee-model diff (`ledger.ts`, `booking-quote.ts`, `pricing.ts`) | **EMPTY** ✅ |
| Files changed | **1** — `app/admin/folio/guest/[id]/page.tsx` (+151 / −117) |
| Template-only code riding along | **none** — grepped for `square_connections`, `getSquareCredentials`, `square-oauth`, `settleTerminalCheckout`, `proxy.ts`, `allowBeyondHorizon` |
| Schema change | **none** |
| Combined mode | **unchanged** — see below |

⚠️ `api-auth`, `payment-route`, `supabase-cookie` deliberately **not run**: `.env.local` points at
the live database. **Nothing was written to production.**

### Proof that combined mode is unchanged
Every added non-comment line in the diff was extracted and checked. It is, in full:
- the `AccountBucketCards` import;
- one block gated `{laneView && buckets && (…)}` — the cards;
- one control gated `{laneView && ev.paymentId && …}` — the lane picker;
- `{ledgerEvents.length > 0 && (` — a **widening** of a gate that combined mode already passed;
- the button's `if (laneView && buckets) { … } else { … }`, whose `else` is `main`'s existing code
  verbatim;
- **(2b)** `const [showLedger] = useState(false)` — inert unless read; `ledgerOpen = !laneView ||
  showLedger` — **`true` in combined, always**; a `{laneView ? <toggle> : <original header div>}`
  whose `else` is the existing markup unchanged; a `{laneView && …}` column-heading row; and a
  fragment wrapper `{ledgerOpen && (<>…</>)}` that always renders in combined and adds no DOM.

`laneView` is `billingMode === 'separated' && !!guest?.is_seasonal`, and `billing_mode` is NULL, so
on the live park **every one of these is off.**

---

## Guardrails honoured

- **No merge. No push to `main`. No deploy.** Branch + PR only.
- **`billing_mode` NOT flipped** — still NULL. The flip stays a deliberate Tier-3 step for
  Charissa after review.
- **No schema change, no migration.**
- **Fee model empty diff**, proven above.
- **Cady divergences preserved** — env-token Square, `middleware.ts`, the electric void/`billGuard`
  flow, `renderStatementHtml`. None of those files is in the diff; only one file changed.
- **No writing test against the live DB.**

## Recommendation

Read the PR, then re-flip `billing_mode` to `'separated'` **off-peak** and check one seasonal
camper's folio: you should see the two cards, a **"View transaction history"** line, and the
Collect Payment button — no long list of entries until you tap. Tap it: the full ledger opens, and
the balance at its foot should equal the two cards added together. Then press **Collect Payment** —
it should open a box offering **Camp Account / Seasonal / Pay both**.
If anything looks wrong, setting `billing_mode` back to NULL restores today's behaviour instantly —
nothing here changes stored data.

The one thing I'd fix next, separately: **entry point 6**, the reservation folio, so a seasonal fee
can't be filed as Camp money by taking it on the wrong screen.
