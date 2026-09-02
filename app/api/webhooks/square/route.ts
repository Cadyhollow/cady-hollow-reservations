import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeLaneSplit, recordCardPayment } from '@/lib/lane-payments'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function verifySquareWebhook(body: string, signature: string, sigKey: string, url: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', sigKey)
    hmac.update(url + body)
    const hash = hmac.digest('base64')
    return hash === signature
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get('x-square-hmacsha256-signature') || ''
    const sigKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || ''
    const url = request.url

    // Verify webhook signature in production
    if (sigKey && sigKey !== 'your_webhook_secret_here') {
      const valid = verifySquareWebhook(body, signature, sigKey, url)
      if (!valid) {
        console.error('Invalid Square webhook signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const event = JSON.parse(body)
    console.log('Square webhook event:', event.type)

    // Handle Terminal checkout events
    if (event.type === 'terminal.checkout.updated') {
      const checkout = event.data?.object?.checkout
      if (!checkout) return NextResponse.json({ ok: true })

      const squareCheckoutId = checkout.id
      const status = checkout.status // COMPLETED, CANCELED, etc.
      const paymentId = checkout.payment_ids?.[0] || ''

      // Find the terminal checkout record
      const { data: terminalCheckout } = await supabase
        .from('terminal_checkouts')
        .select('*')
        .eq('square_checkout_id', squareCheckoutId)
        .single()

      if (!terminalCheckout) {
        console.log('Terminal checkout not found:', squareCheckoutId)
        return NextResponse.json({ ok: true })
      }

      if (status === 'COMPLETED') {
        // Update terminal checkout record
        await supabase
          .from('terminal_checkouts')
          .update({ status: 'completed', payment_id: paymentId, completed_at: new Date().toISOString() })
          .eq('square_checkout_id', squareCheckoutId)

        // ── RECORDING THE PAYMENT ─────────────────────────────────────────────────────────────
        //
        // ⚠ THIS WAS A BARE INSERT WITH NO GUARD, AND SQUARE DELIVERS WEBHOOKS AT LEAST ONCE.
        // A retry — anything that stops Square seeing a 200 — ran this block again, found the
        // checkout again (the lookup above has no status filter) and inserted a SECOND payment
        // row for the same tap. The camper would have been recorded as paying twice. It has not
        // happened on this park (89 real Square payment ids, all distinct), but only luck stood
        // between the code and it.
        //
        // recordCardPayment() is IDEMPOTENT ON THE SQUARE PAYMENT ID: a retry finds the row
        // already there and writes nothing. That is also what makes it safe for the poll in
        // /api/terminal/charge to record as well — whichever arrives second is a no-op.
        //
        // ⚠ AND IT CARRIES THE LANES. A checkout sent with a lane split records one row per lane
        // sharing the same square_payment_id; a whole-account charge records the single untagged
        // row it always did, with the same amount and the same surcharge.
        const rec = await recordCardPayment(supabase, {
          folioId: terminalCheckout.folio_id,
          squarePaymentId: paymentId,
          split: normalizeLaneSplit(terminalCheckout.lanes),
          amount: terminalCheckout.amount,
          surchargeAmount: terminalCheckout.surcharge_amount || 0,
          note: 'Square Terminal' + (terminalCheckout.note ? ' · ' + terminalCheckout.note : ''),
        })
        if (rec.error) console.error('Terminal payment could not be recorded from the webhook:', rec.error, paymentId)

        // NOTE: We intentionally do NOT mirror Terminal payments into
        // reservations.amount_paid. Folio money lives ONLY in folio_payments.
        // Mirroring here double-counted the same dollar (booking amount_paid +
        // folio payment), which inflated revenue and produced phantom
        // balances/credits. Paid status is derived everywhere from
        // total_price - amount_paid - folio_payments.

        console.log('Payment recorded for folio:', terminalCheckout.folio_id)

      } else if (status === 'CANCELED') {
        await supabase
          .from('terminal_checkouts')
          .update({ status: 'cancelled' })
          .eq('square_checkout_id', squareCheckoutId)
        console.log('Terminal checkout cancelled:', squareCheckoutId)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
