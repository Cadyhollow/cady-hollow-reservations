// Shared running-ledger statement renderer. Extracted verbatim from the electric
// bill email (app/api/electric-bill-email/route.ts) so BOTH the electric statement
// and the guest-account receipt render the same block — Balance Forward row, green
// payments with a minus, per-line "Bal −$X", and a Current Balance / Credit on
// Account / ✓ Paid in Full footer. Takes a Statement (from buildStatement).
//
// `showNotes` is off by default so the electric email is byte-identical to before;
// the account receipt turns it on to surface per-line notes (payment note / item note)
// next to the date. Nothing else differs between the two callers' statement blocks.

import type { Statement } from './ledger'

const money = (c: number) => '$' + (Math.abs(c) / 100).toFixed(2)
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function renderStatementHtml(stmt: Statement, opts?: { showNotes?: boolean }): string {
  const showNotes = opts?.showNotes ?? false
  const fwd = stmt.balanceForward
  const fwdColor = fwd < 0 ? '#4ADE80' : fwd === 0 ? '#9CA3AF' : '#FCD34D'
  const fwdDisplay = (fwd < 0 ? '−' : '') + money(fwd)

  const lineRows = stmt.lines.map((ev) => {
    const isPay = ev.kind === 'payment'
    const amtColor = isPay ? '#4ADE80' : '#ffffff'
    const amtDisplay = (isPay ? '−' : '') + money(ev.amount)
    // Running-balance column matches the in-app folio ledger: positive amount + a
    // "credit" indicator when in credit — never a raw negative (money() is already abs).
    const balDisplay = 'Bal ' + money(ev.balanceAfter) + (ev.balanceAfter < 0 ? ' credit' : '')
    return `
      <tr>
        <td style="padding:10px 0;border-top:1px solid #374151;vertical-align:top;">
          <div style="color:#ffffff;font-size:14px;line-height:1.3;">${ev.label}</div>
          <div style="color:#6B7280;font-size:12px;margin-top:2px;">${fmtDate(ev.ts)}${(showNotes && ev.note) ? ' · ' + ev.note : ''}</div>
        </td>
        <td style="padding:10px 0;border-top:1px solid #374151;text-align:right;vertical-align:top;white-space:nowrap;">
          <div style="color:${amtColor};font-size:14px;font-weight:bold;">${amtDisplay}</div>
          <div style="color:#6B7280;font-size:12px;margin-top:2px;">${balDisplay}</div>
        </td>
      </tr>`
  }).join('')

  const cur = stmt.currentBalance
  const curLabel = cur < 0 ? 'Credit on Account' : cur === 0 ? '✓ Paid in Full' : 'Current Balance'
  const curColor = cur <= 0 ? '#4ADE80' : '#FCD34D'
  const curDisplay = cur === 0 ? '' : money(cur)

  return `
  <div style="background-color:#2B2B2B;margin:16px;border-radius:12px;padding:24px;">
    <h3 style="color:#ffffff;margin:0 0 4px;font-size:16px;">Account Statement</h3>
    <p style="color:#6B7280;margin:0 0 12px;font-size:12px;">Your running account — every charge and payment in date order.</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:2px 0 10px;color:#9CA3AF;font-size:14px;font-weight:bold;vertical-align:top;">Balance Forward</td>
        <td style="padding:2px 0 10px;text-align:right;color:${fwdColor};font-size:14px;font-weight:bold;vertical-align:top;white-space:nowrap;">${fwdDisplay}</td>
      </tr>${lineRows}
      <tr>
        <td style="padding:14px 0 0;border-top:2px solid #4B5563;color:#ffffff;font-size:16px;font-weight:bold;">${curLabel}</td>
        <td style="padding:14px 0 0;border-top:2px solid #4B5563;text-align:right;color:${curColor};font-size:16px;font-weight:bold;white-space:nowrap;">${curDisplay}</td>
      </tr>
    </table>
  </div>`
}
