'use client'
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { SQUARE_SDK_URL } from '@/lib/square-env'

// Shared Square Web Payments MANUAL card entry — the single implementation for every
// surface that captures a card in the browser (was hand-rolled 5×). The seam is the
// TOKEN: this loads the SDK, renders the card field, and exposes tokenize(). Each
// surface makes its OWN charge call afterward (admin → /api/admin-card-payment,
// public book → /api/payment) and its own post-charge flow. App ID + location ID come
// from env (NEXT_PUBLIC_SQUARE_APP_ID / NEXT_PUBLIC_SQUARE_LOCATION_ID) — no hardcode.

// Load the Web Payments SDK exactly once per page.
let sdkPromise: Promise<void> | null = null
function loadSquareSdk(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).Square) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    // Resolved centrally so the card form and the server that charges its token can never
    // disagree about which Square environment they are in. This used to be an inline ternary
    // that fell through to the SANDBOX SDK for any value that was not exactly 'production' —
    // so an unset or misspelled variable pointed the live card form at sandbox. The helper
    // inverts that: sandbox is opt-in by exact match, everything else is production.
    script.src = SQUARE_SDK_URL
    script.onload = () => resolve()
    script.onerror = () => { sdkPromise = null; reject(new Error('Square payment library failed to load.')) }
    document.head.appendChild(script)
  })
  return sdkPromise
}

// ONE payments instance for the page. Square allows a single card per location at a
// time; reusing one instance (rather than newing it per mount) keeps card create/
// destroy well-defined.
let paymentsInstance: any = null
async function getPayments(): Promise<any> {
  await loadSquareSdk()
  if (!paymentsInstance) {
    paymentsInstance = (window as any).Square.payments(
      process.env.NEXT_PUBLIC_SQUARE_APP_ID!,
      process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID!,
    )
  }
  return paymentsInstance
}

// Serialize every attach/destroy across ALL mounts. This is the fix for the
// mount→destroy→remount bug: switching Cash→Card→Cash→Card unmounts/remounts the
// field, and an un-serialized destroy() from the old mount would still be in flight
// when the new mount's attach() runs — Square then leaves the new container EMPTY.
// Chaining guarantees the previous card is fully destroyed before the next attaches.
let cardOpQueue: Promise<void> = Promise.resolve()

export type SquareTokenResult = { ok: true; token: string } | { ok: false; error: string }

// Hook: owns the card lifecycle for a container (by id). Returns ready state, any
// load error, and tokenize(). Destroys the card on unmount so the Square iframe never
// leaks — serialized so the next mount re-attaches cleanly.
export function useSquareCard(containerId: string) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false

    cardOpQueue = cardOpQueue.then(async () => {
      if (cancelled) return
      try {
        const payments = await getPayments()
        if (cancelled || !document.getElementById(containerId)) return
        const card = await payments.card()
        // Component may have unmounted while awaiting — destroy and bail so we don't
        // attach an orphan or setState after unmount.
        if (cancelled) { await card.destroy().catch(() => {}); return }
        await card.attach('#' + containerId)
        if (cancelled) { await card.destroy().catch(() => {}); return }
        cardRef.current = card
        setReady(true)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load the card form.')
      }
    }).catch(() => {})

    return () => {
      cancelled = true
      setReady(false)
      const c = cardRef.current
      cardRef.current = null
      // Chain the destroy so the NEXT mount's attach waits for it to finish.
      if (c) cardOpQueue = cardOpQueue.then(() => c.destroy().catch(() => {}))
    }
  }, [containerId])

  async function tokenize(): Promise<SquareTokenResult> {
    if (!cardRef.current) return { ok: false, error: 'Card form is not ready yet.' }
    try {
      const result = await cardRef.current.tokenize()
      if (result.status === 'OK') return { ok: true, token: result.token }
      return { ok: false, error: result.errors?.[0]?.message || 'Card was declined or the fields are incomplete.' }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not process the card.' }
    }
  }

  return { ready, error, tokenize }
}

// Component: renders the card container with a UNIQUE per-instance id (via useId, so
// two fields on one page can't collide) and exposes tokenize()/ready to the parent
// via ref. Usage:
//   const cardRef = useRef<SquareCardHandle>(null)
//   {mode === 'manual' && <SquareCardField ref={cardRef} onReady={setCardReady} />}
//   const r = await cardRef.current?.tokenize()  // then charge r.token yourself
export type SquareCardHandle = { tokenize: () => Promise<SquareTokenResult>; ready: boolean }

const SquareCardField = forwardRef<SquareCardHandle, { className?: string; onReady?: (ready: boolean) => void }>(
  function SquareCardField({ className, onReady }, ref) {
    const containerId = 'sq-card-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
    const { ready, error, tokenize } = useSquareCard(containerId)
    useImperativeHandle(ref, () => ({ tokenize, ready }), [ready])
    useEffect(() => { onReady?.(ready) }, [ready, onReady]) // let the parent gate its charge button
    return (
      <div className={className}>
        <div id={containerId} style={{ minHeight: 89, border: '1px solid #d1d5db', borderRadius: 8, padding: 4 }} />
        {!ready && !error && <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Loading card form…</p>}
        {error && <p style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{error}</p>}
      </div>
    )
  },
)

export default SquareCardField
