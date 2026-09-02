import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSquareCheckout, normalizeCheckoutState } from '@/lib/square-terminal'
import { requireRole } from '@/lib/require-role'
import { normalizeLaneSplit, laneSplitTotal, recordCardPayment } from '@/lib/lane-payments'
import { SQUARE_API_BASE } from '@/lib/square-env'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/terminal/charge?checkoutId=... — what Square currently thinks of this checkout.
//
// The UI has polled this since terminal support was added, but only POST was ever exported,
// so every poll came back 405 and the operator saw "waiting..." until a three-minute timeout
// no matter what the terminal was doing. That blind spot is why a stuck charge had no obvious
// next step.
//
// ⚠ THIS USED TO BE DELIBERATELY READ-ONLY, on the grounds that a GET which writes money would
// race the webhook and record the same payment twice. That objection is now answered rather than
// avoided: recordCardPayment() is idempotent on the Square payment id, so the two paths cannot
// duplicate each other. See the note at the recording block below.
export async function GET(request: NextRequest) {
  const denied = await requireRole(request, 'staff')
  if (denied) return denied

  const checkoutId = request.nextUrl.searchParams.get('checkoutId')
  if (!checkoutId) {
    return NextResponse.json({ error: 'Missing checkoutId' }, { status: 400 })
  }

  const { ok, checkout, errors } = await fetchSquareCheckout(checkoutId)
  if (!ok) {
    return NextResponse.json(
      { error: errors?.[0]?.detail || 'Could not read checkout status' },
      { status: 400 }
    )
  }

  const paymentId = checkout.payment_ids?.[0] || null

  // ── THE POLL NOW RECORDS, AND THAT IS THE POINT ─────────────────────────────────────────────
  //
  // Until now this park recorded a terminal payment in ONE place: the Square webhook. If that
  // webhook were ever missed — a deploy mid-request, a timeout, anything that stops Square seeing
  // a 200 — the card would have been charged and the folio would never know. It has not happened
  // (55 completed checkouts, 55 recorded payments) but it was a single point of failure on money.
  //
  // ⚠ RECORDING TWICE IS NOW SAFE, WHICH IS WHAT MAKES TWO PATHS ALLOWABLE. recordCardPayment()
  // is idempotent on the Square payment id: whichever of the poll or the webhook arrives second
  // finds the row already there and writes nothing. Without that guard, adding this second path
  // would have created the very double-recording it protects against.
  //
  // ⚠ COMPLETED **AND** A REAL PAYMENT ID, together, before a cent is written. Never on PENDING,
  // never on IN_PROGRESS, never without an id.
  let recorded = false
  if (checkout.status === 'COMPLETED' && paymentId) {
    const { data: tc } = await supabase
      .from('terminal_checkouts')
      .select('*')
      .eq('square_checkout_id', checkout.id)
      .maybeSingle()
    if (tc) {
      const rec = await recordCardPayment(supabase, {
        folioId: tc.folio_id,
        squarePaymentId: paymentId,
        // The lanes the operator chose when the charge was sent. Empty for a whole-account
        // payment, which records exactly the single untagged row it always did.
        split: normalizeLaneSplit(tc.lanes),
        amount: tc.amount,
        surchargeAmount: tc.surcharge_amount || 0,
        note: 'Square Terminal' + (tc.note ? ' · ' + tc.note : ''),
      })
      recorded = rec.recorded || rec.alreadyRecorded
      if (rec.error) console.error('Terminal payment could not be recorded from the poll:', rec.error, paymentId)
      if (rec.recorded) {
        await supabase.from('terminal_checkouts')
          .update({ status: 'completed', payment_id: paymentId, completed_at: new Date().toISOString() })
          .eq('square_checkout_id', checkout.id)
      }
    }
  }

  return NextResponse.json({
    // ⚠ WHETHER THE MONEY IS ON THE FOLIO YET. The screen waits for this rather than merely for
    // COMPLETED, so it never tells a member of staff "paid" before the books say so.
    recorded,
    // Raw Square value — the calendar and guest-folio pollers compare against this.
    status: checkout.status,
    state: normalizeCheckoutState(checkout.status),
    checkoutId: checkout.id,
    paymentId,
    amount: checkout.amount_money?.amount ?? null,
    cancelReason: checkout.cancel_reason || null,
  })
}

export async function POST(request: NextRequest) {
  const denied = await requireRole(request, 'staff')
  if (denied) return denied

  try {
    const { folioId, amount, surchargeAmount, note, lanes } = await request.json()

    // ⚠ THE CARD IS CHARGED THE SUM OF THE ROWS THAT WILL BE WRITTEN, never a separately-supplied
    // total. Trusting both would let the terminal take one figure while the ledger recorded
    // another — the worst money bug available here, and one that would reconcile on every screen.
    // No split (the ordinary whole-account payment) falls back to `amount`, exactly as before.
    const laneSplit = normalizeLaneSplit(lanes)

    const chargeAmount = laneSplit.length ? laneSplitTotal(laneSplit) : amount
    if (!chargeAmount || chargeAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    // Get device ID from settings
    const { data: settings } = await supabase
      .from('settings')
      .select('square_terminal_device_id')
      .single()

    const deviceId = settings?.square_terminal_device_id
    if (!deviceId) {
      return NextResponse.json({ error: 'No Terminal device configured. Please pair your Terminal in Settings first.' }, { status: 400 })
    }

    const idempotencyKey = `folio-${folioId}-${Date.now()}`

    // Send checkout request to Square Terminal API
    const squareResponse = await fetch(`${SQUARE_API_BASE}/v2/terminals/checkouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Square-Version': '2024-01-18',
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        checkout: {
          amount_money: {
            amount: chargeAmount,
            currency: 'USD',
          },
          device_options: {
            device_id: deviceId,
            tip_settings: {
              allow_tipping: false,
            },
            skip_receipt_screen: false,
          },
          note: note || 'ResoNation charge',
          payment_type: 'CARD_PRESENT',
        },
      }),
    })

    const squareData = await squareResponse.json()

    if (!squareResponse.ok || !squareData.checkout) {
      console.error('Square Terminal error:', squareData)
      return NextResponse.json(
        { error: squareData.errors?.[0]?.detail || 'Failed to send charge to Terminal' },
        { status: 400 }
      )
    }

    const checkoutId = squareData.checkout.id

    // Save terminal checkout record
    const { error: insertError } = await supabase.from('terminal_checkouts').insert({
  folio_id: folioId,
  square_checkout_id: checkoutId,
  amount: chargeAmount,
  surcharge_amount: surchargeAmount || 0,
  status: 'pending',
  device_id: deviceId,
  note: note || '',
  // The split travels WITH the checkout, not with the request that completes it: the completion
  // arrives later, from the poll or the webhook, and neither of those knows what the operator
  // chose. NULL for an ordinary whole-account payment — the column already existed, unused.
  lanes: laneSplit.length ? laneSplit : null,
})

if (insertError) {
  console.error('Failed to insert terminal_checkout:', insertError.message)
}

    return NextResponse.json({
      success: true,
      checkoutId,
      message: 'Charge sent to Terminal — waiting for customer to tap card',
    })

  } catch (error: any) {
    console.error('Terminal charge error:', error)
    return NextResponse.json({ error: error.message || 'Unexpected error' }, { status: 500 })
  }
}
