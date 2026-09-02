/**
 * The ACCOUNT STATEMENT — the recent-activity email a camper gets for their whole account.
 *
 * ⚠ WHAT THIS REPLACES. The statement used to dump EVERY charge and EVERY payment since the
 * account opened, as raw plain text, with no window and no structure. On a seasonal camper with
 * three years of electric bills that is hundreds of lines, and the one number they actually wanted
 * — what do I owe? — was buried at the bottom of it. This module is the recent-activity window and
 * the closing-balance arithmetic behind the clean replacement.
 *
 * Everything here is PURE — no Supabase, no formatting of money beyond `receiptMoney` — so the
 * window boundary, the ordering and the three balance wordings can be pinned by tests instead of
 * verified by sending mail to a camper.
 */
import { notVoided } from './ledger.ts'
import { receiptMoney } from './receipt-lines.ts'

/**
 * How far back the statement looks.
 *
 * TODO(statement-window): a future enhancement could make this a per-park setting. Deliberately
 * hardcoded for this pass — the setting, its Settings UI and its migration are their own task, and
 * a park with no such column must still get a statement.
 */
export const STATEMENT_WINDOW_DAYS = 30

export type StatementLineItem = {
  description?: string | null
  line_total: number
  charged_at?: string | null
  voided?: boolean | null
}

export type StatementPayment = {
  method?: string | null
  note?: string | null
  amount: number
  surcharge_amount?: number | null
  paid_at?: string | null
}

export type StatementRow = {
  /** Milliseconds — what the ascending sort is done on, kept so tests can assert the order. */
  ts: number
  /** "Jun 17" */
  date: string
  description: string
  /**
   * SIGNED cents. A charge is positive; a payment is negative. A refund is a payment with a
   * negative net, so it lands positive here — which is right: handing money back increases what
   * the account owes, and it renders in the charge colour rather than the payment green.
   */
  cents: number
  kind: 'charge' | 'payment'
}

/** A payment's value to the account: NET of any card surcharge, matching every other balance. */
const netOf = (p: StatementPayment): number => p.amount - (p.surcharge_amount || 0)

const shortDate = (ts: number): string =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export const longDate = (d: Date | number): string =>
  new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

/**
 * The window's first instant. Measured back from `now`, so a statement sent today and one sent
 * tomorrow do not cover the same days — which is what "last 30 days" means.
 */
export function statementWindowStart(now: Date | number, days: number = STATEMENT_WINDOW_DAYS): Date {
  return new Date(new Date(now).getTime() - days * 86400000)
}

/**
 * What a payment row says. The camper knows their own money by how they handed it over, so the
 * method leads; the note (e.g. "Square Terminal") is appended when staff recorded one.
 */
export function paymentDescription(p: StatementPayment): string {
  const verb = netOf(p) < 0 ? 'refund' : 'payment'
  const raw = (p.method || '').trim()
  // No method recorded: just "Payment" — never "Payment payment", and never a guessed method.
  const head = raw
    ? `${raw.charAt(0).toUpperCase() + raw.slice(1)} ${verb}`
    : verb.charAt(0).toUpperCase() + verb.slice(1)
  const note = (p.note || '').trim()
  return `${head}${note ? ' · ' + note : ''}`
}

/**
 * The activity list: charges and payments inside the window, oldest first.
 *
 * ⚠ VOIDED CHARGES ARE EXCLUDED, matching the balances below and every other total in the app —
 * a camper has no reason to see a charge that no longer exists. Rows with no usable timestamp are
 * dropped rather than guessed at a date for; they cannot be placed in a chronological list
 * honestly, and inventing "today" for them would put old money at the top of a recent-activity
 * statement.
 */
export function statementActivity(
  items: StatementLineItem[] | null | undefined,
  payments: StatementPayment[] | null | undefined,
  opts: { now: Date | number; windowDays?: number },
): StatementRow[] {
  const days = opts.windowDays ?? STATEMENT_WINDOW_DAYS
  const from = statementWindowStart(opts.now, days).getTime()
  const rows: StatementRow[] = []

  for (const i of (items || []).filter(notVoided)) {
    const ts = new Date(i.charged_at || '').getTime()
    if (!Number.isFinite(ts) || ts < from) continue
    rows.push({
      ts, date: shortDate(ts),
      description: (i.description || 'Charge').trim() || 'Charge',
      cents: i.line_total, kind: 'charge',
    })
  }

  for (const p of payments || []) {
    const ts = new Date(p.paid_at || '').getTime()
    if (!Number.isFinite(ts) || ts < from) continue
    rows.push({
      ts, date: shortDate(ts),
      description: paymentDescription(p),
      cents: -netOf(p), kind: 'payment',
    })
  }

  return rows.sort((a, b) => a.ts - b.ts)
}

/**
 * The closing total. Three wordings, one rule, used for the statement's grand total.
 *
 * `settled` means "nothing is owed" — true for both paid-up and in-credit — and is what the
 * renderers colour green on.
 */
export function statementTotalLine(cents: number): { label: string; value: string; settled: boolean } {
  if (cents === 0) return { label: 'Total', value: 'Paid in full ✓', settled: true }
  if (cents < 0) return { label: 'Credit on account', value: receiptMoney(cents), settled: true }
  return { label: 'Total balance due', value: receiptMoney(cents), settled: false }
}

/**
 * One of the two account cards in separated mode. Same rule as the total, worded for a card: the
 * figure sits large and the state sits under it.
 */
export function statementCardLine(cents: number): { amount: string; tag: string; settled: boolean } {
  if (cents === 0) return { amount: receiptMoney(0), tag: 'paid up ✓', settled: true }
  if (cents < 0) return { amount: receiptMoney(cents), tag: 'credit on account', settled: true }
  return { amount: receiptMoney(cents), tag: 'balance due', settled: false }
}

/** Everything a rendered statement needs — resolved by the caller, so the renderers stay pure. */
export type StatementBuckets = {
  campLabel: string
  campBalance: number
  seasonalLabel: string
  seasonalBalance: number
}

export type StatementView = {
  parkName: string
  parkLocation: string
  guestName: string
  now: Date | number
  rows: StatementRow[]
  /** The whole-account balance, server-computed. The closing total on both renderings. */
  accountBalance: number
  /** Separated mode only: the two account cards. `null` in combined — one total, no cards. */
  buckets: StatementBuckets | null
}

/** Staff-entered text goes into an email: a camper called "Rian & Charissa" must not arrive as
 *  broken markup, and a charge description is free text. */
const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The styled HTML email. Same family as the payment receipt: gradient header, tent, white card. */
export function renderAccountStatementHtml(v: StatementView): string {
  const { rows } = v
  const now = v.now
  const total = statementTotalLine(v.accountBalance)
  const parkLine = v.parkName + (v.parkLocation ? ' \u00b7 ' + v.parkLocation : '')
  const guestName = v.guestName
  const activityHtml = rows.length === 0
    ? `<p style="margin:2px 0 0;font-size:14px;color:#9ca3af;font-style:italic;">No activity in the last ${STATEMENT_WINDOW_DAYS} days</p>`
    : `<table style="width:100%;border-collapse:collapse;">
${rows.map(r => {
  const cell = 'padding:9px 0;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top;'
  // A payment is green with a true minus sign; a charge — and a refund, which is money handed
  // back and therefore positive — reads in the ordinary text colour.
  const amt = r.cents < 0
? `<td style="${cell}text-align:right;white-space:nowrap;color:#15803d;font-weight:600;">&minus;${receiptMoney(r.cents)}</td>`
: `<td style="${cell}text-align:right;white-space:nowrap;color:#374151;">${receiptMoney(r.cents)}</td>`
  return `          <tr><td style="${cell}color:#9ca3af;width:64px;white-space:nowrap;">${esc(r.date)}</td><td style="${cell}color:#374151;">${esc(r.description)}</td>${amt}</tr>`
}).join('\n')}
    </table>`

  // ── THE BALANCE BLOCK — the only part that branches on billing mode ────────────────────
  let cardsHtml = ''
  if (v.buckets) {
    const camp = statementCardLine(v.buckets.campBalance)
    const seas = statementCardLine(v.buckets.seasonalBalance)
    const card = (label: string, line: { amount: string; tag: string }, c: {
      bg: string; border: string; lbl: string; amt: string; tag: string
    }) => `
        <div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:16px 18px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${c.lbl};">${esc(label)}</p>
          <div style="font-size:24px;font-weight:800;letter-spacing:-.5px;color:${c.amt};">${line.amount}</div>
          <div style="font-size:11px;font-weight:600;margin-top:2px;color:${c.tag};">${line.tag}</div>
        </div>`
    // A table, not flexbox — Outlook does not lay out flex, and these two must sit side by side.
    cardsHtml = `
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:6px;">${card(v.buckets.campLabel, camp, { bg: '#f0fdf4', border: '#bbf7d0', lbl: '#15803d', amt: '#15803d', tag: '#166534' })}
        </td>
        <td style="width:50%;vertical-align:top;padding-left:6px;">${card(v.buckets.seasonalLabel, seas, { bg: '#FFFBEB', border: '#fde68a', lbl: '#B4842B', amt: '#B4842B', tag: '#a16207' })}
        </td>
      </tr>
    </table>`
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#eceff1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#2E6B8A 0%,#1e4f6b 100%);background-color:#2E6B8A;padding:32px 40px;text-align:center;">
<div style="font-size:38px;margin-bottom:6px;">&#127957;&#65039;</div>
<h1 style="margin:0;color:#fff;font-size:21px;font-weight:700;letter-spacing:-0.3px;">Account Statement</h1>
<p style="margin:6px 0 0;color:rgba(255,255,255,0.82);font-size:14px;">${esc(parkLine)}</p>
  </div>
  <div style="padding:30px 40px 34px;">
<p style="margin:0 0 22px;font-size:15px;color:#374151;line-height:1.55;">Hi ${esc(guestName)} &mdash; here&apos;s a summary of your account with us as of ${longDate(now)}.</p>

<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;">Activity</p>
<p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">Since ${longDate(statementWindowStart(now))} &middot; older items not shown</p>
${activityHtml}

<div style="margin-top:22px;border-top:2px solid #e5e7eb;padding-top:18px;">
  ${cardsHtml}
  <table style="width:100%;border-collapse:collapse;margin-top:${v.buckets ? '16px' : '0'};">
    <tr>
      <td style="${v.buckets ? 'border-top:1px solid #f3f4f6;padding-top:14px;' : ''}font-size:15px;font-weight:700;color:#111827;">${total.label}</td>
      <td style="${v.buckets ? 'border-top:1px solid #f3f4f6;padding-top:14px;' : ''}font-size:22px;font-weight:800;text-align:right;color:${total.settled ? '#15803d' : '#dc2626'};">${total.value}</td>
    </tr>
  </table>
</div>

<p style="margin:22px 0 0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;">This is a summary of recent activity, not your full history.<br>Need a complete statement or a specific receipt? Just reply and we&apos;ll send it.</p>
  </div>
  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">${esc(parkLine)}</p>
<p style="margin:5px 0 0;color:#d1d5db;font-size:11px;">Thank you for being part of our community &#127957;&#65039;</p>
  </div>
</div>
</body>
</html>`

  return html
}

/** The plain-text alternative, in the SAME structure — not the old all-history dump. */
export function renderAccountStatementText(v: StatementView): string {
  const { rows } = v
  const now = v.now
  const total = statementTotalLine(v.accountBalance)
  const parkLine = v.parkName + (v.parkLocation ? ' \u00b7 ' + v.parkLocation : '')
  const guestName = v.guestName
  let cardsText = ''
  if (v.buckets) {
    const camp = statementCardLine(v.buckets.campBalance)
    const seas = statementCardLine(v.buckets.seasonalBalance)
    cardsText = `${v.buckets.campLabel}: ${camp.amount} (${camp.tag})\n${v.buckets.seasonalLabel}: ${seas.amount} (${seas.tag})\n`
  }
  // The text part, in the SAME structure — not the old dump. A text-only client gets the
  // window, the ordering and the closing balance, just without the styling.
  const rule = '─'.repeat(44)
  const text = `ACCOUNT STATEMENT
${parkLine}
${rule}
Hi ${guestName} — here's a summary of your account with us as of ${longDate(now)}.

ACTIVITY
Since ${longDate(statementWindowStart(now))} · older items not shown

${rows.length === 0
  ? `  No activity in the last ${STATEMENT_WINDOW_DAYS} days`
  : rows.map(r => `  ${r.date.padEnd(8)}${r.description}`.padEnd(40).slice(0, 40) +
  (r.cents < 0 ? '-' + receiptMoney(r.cents) : receiptMoney(r.cents)).padStart(12)).join('\n')}

${rule}
${cardsText}${total.label}: ${total.value}
${rule}
This is a summary of recent activity, not your full history.
Need a complete statement or a specific receipt? Just reply and we'll send it.

${parkLine}`

  return text
}
