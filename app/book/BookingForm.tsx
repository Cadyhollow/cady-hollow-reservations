'use client'

// The booking page's interactive half. Split out of app/book/page.tsx, which is now a server
// component that reads the settings, fees, add-ons and turnover facts and hands them in below.
//
// Security PR 4b. What is NOT here any more is the Supabase client: this file used to open one
// with the anon key and query four tables from the browser, plus the whole `discounts` table.
// The reads moved to lib/book-server.ts; the discount check became a one-code question to
// /api/discount. Everything else — the steps, the arithmetic, the markup — is untouched.

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { checkSeasonSpan, resolveMaxAdvanceDays, horizonLastArrival } from '@/lib/bookability'
import Image from 'next/image'
import { cardSurchargeFor } from '@/lib/pricing'
import SquareCardField, { type SquareCardHandle } from '@/components/SquareCardField'
import PaymentTrustRow from '../components/PaymentTrustRow'
import { computeBookingQuote } from '@/lib/booking-quote'
import type { BookAddon, BookFee } from '@/lib/book-server'

type Addon = BookAddon
type Fee = BookFee

const CAMPER_TYPES = [
  {
    value: 'travel_trailer',
    label: 'Travel Trailer',
    svg: (
      <svg viewBox="0 0 80 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="8" y="8" width="58" height="22" rx="3" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2"/>
        <rect x="12" y="12" width="10" height="8" rx="1" fill="currentColor" opacity="0.4"/>
        <rect x="26" y="12" width="10" height="8" rx="1" fill="currentColor" opacity="0.4"/>
        <rect x="40" y="12" width="10" height="8" rx="1" fill="currentColor" opacity="0.4"/>
        <line x1="8" y1="30" x2="4" y2="30" stroke="currentColor" strokeWidth="2"/>
        <circle cx="22" cy="33" r="4" fill="currentColor" opacity="0.6"/>
        <circle cx="52" cy="33" r="4" fill="currentColor" opacity="0.6"/>
        <line x1="66" y1="19" x2="74" y2="19" stroke="currentColor" strokeWidth="2"/>
      </svg>
    ),
  },
  {
    value: 'fifth_wheel',
    label: 'Fifth Wheel',
    svg: (
      <svg viewBox="0 0 80 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="8" y="10" width="56" height="20" rx="3" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2"/>
        <rect x="48" y="4" width="16" height="10" rx="2" fill="currentColor" opacity="0.25" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="12" y="14" width="9" height="7" rx="1" fill="currentColor" opacity="0.4"/>
        <rect x="25" y="14" width="9" height="7" rx="1" fill="currentColor" opacity="0.4"/>
        <circle cx="20" cy="33" r="4" fill="currentColor" opacity="0.6"/>
        <circle cx="50" cy="33" r="4" fill="currentColor" opacity="0.6"/>
        <line x1="64" y1="9" x2="72" y2="9" stroke="currentColor" strokeWidth="2"/>
      </svg>
    ),
  },
  {
    value: 'class_a',
    label: 'Class A',
    svg: (
      <svg viewBox="0 0 80 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="6" y="8" width="62" height="22" rx="2" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2"/>
        <rect x="6" y="8" width="12" height="22" rx="2" fill="currentColor" opacity="0.1"/>
        <rect x="8" y="11" width="8" height="10" rx="1" fill="currentColor" opacity="0.5"/>
        <rect x="22" y="13" width="8" height="7" rx="1" fill="currentColor" opacity="0.35"/>
        <rect x="34" y="13" width="8" height="7" rx="1" fill="currentColor" opacity="0.35"/>
        <rect x="46" y="13" width="8" height="7" rx="1" fill="currentColor" opacity="0.35"/>
        <circle cx="18" cy="33" r="4" fill="currentColor" opacity="0.6"/>
        <circle cx="56" cy="33" r="4" fill="currentColor" opacity="0.6"/>
      </svg>
    ),
  },
  {
    value: 'class_c',
    label: 'Class C',
    svg: (
      <svg viewBox="0 0 80 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="14" y="10" width="54" height="20" rx="2" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2"/>
        <rect x="6" y="16" width="14" height="14" rx="2" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="8" y="18" width="8" height="7" rx="1" fill="currentColor" opacity="0.45"/>
        <rect x="30" y="13" width="8" height="7" rx="1" fill="currentColor" opacity="0.35"/>
        <rect x="42" y="13" width="8" height="7" rx="1" fill="currentColor" opacity="0.35"/>
        <circle cx="22" cy="33" r="4" fill="currentColor" opacity="0.6"/>
        <circle cx="56" cy="33" r="4" fill="currentColor" opacity="0.6"/>
      </svg>
    ),
  },
  {
    value: 'van',
    label: 'Van',
    svg: (
      <svg viewBox="0 0 80 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="10" y="12" width="52" height="18" rx="3" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2"/>
        <path d="M10 20 Q10 12 18 12" stroke="currentColor" strokeWidth="2" fill="none"/>
        <rect x="13" y="14" width="9" height="8" rx="1" fill="currentColor" opacity="0.5"/>
        <rect x="26" y="15" width="8" height="6" rx="1" fill="currentColor" opacity="0.35"/>
        <rect x="38" y="15" width="8" height="6" rx="1" fill="currentColor" opacity="0.35"/>
        <circle cx="22" cy="33" r="4" fill="currentColor" opacity="0.6"/>
        <circle cx="52" cy="33" r="4" fill="currentColor" opacity="0.6"/>
      </svg>
    ),
  },
  {
    value: 'other',
    label: 'Other',
    svg: (
      <svg viewBox="0 0 80 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="10" y="10" width="52" height="20" rx="4" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2"/>
        <text x="36" y="24" textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="bold" opacity="0.5">?</text>
        <circle cx="22" cy="33" r="4" fill="currentColor" opacity="0.4"/>
        <circle cx="52" cy="33" r="4" fill="currentColor" opacity="0.4"/>
      </svg>
    ),
  },
]

function parseTime(timeStr: string): { hours: number; minutes: number } | null {
  if (!timeStr) return null
  const clean = timeStr.trim().toUpperCase()
  const match12 = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (match12) {
    let hours = parseInt(match12[1])
    const minutes = parseInt(match12[2])
    const period = match12[3]
    if (period === 'PM' && hours !== 12) hours += 12
    if (period === 'AM' && hours === 12) hours = 0
    return { hours, minutes }
  }
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    return { hours: parseInt(match24[1]), minutes: parseInt(match24[2]) }
  }
  return null
}

export type BookingFormProps = {
  settings: any
  fees: Fee[]
  addons: Addon[]
  earlyBlocked: boolean
  lateBlocked: boolean
}

export default function BookingForm({ settings, fees, addons, earlyBlocked, lateBlocked }: BookingFormProps) {
  const searchParams = useSearchParams()
  const cardRef = useRef<SquareCardHandle>(null)
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)

  const [selectedAddons, setSelectedAddons] = useState<{ [id: string]: number }>({})
  const [discountCode, setDiscountCode] = useState('')
  const [discountResult, setDiscountResult] = useState<any>(null)
  const [discountError, setDiscountError] = useState('')
  const [checkingDiscount, setCheckingDiscount] = useState(false)
  const [form, setForm] = useState({
    guest_name: '',
    guest_email: '',
    guest_phone: '',
    camper_type: '',
    camper_length: '',
    camper_amperage: '',
  })
  const [step, setStep] = useState(1)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [cardReady, setCardReady] = useState(false)
  const [selectedPaymentType, setSelectedPaymentType] = useState<'deposit' | 'full' | null>(null)
  const [cancellationPolicy, setCancellationPolicy] = useState<any>(null)
  const [waiverSigned, setWaiverSigned] = useState(false)
  const [waiverChecked, setWaiverChecked] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [sameDayBlocked, setSameDayBlocked] = useState(false)
  const [seasonMessage, setSeasonMessage] = useState('')
  const [horizonMessage, setHorizonMessage] = useState('')
  const [sameDayMessage, setSameDayMessage] = useState('')

  const site = {
    id: searchParams.get('siteId') || '',
    site_number: searchParams.get('siteNumber') || '',
    site_type: searchParams.get('siteType') || '',
    amp_service: searchParams.get('ampService') || '',
    hookups: searchParams.get('hookups') || '',
    max_rv_length: searchParams.get('maxLength') ? parseInt(searchParams.get('maxLength')!) : null,
    nightly_rate: parseInt(searchParams.get('nightlyRate') || '0'),
    total_price: parseInt(searchParams.get('totalPrice') || '0'),
    nights: parseInt(searchParams.get('nights') || '0'),
  }

  const arrival = searchParams.get('arrival') || ''
  const departure = searchParams.get('departure') || ''
  const adults = parseInt(searchParams.get('adults') || '2')
  const children = parseInt(searchParams.get('children') || '0')

  // The settings, fees, add-ons and turnover flags all arrive as props now — the three
  // fetches that used to run here are gone. What stays client-side is the same-day cutoff,
  // which is a comparison against the CAMPER'S clock: the server's timezone is not theirs, so
  // deciding it here keeps the answer the one the page has always given.
  useEffect(() => { checkSameDayCutoff(settings, arrival) }, [settings, arrival])
  // The season, whole-stay. This page had NO season check at all, so a crafted or stale link to a
  // closed week rendered the full booking page and the guest only found out at the charge. Not the
  // enforcement — /api/payment refuses it regardless — but the guest should be told before they
  // enter a card.
  useEffect(() => {
    if (!arrival || !departure) return
    const verdict = checkSeasonSpan(arrival, departure, settings)
    if (!verdict.bookable) setSeasonMessage(verdict.message)
  }, [settings, arrival, departure])
  // The booking horizon, re-checked here because this page's dates come from URL parameters and
  // the search that would have caught them is skippable. NOT the enforcement — /api/payment is,
  // and a guest who gets past this is refused there with no charge attempted. This exists so that
  // someone who arrives on a crafted or stale link is told why up front, instead of filling in
  // their card details and being rejected at the end.
  //
  // No slack, matching the date picker on the landing page: the browser holds to the park's true
  // window and the server allows one day past it, so anything this page accepts, create accepts.
  useEffect(() => {
    if (!arrival) return
    const maxDays = resolveMaxAdvanceDays(settings?.max_advance_days)
    if (maxDays === null) return
    const today = new Date().toISOString().split('T')[0]
    const last = horizonLastArrival(maxDays, today)
    if (arrival > last) {
      setHorizonMessage(
        `We accept reservations up to ${maxDays} day${maxDays === 1 ? '' : 's'} in advance. Please choose an arrival date on or before ${last}.`
      )
    }
  }, [settings, arrival])
  useEffect(() => { if (arrival) fetchCancellationPolicy() }, [arrival])

  const [earlyChecked, setEarlyChecked] = useState(false)
  const [lateChecked, setLateChecked] = useState(false)

  function fmtTime(t: string) {
    if (!t) return ''
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hr = h % 12 === 0 ? 12 : h % 12
    return `${hr}:${String(m).padStart(2, '0')} ${ampm}`
  }

  function checkSameDayCutoff(settingsData: any, arrivalDate: string) {
    if (!arrivalDate || !settingsData?.same_day_cutoff_time) return
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    if (arrivalDate !== todayStr) return
    const cutoff = parseTime(settingsData.same_day_cutoff_time)
    if (!cutoff) return
    const currentTotalMinutes = today.getHours() * 60 + today.getMinutes()
    const cutoffTotalMinutes = cutoff.hours * 60 + cutoff.minutes
    if (currentTotalMinutes >= cutoffTotalMinutes) {
      setSameDayBlocked(true)
      setSameDayMessage(settingsData.same_day_cutoff_message || 'Same-day reservations are not available online. Please call us.')
    }
  }

  async function fetchCancellationPolicy() {
    const res = await fetch(`/api/cancellation-policy?arrival=${arrival}`)
    const data = await res.json()
    setCancellationPolicy(data.policy)
  }


  const waiverText = (settings?.waiver_text || '').replace(/\[CAMPGROUND NAME\]/g, settings?.park_name || 'the campground')
  const waiverEnabled = settings?.waiver_enabled !== false

  function startDrawing(e: any) {
    isDrawing.current = true
    const canvas = signatureCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const ctx = canvas.getContext('2d')!
    ctx.beginPath()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
    ctx.moveTo(x, y)
  }

  function draw(e: any) {
    if (!isDrawing.current) return
    e.preventDefault()
    const canvas = signatureCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const ctx = canvas.getContext('2d')!
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1F2620'
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasSignature(true)
  }

  function stopDrawing() { isDrawing.current = false }

  function clearSignature() {
    const canvas = signatureCanvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    setWaiverSigned(false)
  }

  function acceptWaiver() {
    if (!hasSignature) { alert('Please sign the waiver before accepting.'); return }
    if (!waiverChecked) { alert('Please check the box to confirm you have read and agree to the waiver.'); return }
    setWaiverSigned(true)
    setStep(3)
  }

  function proceedFromAddons() {
    // Advance whenever the waiver UI isn't being shown (waiver off, or no waiver
    // text configured). Mirrors the button's own render condition so it can't
    // render an inert button.
    if (!waiverEnabled || !waiverText) {
      setWaiverSigned(true)
      setStep(3)
    }
  }

  // One code in, one verdict out.
  //
  // This used to read the `discounts` table — select('*'), anon key — and then apply the four
  // validity rules to the row it got back. Two things were wrong with that. The rules were
  // advisory, since the browser was also the judge (PR 4a fixed the money half of it: the
  // server re-validates before charging). And the read itself handed anyone who opened the
  // page every code the park had ever issued. /api/discount answers about the ONE code typed
  // here and nothing else, so there is no table to enumerate. The four rules now live in
  // lib/booking-quote's checkDiscount(), which is the same function /api/payment calls — the
  // preview and the charge cannot disagree about whether a code counts.
  async function checkDiscount() {
    if (!discountCode) return
    setCheckingDiscount(true)
    setDiscountError('')
    setDiscountResult(null)
    try {
      const res = await fetch('/api/discount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: discountCode.toUpperCase() }),
      })
      const data = await res.json()
      // Same four messages the browser used to produce for itself — they are the endpoint's
      // now, so an unusable code reads exactly as it did before.
      if (!res.ok || !data?.valid) { setDiscountError(data?.error || 'Invalid or expired discount code.'); return }
      setDiscountResult(data.discount)
    } catch {
      setDiscountError('Could not check that code. Please try again.')
    } finally {
      setCheckingDiscount(false)
    }
  }

  // THE quote — the same function /api/payment recomputes with from the database before it
  // charges anything. This page's figures are now a PREVIEW of the server's answer rather
  // than the source of it: the server derives its own and rejects a booking whose totals
  // disagree, so anything shown here that the server would not stand behind fails loudly
  // instead of being charged. Sharing the function is what keeps the two in step — see
  // lib/booking-quote.ts, and lib/refundable.ts for the same lesson learned the hard way.
  const quote = computeBookingQuote({
    site: {
      site_type: site.site_type,
      nightly_rate: site.nightly_rate,
      total_price: site.total_price,
      nights: site.nights,
    },
    adults, children,
    settings,
    fees,
    addonSelections: Object.entries(selectedAddons)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => {
        const a = addons.find(x => x.id === id)
        return { id, quantity: qty, price: a?.price || 0, name: a?.name }
      }),
    discount: discountResult
      ? { code: discountResult.code, discount_type: discountResult.discount_type, discount_value: discountResult.discount_value }
      : null,
    earlyRequested: earlyChecked,
    lateRequested: lateChecked,
    earlyBlocked, lateBlocked,
  })

  const {
    extraGuestFee, addonTotal, feeBreakdown, feesTotal, cardOnlyFeesTotal,
    earlyFee, lateFee, discountAmount, total, emailLines,
  } = quote
  const realCashFees = feesTotal - cardOnlyFeesTotal

  // Cash-canonical: the stay price with the transaction fee removed. We STORE this, and every
  // deposit type is derived from it, so `deposit` is always a CASH value. The fee is added on
  // top per-payment at charge time (see handlePayment).
  const { cashTotal, deposit, depositLabel, depositSubtext, showDepositButton } = quote

  // Card surcharge — Model B (shared helper). Booking carries no tax, so nonTaxBase ===
  // cashTotal. Reads the unified rate setting; a lingering card_only fee is already out
  // of cashTotal and is no longer re-added here, so it simply vanishes (as intended).
  const surchargePct = Number(settings?.card_surcharge_percent) || 0
  // Surcharge on the deposit's cash amount, for a truthful button label.
  const depositSurcharge = cardSurchargeFor(deposit, cashTotal, cashTotal, surchargePct)
  const depositDisplay = deposit + depositSurcharge
  // Same treatment for Pay in Full, which had none: the button quoted `total` — the
  // pre-fee stay price — while handlePayment charges cashTotal PLUS this surcharge, so
  // the camper was billed more than the button said. Computed with the same helper and
  // the same arguments handlePayment passes for paymentType 'full', so the displayed
  // figure IS the charged figure. Display only — nothing about the charge changes.
  const fullSurcharge = cardSurchargeFor(cashTotal, cashTotal, cashTotal, surchargePct)
  const fullDisplay = cashTotal + fullSurcharge

  const siteTypeLabel = (type: string) => ({ rv_site: 'RV Site', cabin: 'Cabin', tent: 'Tent Site' }[type] || type)

  const isRvSite = site.site_type === 'rv_site'

  function validateAndContinue() {
    if (!form.guest_name.trim()) { alert('Please enter your name.'); return }
    if (!form.guest_email.trim() || !form.guest_email.includes('@')) { alert('Please enter a valid email.'); return }
    if (!form.guest_phone.trim()) { alert('Please enter your phone number.'); return }
    if (isRvSite) {
      if (!form.camper_type) { alert('Please select your camper type.'); return }
      if (!form.camper_length || parseInt(form.camper_length) < 1) { alert('Please enter your camper length.'); return }
      if (!form.camper_amperage) { alert('Please select your amperage.'); return }
    }
    setStep(2)
  }

  async function handlePayment(paymentType: 'deposit' | 'full') {
    if (!cardRef.current?.ready) { setPaymentError('Payment form not ready. Please wait a moment and try again.'); return }
    setPaymentLoading(true)
    setPaymentError('')
    setSelectedPaymentType(paymentType)

    try {
      const result = await cardRef.current.tokenize()
      if (!result.ok) { setPaymentError(result.error || 'Card details invalid. Please check and try again.'); setPaymentLoading(false); return }

      // Both deposit and full are already CASH values; surcharge is added below.
      const cashAmountToPay = paymentType === 'deposit' ? deposit : cashTotal
      // Surcharge actually charged on this payment (Model B shared helper).
      const surchargeAmount = cardSurchargeFor(cashAmountToPay, cashTotal, cashTotal, surchargePct)
      const addonItems = Object.entries(selectedAddons)
        .filter(([_, qty]) => qty > 0)
        .map(([id, quantity]) => {
          const addon = addons.find(a => a.id === id)
          return { id, quantity, price: addon?.price || 0 }
        })

      const signatureData = waiverEnabled ? (signatureCanvasRef.current?.toDataURL() || '') : ''

      const response = await fetch('/api/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: result.token,
          siteId: site.id,
          arrival, departure, adults, children,
          guestName: form.guest_name,
          guestEmail: form.guest_email,
          guestPhone: form.guest_phone,
          camperType: form.camper_type,
          camperLength: parseInt(form.camper_length) || 0,
          camperAmperage: form.camper_amperage,
          nightlyRate: site.nightly_rate,
          totalPrice: cashTotal,
          amountToPay: cashAmountToPay, paymentType, addonItems,
          discountCode: discountResult?.code || null,
          discountAmount, extraGuestFee, addonTotal,
          earlyCheckin: earlyFee > 0, earlyCheckinFee: earlyFee,
          lateCheckout: lateFee > 0, lateCheckoutFee: lateFee,
          feesTotal: realCashFees,
          lines: emailLines,
          surchargeAmount,
          nights: site.nights,
          waiverSigned: waiverSigned,
          signatureData,
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.success) { setPaymentError(data.error || 'Payment failed. Please try again.'); setPaymentLoading(false); return }
      window.location.href = `/confirmation?reservationId=${data.reservationId}`
    } catch (error: any) {
      setPaymentError(error.message || 'An unexpected error occurred.')
      setPaymentLoading(false)
    }
  }

  const logoShapeClass =
    settings?.logo_shape === 'circle' ? 'rounded-full' :
    settings?.logo_shape === 'rounded' ? 'rounded-xl' :
    settings?.logo_shape === 'square' ? 'rounded-none' : 'rounded-none'

  const camperTypeLabel = (val: string) =>
    CAMPER_TYPES.find(t => t.value === val)?.label || val

  if (seasonMessage) {
    return (
      <main className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--surface-bg)' }}>
        <div className="px-4 py-4 flex items-center gap-4" style={{ backgroundColor: 'var(--surface-card)' }}>
          {settings?.logo_url && (
            <div className={`w-12 h-12 overflow-hidden flex items-center justify-center shrink-0 ${logoShapeClass}`}>
              <Image src={settings.logo_url} alt={settings?.park_name || 'Campground'} width={48} height={48} className="object-contain w-full h-full" />
            </div>
          )}
          <div>
            <h1 className="text-[var(--text-primary)] font-bold">{settings?.park_name || 'Campground'}</h1>
            <p className="text-sm" style={{ color: 'var(--accent-color)' }}>Online Reservations</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--surface-card)' }}>
            <div className="text-5xl mb-4">❄️</div>
            <h2 className="text-[var(--text-primary)] text-2xl font-bold mb-3">We&apos;re Closed for These Dates</h2>
            <p className="text-[var(--text-muted)] text-base leading-relaxed">{seasonMessage}</p>
            {settings?.season_start && settings?.season_end && (
              <p className="text-sm mt-4" style={{ color: 'var(--accent-color)' }}>We are open from {settings.season_start} through {settings.season_end}</p>
            )}
            <button onClick={() => window.location.href = '/'} className="mt-8 px-6 py-3 rounded-xl text-white font-semibold transition-colors" style={{ backgroundColor: 'var(--accent-color)' }}>← Choose Different Dates</button>
          </div>
        </div>
      </main>
    )
  }

  if (horizonMessage) {
    return (
      <main className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--surface-bg)' }}>
        <div className="px-4 py-4 flex items-center gap-4" style={{ backgroundColor: 'var(--surface-card)' }}>
          {settings?.logo_url && (
            <div className={`w-12 h-12 overflow-hidden flex items-center justify-center shrink-0 ${logoShapeClass}`}>
              <Image src={settings.logo_url} alt={settings?.park_name || 'Campground'} width={48} height={48} className="object-contain w-full h-full" />
            </div>
          )}
          <div>
            <h1 className="text-[var(--text-primary)] font-bold">{settings?.park_name || 'Campground'}</h1>
            <p className="text-sm" style={{ color: 'var(--accent-color)' }}>Online Reservations</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--surface-card)' }}>
            <div className="text-5xl mb-4">🗓️</div>
            <h2 className="text-[var(--text-primary)] text-2xl font-bold mb-3">That&apos;s Further Out Than We Book</h2>
            <p className="text-[var(--text-muted)] text-base leading-relaxed">{horizonMessage}</p>
            <button onClick={() => window.location.href = '/'} className="mt-8 px-6 py-3 rounded-xl text-white font-semibold transition-colors" style={{ backgroundColor: 'var(--accent-color)' }}>← Choose Different Dates</button>
          </div>
        </div>
      </main>
    )
  }

  if (sameDayBlocked) {
    return (
      <main className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--surface-bg)' }}>
        <div className="px-4 py-4 flex items-center gap-4" style={{ backgroundColor: 'var(--surface-card)' }}>
          {settings?.logo_url && (
            <div className={`w-12 h-12 overflow-hidden flex items-center justify-center shrink-0 ${logoShapeClass}`}>
              <Image src={settings.logo_url} alt={settings?.park_name || 'Campground'} width={48} height={48} className="object-contain w-full h-full" priority />
            </div>
          )}
          <div>
            <h1 className="text-[var(--text-primary)] font-bold">{settings?.park_name || 'Campground'}</h1>
            <p className="text-sm" style={{ color: 'var(--accent-color)' }}>Online Reservations</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--surface-card)' }}>
            <div className="text-5xl mb-4">📞</div>
            <h2 className="text-[var(--text-primary)] text-2xl font-bold mb-3">Same-Day Reservations</h2>
            <p className="text-[var(--text-muted)] text-base leading-relaxed">{sameDayMessage}</p>
            <button onClick={() => window.history.back()} className="mt-8 px-6 py-3 rounded-xl text-white font-semibold transition-colors" style={{ backgroundColor: 'var(--accent-color)' }}>← Go Back</button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--surface-bg)' }}>
      {/* Header */}
      <div className="px-4 py-4 flex items-center gap-4" style={{ backgroundColor: 'var(--surface-card)' }}>
        {settings?.logo_url && (
          <div className={`w-12 h-12 overflow-hidden flex items-center justify-center shrink-0 ${logoShapeClass}`}>
            <Image src={settings.logo_url} alt={settings?.park_name || 'Campground'} width={48} height={48} className="object-contain w-full h-full" priority />
          </div>
        )}
        <div>
          <h1 className="text-[var(--text-primary)] font-bold">{settings?.park_name || 'Campground'}</h1>
          <p className="text-sm" style={{ color: 'var(--accent-color)' }}>Complete your reservation</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">

          {/* Step 1 - Guest Details */}
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--surface-card)' }}>
            <h2 className="text-[var(--text-primary)] font-bold text-lg mb-4">{step === 1 ? '1. Your Information' : '✓ Your Information'}</h2>
            {step === 1 ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Full Name *</label>
                  <input className="w-full themed-input border rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm" placeholder="Jane Smith" value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Email Address *</label>
                  <input className="w-full themed-input border rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm" placeholder="jane@email.com" type="email" value={form.guest_email} onChange={e => setForm({ ...form, guest_email: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Phone Number *</label>
                  <input className="w-full themed-input border rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm" placeholder="(555) 555-5555" type="tel" value={form.guest_phone} onChange={e => setForm({ ...form, guest_phone: e.target.value })} />
                </div>

                {/* Camper Type Visual Selector — RV sites only */}
                {isRvSite && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Camper Type *</label>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {CAMPER_TYPES.map(type => (
                          <button
                            key={type.value}
                            type="button"
                            onClick={() => setForm({ ...form, camper_type: type.value })}
                            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all"
                            style={{
                              borderColor: form.camper_type === type.value ? 'var(--accent-color)' : 'var(--border)',
                              backgroundColor: form.camper_type === type.value ? 'rgba(var(--accent-rgb, 45,106,79), 0.15)' : 'var(--surface-input)',
                              color: form.camper_type === type.value ? 'var(--accent-color)' : 'var(--text-muted)',
                            }}
                          >
                            <div className="w-14 h-8">{type.svg}</div>
                            <span className="text-xs font-medium text-center leading-tight">{type.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Camper Length + Amperage */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Camper Length (ft) *</label>
                        <input
                          className="w-full themed-input border rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm"
                          placeholder="e.g. 32"
                          type="number"
                          min="1"
                          max="100"
                          value={form.camper_length}
                          onChange={e => setForm({ ...form, camper_length: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Amperage *</label>
                        <select
                          className="w-full themed-input border rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm"
                          value={form.camper_amperage}
                          onChange={e => setForm({ ...form, camper_amperage: e.target.value })}
                        >
                          <option value="">Select...</option>
                          <option value="50amp">50 Amp</option>
                          <option value="30amp">30 Amp</option>
                          <option value="20amp">20 Amp</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                <button onClick={validateAndContinue} className="w-full py-3 rounded-xl text-white font-semibold transition-colors mt-2" style={{ backgroundColor: 'var(--accent-color)' }}>
                  Continue to Add-Ons →
                </button>
              </div>
            ) : (
              <div className="text-[var(--text-muted)] text-sm space-y-1">
                <p className="text-[var(--text-primary)] font-medium">{form.guest_name}</p>
                <p>{form.guest_email}</p>
                <p>{form.guest_phone}</p>
                {isRvSite && form.camper_type && <p className="text-[var(--text-muted)]">{camperTypeLabel(form.camper_type)} · {form.camper_length} ft · {form.camper_amperage.replace('amp', ' Amp')}</p>}
                <button onClick={() => { setStep(1); setWaiverSigned(false) }} className="text-xs mt-2" style={{ color: 'var(--accent-color)' }}>Edit</button>
              </div>
            )}
          </div>

          {/* Step 2 - Add-Ons, Discount & Waiver */}
          {step >= 2 && (
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--surface-card)' }}>
              <h2 className="text-[var(--text-primary)] font-bold text-lg mb-4">2. Add-Ons (Optional)</h2>
              {addons.length === 0 ? (
                <p className="text-[var(--text-muted)] text-sm mb-6">No add-ons available.</p>
              ) : (
                <div className="space-y-3 mb-6">
                  {addons.map(addon => (
                    <div key={addon.id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--surface-input)]">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium text-sm">{addon.name}</p>
                        {addon.description && <p className="text-[var(--text-muted)] text-xs">{addon.description}</p>}
                        <p className="text-sm mt-0.5" style={{ color: 'var(--accent-color)' }}>${(addon.price / 100).toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSelectedAddons(prev => ({ ...prev, [addon.id]: Math.max(0, (prev[addon.id] || 0) - 1) }))} className="w-8 h-8 rounded-full bg-[var(--surface-input)] text-[var(--text-primary)] font-bold hover:opacity-80">-</button>
                        <span className="text-[var(--text-primary)] w-6 text-center">{selectedAddons[addon.id] || 0}</span>
                        <button onClick={() => setSelectedAddons(prev => ({ ...prev, [addon.id]: (prev[addon.id] || 0) + 1 }))} className="w-8 h-8 rounded-full text-white font-bold" style={{ backgroundColor: 'var(--accent-color)' }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {settings?.early_checkin_enabled && settings?.early_checkin_show_customers && (
                <div className={`flex items-center justify-between p-3 rounded-lg mb-3 ${earlyBlocked ? 'bg-[var(--surface-input)] opacity-50' : 'bg-[var(--surface-input)]'}`}>
                  <div>
                    <p className="text-[var(--text-primary)] font-medium text-sm">Early Check-In</p>
                    <p className="text-[var(--text-muted)] text-xs">Arrive as early as {fmtTime(settings.early_checkin_time)}</p>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--accent-color)' }}>${(settings.early_checkin_price / 100).toFixed(2)}</p>
                    {earlyBlocked && <p className="text-amber-400 text-xs mt-1">Not available for these dates — another guest is using this site.</p>}
                  </div>
                  <button type="button" disabled={earlyBlocked} onClick={() => setEarlyChecked(!earlyChecked)} className="w-6 h-6 shrink-0 rounded border-2 flex items-center justify-center transition-colors disabled:cursor-not-allowed" style={{ borderColor: 'var(--accent-color)', backgroundColor: (earlyChecked && !earlyBlocked) ? 'var(--accent-color)' : 'transparent' }}>{(earlyChecked && !earlyBlocked) && <span className="text-white text-sm font-bold leading-none">✓</span>}</button>
                </div>
              )}

              {settings?.late_checkout_enabled && settings?.late_checkout_show_customers && (
                <div className={`flex items-center justify-between p-3 rounded-lg mb-3 ${lateBlocked ? 'bg-[var(--surface-input)] opacity-50' : 'bg-[var(--surface-input)]'}`}>
                  <div>
                    <p className="text-[var(--text-primary)] font-medium text-sm">Late Check-Out</p>
                    <p className="text-[var(--text-muted)] text-xs">Stay until {fmtTime(settings.late_checkout_time)}</p>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--accent-color)' }}>${(settings.late_checkout_price / 100).toFixed(2)}</p>
                    {lateBlocked && <p className="text-amber-400 text-xs mt-1">Not available for these dates — another guest is using this site.</p>}
                  </div>
                  <button type="button" disabled={lateBlocked} onClick={() => setLateChecked(!lateChecked)} className="w-6 h-6 shrink-0 rounded border-2 flex items-center justify-center transition-colors disabled:cursor-not-allowed" style={{ borderColor: 'var(--accent-color)', backgroundColor: (lateChecked && !lateBlocked) ? 'var(--accent-color)' : 'transparent' }}>{(lateChecked && !lateBlocked) && <span className="text-white text-sm font-bold leading-none">✓</span>}</button>
                </div>
              )}

              {/* Discount Code */}
              <div className="pt-4 border-t border-[var(--border)] mb-6">
                <h3 className="text-[var(--text-primary)] font-medium mb-3">Discount Code</h3>
                <div className="flex gap-2">
                  <input className="flex-1 themed-input border rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm uppercase" placeholder="Enter code..." value={discountCode} onChange={e => { setDiscountCode(e.target.value.toUpperCase()); setDiscountResult(null); setDiscountError('') }} />
                  <button onClick={checkDiscount} disabled={checkingDiscount} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: 'var(--accent-color)' }}>{checkingDiscount ? '...' : 'Apply'}</button>
                </div>
                {discountError && <p className="text-red-400 text-sm mt-2">{discountError}</p>}
                {discountResult && <p className="text-green-400 text-sm mt-2">✓ {discountResult.discount_type === 'percent' ? `${discountResult.discount_value}% discount applied!` : `$${(discountResult.discount_value / 100).toFixed(2)} discount applied!`}</p>}
              </div>

              {/* Waiver */}
              {waiverEnabled && !waiverSigned && waiverText && (
                <div className="pt-4 border-t border-[var(--border)]">
                  <h3 className="text-[var(--text-primary)] font-bold text-lg mb-3">3. Liability Waiver</h3>
                  <p className="text-[var(--text-muted)] text-sm mb-3">Please read and sign the following waiver before proceeding to payment.</p>
                  <div className="bg-[var(--surface-input)] rounded-lg p-4 mb-4 h-48 overflow-y-auto">
                    <p className="text-[var(--text-muted)] text-xs leading-relaxed whitespace-pre-line">{waiverText}</p>
                  </div>
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-[var(--text-muted)]">Sign below:</label>
                      <button onClick={clearSignature} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">Clear</button>
                    </div>
                    <canvas
                      ref={signatureCanvasRef}
                      width={600}
                      height={150}
                      className="w-full rounded-lg border border-[var(--border)] cursor-crosshair touch-none"
                      style={{ backgroundColor: '#FFFFFF' }}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />
                    {!hasSignature && <p className="text-[var(--text-muted)] text-xs mt-1">Draw your signature above using your mouse or finger</p>}
                  </div>
                  <div className="flex items-start gap-3 mb-4">
                    <button
                      type="button"
                      onClick={() => setWaiverChecked(!waiverChecked)}
                      className="w-5 h-5 mt-0.5 shrink-0 rounded border-2 flex items-center justify-center transition-colors"
                      style={{ borderColor: waiverChecked ? '#14b8a6' : '#6b7280', backgroundColor: waiverChecked ? '#14b8a6' : 'transparent' }}
                    >
                      {waiverChecked && <span className="text-[var(--text-primary)] text-xs font-bold">✓</span>}
                    </button>
                    <label className="text-[var(--text-muted)] text-sm">
                      I have read, understand, and agree to the {settings?.park_name || 'Campground'} Liability Waiver above. I acknowledge that my electronic signature is legally binding.
                    </label>
                  </div>
                  <button onClick={acceptWaiver} className="w-full py-3 rounded-xl text-white font-semibold transition-colors" style={{ backgroundColor: 'var(--accent-color)' }}>
                    Accept Waiver & Continue to Payment →
                  </button>
                </div>
              )}

              {(!waiverEnabled || !waiverText) && !waiverSigned && (
                <div className="pt-4 border-t border-[var(--border)]">
                  <button onClick={proceedFromAddons} className="w-full py-3 rounded-xl text-white font-semibold transition-colors" style={{ backgroundColor: 'var(--accent-color)' }}>
                    Continue to Payment →
                  </button>
                </div>
              )}

              {waiverEnabled && waiverSigned && (
                <div className="pt-4 border-t border-[var(--border)]">
                  <p className="text-green-400 font-medium">✓ Liability waiver signed</p>
                  <button onClick={() => { setWaiverSigned(false); setStep(2) }} className="text-xs mt-1" style={{ color: 'var(--accent-color)' }}>Re-sign</button>
                </div>
              )}
            </div>
          )}

          {/* Step 3 - Payment */}
          {step >= 3 && waiverSigned && (
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--surface-card)' }}>
              <h2 className="text-[var(--text-primary)] font-bold text-lg mb-4">{waiverEnabled ? '4. Payment' : '3. Payment'}</h2>
              <div className="mb-6 space-y-2 text-sm">
                <div className="flex justify-between text-[var(--text-muted)]">
                  <span>{siteTypeLabel(site.site_type)} {site.site_number} × {site.nights} nights</span>
                  <span>${(site.total_price / 100).toFixed(2)}</span>
                </div>
                {extraGuestFee > 0 && <div className="flex justify-between text-[var(--text-muted)]"><span>Extra guest fees</span><span>${(extraGuestFee / 100).toFixed(2)}</span></div>}
                {Object.entries(selectedAddons).filter(([_, qty]) => qty > 0).map(([id, qty]) => {
                  const addon = addons.find(a => a.id === id)
                  if (!addon) return null
                  return (
                    <div key={id} className="flex justify-between">
                      <p className="text-[var(--text-muted)]">{addon.name}{qty > 1 ? ` ×${qty}` : ''}</p>
                      <p className="text-[var(--text-primary)] font-medium">${((addon.price * qty) / 100).toFixed(2)}</p>
                    </div>
                  )
                })}
                {feeBreakdown.map(fee => (
                  <div key={fee.id} className="flex justify-between text-[var(--text-muted)]">
                    <span>{fee.name}</span>
                    <span>${(fee.calculatedAmount / 100).toFixed(2)}</span>
                  </div>
                ))}
                {discountAmount > 0 && <div className="flex justify-between text-green-400"><span>Discount ({discountResult.code})</span><span>-${(discountAmount / 100).toFixed(2)}</span></div>}
                <div className="border-t border-[var(--border)] pt-2 flex justify-between text-[var(--text-primary)] font-bold">
                  <span>Total</span><span>${(total / 100).toFixed(2)}</span>
                </div>
              </div>
              <div className="rounded-lg p-4 bg-[var(--surface-input)] mb-6">
                <p className="text-[var(--text-muted)] text-xs leading-relaxed">
                  <span className="text-[var(--text-primary)] font-medium">Cancellation Policy: </span>
                  {/* The fallback was Cady's policy spelled out — "at least 7 days… a 10%
                      booking fee is retained" — which in the template told every other park's
                      campers about a fee that park does not charge. It now says only that the
                      terms are the park's to state, so a park that has not written one yet
                      cannot accidentally publish someone else's. */}
                  {cancellationPolicy ? cancellationPolicy.policy_text : 'Please contact us for cancellation information.'}
                </p>
                {cancellationPolicy && !cancellationPolicy.deposit_refundable && (
                  <p className="text-yellow-400 text-xs mt-2 font-medium">⚠ Deposit is non-refundable for these dates.</p>
                )}
              </div>
              <div className="mb-6">
                <h3 className="text-[var(--text-primary)] font-medium mb-3">Card Details</h3>
                <SquareCardField ref={cardRef} onReady={setCardReady} />
                {/* Sits inside the Card Details block, so it appears with the card fields and
                    nowhere else — this page has no cash path to guard against. */}
                <PaymentTrustRow />
              </div>
              {paymentError && <div className="rounded-lg p-4 bg-red-900 mb-4"><p className="text-red-300 text-sm">{paymentError}</p></div>}
              <div className="space-y-3">
                <h3 className="text-[var(--text-primary)] font-medium">Choose Payment Option</h3>
                {showDepositButton && (
                  <button
                    disabled={paymentLoading || !cardReady}
                    className="w-full py-3 rounded-xl font-semibold border-2 transition-colors disabled:opacity-50"
                    style={{ borderColor: 'var(--accent-color)', color: 'var(--accent-color)', backgroundColor: 'transparent' }}
                    onClick={() => handlePayment('deposit')}
                  >
                    {paymentLoading && selectedPaymentType === 'deposit' ? 'Processing...' : `${depositLabel} — $${(depositDisplay / 100).toFixed(2)}`}
                    {depositSubtext && <span className="block text-xs font-normal mt-0.5 text-[var(--text-muted)]">{depositSubtext}</span>}
                    {depositSurcharge > 0 && <span className="block text-xs font-normal mt-0.5 text-[var(--text-muted)]">Includes ${(depositSurcharge / 100).toFixed(2)} transaction fee</span>}
                  </button>
                )}
                <button
                  disabled={paymentLoading || !cardReady}
                  className="w-full py-3 rounded-xl text-[var(--text-primary)] font-semibold transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent-color)' }}
                  onClick={() => handlePayment('full')}
                >
                  {paymentLoading && selectedPaymentType === 'full' ? 'Processing...' : (
                    <>
                      {`Pay in Full — $${(fullDisplay / 100).toFixed(2)}`}
                      {fullSurcharge > 0 && <span className="block text-xs font-normal mt-0.5 opacity-80">Includes ${(fullSurcharge / 100).toFixed(2)} transaction fee</span>}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl p-6 sticky top-6" style={{ backgroundColor: 'var(--surface-card)' }}>
            <h3 className="text-[var(--text-primary)] font-bold mb-4">Booking Summary</h3>
            <div className="space-y-3 text-sm">
              <div><p className="text-[var(--text-muted)]">Site</p><p className="text-[var(--text-primary)] font-medium">{siteTypeLabel(site.site_type)} {site.site_number}</p></div>
              <div><p className="text-[var(--text-muted)]">Arrival</p><p className="text-[var(--text-primary)] font-medium">{arrival}</p><p className="text-[var(--text-muted)] text-xs">Check-in: {settings?.check_in_time || '2:00 PM'}</p></div>
              <div><p className="text-[var(--text-muted)]">Departure</p><p className="text-[var(--text-primary)] font-medium">{departure}</p><p className="text-[var(--text-muted)] text-xs">Check-out: {settings?.check_out_time || '12:00 PM'}</p></div>
              <div><p className="text-[var(--text-muted)]">Guests</p><p className="text-[var(--text-primary)] font-medium">{adults} adult{adults !== 1 ? 's' : ''}{children > 0 ? `, ${children} child${children !== 1 ? 'ren' : ''}` : ''}</p></div>
              <div><p className="text-[var(--text-muted)]">Duration</p><p className="text-[var(--text-primary)] font-medium">{site.nights} night{site.nights !== 1 ? 's' : ''}</p></div>
              <div className="border-t border-[var(--border)] pt-3"><p className="text-[var(--text-muted)]">Rate</p><p className="text-[var(--text-primary)] font-medium">${(site.nightly_rate / 100).toFixed(2)}/night</p></div>
              {isRvSite && form.camper_type && (
                <div className="border-t border-[var(--border)] pt-3">
                  <p className="text-[var(--text-muted)]">Camper</p>
                  <p className="text-[var(--text-primary)] font-medium">{camperTypeLabel(form.camper_type)}</p>
                  {form.camper_length && <p className="text-[var(--text-muted)] text-xs">{form.camper_length} ft · {form.camper_amperage.replace('amp', ' Amp')}</p>}
                </div>
              )}
              {Object.entries(selectedAddons).filter(([_, qty]) => qty > 0).map(([id, qty]) => {
                const addon = addons.find(a => a.id === id)
                if (!addon) return null
                return (
                  <div key={id} className="flex justify-between">
                    <p className="text-[var(--text-muted)]">{addon.name}{qty > 1 ? ` ×${qty}` : ''}</p>
                    <p className="text-[var(--text-primary)] font-medium">${((addon.price * qty) / 100).toFixed(2)}</p>
                  </div>
                )
              })}
              {earlyFee > 0 && (
                <div className="flex justify-between">
                  <p className="text-[var(--text-muted)]">Early Check-In</p>
                  <p className="text-[var(--text-primary)] font-medium">${(earlyFee / 100).toFixed(2)}</p>
                </div>
              )}
              {lateFee > 0 && (
                <div className="flex justify-between">
                  <p className="text-[var(--text-muted)]">Late Check-Out</p>
                  <p className="text-[var(--text-primary)] font-medium">${(lateFee / 100).toFixed(2)}</p>
                </div>
              )}
              {feeBreakdown.map(fee => (
                <div key={fee.id} className="flex justify-between">
                  <p className="text-[var(--text-muted)]">{fee.name}</p>
                  <p className="text-[var(--text-primary)] font-medium">${(fee.calculatedAmount / 100).toFixed(2)}</p>
                </div>
              ))}
              {discountAmount > 0 && (
                <div className="flex justify-between">
                  <p className="text-green-400">Discount</p>
                  <p className="text-green-400 font-medium">-${(discountAmount / 100).toFixed(2)}</p>
                </div>
              )}
              <div className="border-t border-[var(--border)] pt-3">
                <div className="flex justify-between">
                  <p className="text-[var(--text-primary)] font-bold">Total</p>
                  <p className="font-bold text-lg" style={{ color: 'var(--accent-color)' }}>${(total / 100).toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
