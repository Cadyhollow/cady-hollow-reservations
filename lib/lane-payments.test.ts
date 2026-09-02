// The split-payment normaliser. Pure — `node --test`, no server, no DB.
//
// These exist because a dropped split row is SILENT: the card routes fall back to the caller's
// own `amount` when a split normalises to empty (`split.length ? laneSplitTotal(split) : amount`),
// so a row lost here charges one figure while the screen shows another and every page still
// reconciles. The two-bucket "Pay both" tender depends on an untagged row surviving.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLaneSplit, laneSplitTotal } from './lane-payments.ts'

test('an ordinary tagged split is unchanged', () => {
  assert.deepEqual(
    normalizeLaneSplit([{ lane: 'seasonal', amount: 90363, surchargeAmount: 0 }]),
    [{ lane: 'seasonal', amount: 90363, surchargeAmount: 0 }],
  )
})

test('⚠ AN EXPLICIT null LANE SURVIVES — it is the Camp half of "Pay both"', () => {
  const split = normalizeLaneSplit([
    { lane: null, amount: 3200, surchargeAmount: 0 },
    { lane: 'seasonal', amount: 90363, surchargeAmount: 0 },
  ])
  assert.equal(split.length, 2, 'both rows must survive')
  assert.equal(split[0].lane, null)
  assert.equal(split[1].lane, 'seasonal')
  // And the card is charged the whole thing, not just the tagged half.
  assert.equal(laneSplitTotal(split), 93563)
})

test('a MISSING or EMPTY lane is still dropped, exactly as before', () => {
  // Malformed input, not a deliberate whole-account row. Dropping it is the existing guard that
  // keeps a garbled request from being charged.
  assert.deepEqual(normalizeLaneSplit([{ amount: 500, surchargeAmount: 0 }]), [])
  assert.deepEqual(normalizeLaneSplit([{ lane: '', amount: 500, surchargeAmount: 0 }]), [])
  assert.deepEqual(normalizeLaneSplit([{ lane: undefined, amount: 500, surchargeAmount: 0 }]), [])
})

test('zero and negative amounts are dropped whether tagged or not', () => {
  assert.deepEqual(normalizeLaneSplit([{ lane: null, amount: 0, surchargeAmount: 0 }]), [])
  assert.deepEqual(normalizeLaneSplit([{ lane: 'store', amount: -100, surchargeAmount: 0 }]), [])
})

test('a two-row split — one tagged, one untagged — is exactly what a "pay both" tender needs', () => {
  // The shape the two-bucket work will send once separated billing lands: Seasonal tagged, the
  // everyday half untagged. Asserted here so this module is ready for it and cannot regress.
  const split = normalizeLaneSplit([
    { lane: null, amount: 3200, surchargeAmount: 96 },
    { lane: 'seasonal', amount: 90363, surchargeAmount: 2711 },
  ])
  assert.equal(split.length, 2)
  assert.deepEqual(split.map(l => l.lane), [null, 'seasonal'])
})

test("⚠ TODAY'S ONE-LANE SPLIT IS UNCHANGED — what the terminal actually sends now", () => {
  // The guest folio sends a single row, gross amount, when the operator names a lane. That must
  // normalise to exactly one row and charge exactly that amount.
  const split = normalizeLaneSplit([{ lane: 'seasonal', amount: 51500, surchargeAmount: 1500 }])
  assert.equal(split.length, 1)
  assert.equal(split[0].lane, 'seasonal')
  assert.equal(laneSplitTotal(split), 51500, 'the card is charged the gross amount')
})

test('no split at all leaves the caller amount in charge — the whole-account path', () => {
  // "Whole account" sends no `lanes`, so the route falls back to its own `amount`.
  assert.deepEqual(normalizeLaneSplit(undefined), [])
  assert.equal(laneSplitTotal([]), 0)
})

test('a non-array, or junk, is an empty split rather than a throw', () => {
  for (const junk of [null, undefined, 'nope', 42, {}]) {
    assert.deepEqual(normalizeLaneSplit(junk), [])
  }
})

test('laneSplitTotal sums the rows that will be written, surcharge excluded', () => {
  // ⚠ The card routes charge laneSplitTotal(). Each row's `amount` is what the caller intends to
  // charge for that row; the surcharge travels alongside for the ledger.
  const split = normalizeLaneSplit([
    { lane: null, amount: 1000, surchargeAmount: 30 },
    { lane: 'seasonal', amount: 2000, surchargeAmount: 60 },
  ])
  assert.equal(laneSplitTotal(split), 3000)
})
