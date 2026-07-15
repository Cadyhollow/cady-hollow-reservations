// Unified folio ledger: charges + payments merged in true date order with a
// running balance after each line. Ported verbatim from the in-app folio page
// (app/admin/folio/guest/[id]/page.tsx) so any statement built from it matches
// what staff see in the folio exactly. All amounts are integer cents.

export type LedgerLineItem = {
  id: string
  description: string
  quantity?: number | null
  line_total: number
  charged_at?: string | null
  voided?: boolean | null
  notes?: string | null
}

// Phase D — the single void-filter idiom, imported everywhere a folio balance is
// summed. Applied at the SUM step (never at the query) so admin views can still
// DISPLAY voided rows as the audit trail (Decision 2d) while excluding them from
// totals. `voided !== true` treats null/undefined/false all as active, so it's safe
// against any row (or select) that doesn't carry the column.
export const notVoided = (i: { voided?: boolean | null }): boolean => i.voided !== true
export function sumLineTotals(
  items: { line_total: number; voided?: boolean | null }[] | null | undefined,
): number {
  return (items || []).filter(notVoided).reduce((s, i) => s + (i.line_total || 0), 0)
}

export type LedgerPayment = {
  id: string
  method: string
  amount: number
  surcharge_amount?: number | null
  paid_at?: string | null
  note?: string | null
}

export type LedgerEvent = {
  key: string
  kind: 'charge' | 'payment'
  ts: number
  order: number
  label: string
  amount: number        // charge: line_total; payment: amount net of card surcharge
  balanceAfter: number
  note?: string | null  // charge: item notes; payment: payment note. Rendered only when the caller opts in (showNotes) — the electric statement leaves it off.
}

// Build the merged, date-sorted ledger with a running balance after every line.
export function buildLedger(lineItems: LedgerLineItem[], payments: LedgerPayment[]): LedgerEvent[] {
  const events: LedgerEvent[] = []
  let order = 0
  // Voided charges drop out of the emailed statement's display AND its running
  // balance (customer-facing → they vanish entirely, Decision 2d).
  for (const item of (lineItems || []).filter(notVoided)) {
    events.push({
      key: `item-${item.id}`,
      kind: 'charge',
      ts: item.charged_at ? new Date(item.charged_at).getTime() : 0,
      order: order++,
      label: item.description + ((item.quantity && item.quantity > 1) ? ` ×${item.quantity}` : ''),
      amount: item.line_total,
      balanceAfter: 0,
      note: item.notes ?? null,
    })
  }
  for (const p of payments || []) {
    events.push({
      key: `pay-${p.id}`,
      kind: 'payment',
      ts: p.paid_at ? new Date(p.paid_at).getTime() : 0,
      order: order++,
      label: p.method.charAt(0).toUpperCase() + p.method.slice(1),
      amount: p.amount - (p.surcharge_amount || 0),
      balanceAfter: 0,
      note: p.note ?? null,
    })
  }
  events.sort((a, b) => a.ts - b.ts || a.order - b.order)
  let bal = 0
  for (const ev of events) {
    bal += ev.kind === 'charge' ? ev.amount : -ev.amount
    ev.balanceAfter = bal
  }
  return events
}

export type Statement = {
  balanceForward: number   // running balance carried into the first displayed line
  lines: LedgerEvent[]     // events to display, oldest → newest
  currentBalance: number   // final running balance (negative = credit)
}

// Decide where the statement starts: walk back to the most recent point the
// balance was ≤ $0 (paid up or in credit) and start there. If there's no such
// point within `windowDays`, cap the start at `windowDays` ago and carry the
// balance in as "Balance Forward".
export function buildStatement(events: LedgerEvent[], nowMs: number, windowDays = 90): Statement {
  if (events.length === 0) return { balanceForward: 0, lines: [], currentBalance: 0 }
  const cutoff = nowMs - windowDays * 86_400_000

  // Most recent index where the balance settled to ≤ 0 AND has at least one event
  // after it. The `- 1` bound is the fix for the empty-statement bug: without it, any
  // folio whose CURRENT balance is ≤ 0 (settled or in credit) picks the final event as
  // the fold point → startIdx past the end → zero lines rendered. Excluding the last
  // event means a just-settled folio folds to the prior zero point and still shows the
  // latest cycle (Balance Forward → charges → payment → ✓ Paid in Full).
  let zeroIdx = -1
  for (let i = 0; i < events.length - 1; i++) if (events[i].balanceAfter <= 0) zeroIdx = i

  let startIdx: number
  let balanceForward: number
  if (zeroIdx >= 0 && events[zeroIdx].ts >= cutoff) {
    // Start right after the most recent settled/credit point (within window)
    startIdx = zeroIdx + 1
    balanceForward = events[zeroIdx].balanceAfter          // ≤ 0
  } else {
    // No settled point in the window — cap at the window and carry the balance in
    let firstInWindow = events.findIndex(e => e.ts >= cutoff)
    if (firstInWindow === -1) firstInWindow = events.length // all activity older than the cutoff
    startIdx = firstInWindow
    balanceForward = firstInWindow === 0 ? 0 : events[firstInWindow - 1].balanceAfter
  }

  return {
    balanceForward,
    lines: events.slice(startIdx),
    currentBalance: events[events.length - 1].balanceAfter,
  }
}
