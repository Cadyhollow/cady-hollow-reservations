'use client'
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'

// Shared Square Web Payments MANUAL card entry — the single implementation for every
// surface that captures a card in the browser (was hand-rolled 5×). The seam is the
// TOKEN: this loads the SDK, renders the card field, and exposes tokenize(). Each
// surface makes its OWN charge call afterward (admin → /api/admin-card-payment,
// public book → /api/payment) and its own post-charge flow. App ID + location ID come
// from env (NEXT_PUBLIC_SQUARE_APP_ID / NEXT_PUBLIC_SQUARE_LOCATION_ID) — no hardcode.

// Load the Web Payments SDK exactly once per page (idempotent across all fields).
let sdkPromise: Promise<void> | null = null
function loadSquareSdk(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).Square) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production'
      ? 'https://web.squarecdn.com/v1/square.js'
      : 'https://sandbox.web.squarecdn.com/v1/square.js'
    script.onload = () => resolve()
    script.onerror = () => { sdkPromise = null; reject(new Error('Square payment library failed to load.')) }
    document.head.appendChild(script)
  })
  return sdkPromise
}

export type SquareTokenResult = { ok: true; token: string } | { ok: false; error: string }

// Hook: owns the SDK load + card lifecycle for a container (by id). Returns ready
// state, any load error, and tokenize(). Destroys the card on unmount so the Square
// iframe never leaks (the source of the earlier folio→Back hang).
export function useSquareCard(containerId: string) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await loadSquareSdk()
        if (cancelled || !document.getElementById(containerId)) return
        const payments = (window as any).Square.payments(
          process.env.NEXT_PUBLIC_SQUARE_APP_ID!,
          process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID!,
        )
        const card = await payments.card()
        if (cancelled) { try { await card.destroy() } catch { /* noop */ } ; return }
        await card.attach('#' + containerId)
        cardRef.current = card
        setReady(true)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load the card form.')
      }
    })()
    return () => {
      cancelled = true
      const c = cardRef.current
      cardRef.current = null
      setReady(false)
      if (c) { try { c.destroy() } catch { /* noop */ } } // tear down the iframe on unmount
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
//   {mode === 'manual' && <SquareCardField ref={cardRef} />}
//   const r = await cardRef.current?.tokenize()  // then charge r.token yourself
export type SquareCardHandle = { tokenize: () => Promise<SquareTokenResult>; ready: boolean }

const SquareCardField = forwardRef<SquareCardHandle, { className?: string }>(
  function SquareCardField({ className }, ref) {
    const containerId = 'sq-card-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
    const { ready, error, tokenize } = useSquareCard(containerId)
    useImperativeHandle(ref, () => ({ tokenize, ready }), [ready])
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
