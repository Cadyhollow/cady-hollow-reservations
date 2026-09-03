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
