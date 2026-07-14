// Pure period math for electric billing (Phase A of the redesign).
//
// Every comparison here is on ISO 'YYYY-MM-DD' STRINGS. For same-format ISO dates,
// lexicographic order == chronological order, so NO JavaScript `Date` is ever
// constructed in this file. That is deliberate: `new Date('2026-07-01')` parses as
// UTC midnight and any local-time handling introduces an off-by-one exactly at the
// June→July 1 boundary seam. String math sidesteps that class of bug entirely.
//
// Periods are HALF-OPEN [start, end): `start` belongs to the period, `end` is the
// boundary that belongs to the NEXT period. A shared boundary date (one bill's end
// == another's start) is therefore NOT an overlap — it's the normal consecutive
// meter cycle.

export type Period = { start: string; end: string } // ISO 'YYYY-MM-DD', half-open

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad2(n: number): string { return n < 10 ? '0' + n : '' + n }

// "July 2026" -> { start: '2026-07-01', end: '2026-08-01' }  (half-open calendar month).
// Returns null if the text isn't the exact "Month YYYY" shape — callers treat null as
// "unparseable" (the backfill's abort-on-mismatch check relies on this being strict).
export function periodFromBillingMonth(billingMonth: string): Period | null {
  if (typeof billingMonth !== 'string') return null
  const m = billingMonth.trim().match(/^([A-Z][a-z]+) (\d{4})$/)
  if (!m) return null
  const monthIdx = MONTHS.indexOf(m[1])
  if (monthIdx < 0) return null
  const year = parseInt(m[2], 10)
  const start = `${m[2]}-${pad2(monthIdx + 1)}-01`
  const endYear = monthIdx === 11 ? year + 1 : year
  const endMonth = monthIdx === 11 ? 1 : monthIdx + 2 // 1-based next month
  const end = `${endYear}-${pad2(endMonth)}-01`
  return { start, end }
}

// Exact same half-open range.
export function rangesExactMatch(a: Period, b: Period): boolean {
  return a.start === b.start && a.end === b.end
}

// Positive-width overlap of two half-open ranges. Boundary touch (a.end === b.start
// or b.end === a.start) is NOT an overlap. NOTE: an exact match is also a positive-
// width overlap, so callers that care about the distinction must test exact FIRST.
export function rangesOverlap(a: Period, b: Period): boolean {
  return a.start < b.end && b.start < a.end
}

// The shared span of two overlapping ranges, or null if they don't overlap.
export function overlapSpan(a: Period, b: Period): Period | null {
  if (!rangesOverlap(a, b)) return null
  const start = a.start > b.start ? a.start : b.start
  const end = a.end < b.end ? a.end : b.end
  return { start, end }
}

export type GuardLevel = 'exact' | 'overlap' | 'none'
export type GuardResult = { level: GuardLevel; span: Period | null; conflict: Period | null }

// Classify a proposed period against existing ACTIVE bill periods. Exact wins over
// overlap; boundary-touch and fully-separate both yield 'none'. The caller must pass
// ONLY active periods — i.e. periods whose charge exists on the folio and is not
// voided (the charge is the authority; see spec Source of truth).
export function classifyPeriod(proposed: Period, existing: Period[]): GuardResult {
  for (const e of existing) {
    if (rangesExactMatch(proposed, e)) return { level: 'exact', span: null, conflict: e }
  }
  for (const e of existing) {
    if (rangesOverlap(proposed, e)) return { level: 'overlap', span: overlapSpan(proposed, e), conflict: e }
  }
  return { level: 'none', span: null, conflict: null }
}

// 'YYYY-MM-DD' -> 'M/D/YY' with NO Date construction (no TZ drift).
export function fmtMDY(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(2)}`
}

// Half-open range -> "Electric Bill 6/10/26–7/10/26" (raw endpoints, en dash).
// End is shown as the exclusive boundary, matching the spec's example.
export function billTitle(period: Period): string {
  return `Electric Bill ${fmtMDY(period.start)}–${fmtMDY(period.end)}`
}
