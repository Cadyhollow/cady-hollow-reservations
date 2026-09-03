// THE PAYMENT MODAL'S ARITHMETIC — the part that turns typed strings into money.
//
// Extracted from the folio's Collect Payment modal so it can be tested without a browser, because
// the bug it exists to prevent was invisible to every other kind of check: the page compiled, the
// types were right, and the modal rendered "Amount short $NaN".
//
// ── THE RULE THIS MODULE ENFORCES ─────────────────────────────────────────────────────────────
//
// A BLANK AMOUNT BOX IS ZERO, NEVER NaN.
//
// `parseFloat('')` is NaN, and NaN is the worst possible value here because it is silent: every
// comparison against it is false, so `tendered >= amount` failed and the modal concluded the cash
// was SHORT; `Math.abs(NaN).toFixed(2)` then printed "$NaN" as the figure. The Record button
// showed "$NaN" for the same reason. Nothing threw and nothing was logged.
//
// It mattered because of a real workflow, not a hypothetical one: when the bucket being paid into
// is already settled — a seasonal camper paying early to hold next season's spot, before the
// contract exists — there is nothing to pre-fill, so the box is empty by design. That is exactly
// when the arithmetic met a blank string.
//
// ⚠ NO MONEY IS DECIDED HERE. This chooses no lane, applies no surcharge and writes nothing. It
// converts and compares, so that the modal's label, its button and its writer can all read the
// same number instead of deriving it three times and disagreeing.

/**
 * A typed amount box as integer cents. Blank, whitespace, a lone ".", or junk all read as ZERO.
 *
 * Rounded, because a browser number input hands back a string and `19.99 * 100` is 1998.9999…
 */
export function centsOf(value: string | null | undefined): number {
  const n = Math.round(parseFloat(String(value ?? '')) * 100)
  return Number.isFinite(n) ? n : 0
}

export type RecordAmountInput = {
  /** The whole-account balance in cents. Zero means the account is settled. */
  totalDueCents: number
  /** The tender: 'cash', 'card', 'check', a park's custom method — anything. */
  method: string
  /** The amount box, as typed. */
  amount: string
  /** The cash-tendered box, as typed. Ignored for every non-cash tender. */
  tendered: string
}

/**
 * What this tender will actually record, in cents.
 *
 * ⚠ ONE DERIVATION, THREE CONSUMERS — the button's label, the button's enablement, and the write.
 * They were three separate expressions in the modal, which is how the label could offer "$NaN"
 * while the writer silently refused it: the button invited a click that did nothing at all.
 *
 * CASH IS THE ONLY TENDER WITH A SECOND BOX. When a tender has been entered, the recorded figure
 * is the smaller of tendered and amount — handing over less than the asking price records what was
 * actually handed over, and handing over more records the amount, with the excess given back as
 * change rather than banked. An empty tendered box means the operator is not counting cash into
 * the drawer against a fixed price, so the typed amount stands.
 *
 * On a settled account (`totalDueCents === 0`) the typed amount always stands: there is no price
 * to be short of, so a prepayment is simply what was typed.
 */
export function recordAmountCents(input: RecordAmountInput): number {
  const amountCents = centsOf(input.amount)
  if (input.totalDueCents === 0) return amountCents
  if (input.method === 'cash' && String(input.tendered ?? '') !== '') {
    return Math.min(centsOf(input.tendered), amountCents)
  }
  return amountCents
}

/** Nothing typed, nothing recorded. Blocks $0 and — by construction — anything that was NaN. */
export function canRecordAmount(input: RecordAmountInput): boolean {
  return recordAmountCents(input) > 0
}

export type CashState = {
  /** True when the cash handed over is less than the amount being recorded against. */
  short: boolean
  /** The gap either way, in cents — change owed back, or the shortfall. Never negative. */
  differenceCents: number
}

/**
 * Change due, or how far short the cash is.
 *
 * ⚠ "SHORT" IS MEASURED AGAINST THE TYPED AMOUNT, NOT AGAINST THE ACCOUNT. A freely-typed
 * prepayment must never be flagged short merely because the account owes something elsewhere —
 * that was the other half of the NaN bug, and it would have told an operator taking $375 to hold a
 * site that they were short.
 *
 * Equal amounts are not short: paying exactly is the ordinary case.
 */
export function cashState(tenderedCents: number, amountCents: number): CashState {
  return {
    short: tenderedCents < amountCents,
    differenceCents: Math.abs(tenderedCents - amountCents),
  }
}

/**
 * Is what was selected already settled, so anything typed is a PREPAYMENT?
 *
 * ⚠ ASKED OF THE SELECTION, NEVER OF THE WHOLE ACCOUNT. A camper can owe electric while the
 * seasonal door being paid into is settled; keying this off the account balance is what left the
 * amount box empty AND read-only, with no way forward. A credit balance (negative) is settled too.
 */
export function isPrepayment(selectedDueCents: number): boolean {
  return selectedDueCents <= 0
}

// ── THE CREDIT CAP, AND WHO IT IS FOR ─────────────────────────────────────────────────────────

/** A payment's lane tag reads as seasonal. Trimmed and case-folded, like every other lane test. */
export function isSeasonalLane(lane: string | null | undefined): boolean {
  return String(lane ?? '').trim().toLowerCase() === 'seasonal'
}

/**
 * How much of a payment's credit the `max_credit_amount` cap applies to.
 *
 * ⚠ THE CAP IS FOR EVERYDAY MONEY. It exists to catch a MISTYPED overpayment — a store tab or an
 * electric bill fat-fingered into a large accidental credit — and for that it is exactly right.
 *
 * ⚠ IT IS WRONG FOR A SEASONAL PAYMENT, AND NOT MARGINALLY. A season deposit onto a settled
 * seasonal account IS a credit; that is what a deposit is. So the cap fired on every one of them:
 * a $375 deposit against a $50 cap asked the operator "this exceeds the $50 credit limit, add
 * anyway?" on a routine payment, and the cash path went further and suggested handing the money
 * back as change. A deposit that is handed back is not a deposit.
 *
 * So the cap is SCOPED, not weakened. The limit is unchanged and no everyday payment escapes it —
 * seasonal money simply stops being measured against a rule written for a different kind of money.
 *
 * The LANE TAG is the test, deliberately: it is exactly what will be written on the row, so what
 * the cap does and what the ledger records can never disagree.
 */
export function creditSubjectToCap(creditCents: number, lane: string | null | undefined): number {
  if (isSeasonalLane(lane)) return 0
  return Math.max(0, creditCents)
}

/**
 * Does this payment's credit break the cap?
 *
 * ONE definition, used by the modal's warning banner, its disabled-button state AND the confirm in
 * the writer — so a screen can never warn about something the writer would wave through, or the
 * reverse. `maxCreditAmount` of 0 means the park sets no cap, and nothing is ever over it.
 */
export function exceedsCreditCap(
  creditCents: number,
  lane: string | null | undefined,
  maxCreditAmount: number,
): boolean {
  return maxCreditAmount > 0 && creditSubjectToCap(creditCents, lane) > maxCreditAmount
}
