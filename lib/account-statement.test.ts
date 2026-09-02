import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STATEMENT_WINDOW_DAYS, statementWindowStart, statementActivity,
  paymentDescription, statementTotalLine, statementCardLine, longDate,
  renderAccountStatementHtml, renderAccountStatementText,
} from './account-statement.ts'
import type { StatementView } from './account-statement.ts'

// Midday UTC throughout, so a date reads the same whether the runner sits in UTC or US Eastern.
const at = (iso: string) => `${iso}T12:00:00.000Z`
const NOW = new Date(at('2026-09-02'))

const charge = (d: string, description: string, line_total: number, voided = false) =>
  ({ charged_at: at(d), description, line_total, voided })
const pay = (d: string, method: string, amount: number, extra: Record<string, unknown> = {}) =>
  ({ paid_at: at(d), method, amount, ...extra })

test('the window is 30 days, measured back from now', () => {
  assert.equal(STATEMENT_WINDOW_DAYS, 30)
  const start = statementWindowStart(NOW)
  assert.equal(Math.round((NOW.getTime() - start.getTime()) / 86400000), 30)
})

test('only activity inside the window is listed', () => {
  const rows = statementActivity(
    [charge('2026-05-01', 'May Electric', 2997), charge('2026-08-25', 'August Electric', 3564)],
    [pay('2026-01-04', 'cash', 9620), pay('2026-09-01', 'card', 1000)],
    { now: NOW },
  )
  assert.deepEqual(rows.map(r => r.description), ['August Electric', 'Card payment'])
})

test('rows are strictly ascending by timestamp, charges and payments interleaved', () => {
  const rows = statementActivity(
    [charge('2026-08-25', 'August Electric', 3564), charge('2026-09-01', 'September Electric', 1500)],
    [pay('2026-08-27', 'cash', 500), pay('2026-08-20', 'card', 2000)],
    { now: NOW },
  )
  assert.deepEqual(rows.map(r => r.description), [
    'Card payment', 'August Electric', 'Cash payment', 'September Electric',
  ])
  const ts = rows.map(r => r.ts)
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b))
})

test('a payment is negative and net of its card surcharge', () => {
  const [row] = statementActivity([], [pay('2026-09-01', 'card', 10275, { surcharge_amount: 275 })], { now: NOW })
  assert.equal(row.cents, -10000)
  assert.equal(row.kind, 'payment')
})

test('a charge is positive; a voided charge is excluded entirely', () => {
  const rows = statementActivity(
    [charge('2026-08-25', 'August Electric', 3564), charge('2026-08-26', 'Cancelled packet', 5000, true)],
    [], { now: NOW },
  )
  assert.deepEqual(rows.map(r => [r.description, r.cents]), [['August Electric', 3564]])
})

test('a refund lands positive — money handed back increases what is owed', () => {
  const [row] = statementActivity([], [pay('2026-09-01', 'card', -2500)], { now: NOW })
  assert.equal(row.cents, 2500)
  assert.equal(row.description, 'Card refund')
})

test('a payment description is its method, with the note appended when there is one', () => {
  assert.equal(paymentDescription({ method: 'cash', amount: 500 }), 'Cash payment')
  assert.equal(paymentDescription({ method: 'card', note: 'Square Terminal', amount: 100 }), 'Card payment · Square Terminal')
  // No method on file reads as plain "Payment" — never a doubled word, never a guessed method.
  assert.equal(paymentDescription({ method: null, amount: 100 }), 'Payment')
  assert.equal(paymentDescription({ method: null, amount: -100 }), 'Refund')
  assert.equal(paymentDescription({ method: 'check', amount: -100 }), 'Check refund')
})

test('rows with no usable timestamp are dropped, not dated to today', () => {
  const rows = statementActivity(
    [{ description: 'Orphan', line_total: 100, charged_at: null }],
    [{ method: 'cash', amount: 100, paid_at: 'not-a-date' }],
    { now: NOW },
  )
  assert.deepEqual(rows, [])
})

test('an empty window yields no rows — the caller renders the muted line', () => {
  assert.deepEqual(statementActivity([charge('2026-01-01', 'Old', 100)], [], { now: NOW }), [])
})

test('the total line has three wordings: due, paid in full, credit', () => {
  assert.deepEqual(statementTotalLine(2900), { label: 'Total balance due', value: '$29.00', settled: false })
  assert.deepEqual(statementTotalLine(0), { label: 'Total', value: 'Paid in full ✓', settled: true })
  assert.deepEqual(statementTotalLine(-1550), { label: 'Credit on account', value: '$15.50', settled: true })
})

test('a bucket card follows the same rule, worded for a card', () => {
  assert.deepEqual(statementCardLine(2900), { amount: '$29.00', tag: 'balance due', settled: false })
  assert.deepEqual(statementCardLine(0), { amount: '$0.00', tag: 'paid up ✓', settled: true })
  assert.deepEqual(statementCardLine(-500), { amount: '$5.00', tag: 'credit on account', settled: true })
})

test('a card and the total never print a minus sign — the wording carries the sign', () => {
  assert.ok(!statementCardLine(-500).amount.includes('-'))
  assert.ok(!statementTotalLine(-500).value.includes('-'))
})

test('longDate is the human header date', () => {
  assert.equal(longDate(new Date(at('2026-09-02'))), 'September 2, 2026')
})

// ── THE RENDERERS ────────────────────────────────────────────────────────────────────────────
// Pinned here so the layout can be checked without the live database, a staff session, or Resend.

const view = (over: Partial<StatementView> = {}): StatementView => ({
  parkName: 'Cady Hollow Campground', parkLocation: 'Port Allegany, PA',
  guestName: 'Rian & Charissa', now: NOW,
  rows: statementActivity(
    [charge('2026-08-05', 'August Electric', 3564)],
    [pay('2026-08-08', 'cash', 500)], { now: NOW }),
  accountBalance: 3300, buckets: null, ...over,
})
const BUCKETS = {
  campLabel: 'Camp Account', campBalance: 3300,
  seasonalLabel: 'Seasonal', seasonalBalance: 0,
}

test('separated renders the two cards; combined renders none', () => {
  const sep = renderAccountStatementHtml(view({ buckets: BUCKETS }))
  assert.ok(sep.includes('Camp Account') && sep.includes('Seasonal'))
  const com = renderAccountStatementHtml(view())
  assert.ok(!com.includes('Camp Account'))
  assert.ok(!com.includes('Seasonal'))
  // Both still close on the whole-account total — that is the point of the block.
  assert.ok(sep.includes('Total balance due') && com.includes('Total balance due'))
})

test('the balance block is the LAST thing before the footer note', () => {
  const html = renderAccountStatementHtml(view({ buckets: BUCKETS }))
  assert.ok(html.indexOf('Total balance due') > html.indexOf('August Electric'))
  assert.ok(html.indexOf('not your full history') > html.indexOf('Total balance due'))
})

test('no activity in the window still renders the balance block', () => {
  const html = renderAccountStatementHtml(view({ rows: [], accountBalance: 0 }))
  assert.ok(html.includes('No activity in the last 30 days'))
  assert.ok(html.includes('Paid in full ✓'))
  const text = renderAccountStatementText(view({ rows: [], accountBalance: 0 }))
  assert.ok(text.includes('No activity in the last 30 days'))
  assert.ok(text.includes('Paid in full ✓'))
})

test('staff-entered text is escaped — a guest called "Rian & Charissa" is not broken markup', () => {
  const html = renderAccountStatementHtml(view())
  assert.ok(html.includes('Hi Rian &amp; Charissa'))
  assert.ok(!/Hi Rian & Charissa/.test(html))
  const nasty = renderAccountStatementHtml(view({ guestName: '<script>x</script>' }))
  assert.ok(!nasty.includes('<script>'))
})

test('the text part carries the same window, order and closing balance — not the old dump', () => {
  const text = renderAccountStatementText(view({ buckets: BUCKETS }))
  assert.ok(text.includes('Since August 3, 2026'))
  assert.ok(text.indexOf('August Electric') < text.indexOf('Cash payment'))
  assert.ok(text.includes('Camp Account: $33.00 (balance due)'))
  assert.ok(text.includes('Total balance due: $33.00'))
})

test('a credit reads as a credit, never as a negative amount due', () => {
  const html = renderAccountStatementHtml(view({ accountBalance: -1550 }))
  assert.ok(html.includes('Credit on account'))
  assert.ok(!html.includes('Total balance due'))
})
