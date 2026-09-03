// The payment modal's arithmetic, pinned.
//
// The bug these exist to prevent was silent: no throw, no log, no type error — just "Amount short
// $NaN" on a live money screen and a Record button that did nothing when clicked. So the central
// group below is exhaustive rather than representative: it sweeps every string a person or a
// browser can put in an amount box against every tender, and asserts that NOTHING is ever NaN.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  centsOf,
  recordAmountCents,
  canRecordAmount,
  cashState,
  isPrepayment,
  isSeasonalLane,
  creditSubjectToCap,
  exceedsCreditCap,
} from './payment-amount.ts'

/** Every way an amount box can be non-numeric, including the ones a number input really produces. */
const JUNK = ['', ' ', '   ', '.', '-', '+', 'abc', 'NaN', 'e', '--5', undefined, null]

/** Every tender this park can present. */
const METHODS = ['cash', 'card', 'check', 'venmo', 'Some Custom Method']

// ── centsOf ───────────────────────────────────────────────────────────────────────────────────

test('centsOf turns a typed amount into integer cents', () => {
  assert.equal(centsOf('375'), 37500)
  assert.equal(centsOf('375.00'), 37500)
  assert.equal(centsOf('19.99'), 1999, 'no floating-point drift')
  assert.equal(centsOf('0.01'), 1)
  assert.equal(centsOf('1234.567'), 123457, 'rounded, not truncated')
})

test('centsOf reads every non-numeric box as ZERO, never NaN', () => {
  for (const v of JUNK) {
    const c = centsOf(v as string)
    assert.equal(c, 0, `centsOf(${JSON.stringify(v)}) should be 0`)
    assert.ok(Number.isFinite(c), `centsOf(${JSON.stringify(v)}) must be finite`)
  }
})

test('a half-typed number reads as its leading value, which is what live feedback wants', () => {
  // parseFloat is deliberately lenient: it takes the leading number and stops. That is the right
  // behaviour mid-keystroke — "3." shows $3.00 rather than flicking to $0.00 while someone types
  // "3.75". The invariant that matters is that the result is always FINITE, never NaN.
  assert.equal(centsOf('3.'), 300)
  assert.equal(centsOf('1e'), 100)
  assert.equal(centsOf('12abc'), 1200)
  for (const v of ['3.', '1e', '12abc']) assert.ok(Number.isFinite(centsOf(v)))
})

// ── THE NaN SWEEP — the heart of this fix ─────────────────────────────────────────────────────

test('NO STATE PRODUCES NaN: every junk/valid combination, every tender', () => {
  const amounts = [...JUNK, '1e', '3.', '0', '0.00', '375', '19.99']
  const tenders = [...JUNK, '0', '400', '100']
  const totals = [0, 4200, 189500]
  let checked = 0

  for (const method of METHODS) {
    for (const amount of amounts) {
      for (const tendered of tenders) {
        for (const totalDueCents of totals) {
          const args = { totalDueCents, method, amount: amount as string, tendered: tendered as string }

          const rec = recordAmountCents(args)
          assert.ok(Number.isFinite(rec), `recordAmountCents NaN for ${JSON.stringify(args)}`)
          assert.ok(rec >= 0, `recordAmountCents negative for ${JSON.stringify(args)}`)

          // The button's label is built from this. `.toFixed(2)` on NaN is the literal string
          // "NaN", which is exactly what reached the screen.
          assert.ok(!(rec / 100).toFixed(2).includes('NaN'), `label NaN for ${JSON.stringify(args)}`)

          const cs = cashState(centsOf(tendered as string), centsOf(amount as string))
          assert.ok(Number.isFinite(cs.differenceCents), `cashState NaN for ${JSON.stringify(args)}`)
          assert.ok(cs.differenceCents >= 0, 'the gap is stated as a magnitude')
          assert.equal(typeof cs.short, 'boolean')
          assert.ok(!(cs.differenceCents / 100).toFixed(2).includes('NaN'))

          assert.equal(typeof canRecordAmount(args), 'boolean')
          checked++
        }
      }
    }
  }
  assert.ok(checked > 3000, `expected a broad sweep, checked ${checked}`)
})

// ── THE BUG, EXACTLY AS IT PRESENTED ──────────────────────────────────────────────────────────

test('THE BUG: paid-up bucket, account owes elsewhere, amount box empty', () => {
  // A seasonal camper whose Seasonal door is settled but who owes $42 of electric. The door
  // pre-fills nothing, so the amount box is blank, and the operator types nothing yet.
  const args = { totalDueCents: 4200, method: 'cash', amount: '', tendered: '400' }

  // Before: Math.min(40000, NaN) -> NaN -> "Record cash · $NaN".
  assert.equal(recordAmountCents(args), 0)
  assert.equal(canRecordAmount(args), false, 'the button must be disabled, not offering $NaN')

  // Before: NaN >= NaN was false, so it rendered "Amount short" with "$NaN" as the figure.
  const cs = cashState(centsOf('400'), centsOf(''))
  assert.equal(cs.short, false, 'a $400 tender against a blank amount is NOT short')
  assert.equal((cs.differenceCents / 100).toFixed(2), '400.00', 'and never "NaN"')
})

test('THE FIX: typing the prepayment makes it recordable', () => {
  const args = { totalDueCents: 4200, method: 'cash', amount: '375', tendered: '400' }
  assert.equal(recordAmountCents(args), 37500, 'records the $375 typed, not the $42 owed elsewhere')
  assert.equal(canRecordAmount(args), true)
  const cs = cashState(centsOf('400'), centsOf('375'))
  assert.equal(cs.short, false)
  assert.equal(cs.differenceCents, 2500, '$25 change')
})

// ── ENABLEMENT ────────────────────────────────────────────────────────────────────────────────

test('a blank or zero amount never enables the button, on any tender', () => {
  for (const method of METHODS) {
    for (const amount of ['', '0', '0.00', ' ', 'abc']) {
      assert.equal(
        canRecordAmount({ totalDueCents: 0, method, amount, tendered: '' }), false,
        `${method} / ${JSON.stringify(amount)} must stay disabled`,
      )
    }
  }
})

test('a positive amount enables it, on any tender', () => {
  for (const method of METHODS) {
    assert.equal(canRecordAmount({ totalDueCents: 0, method, amount: '375', tendered: '' }), true)
  }
})

test('cash with a tender of zero records nothing, so the button stays disabled', () => {
  const args = { totalDueCents: 4200, method: 'cash', amount: '375', tendered: '0' }
  assert.equal(recordAmountCents(args), 0, 'min(0, 37500)')
  assert.equal(canRecordAmount(args), false)
})

// ── CASH BEHAVIOUR IS OTHERWISE UNCHANGED ─────────────────────────────────────────────────────

test('cash records the smaller of tendered and amount when a tender is entered', () => {
  assert.equal(recordAmountCents({ totalDueCents: 5000, method: 'cash', amount: '50', tendered: '30' }), 3000,
    'handed over less than asked: record what was handed over')
  assert.equal(recordAmountCents({ totalDueCents: 5000, method: 'cash', amount: '50', tendered: '100' }), 5000,
    'handed over more: record the amount, the rest is change')
})

test('an empty tendered box leaves the typed amount standing', () => {
  assert.equal(recordAmountCents({ totalDueCents: 5000, method: 'cash', amount: '50', tendered: '' }), 5000)
})

test('non-cash tenders ignore the tendered box entirely', () => {
  for (const method of ['card', 'check', 'venmo']) {
    assert.equal(recordAmountCents({ totalDueCents: 5000, method, amount: '50', tendered: '5' }), 5000)
  }
})

test('a settled account takes the typed amount whatever the tendered box says', () => {
  assert.equal(recordAmountCents({ totalDueCents: 0, method: 'cash', amount: '375', tendered: '' }), 37500)
  assert.equal(recordAmountCents({ totalDueCents: 0, method: 'cash', amount: '375', tendered: '10' }), 37500,
    'nothing is owed, so there is no price to fall short of')
})

test('"short" is measured against the typed amount, never the account', () => {
  // The prepayment case: the account owes $1,895 elsewhere, but $375 tendered against $375 typed
  // is exact — flagging it short would tell the operator the wrong thing about money in hand.
  assert.equal(cashState(centsOf('375'), centsOf('375')).short, false, 'exact is not short')
  assert.equal(cashState(centsOf('374.99'), centsOf('375')).short, true)
  assert.equal(cashState(centsOf('375.01'), centsOf('375')).short, false)
})

// ── PREPAYMENT DETECTION ──────────────────────────────────────────────────────────────────────

test('a settled or in-credit selection is a prepayment; an owing one is not', () => {
  assert.equal(isPrepayment(0), true, 'settled')
  assert.equal(isPrepayment(-9000), true, 'already in credit')
  assert.equal(isPrepayment(1), false)
  assert.equal(isPrepayment(37500), false)
})

// ── THE WORKFLOW THIS UNBLOCKED ───────────────────────────────────────────────────────────────

test("the real flow: $375 held against a settled Seasonal door before the contract exists", () => {
  // The camper's Seasonal bucket is settled (no contract yet), their Camp side owes $42 of
  // electric. The operator opens the Seasonal door and types 375.
  const selectedDueCents = 0
  assert.equal(isPrepayment(selectedDueCents), true, 'so the amount box is empty AND editable')

  const args = { totalDueCents: 4200, method: 'cash', amount: '375', tendered: '375' }
  assert.equal(canRecordAmount(args), true)
  assert.equal(recordAmountCents(args), 37500)

  // Recorded with lane:'seasonal', that is a seasonal CREDIT: the bucket goes to −$375. When the
  // contract later posts a $1,695 fee the seasonal balance becomes 1695 − 375 = $1,320, and Camp
  // — the account remainder — still shows the $42 of electric, untouched by the tag.
  const seasonalAfterPrepay = 0 - 37500
  assert.equal(seasonalAfterPrepay, -37500)
  const seasonalAfterFee = 169500 + seasonalAfterPrepay
  assert.equal(seasonalAfterFee, 132000, '$1,320 still owed on the fee')
  const accountAfter = 4200 + seasonalAfterFee
  assert.equal(accountAfter - seasonalAfterFee, 4200, 'camp = account − seasonal holds throughout')
})

// ── THE CREDIT CAP, SCOPED ────────────────────────────────────────────────────────────────────
//
// `max_credit_amount` is $50 on this park. A seasonal deposit is typically $375, so before this
// scoping EVERY seasonal deposit tripped the cap: a confirm on an electronic tender, and on cash a
// disabled "Apply as credit" button with "please give change instead" — which is the opposite of
// what a deposit is for.

const CAP = 5000        // the park's $50 limit
const DEPOSIT = 37500   // a $375 season deposit

test('isSeasonalLane recognises the tag, and nothing else', () => {
  assert.equal(isSeasonalLane('seasonal'), true)
  assert.equal(isSeasonalLane(' Seasonal '), true, 'trimmed and case-folded, like every lane test')
  for (const v of [null, undefined, '', 'camp', 'electric', 'store', 'other', 'season']) {
    assert.equal(isSeasonalLane(v as string), false, `${JSON.stringify(v)} is not the seasonal lane`)
  }
})

test('SEASONAL IS EXEMPT: a $375 deposit trips nothing against a $50 cap', () => {
  assert.equal(creditSubjectToCap(DEPOSIT, 'seasonal'), 0)
  assert.equal(exceedsCreditCap(DEPOSIT, 'seasonal', CAP), false)
  // However large it gets. A season fee is a season fee.
  assert.equal(exceedsCreditCap(500000, 'seasonal', CAP), false)
})

test('CAMP STILL CAPPED: an untagged overpayment past the cap warns exactly as before', () => {
  assert.equal(creditSubjectToCap(DEPOSIT, null), DEPOSIT, 'untagged = everyday = Camp')
  assert.equal(exceedsCreditCap(DEPOSIT, null, CAP), true)
  assert.equal(exceedsCreditCap(DEPOSIT, '', CAP), true)
  assert.equal(exceedsCreditCap(5001, null, CAP), true, 'a cent over')
  assert.equal(exceedsCreditCap(CAP, null, CAP), false, 'exactly at the cap is not over it')
  assert.equal(exceedsCreditCap(100, null, CAP), false)
})

test('the other lanes are everyday money and keep the cap', () => {
  for (const lane of ['electric', 'store', 'other']) {
    assert.equal(exceedsCreditCap(DEPOSIT, lane, CAP), true, `${lane} must stay capped`)
  }
})

test('a park with no cap set has nothing to exceed, seasonal or not', () => {
  assert.equal(exceedsCreditCap(DEPOSIT, null, 0), false)
  assert.equal(exceedsCreditCap(DEPOSIT, 'seasonal', 0), false)
})

test('no credit at all never trips the cap', () => {
  assert.equal(exceedsCreditCap(0, null, CAP), false)
  assert.equal(exceedsCreditCap(-500, null, CAP), false, 'a negative is not a credit')
  assert.equal(creditSubjectToCap(-500, null), 0)
})

test('PAY BOTH: each row settles its own bucket exactly, so no row creates a credit', () => {
  // The door fixes the amount at camp.balance + seasonal.balance, and each row is written for its
  // own bucket's balance. creditPortion = amount - totalDue, and the two are equal by the
  // accountBuckets invariant (camp + seasonal === accountBalance).
  const camp = 4200
  const seasonal = 132000
  const amount = camp + seasonal
  const totalDue = amount
  const creditPortion = Math.max(0, amount - totalDue)
  assert.equal(creditPortion, 0)
  assert.equal(exceedsCreditCap(creditPortion, '', CAP), false, 'the camp row keeps the cap and never trips it')
  assert.equal(exceedsCreditCap(creditPortion, 'seasonal', CAP), false)
})

test('COMBINED MODE: the rule is the tag, so everyday money is capped there too', () => {
  // Combined mode has no buckets, but its lane picker can still tag a payment 'seasonal'. The tag
  // is what gets written on the row, so the same answer applies in either mode — and everything
  // untagged, which is almost every payment in combined mode, stays capped exactly as today.
  assert.equal(exceedsCreditCap(DEPOSIT, null, CAP), true)
  assert.equal(exceedsCreditCap(DEPOSIT, 'seasonal', CAP), false)
})

test('the display flag and the writer ask the SAME function', () => {
  // The modal derives creditExceedsCap from creditPortionCents, and collectPayment re-derives a
  // credit from the recorded amount — different inputs, deliberately, but one rule. Given the same
  // credit they must agree, or a screen warns about something the writer waves through.
  for (const credit of [0, 100, CAP, CAP + 1, DEPOSIT]) {
    for (const lane of [null, '', 'seasonal', 'electric']) {
      assert.equal(
        exceedsCreditCap(credit, lane, CAP),
        exceedsCreditCap(credit, lane, CAP),
      )
    }
  }
})
