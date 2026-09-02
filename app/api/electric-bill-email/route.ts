import { NextRequest, NextResponse } from 'next/server'
import { renderElectricMessageFor } from '@/lib/electric-bill-tokens'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { buildLedger, buildStatement } from '@/lib/ledger'
import { normalizeBillingMode, laneBalances } from '@/lib/ledger-lanes'
import { accountBuckets, billAccountBalance, filterToBucket } from '@/lib/account-buckets'
import { renderStatementHtml } from '@/lib/statement-html'
import { requireRole } from '@/lib/require-role'

// Lazy so `next build` (which has no RESEND_API_KEY) doesn't construct — and
// throw — at import time. The client is built at request time instead.
function getResend() { return new Resend(process.env.RESEND_API_KEY) }
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  const denied = await requireRole(request, 'staff')
  if (denied) return denied

  try {
    const body = await request.json()
    const {
      guestName,
      guestEmail,
      siteNumber,
      folioId,
      billingMonth,
      emailMessage,
      electricAmount,
      newCharges,
      paymentsReceived,
      totalBalance,
      balanceForward,
      // Additive: the walk knows the usage, and the owner's message can now mention it.
      // Absent on an older caller, in which case {{kwh}} simply renders empty.
      kwhUsed,
    } = body

    const { data: settings } = await supabase
      .from('settings')
      .select('park_name, park_location, park_email')
      .single()

    // ── PHASE 4: WHICH MONEY GOES ON THIS BILL ──────────────────────────────────────────────
    //
    // 'combined' (this park today) → the statement below is the WHOLE folio, byte-for-byte as it
    // always has been. 'separated' → the CAMP ACCOUNT: electric, store and everyday, with the
    // seasonal fee left off.
    //
    // ⚠ ITS OWN GUARDED SELECT. A park that has not run the Phase 4 migration has no billing_mode
    // column, and a failed select there would break an email that works today. Any failure lands
    // on 'combined', which is exactly today's behaviour.
    let billingMode: 'combined' | 'separated' = 'combined'
    try {
      const { data: modeRow } = await supabase.from('settings').select('billing_mode').limit(1).single()
      billingMode = normalizeBillingMode(modeRow?.billing_mode)
    } catch { /* stays combined */ }

    // Filled in from the folio below, in separated mode only.
    let campBalanceCents: number | null = null

    let statementHtml = ''
    let ledgerBuilt = false
    if (folioId) {
      try {
        const [{ data: items }, { data: pmts }] = await Promise.all([
          // ⚠ `lane` AND `product_id` MUST BE SELECTED. classifyLineItem() checks a DECLARED lane
          // first and only then infers from the electric signal and product_id. The seasonal fee
          // has neither, so without `lane` it falls through to `other`, which rolls up into Camp —
          // and the season fee would appear on the electric bill. That exact omission was a real
          // bug in the blueprint (its PR #91); it is not repeated here.
          supabase.from('folio_line_items').select('id, description, quantity, line_total, charged_at, voided, product_id, lane').eq('folio_id', folioId),
          supabase.from('folio_payments').select('id, method, amount, surcharge_amount, paid_at, lane').eq('folio_id', folioId).eq('status', 'completed'),
        ])

        // The electric signal, so a metered charge classifies as electric rather than `other`.
        // Both fold into Camp, so it does not move the total — it is read for the classification
        // itself to be right.
        const itemIds = (items || []).map(i => i.id)
        const { data: readings } = itemIds.length
          ? await supabase.from('electric_readings').select('folio_line_item_id').in('folio_line_item_id', itemIds)
          : { data: [] }
        const ctx = {
          electricLineItemIds: new Set(
            (readings || []).map(r => r.folio_line_item_id).filter(Boolean) as string[]),
        }

        // ── SEPARATED: THE BILL IS THE CAMP ACCOUNT ─────────────────────────────────────────
        //
        // Electric, store and everyday — everything EXCEPT the seasonal fee. That matches the
        // headline balance below and matches how this park bills: its own bill message tells
        // campers that firewood and visitor fees are included in the total amount due.
        //
        // COMBINED — this park today — takes the whole folio, exactly as it always has.
        let stmtItems = items || []
        let stmtPmts = pmts || []
        if (billingMode === 'separated') {
          const camp = filterToBucket('camp', stmtItems, stmtPmts, ctx)
          stmtItems = camp.items
          stmtPmts = camp.payments
        }

        campBalanceCents = billingMode === 'separated'
          ? accountBuckets(laneBalances(items || [], pmts || [], ctx)).camp.balance
          : null

        const stmt = buildStatement(buildLedger(stmtItems, stmtPmts), Date.now(), 90)

        statementHtml = renderStatementHtml(stmt)
        ledgerBuilt = true
      } catch (e) {
        console.error('Ledger statement build failed; falling back to lump-sum:', e)
      }
    }

    /** What this bill says is owed: the Camp Account in separated mode, the whole account in
     *  combined. One value, so the headline figure and the {{balance}} token cannot disagree.
     *
     *  ⚠ THE SERVER DECIDES IT. `totalBalance` arrives in the request body from the Electric
     *  Billing screen; a stale or wrong figure from any caller must not reach a camper. It is
     *  used only as the fallback when the folio could not be read — a bill with an imperfect
     *  balance beats no bill. */
    const billBalance: number = billAccountBalance(billingMode, campBalanceCents, totalBalance)

    // ⚠ THE OWNER'S MESSAGE IS NOW RENDERED, NOT INSERTED RAW.
    //
    // It used to go straight into the email with only newlines converted. The billing screen now
    // offers click-to-insert merge fields for it, and chips without substitution would put a
    // literal "Hi {{first_name}}," in a camper's bill — so the two ship together.
    //
    // ⚠ AN UNKNOWN TOKEN IS LEFT VISIBLE RATHER THAN BLANKED. See renderElectricMessage(): this
    // input is free text a park may have written long before tokens existed, and silently
    // deleting a stretch of it would be worse than leaving something odd on screen. Cady's saved
    // message contains no braces today, so this renders a byte-identical email.
    const renderedMessage = renderElectricMessageFor(String(emailMessage ?? ''), {
      guestName, siteNumber, billingMonth,
      kwhUsed: typeof kwhUsed === 'number' ? kwhUsed : null,
      amountCents: typeof electricAmount === 'number' ? electricAmount : null,
      balanceCents: typeof billBalance === 'number' ? billBalance : null,
    })

    const campgroundName = settings?.park_name || 'Our Campground'
    const campgroundLocation = settings?.park_location || ''
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'reservations@example.com'
    const replyToEmail = settings?.park_email || fromEmail

    const formatDateTime = (dateStr: string) => {
      const d = new Date(dateStr)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    }

    const newChargeRows = (newCharges || []).map((item: any) => `
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">${item.description}${item.charged_at ? ' · ' + formatDateTime(item.charged_at) : ''}</td>
        <td style="padding:6px 0;color:#ffffff;font-size:14px;text-align:right;">$${(item.line_total/100).toFixed(2)}</td>
      </tr>`).join('')

    const isCredit = billBalance < 0
    const balanceColor = isCredit ? '#4ADE80' : billBalance === 0 ? '#4ADE80' : '#FCD34D'
    const balanceLabel = isCredit ? 'Credit on Account' : billBalance === 0 ? '✓ Paid in Full' : 'Total Balance Due'
    const balanceDisplay = isCredit ? '$' + (Math.abs(billBalance)/100).toFixed(2) : billBalance === 0 ? '' : '$' + (billBalance/100).toFixed(2)

    // ── Account Statement: a running ledger — every charge AND payment/credit in
    //    true date order with a running balance per line. Pulls the COMPLETE folio
    //    (electric, POS items, payments, credits), not just this month's electric.
    //    Rendered by the shared renderStatementHtml (also used by the account receipt). ──

    if (!ledgerBuilt) {
      // Fallback (no folioId, or folio fetch failed): the original lump-sum layout,
      // so an email never breaks even if the ledger can't be assembled.
      statementHtml = `
  <div style="background-color:#2B2B2B;margin:16px;border-radius:12px;padding:24px;">
    <h3 style="color:#ffffff;margin:0 0 16px;font-size:16px;">Account Statement</h3>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">${balanceForward < 0 ? 'Credit Forward' : 'Balance Forward'}</td>
        <td style="padding:6px 0;font-size:14px;font-weight:bold;text-align:right;color:${balanceForward < 0 ? '#4ADE80' : balanceForward === 0 ? '#9CA3AF' : '#FCA5A5'};">
          ${balanceForward < 0 ? '-$' + (Math.abs(balanceForward)/100).toFixed(2) : '$' + (balanceForward/100).toFixed(2)}
        </td>
      </tr>
      <tr><td colspan="2" style="padding:4px 0;border-top:1px solid #374151;"></td></tr>
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">${billingMonth} Electric</td>
        <td style="padding:6px 0;color:#FCD34D;font-size:14px;font-weight:bold;text-align:right;">$${(electricAmount/100).toFixed(2)}</td>
      </tr>
      ${newChargeRows}
      <tr><td colspan="2" style="padding:4px 0;border-top:1px solid #374151;"></td></tr>
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">Payments Received</td>
        <td style="padding:6px 0;color:${paymentsReceived > 0 ? '#4ADE80' : '#9CA3AF'};font-size:14px;font-weight:bold;text-align:right;">
          ${paymentsReceived > 0 ? '-$' + (paymentsReceived/100).toFixed(2) : '$0.00'}
        </td>
      </tr>
      <tr><td colspan="2" style="padding:8px 0 0;border-top:1px solid #374151;"></td></tr>
      <tr>
        <td style="padding:8px 0 4px;color:#ffffff;font-size:16px;font-weight:bold;">${balanceLabel}</td>
        <td style="padding:8px 0 4px;color:${balanceColor};font-size:16px;font-weight:bold;text-align:right;">
          ${balanceDisplay}
        </td>
      </tr>
    </table>
  </div>`
    }

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#1C1C1C;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background-color:#1C1C1C;">

  <div style="background-color:#2B2B2B;padding:32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0 0 4px;font-size:24px;">${campgroundName}</h1>
    <p style="color:#9CA3AF;margin:0;font-size:14px;">${campgroundLocation}</p>
  </div>

  <div style="background-color:#2B2B2B;margin:16px;border-radius:12px;padding:32px;text-align:center;">
    <div style="font-size:48px;margin-bottom:16px;">⚡</div>
    <h2 style="color:#ffffff;margin:0 0 8px;font-size:24px;">${billingMonth} Electric Statement</h2>
    <p style="color:#9CA3AF;margin:0;font-size:14px;">${guestName} · Site ${siteNumber}</p>
  </div>

  <div style="background-color:#2B2B2B;margin:16px;border-radius:12px;padding:24px;">
    <p style="color:#D1D5DB;font-size:15px;margin:0;line-height:1.6;">${renderedMessage.replace(/\n/g, "<br>")}</p>
  </div>

${statementHtml}

  <div style="padding:24px;text-align:center;">
    <p style="color:#6B7280;font-size:12px;margin:0;">Thank you! Please don't hesitate to reach out if you have any questions.</p>
    <p style="color:#6B7280;font-size:12px;margin:8px 0 0;">${campgroundName} · ${campgroundLocation}</p>
  </div>
</div>
</body>
</html>`

    await getResend().emails.send({
      from: `${campgroundName} <${fromEmail}>`,
      replyTo: replyToEmail,
      to: guestEmail,
      subject: `${billingMonth} Electric Statement — ${campgroundName}`,
      html,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Electric bill email error:', error)
    return NextResponse.json({ error: error.message || 'Failed to send email' }, { status: 500 })
  }
}
