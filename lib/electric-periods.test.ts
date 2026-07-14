// Unit tests for the pure period math. Framework-free — runs on Node's built-in
// runner with type stripping, no dependencies:
//
//   node --test lib/electric-periods.test.ts
//
// The critical case is the June→July 1 boundary seam: consecutive calendar-month
// cycles share the date 2026-07-01, and that shared boundary must NOT count as an
// overlap (or every normal month-to-month bill would false-warn).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  periodFromBillingMonth,
  rangesExactMatch,
  rangesOverlap,
  overlapSpan,
  classifyPeriod,
  fmtMDY,
  billTitle,
  type Period,
} from './electric-periods.ts'

const P = (start: string, end: string): Period => ({ start, end })

test('periodFromBillingMonth: calendar month → half-open [1st, 1st-of-next)', () => {
  assert.deepEqual(periodFromBillingMonth('May 2026'), P('2026-05-01', '2026-06-01'))
  assert.deepEqual(periodFromBillingMonth('July 2026'), P('2026-07-01', '2026-08-01'))
})

test('periodFromBillingMonth: December rolls the year over', () => {
  assert.deepEqual(periodFromBillingMonth('December 2026'), P('2026-12-01', '2027-01-01'))
})

test('periodFromBillingMonth: all 7 live billing_month values parse (May–Nov 2026)', () => {
  for (const bm of ['May 2026', 'June 2026', 'July 2026', 'August 2026', 'September 2026', 'October 2026', 'November 2026']) {
    assert.notEqual(periodFromBillingMonth(bm), null, `${bm} should parse`)
  }
})

test('periodFromBillingMonth: junk → null (abort-on-mismatch relies on strictness)', () => {
  assert.equal(periodFromBillingMonth(''), null)
  assert.equal(periodFromBillingMonth('Q3 2026'), null)
  assert.equal(periodFromBillingMonth('July'), null)
  assert.equal(periodFromBillingMonth('2026-07'), null)
  assert.equal(periodFromBillingMonth('Jul 2026'), null) // abbreviations are not the live format
})

test('periodFromBillingMonth: surrounding whitespace is trimmed', () => {
  assert.deepEqual(periodFromBillingMonth('  July 2026  '), P('2026-07-01', '2026-08-01'))
})

test('rangesExactMatch', () => {
  assert.equal(rangesExactMatch(P('2026-07-01', '2026-08-01'), P('2026-07-01', '2026-08-01')), true)
  assert.equal(rangesExactMatch(P('2026-07-01', '2026-08-01'), P('2026-07-01', '2026-07-31')), false)
})

test('THE SEAM: consecutive months share a boundary date and do NOT overlap', () => {
  const june = periodFromBillingMonth('June 2026')!  // [2026-06-01, 2026-07-01)
  const july = periodFromBillingMonth('July 2026')!  // [2026-07-01, 2026-08-01)
  assert.equal(june.end, july.start)                 // they touch at 2026-07-01
  assert.equal(rangesOverlap(june, july), false)     // touching is NOT overlapping
  assert.equal(rangesOverlap(july, june), false)     // symmetric
  assert.equal(overlapSpan(june, july), null)
})

test('rangesOverlap: positive-width overlap is detected (both directions)', () => {
  const june = P('2026-06-01', '2026-07-01')
  const mid = P('2026-06-25', '2026-07-05') // straddles the seam
  assert.equal(rangesOverlap(june, mid), true)
  assert.equal(rangesOverlap(mid, june), true)
  assert.deepEqual(overlapSpan(june, mid), P('2026-06-25', '2026-07-01'))
})

test('rangesOverlap: fully separate ranges do not overlap', () => {
  assert.equal(rangesOverlap(P('2026-06-01', '2026-07-01'), P('2026-08-01', '2026-09-01')), false)
})

test('rangesOverlap: flexible ranges touching at a shared endpoint do not overlap', () => {
  // June 10–July 10 and July 10–Aug 10 (move-out style) share 2026-07-10 → not an overlap
  assert.equal(rangesOverlap(P('2026-06-10', '2026-07-10'), P('2026-07-10', '2026-08-10')), false)
})

test('rangesOverlap: exact match is itself a positive-width overlap', () => {
  const p = P('2026-07-01', '2026-08-01')
  assert.equal(rangesOverlap(p, p), true) // why classifyPeriod must test exact FIRST
})

test('classifyPeriod: exact same range → exact (the fat-finger double-send)', () => {
  const july = periodFromBillingMonth('July 2026')!
  const r = classifyPeriod(july, [periodFromBillingMonth('June 2026')!, july])
  assert.equal(r.level, 'exact')
  assert.deepEqual(r.conflict, july)
})

test('classifyPeriod: partial overlap → overlap, with the shared span reported', () => {
  const proposed = P('2026-06-25', '2026-07-05')
  const r = classifyPeriod(proposed, [periodFromBillingMonth('June 2026')!])
  assert.equal(r.level, 'overlap')
  assert.deepEqual(r.span, P('2026-06-25', '2026-07-01'))
})

test('classifyPeriod: exact wins even when an overlap also exists', () => {
  const july = periodFromBillingMonth('July 2026')!
  const straddle = P('2026-07-15', '2026-08-15') // overlaps July
  const r = classifyPeriod(july, [straddle, july])
  assert.equal(r.level, 'exact')
})

test('classifyPeriod: consecutive month (boundary touch) → none, never warns', () => {
  const july = periodFromBillingMonth('July 2026')!
  const r = classifyPeriod(july, [periodFromBillingMonth('June 2026')!]) // touches at 7/1
  assert.equal(r.level, 'none')
})

test('classifyPeriod: no existing bills → none', () => {
  assert.equal(classifyPeriod(periodFromBillingMonth('July 2026')!, []).level, 'none')
})

test('fmtMDY: no leading zeros, 2-digit year, no Date/TZ drift', () => {
  assert.equal(fmtMDY('2026-07-01'), '7/1/26')
  assert.equal(fmtMDY('2026-12-10'), '12/10/26')
})

test('billTitle: matches the spec example exactly (raw half-open endpoints, en dash)', () => {
  assert.equal(billTitle(P('2026-06-10', '2026-07-10')), 'Electric Bill 6/10/26–7/10/26')
})
