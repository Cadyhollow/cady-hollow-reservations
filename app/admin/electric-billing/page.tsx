'use client'
import { allPaymentMethods, methodLabel } from '@/lib/transactions'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { planAtLeast } from '@/lib/plan'
// ⚠ CADY-ONLY, AND IT MUST SURVIVE THE REDESIGN. The period guard warns when a billing month
// overlaps a stretch already billed; the void helpers back the Void button in the history panel.
// Neither exists in the template, so the template's version of this page knows nothing about them.
import { periodFromBillingMonth, classifyPeriod, fmtMDY, type GuardResult } from '@/lib/electric-periods'
import { notVoided, sumLineTotals } from '@/lib/ledger'
import { createBrowserSupabase } from '@/lib/supabase-browser'
// ⚠ ONE ELECTRIC CALCULATION, SHARED. This page, the meter walk and the draft staging all price a
// reading through lib/electric-billing.ts. The arithmetic is byte-identical to the expression that
// used to live inline in updateReading() below — Cady's four lines and the template's were already
// the same, and lib/electric-billing.test.ts pins the extraction against a literal copy of them.
import {
  computeElectricCharge, rateFromSettings, LEGACY_RATE_PER_KWH, LEGACY_MINIMUM_CHARGE_CENTS,
  type ElectricRate,
  planElectricPost, postSkipLabel,
} from '@/lib/electric-billing'
import { detectReadingAnomaly } from '@/lib/meters'
import {
  cardStatus, primaryLabel, menuFor, tallyCards, matchesFilter, owesBalance,
  type CardRow, type CardFilter, type MenuActionId,
} from '@/lib/electric-billing-cards'
import {
  ELECTRIC_TOKENS, tokenText, insertAtCursor, unknownTokensIn,
} from '@/lib/electric-bill-tokens'

// PR 5b-1: the admin browser now talks to Supabase as the LOGGED-IN USER rather than as
// `anon`. Same publishable key, but it travels with the session cookie, so PostgREST runs
// these queries as `authenticated` and the role policies in
// db/migrations/2026-08-11-pr5b1-authenticated-role-policies.sql apply. Safe at module
// scope: createBrowserClient returns a singleton in the browser and a no-op cookie store
// during prerender.
const supabase = createBrowserSupabase()

type Guest = {
  id: string
  name: string
  email: string
  phone: string
  site_number: string
  is_seasonal: boolean
}

type ElectricReading = {
  id: string
  billing_month: string
  previous_reading: number
  current_reading: number
  kwh_used: number
  rate_per_kwh: number
  final_amount: number
  created_at: string
  notes: string
  folio_line_item_id?: string | null
  voided?: boolean | null
  voided_at?: string | null
  voided_by?: string | null
  reason?: string | null
}

type FolioPayment = {
  id: string
  amount: number
  surcharge_amount: number
  method: string
  paid_at: string
  note: string
  receipt_sent_at: string | null
}

/**
 * One meter's contribution to a bill, as staged by a meter walk.
 *
 * ⚠ A SNAPSHOT OF WHAT WAS BILLED, not a live join to meter_readings. The reading is what the
 * meter SAID in the field; this is what the camper was CHARGED for. Correcting an amount here does
 * not rewrite the meter, and next month still carries forward from the meter.
 */
type MeterLine = {
  meter_id: string
  meter_number: string
  previous_reading: number
  current_reading: number
  kwh: number
  is_reset?: boolean
  replaced_meter_final?: number | null
}

type CamperRow = {
  guest: Guest
  folioId: string
  folioBalance: number
  recentCharges: { id: string; description: string; line_total: number; charged_at: string }[]
  folioPayments: FolioPayment[]
  previousReading: string
  currentReading: string
  kwhUsed: number
  calculatedAmount: number
  finalAmount: string
  skip: boolean
  sent: boolean
  sending: boolean
  error: string
  showHistory: boolean
  showPayment: boolean
  paymentAmount: string
  paymentMethod: string
  paymentNote: string
  savingPayment: boolean
  lastPaymentRecorded: FolioPayment | null
  showReceiptConfirm: boolean
  sendingReceipt: boolean
  receiptSent: boolean
  readings: ElectricReading[]
  historyLoaded: boolean
  // ── Filled in by a meter walk. All absent on a park that never walks the meters. ──
  /** The DRAFT electric_readings row these figures came from, if any. */
  draftId: string
  /** The owner has looked at a flagged reading and chosen to bill it anyway. */
  anomalyAcknowledged: boolean
  /** One line per meter the camper holds. Empty for a bill typed by hand — the pre-existing
   *  behaviour, still fully supported. */
  meterBreakdown: MeterLine[]
  editEmailMode: boolean
  editEmailValue: string
  showBillConfirm: boolean
  billGuard: GuardResult | null
}

// ── PRE-FILLING A MONTH: posted, draft, or carry-forward ─────────────────────────────────────
//
// This logic was copy-pasted between fetchCampers() and handleMonthChange(). The meter walk gives
// it a THIRD case, and two copies of a three-branch rule is how one of them silently keeps only
// two. One function now, three cases in order:
//
//   1. A POSTED bill for this month  -> show it, mark the row ✓ Billed. Unchanged behaviour.
//   2. A DRAFT for this month        -> pre-fill readings AND amount, leave the row BILLABLE.
//   3. Neither                       -> carry the last prior month's current reading forward.
//
// ⚠ CASE 2 MUST NOT SET `sent`. A draft that marked itself billed would disable its own Bill
// Electric button, and a whole month of walked meters would sit looking finished while nothing
// had been charged or sent.
//
// ⚠ VOID-AWARENESS IS CADY'S AND IS PRESERVED EXACTLY. Every branch still skips `voided` rows,
// including the carry-forward — a voided bill must not supply next month's "previous". That rule
// predates the meter walk and is not the template's; it is kept here deliberately.
async function applyMonthReadings(row: CamperRow, month: string, rate: ElectricRate): Promise<CamperRow> {
  const { data: readings } = await supabase
    .from('electric_readings')
    .select('id, billing_month, previous_reading, current_reading, kwh_used, calculated_amount, final_amount, status, meter_breakdown, created_at, voided')
    .eq('guest_id', row.guest.id)
    .order('created_at', { ascending: false })

  const cleared: CamperRow = {
    ...row, previousReading: '', currentReading: '', kwhUsed: 0, calculatedAmount: 0,
    finalAmount: '', sent: false, draftId: '', meterBreakdown: [],
  }
  if (!readings || readings.length === 0) return cleared

  const live = readings.filter(r => r.voided !== true)
  const thisMonth = live.filter(r => r.billing_month === month)

  const posted = thisMonth.find(r => r.status !== 'draft')
  if (posted) {
    return {
      ...cleared,
      previousReading: String(posted.previous_reading),
      currentReading: String(posted.current_reading),
      kwhUsed: Number(posted.kwh_used) || 0,
      calculatedAmount: Number(posted.calculated_amount) || 0,
      finalAmount: ((Number(posted.final_amount) || 0) / 100).toFixed(2),
      meterBreakdown: Array.isArray(posted.meter_breakdown) ? posted.meter_breakdown as MeterLine[] : [],
      sent: true,
    }
  }

  const draft = thisMonth.find(r => r.status === 'draft')
  if (draft) {
    const kwh = Number(draft.kwh_used) || 0
    // Recomputed from the CURRENT rate rather than trusted from the draft: the readings are the
    // fact, the price is a setting the owner may correct before reviewing.
    const recalculated = computeElectricCharge(kwh, rate).calculatedAmountCents
    const storedFinal = Number(draft.final_amount) || 0
    const edited = storedFinal !== (Number(draft.calculated_amount) || 0)
    return {
      ...cleared,
      previousReading: String(draft.previous_reading),
      currentReading: String(draft.current_reading),
      kwhUsed: kwh,
      calculatedAmount: recalculated,
      finalAmount: ((edited ? storedFinal : recalculated) / 100).toFixed(2),
      meterBreakdown: Array.isArray(draft.meter_breakdown) ? draft.meter_breakdown as MeterLine[] : [],
      draftId: String(draft.id),
      sent: false,
    }
  }

  // ⚠ CARRY-FORWARD TAKES NEITHER A DRAFT NOR A VOIDED BILL. A draft is a proposal nobody has
  // confirmed; a voided bill is one that was withdrawn. Neither may become next month's baseline.
  const selectedVal = parseMonthValue(month)
  const prior = live.filter(r => r.status !== 'draft' && parseMonthValue(r.billing_month) < selectedVal)
  if (prior.length === 0) return cleared
  return { ...cleared, previousReading: String(prior[0].current_reading) }
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

// The month the owner almost always means: the one that just ENDED. The park bills on the 1st
// for the period behind it, so seeding this box with the CURRENT month was permanently one
// month ahead of intent — and a whole batch can go out mislabelled before anyone notices.
// Rolls back across the year boundary (January -> December of the prior year). Any month can
// still be picked; this only decides where the box opens.
function getPreviousMonthOption(): string {
  const now = new Date()
  const monthIdx = now.getMonth() - 1
  const year = monthIdx < 0 ? now.getFullYear() - 1 : now.getFullYear()
  return `${MONTH_NAMES[(monthIdx + 12) % 12]} ${year}`
}

function generateMonthOptions(): string[] {
  const now = new Date()
  // Start at the DEFAULT's year, not today's: in January the default is last December, and a
  // <select> whose value is absent from its own options renders blank. Outside January this
  // is the same two-year list as before.
  const startYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const options: string[] = []
  for (let year = startYear; year <= now.getFullYear() + 1; year++) {
    for (const month of MONTH_NAMES) {
      options.push(`${month} ${year}`)
    }
  }
  return options
}

function parseMonthValue(s: string): number {
  const p = s.split(' ')
  return p.length === 2 ? parseInt(p[1]) * 12 + MONTH_NAMES.indexOf(p[0]) : 0
}

// The one fact a busy person must not be able to skate past: WHICH MONTH is being billed.
// Deliberately the largest thing in either confirmation, above the amount and the recipient.
// The period comes from lib/electric-periods — the same half-open [start, end) the guard and
// the stored period_start/period_end use, so the headline cannot disagree with the record.
function MonthHeadline({ lead, billingMonth }: { lead: string; billingMonth: string }) {
  const period = periodFromBillingMonth(billingMonth)
  return (
    <div style={{ background: '#fff', border: '2px solid #1e40af', borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280' }}>{lead}</div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '0.01em', color: '#1e3a8a', lineHeight: 1.2 }}>
        {billingMonth.toUpperCase()}
      </div>
      {period && (
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1e40af' }}>
          {'\u00b7'} {fmtMDY(period.start)}{'\u2013'}{fmtMDY(period.end)}
        </div>
      )}
    </div>
  )
}

export default function ElectricBillingPage() {
  const router = useRouter()

  useEffect(() => {
    supabase.from('settings').select('plan, pos_enabled, custom_payment_methods, max_credit_amount').single().then(({ data }) => {
      setCustomMethods((data as any)?.custom_payment_methods || [])
      setMaxCreditAmount((data as any)?.max_credit_amount || 0)
      if (!planAtLeast(data?.plan, 'summit')) router.replace('/admin')
    })
  }, [])

  const [campers, setCampers] = useState<CamperRow[]>([])
  const [customMethods, setCustomMethods] = useState<string[]>([])
  // Same credit cap the guest folio enforces, so an overpayment taken here is held to the
  // same limit rather than being the one door with no check on it.
  const [maxCreditAmount, setMaxCreditAmount] = useState(0)
  const [loading, setLoading] = useState(true)
  // ── THE PARK'S RATE ────────────────────────────────────────────────────────────────────────
  //
  // These two boxes were page-local state, seeded with '0.27' / '15.00' and never saved: the rate
  // was retyped on every visit. They now load from settings and save with the message, and the
  // meter walk reads the SAME stored values — which is what lets the live "≈ $" on the phone agree
  // with the bill on this screen.
  //
  // ⚠ THE BOXES STILL OPEN AT 0.27 / 15.00 UNTIL A RATE IS SAVED, so nothing about this screen
  // changes for a park that ignores the new setting. Cady's saved rate is set to its own measured
  // values ($0.27 / $15.00 — every one of its 153 bills to date) as part of the port, so the first
  // bill after it is identical to the last one before it.
  const [ratePerKwh, setRatePerKwh] = useState(String(LEGACY_RATE_PER_KWH))
  const [minimumCharge, setMinimumCharge] = useState((LEGACY_MINIMUM_CHARGE_CENTS / 100).toFixed(2))
  const [savingRate, setSavingRate] = useState(false)
  const [rateSaved, setRateSaved] = useState('')

  // The single source of truth for pricing on this page. Derived from the boxes so an unsaved edit
  // previews immediately, exactly as it did before.
  const rate: ElectricRate = {
    ratePerKwh: parseFloat(ratePerKwh) || LEGACY_RATE_PER_KWH,
    minimumChargeCents: Math.round((parseFloat(minimumCharge) || LEGACY_MINIMUM_CHARGE_CENTS / 100) * 100),
  }
  const [activeTab, setActiveTab] = useState<'billing' | 'history'>('billing')
  const [billingMonth, setBillingMonth] = useState(getPreviousMonthOption)
  const [emailMessage, setEmailMessage] = useState("Please find your monthly electric statement below. If you have any questions, please don't hesitate to reach out.")
  const [sendingAll, setSendingAll] = useState(false)
  // The bulk action now asks first, and the ask leads with the month (see MonthHeadline).
  const [showSendAllConfirm, setShowSendAllConfirm] = useState(false)
  // Phase C2 — void dialog state (electric History is the only void surface).
  // ⚠ CADY-ONLY. Kept exactly as it was; the redesign does not move the void flow.
  const [voidTarget, setVoidTarget] = useState<{ index: number; reading: ElectricReading } | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidBy, setVoidBy] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState('')

  // ── Redesign UI state. Presentation only: none of these change what is billed. ──
  /** Which card's "⋯" menu is open. One at a time, closed on outside click. */
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  /** Which card has its inline edit panel open. */
  const [editing, setEditing] = useState<number | null>(null)
  /** The gentle filter tabs. A VIEW filter — Send All still walks the whole list. */
  const [filter, setFilter] = useState<CardFilter>('ready')
  /** The billing settings (rate, minimum, email message) start folded away. */
  const [showSettings, setShowSettings] = useState(false)
  /** The bill-email box, so a clicked merge field lands at the cursor rather than at the end. */
  const emailBoxRef = useRef<HTMLTextAreaElement | null>(null)
  const [autoPopulating, setAutoPopulating] = useState(false)

  const monthOptions = generateMonthOptions()

  useEffect(() => { fetchCampers(); fetchMessage() }, [])

  async function fetchMessage() {
    const { data } = await supabase.from('settings')
      .select('electric_bill_message, electric_rate_per_kwh, electric_minimum_charge').single()
    if (data?.electric_bill_message) setEmailMessage(data.electric_bill_message)
    const stored = rateFromSettings(data)
    if (data?.electric_rate_per_kwh !== null && data?.electric_rate_per_kwh !== undefined) {
      setRatePerKwh(String(stored.ratePerKwh))
    }
    if (data?.electric_minimum_charge !== null && data?.electric_minimum_charge !== undefined) {
      setMinimumCharge((stored.minimumChargeCents / 100).toFixed(2))
    }
  }

  // Saving the rate is what carries it to the phone. Without it the walk's live usage preview
  // would price at the fallback while this screen priced at whatever was typed here.
  async function saveRate() {
    setSavingRate(true); setRateSaved('')
    const { data: row } = await supabase.from('settings').select('id').single()
    const { error } = await supabase.from('settings').update({
      electric_rate_per_kwh: rate.ratePerKwh,
      electric_minimum_charge: rate.minimumChargeCents,
    }).eq('id', row?.id)
    setSavingRate(false)
    setRateSaved(error ? 'Could not save the rate.' : 'Rate saved — the meter-reading screen will use it too.')
  }

  async function saveMessage() {
    await supabase.from('settings').update({ electric_bill_message: emailMessage }).eq('id', (await supabase.from('settings').select('id').single()).data?.id)
    alert('Message saved!')
  }

  async function fetchCampers() {
    setLoading(true)
    const { data: guests } = await supabase.from('guests').select('*').eq('electric_billing_enabled', true)
    const sortedGuests = (guests || []).sort((a, b) => parseInt(a.site_number) - parseInt(b.site_number))
    if (sortedGuests.length === 0) { setLoading(false); return }

    const rows: CamperRow[] = await Promise.all(sortedGuests.map(async (guest: Guest) => {
      const { data: folio } = await supabase
        .from('folios').select('id').eq('guest_id', guest.id)
        .eq('folio_type', 'guest_account').eq('status', 'open').single()

      let folioBalance = 0
      let recentCharges: any[] = []
      let folioPayments: FolioPayment[] = []

      if (folio) {
        const [{ data: items }, { data: pmts }] = await Promise.all([
          supabase.from('folio_line_items').select('*').eq('folio_id', folio.id).order('charged_at'),
          supabase.from('folio_payments').select('*').eq('folio_id', folio.id).eq('status', 'completed').order('paid_at', { ascending: false }),
        ])
        const itemsTotal = sumLineTotals(items)
        const paymentsTotal = (pmts || []).reduce((sum: number, p: any) => sum + p.amount - (p.surcharge_amount || 0), 0)
        folioBalance = itemsTotal - paymentsTotal
        recentCharges = items || []
        folioPayments = pmts || []
      }

      // Check if the most recent payment has a receipt sent
      const mostRecentPayment = folioPayments.length > 0 ? folioPayments[0] : null
      const receiptAlreadySent = mostRecentPayment?.receipt_sent_at ? true : false

      return {
        guest, folioId: folio?.id || '', folioBalance, recentCharges, folioPayments,
        previousReading: '', currentReading: '', kwhUsed: 0, calculatedAmount: 0, finalAmount: '',
        skip: false, sent: false, sending: false, error: '',
        showHistory: false, showPayment: false, paymentAmount: '', paymentMethod: 'cash', paymentNote: '', savingPayment: false, editEmailMode: false, editEmailValue: '', showBillConfirm: false, billGuard: null,
        lastPaymentRecorded: mostRecentPayment, showReceiptConfirm: false, sendingReceipt: false, receiptSent: receiptAlreadySent,
        readings: [], historyLoaded: false,
        draftId: '', meterBreakdown: [], anomalyAcknowledged: false,
      }
    }))

    const populatedRows = await Promise.all(rows.map(row => applyMonthReadings(row, billingMonth, rate)))
    setCampers(populatedRows)
    setLoading(false)
  }

 async function handleMonthChange(newMonth: string) {
    setBillingMonth(newMonth)
    setShowSendAllConfirm(false) // never leave a confirmation open across a month change
    if (campers.length === 0) return
    setAutoPopulating(true)

    const updatedCampers = await Promise.all(campers.map(row => applyMonthReadings(row, newMonth, rate)))
    setCampers(updatedCampers)
    setAutoPopulating(false)
  }

  async function loadHistory(index: number) {
    const row = campers[index]
    if (row.historyLoaded) {
      setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], showHistory: !u[index].showHistory }; return u })
      return
    }
    // Posted only: this is the record of what this camper has been BILLED. A draft is a proposal.
    const { data } = await supabase.from('electric_readings').select('*').eq('guest_id', row.guest.id).eq('status', 'posted').order('created_at', { ascending: false })
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], readings: data || [], historyLoaded: true, showHistory: true }; return u })
  }

  // Phase C2 — void a bill from the History table. Opens the dialog for reason + name.
  function openVoid(index: number, reading: ElectricReading) {
    setVoidTarget({ index, reading })
    setVoidReason('')
    setVoidBy('')
    setVoidError('')
  }

  async function performVoid() {
    if (!voidTarget) return
    if (!voidBy.trim()) { setVoidError('Enter your name or initials.'); return }
    if (!voidReason.trim()) { setVoidError('Enter a reason.'); return }
    setVoiding(true)
    setVoidError('')
    // Void both halves atomically (reading + its charge if it still exists).
    const { error } = await supabase.rpc('void_electric_bill', {
      p_reading_id: voidTarget.reading.id,
      p_voided_by: voidBy.trim(),
      p_reason: voidReason.trim(),
    })
    if (error) { setVoiding(false); setVoidError(error.message || 'Could not void the bill.'); return }
    const index = voidTarget.index
    await reloadRowAfterVoid(index)
    setVoiding(false)
    setVoidTarget(null)
  }

  // Refresh one camper's readings (history) + folio balance after a void.
  async function reloadRowAfterVoid(index: number) {
    const row = campers[index]
    // Posted only — the History table lists bills, and a draft has been charged to nothing.
    const { data: readings } = await supabase.from('electric_readings').select('*').eq('guest_id', row.guest.id).eq('status', 'posted').order('created_at', { ascending: false })
    let newBalance = row.folioBalance
    if (row.folioId) {
      const [{ data: items }, { data: pmts }] = await Promise.all([
        supabase.from('folio_line_items').select('*').eq('folio_id', row.folioId),
        supabase.from('folio_payments').select('*').eq('folio_id', row.folioId).eq('status', 'completed'),
      ])
      const itemsTotal = sumLineTotals(items)
      const paymentsTotal = (pmts || []).reduce((s: number, p: any) => s + p.amount - (p.surcharge_amount || 0), 0)
      newBalance = itemsTotal - paymentsTotal
    }
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], readings: readings || [], folioBalance: newBalance, historyLoaded: true, showHistory: true }; return u })
  }

  async function recordPayment(index: number) {
    const row = campers[index]
    if (!row.folioId || !row.paymentAmount) return
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], savingPayment: true }; return u })

    const amountCents = Math.round(parseFloat(row.paymentAmount) * 100)

    // Anything beyond the balance becomes an account credit. Warn rather than block: this
    // screen records money already received, so refusing would leave it recorded nowhere.
    const creditCents = Math.max(0, amountCents - Math.max(0, row.folioBalance))
    if (creditCents > 0 && maxCreditAmount > 0 && creditCents > maxCreditAmount) {
      if (!confirm('This will add a credit of $' + (creditCents / 100).toFixed(2) + ', which exceeds the $' + (maxCreditAmount / 100).toFixed(2) + ' credit limit for this account. Add it anyway?')) {
        setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], savingPayment: false }; return u })
        return
      }
    }

    const { data: newPayment } = await supabase.from('folio_payments').insert({
      folio_id: row.folioId, method: row.paymentMethod, amount: amountCents,
      surcharge_amount: 0, status: 'completed', note: row.paymentNote || null,
    }).select().single()

    const [{ data: items }, { data: pmts }] = await Promise.all([
      supabase.from('folio_line_items').select('*').eq('folio_id', row.folioId),
      supabase.from('folio_payments').select('*').eq('folio_id', row.folioId).eq('status', 'completed'),
    ])
    const itemsTotal = sumLineTotals(items)
    const paymentsTotal = (pmts || []).reduce((sum: number, p: any) => sum + p.amount - (p.surcharge_amount || 0), 0)
    // Not clamped at zero. An overpayment leaves the folio negative and that negative IS the
    // account credit — clamping it here recorded the credit but hid it, so the operator saw a
    // settled account and no sign of the money sitting on it.
    const newBalance = itemsTotal - paymentsTotal

    setCampers(prev => {
      const u = [...prev]
      u[index] = { ...u[index], folioBalance: newBalance, folioPayments: pmts || [], savingPayment: false, showPayment: false, paymentAmount: '', paymentNote: '', lastPaymentRecorded: newPayment || null, showReceiptConfirm: false, receiptSent: false }
      return u
    })
  }

  async function sendReceipt(index: number) {
    const row = campers[index]
    if (!row.lastPaymentRecorded || !row.guest.email) return
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], sendingReceipt: true }; return u })

    const res = await fetch('/api/electric-payment-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestName: row.guest.name, guestEmail: row.guest.email, siteNumber: row.guest.site_number,
        paymentAmount: row.lastPaymentRecorded.amount, paymentMethod: row.lastPaymentRecorded.method,
        paymentNote: row.lastPaymentRecorded.note, paidAt: row.lastPaymentRecorded.paid_at,
        remainingBalance: row.folioBalance, paymentId: row.lastPaymentRecorded.id,
      }),
    })
    const data = await res.json()
    if (data.success) {
      // Update the payment in local state with the receipt timestamp
      const now = new Date().toISOString()
      setCampers(prev => {
        const u = [...prev]
        u[index] = {
          ...u[index],
          sendingReceipt: false,
          receiptSent: true,
          showReceiptConfirm: false,
          lastPaymentRecorded: u[index].lastPaymentRecorded
            ? { ...u[index].lastPaymentRecorded, receipt_sent_at: now }
            : null,
          folioPayments: u[index].folioPayments.map(p =>
            p.id === u[index].lastPaymentRecorded?.id ? { ...p, receipt_sent_at: now } : p
          ),
        }
        return u
      })
    } else {
      setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], sendingReceipt: false, showReceiptConfirm: false }; return u })
    }
  }

  function updateReading(index: number, field: 'previousReading' | 'currentReading', value: string) {
    setCampers(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      const prev_r = parseFloat(field === 'previousReading' ? value : updated[index].previousReading) || 0
      const curr_r = parseFloat(field === 'currentReading' ? value : updated[index].currentReading) || 0
      // ⚠ EDITING A READING BY HAND DROPS THE PER-METER LINES. They describe a specific pair of
      // meter numbers; once the totals are typed over they no longer describe the bill, and stale
      // lines under a corrected total are worse than none. meter_readings is untouched.
      if (updated[index].meterBreakdown.length) updated[index].meterBreakdown = []
      // Same arithmetic, one implementation — see the import note at the top of this file.
      const { kwhUsed: kwh, calculatedAmountCents: calculated } =
        computeElectricCharge(Math.max(0, curr_r - prev_r), rate)
      updated[index].kwhUsed = kwh
      updated[index].calculatedAmount = calculated
      if (updated[index].finalAmount === '' || updated[index].finalAmount === (updated[index].calculatedAmount / 100).toFixed(2)) {
        updated[index].finalAmount = (calculated / 100).toFixed(2)
      }
      return updated
    })
  }

  function updateFinalAmount(index: number, value: string) {
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], finalAmount: value }; return u })
  }

  function toggleSkip(index: number) {
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], skip: !u[index].skip }; return u })
  }

  function updatePaymentField(index: number, field: string, value: string) {
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], [field]: value }; return u })
  }

  async function resendBill(index: number, overrideEmail?: string) {
    const row = campers[index]
    const emailToUse = overrideEmail || row.guest.email
    if (!emailToUse) return
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], sending: true, error: '', editEmailMode: false }; return u })

    // Just re-send the email — don't touch the database
    const { data: allItems } = await supabase.from('folio_line_items').select('*').eq('folio_id', row.folioId).order('charged_at')
    const { data: allPayments } = await supabase.from('folio_payments').select('*').eq('folio_id', row.folioId).eq('status', 'completed')
    const itemsTotal = sumLineTotals(allItems)
    const paymentsTotal = (allPayments || []).reduce((sum: number, p: any) => sum + p.amount - (p.surcharge_amount || 0), 0)
    const balance = Math.max(0, itemsTotal - paymentsTotal)

    const thisElectricDesc = billingMonth + ' Electric'
    const electricItem = (allItems || []).find((i: any) => i.description === thisElectricDesc)
    const electricAmount = electricItem?.line_total || row.calculatedAmount

    // Void-aware (Decision 2d): a voided prior bill must not date the statement's
    // "new charges since last bill" cutoff. Server-side filter — a limit(1) can't be
    // client-filtered (the newest could be voided → 0 rows).
    // ⚠ POSTED ONLY, as well as non-voided. A draft has never been sent to anybody, so letting one
    // answer "when was the last bill sent" would date the balance-forward split from a walk nobody
    // has reviewed and silently move charges between "brought forward" and "new this month".
    const { data: prevBills } = await supabase.from('electric_readings').select('created_at')
      .eq('guest_id', row.guest.id).neq('billing_month', billingMonth).eq('voided', false).eq('status', 'posted')
      .order('created_at', { ascending: false }).limit(1)
    const previousBillSentAt = prevBills && prevBills.length > 0 ? prevBills[0].created_at : null

    const newLineItems = (allItems || []).filter((item: any) => {
      if (!notVoided(item)) return false
      if (item.description === thisElectricDesc) return false
      if (!previousBillSentAt) return true
      return new Date(item.charged_at) > new Date(previousBillSentAt)
    })
    const newLineItemsTotal = newLineItems.reduce((s: number, i: any) => s + i.line_total, 0)
    const previousBalance = balance - electricAmount - newLineItemsTotal

    // Payments received since last bill
    const paymentsReceivedAmt = (allPayments || [])
      .filter((p: any) => !previousBillSentAt || new Date(p.paid_at) > new Date(previousBillSentAt))
      .reduce((s: number, p: any) => s + p.amount - (p.surcharge_amount || 0), 0)
    const chargesBeforeResend = (allItems || [])
      .filter((i: any) => notVoided(i) && i.description !== thisElectricDesc && (!previousBillSentAt || new Date(i.charged_at) <= new Date(previousBillSentAt)))
      .reduce((s: number, i: any) => s + i.line_total, 0)
    const paymentsBeforeResend = (allPayments || [])
      .filter((p: any) => !previousBillSentAt || new Date(p.paid_at) <= new Date(previousBillSentAt))
      .reduce((s: number, p: any) => s + p.amount - (p.surcharge_amount || 0), 0)
    const balanceForwardResend = chargesBeforeResend - paymentsBeforeResend
    const liveBalanceResend = itemsTotal - paymentsTotal

    const res = await fetch('/api/electric-bill-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestName: row.guest.name, guestEmail: emailToUse, siteNumber: row.guest.site_number,
        folioId: row.folioId,
        billingMonth, emailMessage, electricAmount,
        newCharges: newLineItems, paymentsReceived: paymentsReceivedAmt,
        totalBalance: liveBalanceResend, balanceForward: balanceForwardResend,
        kwhUsed: row.kwhUsed,
      }),
    })
    const data = await res.json()
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], sending: false, error: data.success ? '' : (data.error || 'Failed to send') }; return u })
  }

  // Warn-don't-block guard (Phase A). Runs BEFORE the bill confirm opens. Resolves
  // the proposed period against the guest's ACTIVE bills, where "a bill" is
  // authoritatively a NON-VOIDED CHARGE on the folio for that period — the reading is
  // supporting data, never the authority. So an orphan reading (its charge deleted)
  // is stale and must not fire the guard. Never blocks: on any error (e.g. the
  // period/voided columns not deployed yet) the guard goes inert and billing flows.
  async function prepareBill(index: number) {
    const row = campers[index]
    const proposed = periodFromBillingMonth(billingMonth)
    let guard: GuardResult = { level: 'none', span: null, conflict: null }
    if (proposed) {
      try {
        // Readings carry the period; keep only non-voided ones with a linked charge.
        const { data: reads, error: rErr } = await supabase
          .from('electric_readings')
          .select('period_start, period_end, folio_line_item_id, voided')
          .eq('guest_id', row.guest.id)
        if (rErr) throw rErr
        const candidates = (reads || []).filter((r: any) =>
          r.period_start && r.period_end && r.voided !== true && r.folio_line_item_id)
        // Authority check: the linked charge must still EXIST and be non-voided.
        const chargeIds = candidates.map((r: any) => r.folio_line_item_id)
        let activeChargeIds = new Set<string>()
        if (chargeIds.length > 0) {
          const { data: charges, error: cErr } = await supabase
            .from('folio_line_items')
            .select('id, voided')
            .in('id', chargeIds)
          if (cErr) throw cErr
          activeChargeIds = new Set((charges || []).filter((c: any) => c.voided !== true).map((c: any) => c.id))
        }
        const activePeriods = candidates
          .filter((r: any) => activeChargeIds.has(r.folio_line_item_id))
          .map((r: any) => ({ start: r.period_start as string, end: r.period_end as string }))
        guard = classifyPeriod(proposed, activePeriods)
      } catch (e) {
        // Columns not deployed yet, or read failure → guard inert. NEVER blocks.
        console.warn('Electric bill guard inactive (period/voided columns not ready?):', e)
        guard = { level: 'none', span: null, conflict: null }
      }
    }
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], billGuard: guard, showBillConfirm: true }; return u })
  }

  async function sendBill(index: number) {
    const row = campers[index]
    if (row.skip || row.sent) return
    if (!row.guest.email) { setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], error: 'No email on file' }; return u }); return }
    const finalAmountCents = Math.round(parseFloat(row.finalAmount) * 100) || row.calculatedAmount

    // ⚠ THE DOUBLE-BILL GUARD, ASKED OF THE DATABASE. `row.sent` is React state: false after a
    // reload, false on another machine, and false for a camper whose bill posted while an
    // orphaned draft was left behind. September 2026 left 47 such drafts on this park, every one
    // still postable. This asks the table instead of the screen.
    const { data: alreadyPosted } = await supabase.from('electric_readings')
      .select('id').eq('guest_id', row.guest.id).eq('billing_month', billingMonth)
      .eq('status', 'posted').eq('voided', false).limit(1)
    const plan = planElectricPost({
      alreadyPostedThisMonth: (alreadyPosted?.length || 0) > 0,
      skipped: row.skip,
      draftId: row.draftId,
      finalAmountCents,
    })
    if (plan.action === 'skip') {
      setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], sending: false, error: postSkipLabel(plan.reason) }; return u })
      return
    }
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], sending: true, error: '' }; return u })

    let folioId = row.folioId
    if (!folioId) {
      const { data: newFolio } = await supabase.from('folios').insert({
        guest_id: row.guest.id, guest_name: row.guest.name, guest_email: row.guest.email,
        folio_type: 'guest_account', status: 'open', label: 'Seasonal Account',
      }).select().single()
      if (newFolio) folioId = newFolio.id
    }

    // Phase B: write the charge + reading ATOMICALLY in one transaction (RPC), so a
    // mid-write failure can never leave an orphan charge or orphan reading. Also
    // populates the Phase A period columns on the reading (new bills are now
    // guard-visible); billing_month is still written in parallel.
    const period = periodFromBillingMonth(billingMonth)
    const readingFields = {
      previous_reading: parseFloat(row.previousReading) || 0,
      current_reading: parseFloat(row.currentReading) || 0,
      kwh_used: row.kwhUsed,
      rate_per_kwh: rate.ratePerKwh,
      minimum_charge: rate.minimumChargeCents,
      calculated_amount: row.calculatedAmount,
      final_amount: finalAmountCents,
    }
    const { error: rpcErr } = await supabase.rpc('create_electric_bill', {
      p_folio_id: folioId,
      p_guest_id: row.guest.id,
      p_billing_month: billingMonth,
      p_period_start: period?.start ?? null,
      p_period_end: period?.end ?? null,
      p_description: billingMonth + ' Electric',
      p_amount_cents: finalAmountCents,
      p_previous_reading: readingFields.previous_reading,
      p_current_reading: readingFields.current_reading,
      p_kwh_used: readingFields.kwh_used,
      p_rate_per_kwh: readingFields.rate_per_kwh,
      p_minimum_charge: readingFields.minimum_charge,
      p_calculated_amount: readingFields.calculated_amount,
      p_final_amount: readingFields.final_amount,
    })
    if (rpcErr) {
      // Option A scoped fallback: ONLY when the function isn't deployed yet (code
      // ships before schema). PostgREST reports a missing function as PGRST202,
      // Postgres as 42883. Any OTHER error is a real failure — surface it, never
      // silently fall back to the non-atomic path.
      const missingFn = rpcErr.code === 'PGRST202' || rpcErr.code === '42883' ||
        /could not find the function|does not exist/i.test(rpcErr.message || '')
      if (!missingFn) {
        setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], sending: false, error: rpcErr.message || 'Could not create the bill.' }; return u })
        return
      }
      console.warn('create_electric_bill RPC not deployed yet — falling back to non-atomic two-insert path.', rpcErr)
      const { data: lineItem } = await supabase.from('folio_line_items').insert({
        folio_id: folioId, product_id: null, description: billingMonth + ' Electric',
        quantity: 1, unit_price: finalAmountCents, tax_amount: 0, line_total: finalAmountCents, category: 'Fees',
      }).select().single()
      await supabase.from('electric_readings').insert({
        guest_id: row.guest.id, billing_month: billingMonth,
        period_start: period?.start ?? null, period_end: period?.end ?? null,
        ...readingFields,
        folio_line_item_id: lineItem?.id || null,
      })
    }

    // ⚠ THE DRAFT IS WITHDRAWN ONLY AFTER THE BILL EXISTS, AND THIS ORDER IS THE POINT.
    //
    // The template promotes its draft row in place, because its sendBill does two separate
    // inserts. Cady's does NOT: it posts through the atomic create_electric_bill() RPC, which
    // writes the line item and a fresh electric_readings row together. Reusing the draft row
    // would mean giving up that atomicity, which is the one thing standing between a park and a
    // charge with no reading attached to it.
    //
    // So the draft is deleted afterwards instead. Deleting it FIRST would lose the owner's staged
    // figures if the post then failed; deleting it after means the worst case is a draft that
    // briefly coexists with its posted bill — and applyMonthReadings() prefers the posted row, so
    // even that reads correctly. Scoped to this camper, this month, status 'draft': a posted bill
    // cannot be touched by this statement.
    // ⚠ THE DRAFT IS VOIDED, NOT DELETED — AND THE RESULT IS CHECKED. THIS LINE HAD BOTH BUGS.
    //
    // It used to be `.delete()`, with no check on what came back. `authenticated` holds no DELETE
    // privilege on electric_readings, so PostgREST returned success having deleted NOTHING — 46
    // times during one September run, leaving 46 postable duplicates behind. A write whose result
    // nobody reads is not a write.
    //
    // Voiding is the fix that fits this park: UPDATE is granted, voiding is already how Cady
    // retires an electric bill, and a voided row is filtered out everywhere the page reads
    // readings — so it can never be posted, pre-fill anything, or be counted. No new grant on a
    // money table, and no schema change.
    //
    // ⚠ Cady posts through the atomic create_electric_bill() RPC, which writes the line item and
    // the reading together. That atomicity is worth more than promoting the draft in place, so
    // the draft is retired AFTER the real bill exists rather than being converted into it.
    if (plan.consumesDraftId) {
      const { data: retired, error: voidErr } = await supabase.from('electric_readings')
        .update({ voided: true, notes: 'Superseded by the posted ' + billingMonth + ' bill. Retired automatically when that bill was created, so it can never be posted a second time.' })
        .eq('id', plan.consumesDraftId).eq('status', 'draft').select('id')
      if (voidErr || !retired || retired.length === 0) {
        // The bill IS posted at this point — the RPC already ran — so this cannot fail the whole
        // operation. It is surfaced instead, because a draft that outlived its bill is exactly
        // the thing that becomes a duplicate charge later.
        console.warn('Posted the bill but could not retire its draft', plan.consumesDraftId, voidErr)
        setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], error: 'Billed — but the leftover draft could not be cleared. Tell Charissa so it is not billed twice.' }; return u })
      }
    }

    const { data: allItems } = await supabase.from('folio_line_items').select('*').eq('folio_id', folioId).order('charged_at')
    const { data: allPayments } = await supabase.from('folio_payments').select('*').eq('folio_id', folioId).eq('status', 'completed').order('paid_at')
    const itemsTotal = sumLineTotals(allItems)
    const paymentsTotal = (allPayments || []).reduce((sum: number, p: any) => sum + p.amount - (p.surcharge_amount || 0), 0)
    // Live folio balance — matches what shows in their guest folio exactly
    const liveBalance = itemsTotal - paymentsTotal

    // Find the date the previous electric bill was sent for this camper
    // Void-aware (Decision 2d): exclude voided prior bills from the cutoff. Server-side
    // filter — a limit(1) can't be client-filtered (the newest could be voided).
    const { data: prevBills } = await supabase
      .from('electric_readings')
      .select('created_at')
      .eq('guest_id', row.guest.id)
      .neq('billing_month', billingMonth)
      .eq('voided', false)
      // ⚠ POSTED ONLY — same reason as in resendBill() above.
      .eq('status', 'posted')
      .order('created_at', { ascending: false })
      .limit(1)
    const previousBillSentAt = prevBills && prevBills.length > 0 ? prevBills[0].created_at : null

    const thisElectricDesc = billingMonth + ' Electric'

    // Balance Forward = everything owed BEFORE this billing month
    // = all charges before this electric bill minus all payments before this electric bill
    const chargesBefore = (allItems || [])
      .filter((i: any) => notVoided(i) && i.description !== thisElectricDesc && (!previousBillSentAt || new Date(i.charged_at) <= new Date(previousBillSentAt)))
      .reduce((s: number, i: any) => s + i.line_total, 0)
    const paymentsBefore = (allPayments || [])
      .filter((p: any) => !previousBillSentAt || new Date(p.paid_at) <= new Date(previousBillSentAt))
      .reduce((s: number, p: any) => s + p.amount - (p.surcharge_amount || 0), 0)
    const balanceForward = chargesBefore - paymentsBefore

    // New charges since last bill (excluding this month's electric — shown separately)
    const newCharges = (allItems || []).filter((item: any) => {
      if (!notVoided(item)) return false
      if (item.description === thisElectricDesc) return false
      if (!previousBillSentAt) return true
      return new Date(item.charged_at) > new Date(previousBillSentAt)
    })

    // Payments received since last bill
    const paymentsReceivedAmount = (allPayments || [])
      .filter((p: any) => !previousBillSentAt || new Date(p.paid_at) > new Date(previousBillSentAt))
      .reduce((s: number, p: any) => s + p.amount - (p.surcharge_amount || 0), 0)

    const res = await fetch('/api/electric-bill-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestName: row.guest.name, guestEmail: row.guest.email, siteNumber: row.guest.site_number,
        folioId,
        billingMonth, emailMessage, electricAmount: finalAmountCents,
        newCharges, paymentsReceived: paymentsReceivedAmount,
        totalBalance: liveBalance, balanceForward,
        kwhUsed: row.kwhUsed,
      }),
    })
    const data = await res.json()
    setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], sending: false, sent: data.success, folioId, folioBalance: liveBalance, historyLoaded: false, error: data.success ? '' : (data.error || 'Failed to send') }; return u })
  }

  async function sendAllBills() {
    setSendingAll(true)
    for (let i = 0; i < campers.length; i++) {
      if (!campers[i].skip && !campers[i].sent) await sendBill(i)
    }
    setSendingAll(false)
  }

  // ── ⚠ THE READING-LOOKS-OFF GUARD ─────────────────────────────────────────────────────────
  // Defence in depth for a bill that already happened here: a meter with no baseline was measured
  // from zero, so 43 kWh of usage staged as 5,803 kWh — $1,566.81 instead of $15.00. It was a
  // draft and draft-first caught it. This withholds the one-click post rather than only warning.
  function anomalyFor(row: CamperRow) {
    if (row.sent) return null
    const prev = parseFloat(row.previousReading)
    const curr = parseFloat(row.currentReading)
    if (!Number.isFinite(curr)) return null
    // "Has history" = this camper has been billed before, which is exactly when a zero baseline
    // means a missing carry-forward rather than a meter genuinely starting at zero. Cady's
    // loadHistory is posted-only, so row.readings is the right source.
    const hasPriorHistory = row.readings.length > 0
    const recentKwh = row.readings.slice(0, 4).map(r => Number(r.kwh_used)).filter(n => Number.isFinite(n))
    const line = row.meterBreakdown.length === 1 ? row.meterBreakdown[0] : null
    return detectReadingAnomaly(
      line
        ? { previousReading: Number(line.previous_reading), currentReading: Number(line.current_reading), kwh: Number(line.kwh), isReset: line.is_reset }
        : { previousReading: Number.isFinite(prev) ? prev : 0, currentReading: curr, kwh: row.kwhUsed },
      { hasPriorHistory, recentKwh },
    )
  }
  const blockedByAnomaly = (row: CamperRow) => !!anomalyFor(row) && !row.anomalyAcknowledged

  // ── CARD DERIVATIONS ───────────────────────────────────────────────────────────────────────
  // The card's status and menu come from lib/electric-billing-cards.ts, which is pure and tested.
  // This adapter is the only place the page's CamperRow meets that module's smaller CardRow.
  const asCardRow = (row: CamperRow): CardRow => ({
    sent: row.sent,
    skip: row.skip,
    hasEmail: !!row.guest.email,
    hasRecordedPayment: !!row.lastPaymentRecorded,
    anomaly: !!anomalyFor(row),
    anomalyAcknowledged: row.anomalyAcknowledged,
    meterLines: row.meterBreakdown.length,
    finalAmount: row.finalAmount,
    // ⚠ SURFACED, NOT RECOMPUTED. row.folioBalance is what fetchCampers() read off the folio.
    balanceCents: row.folioBalance,
  })

  /** Every menu item dispatches to a handler that already existed. Nothing is reimplemented. */
  function runMenuAction(id: MenuActionId, i: number) {
    const row = campers[i]
    setOpenMenu(null)
    switch (id) {
      case 'folio-receipt':      router.push(`/admin/folio/guest/${row.guest.id}`); break
      case 'resend':             resendBill(i); break
      case 'resend-other-email': setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], editEmailMode: true, editEmailValue: row.guest.email }; return u }); break
      case 'adjust':             setEditing(i); break
      case 'payment':
        updatePaymentField(i, 'showPayment', 'true')
        updatePaymentField(i, 'paymentAmount', (Math.max(0, row.folioBalance) / 100).toFixed(2))
        break
      case 'history':            loadHistory(i); break
      case 'dont-bill':
      case 'do-bill':            toggleSkip(i); break
    }
  }

  /**
   * Insert a merge field at the cursor. Same pure helper the packet-email editor uses, so both
   * boxes behave identically under the owner's hands.
   */
  function insertEmailToken(key: string) {
    const el = emailBoxRef.current
    const at = el ? el.selectionStart ?? emailMessage.length : emailMessage.length
    const to = el ? el.selectionEnd ?? at : at
    const { value, cursor } = insertAtCursor(emailMessage, at, to, tokenText(key))
    setEmailMessage(value)
    // Put the caret back after what was inserted, so typing continues where it left off.
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(cursor, cursor) } })
  }
  const unknownEmailTokens = unknownTokensIn(emailMessage)

  const counts = tallyCards(campers.map(asCardRow))
  const visible = campers
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => matchesFilter(asCardRow(row), filter))
  /** The money the ready pile would bill. Display only — Send All computes its own set. */
  const readyTotalCents = campers
    .filter(c => !c.skip && !c.sent && c.finalAmount)
    .reduce((sum, c) => sum + (Math.round(parseFloat(c.finalAmount) * 100) || 0), 0)
  const fmtUsd = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtNum = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })

  const readyToSend = campers.filter(c => !c.skip && !c.sent && c.finalAmount).length
  const draftCount = campers.filter(c => c.draftId && !c.sent).length
  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>Loading seasonal campers…</div>

  return (
    <div className="eb-wrap" onClick={() => setOpenMenu(null)}>
      <style>{EB_CSS}</style>

      {/* ── Page head: title + the month this screen is about ─────────────────────────────── */}
      <div className="eb-pagehead">
        <h1 className="eb-title">Electric Billing</h1>
        <div className="eb-monthwrap">
          <button className="eb-gear" onClick={e => { e.stopPropagation(); setShowSettings(v => !v) }}
            aria-expanded={showSettings}>⚙ Settings</button>
          <select className="eb-month" value={billingMonth} onChange={e => handleMonthChange(e.target.value)} disabled={autoPopulating} aria-label="Billing month">
            {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {autoPopulating && <span className="eb-loadingnote">⟳ loading readings…</span>}
        </div>
      </div>

      {/* Top-level view switch — the Account History tab the old page had, kept. */}
      <div className="eb-viewtabs">
        {(['billing', 'history'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`eb-viewtab${activeTab === tab ? ' on' : ''}`}>
            {tab === 'billing' ? 'Monthly billing' : 'Account history'}
          </button>
        ))}
      </div>

      {activeTab === 'billing' && (
        <>
          {/* The walk's own reassurance, kept from the old page: a month that LOOKS billed when
              nothing has been charged is the failure the draft state exists to prevent. */}
          {draftCount > 0 && (
            <div className="eb-draftnote">
              <strong>{draftCount} reading{draftCount === 1 ? '' : 's'} from a meter walk {draftCount === 1 ? 'is' : 'are'} filled in for {billingMonth}.</strong>{' '}
              Nothing has been charged or sent yet.
            </div>
          )}

          {/* ── Summary: reassurance first, then the one bulk action ─────────────────────── */}
          <div className="eb-summary">
            <div>
              <p className="eb-headline">
                {counts.ready === 0
                  ? 'Nothing is waiting to be sent.'
                  : `${counts.ready} reading${counts.ready === 1 ? ' is' : 's are'} ready to send.`}
              </p>
              <div className="eb-sub">
                {counts.billed} already billed this month
                {counts.attention > 0 && <> · {counts.attention} worth a look before you send</>}
              </div>
            </div>
            <div className="eb-total">
              <div className="eb-amt tnum">{fmtUsd(readyTotalCents)}</div>
              <div className="eb-lbl">ready to bill</div>
            </div>
          </div>

          <div className="eb-sendall">
            <button className="eb-primary" onClick={e => { e.stopPropagation(); setShowSendAllConfirm(true) }}
              disabled={sendingAll || readyToSend === 0}>
              {sendingAll ? 'Sending…' : 'Review & send all ready'}
            </button>
            <Link className="eb-ghost" href="/admin/seasonals/meters">Read meters</Link>
          </div>

          {/* The batch confirm, unchanged in behaviour — it still leads with the month. */}
          {showSendAllConfirm && (
            <div className="eb-panel" onClick={e => e.stopPropagation()}>
              <MonthHeadline lead="Billing everyone for" billingMonth={billingMonth} />
              <div className="eb-paneltext">
                This creates a <strong>{billingMonth} electric charge</strong> on <strong>{readyToSend} camper account{readyToSend !== 1 ? 's' : ''}</strong> and emails each of them a statement. Campers already billed for this month, and any set to not bill, are left alone.
              </div>
              <div className="eb-panelactions">
                <button className="eb-primary sm" onClick={() => { setShowSendAllConfirm(false); sendAllBills() }}>Yes, bill {billingMonth}</button>
                <button className="eb-ghost sm" onClick={() => setShowSendAllConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* ── ⚙ SETTINGS DRAWER ─────────────────────────────────────────────────────────
              The same rate, minimum and bill-email settings the old page carried, and the same
              save paths — restyled and tucked behind the gear so they stop competing with the
              month's work. Nothing new is stored. */}
          {showSettings && (
            <div className="eb-drawer" onClick={e => e.stopPropagation()}>
              <div className="eb-dh">
                <span className="t">Electric settings</span>
                <button className="x" aria-label="Close settings" onClick={() => setShowSettings(false)}>✕</button>
              </div>
              <div className="eb-dnote">Sets how every electric bill is calculated and worded.</div>

              <div className="eb-srow">
                <div className="eb-field">
                  <label>Rate per kWh ($)</label>
                  <input type="number" step="0.01" value={ratePerKwh}
                    onChange={e => { setRatePerKwh(e.target.value); setRateSaved('') }} />
                </div>
                <div className="eb-field">
                  <label>Minimum charge ($)</label>
                  <input type="number" step="0.01" value={minimumCharge}
                    onChange={e => { setMinimumCharge(e.target.value); setRateSaved('') }} />
                </div>
                <div className="eb-field">
                  <label>&nbsp;</label>
                  <button className="eb-ghost sm" onClick={saveRate} disabled={savingRate}>
                    {savingRate ? 'Saving…' : 'Save rate'}
                  </button>
                </div>
                {rateSaved ? <span className={`eb-note${rateSaved.startsWith('Could not') ? ' bad' : ' good'}`}>{rateSaved}</span> : null}
              </div>
              <div className="eb-dnote sm">
                The rate and minimum feed the same calculation as before, here and on the
                meter-reading screen.
              </div>

              <div className="eb-srow">
                <div className="eb-field email">
                  <label>Bill email to the camper</label>
                  <textarea ref={emailBoxRef} value={emailMessage}
                    onChange={e => setEmailMessage(e.target.value)} />
                  {/* ⚠ CLICKING, NOT TYPING. A hand-typed token that this catalog does not know
                      is left visible rather than blanked (see renderElectricMessage), but a
                      button cannot misspell in the first place. */}
                  <div className="eb-chips">
                    <span className="cl">Insert a field:</span>
                    {ELECTRIC_TOKENS.map(t => (
                      <button key={t.key} type="button" className="eb-chip" title={tokenText(t.key)}
                        onClick={() => insertEmailToken(t.key)}>+ {t.label}</button>
                    ))}
                  </div>
                  {unknownEmailTokens.length > 0 && (
                    <div className="eb-note bad">
                      {unknownEmailTokens.map(k => `{{${k}}}`).join(', ')} {unknownEmailTokens.length === 1 ? 'is not a field' : 'are not fields'} this email knows — it will be sent exactly as written.
                    </div>
                  )}
                </div>
              </div>
              <div className="eb-editactions">
                <button className="eb-primary sm" onClick={saveMessage}>Save message</button>
                <button className="eb-ghost sm" onClick={() => setShowSettings(false)}>Close</button>
              </div>
            </div>
          )}

          {campers.length === 0 ? (
            <div className="eb-empty">No seasonal campers found.</div>
          ) : (
            <>
              {/* ── Gentle filter tabs. A VIEW filter only — Send All still walks every row. ── */}
              <div className="eb-tabs">
                {([['ready', 'Ready', counts.ready], ['attention', 'Worth a look', counts.attention],
                   ['billed', 'Billed', counts.billed], ['owing', 'Owes a balance', counts.owing],
                   ['everyone', 'Everyone', counts.everyone]] as const).map(([id, label, n]) => (
                  <button key={id} className={`eb-tab${filter === id ? ' active' : ''}`}
                    onClick={e => { e.stopPropagation(); setFilter(id as CardFilter) }}>
                    {label} <span className="n tnum">{n}</span>
                  </button>
                ))}
              </div>

              <div className="eb-cards">
                {visible.length === 0 && (
                  <div className="eb-empty">Nothing in this view.</div>
                )}

                {visible.map(({ row, i }) => {
                  const cr = asCardRow(row)
                  const status = cardStatus(cr)
                  const anomaly = anomalyFor(row)
                  const blocked = blockedByAnomaly(row)
                  const sites = (row.guest.site_number || '—').split(',').map(x => x.trim()).filter(Boolean)
                  const isEditing = editing === i
                  const lines = row.meterBreakdown

                  return (
                    <div key={row.guest.id}
                      className={`eb-card ${status}${isEditing ? ' editing' : ''}${row.skip ? ' skipped' : ''}`}>
                      <div className="eb-row">
                        {/* Site tile */}
                        <div className={`eb-site${sites.length > 1 ? ' dbl' : ''}`}>
                          <span className="num tnum">{sites.join('·')}</span>
                          <span className="cap">{sites.length > 1 ? 'sites' : 'site'}</span>
                        </div>

                        {/* Who + the meter line(s) */}
                        <div className="eb-who">
                          <div className="eb-name">{row.guest.name}</div>

                          {lines.length > 0 ? (
                            <div className={`eb-meter tnum${lines.length > 1 ? ' two' : ''}`} style={isEditing ? { opacity: .55 } : undefined}>
                              {lines.map(l => (
                                <span key={l.meter_id}>
                                  {lines.length > 1 && <span className="mlabel">Meter {l.meter_number}</span>}
                                  {fmtNum(l.previous_reading)} <span className="arrow">→</span> {fmtNum(l.current_reading)} · <span className="kwh">{fmtNum(l.kwh)} kWh</span>
                                  {l.is_reset ? <span className="eb-tag warn">meter replaced</span> : null}
                                </span>
                              ))}
                            </div>
                          ) : status === 'manual' ? (
                            <div className="eb-meter">Entered by hand · no meter reading</div>
                          ) : (
                            <div className={`eb-meter tnum`} style={isEditing ? { opacity: .55 } : undefined}>
                              {row.previousReading || '—'} <span className="arrow">→</span> {row.currentReading || '—'}
                              {row.kwhUsed > 0 && <> · <span className="kwh">{fmtNum(row.kwhUsed)} kWh</span></>}
                            </div>
                          )}

                          {!isEditing && !row.sent && (
                            <button className="eb-pencil" onClick={e => { e.stopPropagation(); setEditing(i) }}>✎ edit</button>
                          )}

                          <div className="eb-tags">
                            {row.draftId && !row.sent && <span className="eb-tag draft">Draft · not charged</span>}
                            {lines.length > 1 && <span className="eb-tag">Two meters · summed</span>}
                            {status === 'manual' && <span className="eb-tag manual">Manual amount</span>}
                            {row.skip && <span className="eb-tag">Not billing this month</span>}
                            {row.sent && <span className="eb-tag done">Billed · on their folio</span>}
                            {row.receiptSent && <span className="eb-tag good">Receipt sent</span>}
                            {/* ⚠ WHAT THEY OWE, WHICH IS NOT THIS MONTH'S CHARGE. The big number
                                on the right is what this bill adds; this is what is outstanding on
                                their folio right now, read straight off it and never recomputed. A
                                camper can owe nothing this month and still carry a balance. */}
                            {cr.balanceCents < 0
                              ? <span className="eb-bal paid">Credit <span className="bd tnum">{fmtUsd(Math.abs(cr.balanceCents))}</span></span>
                              : owesBalance(cr)
                                ? <span className="eb-bal owe">Balance <span className="bd tnum">{fmtUsd(cr.balanceCents)}</span></span>
                                : <span className="eb-bal paid">Paid up</span>}
                          </div>

                          {/* The existing anomaly guard, presented kindly rather than as an alarm. */}
                          {anomaly && !row.anomalyAcknowledged && (
                            <div className="eb-attn">
                              <span className="dot">!</span>
                              <span>{anomaly.message}{' '}
                                <button className="eb-inlinelink" onClick={e => { e.stopPropagation(); setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], anomalyAcknowledged: true }; return u }) }}>
                                  I&rsquo;ve checked it
                                </button>
                              </span>
                            </div>
                          )}

                          {row.error && <div className="eb-err">{row.error}</div>}
                          {!row.guest.email && <div className="eb-muted">No email on file</div>}
                        </div>

                        {/* Amount + the one primary action + the ⋯ menu */}
                        <div className="eb-act">
                          <div className={`eb-amtwrap${row.sent ? ' dim' : ''}`}>
                            <div className="eb-big tnum">{row.finalAmount ? '$' + row.finalAmount : '—'}</div>
                            <div className="eb-foot">
                              {row.sent ? 'billed'
                                : isEditing ? 'editing…'
                                : status === 'manual' ? <>you set this <button className="eb-pencil sm" onClick={e => { e.stopPropagation(); setEditing(i) }}>✎</button></>
                                : row.kwhUsed > 0 ? `${fmtNum(row.kwhUsed)} × $${rate.ratePerKwh}` : ''}
                            </div>
                          </div>

                          {row.sent ? (
                            <span className="eb-billed"><span className="ck">✓</span> Billed</span>
                          ) : row.skip ? (
                            <span className="eb-skipped">Not billing</span>
                          ) : (
                            <button
                              className={`eb-bill${status === 'attention' ? ' gold' : ''}`}
                              onClick={e => {
                                e.stopPropagation()
                                // "Review" opens the editor; "Bill" opens the existing confirm.
                                if (status === 'attention') { setEditing(i); return }
                                // ⚠ CADY-ONLY, AND THE REASON THIS LINE DIFFERS FROM THE TEMPLATE.
                                // The template opens the confirm directly. Cady must go through
                                // prepareBill(), which checks this month against the stretches
                                // already billed and sets billGuard before opening the same
                                // confirm. Calling setCampers here instead would silently disable
                                // the duplicate-charge warning.
                                prepareBill(i)
                              }}
                              disabled={row.sending || !row.finalAmount || (status !== 'attention' && blocked)}>
                              {row.sending ? 'Billing…' : primaryLabel(status)}
                            </button>
                          )}

                          <div className="eb-menuwrap" onClick={e => e.stopPropagation()}>
                            <button className={`eb-more${openMenu === i ? ' open' : ''}`}
                              aria-label={`More actions for ${row.guest.name}`} aria-expanded={openMenu === i}
                              onClick={() => setOpenMenu(openMenu === i ? null : i)}>⋯</button>
                            {openMenu === i && (
                              <div className="eb-menu" role="menu">
                                {menuFor(cr).map(a => (
                                  <div key={a.id}>
                                    {a.dividerBefore && <div className="div" />}
                                    <button role="menuitem" className={a.tone === 'warn' ? 'warn' : undefined}
                                      onClick={() => runMenuAction(a.id, i)}>
                                      <span className="mi">{a.icon}</span> {a.label}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ── Inline edit: readings and the amount, exactly as before ────────── */}
                      {isEditing && (
                        <div className="eb-editpanel" onClick={e => e.stopPropagation()}>
                          <div className="eb-eh">{row.sent ? 'Adjust this bill' : 'Edit this bill'}</div>
                          <div className="eb-fields">
                            <div className="eb-field">
                              <label>Previous reading</label>
                              <input type="number" value={row.previousReading} disabled={row.skip}
                                onChange={e => updateReading(i, 'previousReading', e.target.value)} />
                            </div>
                            <div className="eb-field">
                              <label>Current reading</label>
                              <input type="number" value={row.currentReading} disabled={row.skip}
                                onChange={e => updateReading(i, 'currentReading', e.target.value)} />
                            </div>
                            <div className="eb-live tnum">= {fmtNum(row.kwhUsed)} kWh</div>
                            <div className="eb-field amt">
                              <label>Amount due</label>
                              <input type="number" step="0.01" value={row.finalAmount} disabled={row.skip}
                                onChange={e => updateFinalAmount(i, e.target.value)} />
                              <span className="hint">Auto from reading — type to override</span>
                            </div>
                          </div>
                          <div className="eb-editactions">
                            <button className="eb-primary sm" onClick={() => setEditing(null)}>Done</button>
                            {row.calculatedAmount > 0 && (
                              <button className="eb-ghost sm" onClick={() => updateFinalAmount(i, (row.calculatedAmount / 100).toFixed(2))}>
                                Reset to {fmtUsd(row.calculatedAmount)}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Send to a corrected address — the old "wrong email?" path. */}
                      {row.editEmailMode && (
                        <div className="eb-editpanel" onClick={e => e.stopPropagation()}>
                          <div className="eb-eh">Send this statement to a different email</div>
                          <div className="eb-fields">
                            <div className="eb-field wide">
                              <label>Email address</label>
                              <input type="email" value={row.editEmailValue} placeholder="name@example.com"
                                onChange={e => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], editEmailValue: e.target.value }; return u })} />
                            </div>
                          </div>
                          <div className="eb-editactions">
                            <button className="eb-primary sm" onClick={() => resendBill(i, row.editEmailValue)}>Send</button>
                            <button className="eb-ghost sm" onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], editEmailMode: false }; return u })}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* ── The existing bill confirmation, now in the redesign's panel.
                          ⚠ CADY-ONLY: the period guard rides along. prepareBill() classified this
                          month against the stretches already billed, and its verdict recolours the
                          panel and renames the confirm button. Losing this would let a second
                          identical charge through on one click. ─────────────────────────────── */}
                      {row.showBillConfirm && (() => {
                        const level = row.billGuard?.level ?? 'none'
                        const proposed = periodFromBillingMonth(billingMonth)
                        const span = row.billGuard?.span
                        const tone = level === 'exact' ? ' danger' : level === 'overlap' ? ' warn' : ''
                        return (
                        <div className={`eb-panel${tone}`} onClick={e => e.stopPropagation()}>
                          {level === 'exact' && proposed && (
                            <div className="eb-guard">
                              ⚠ You already billed this exact period ({fmtMDY(proposed.start)}–{fmtMDY(proposed.end)}). Sending again creates a second identical charge.
                            </div>
                          )}
                          {level === 'overlap' && span && (
                            <div className="eb-guard">
                              ⚠ This overlaps {fmtMDY(span.start)}–{fmtMDY(span.end)} of an existing bill — those days may be billed twice.
                            </div>
                          )}
                          <MonthHeadline lead={'Billing ' + row.guest.name + ' for'} billingMonth={billingMonth} />
                          <div className="eb-paneltext">
                            This creates a <strong>{billingMonth} electric charge of ${row.finalAmount}</strong> on their account and emails their statement to <strong>{row.guest.email}</strong>.
                          </div>
                          <div className="eb-panelactions">
                            <button className="eb-primary sm" onClick={() => { setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], showBillConfirm: false, billGuard: null }; return u }); sendBill(i) }}>
                              {level === 'none' ? 'Yes, bill electric' : 'Bill anyway'}
                            </button>
                            <button className="eb-ghost sm" onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], showBillConfirm: false, billGuard: null }; return u })}>Cancel</button>
                          </div>
                        </div>
                        )
                      })()}

                      {/* ── The existing receipt confirmation, unchanged ───────────────────── */}
                      {row.showReceiptConfirm && row.lastPaymentRecorded && (
                        <div className="eb-panel warm" onClick={e => e.stopPropagation()}>
                          <div className="eb-paneltext">
                            Email a receipt for <strong>{fmtUsd(row.lastPaymentRecorded.amount)}</strong> to <strong>{row.guest.email}</strong>?
                          </div>
                          <div className="eb-panelactions">
                            <button className="eb-primary sm" onClick={() => sendReceipt(i)} disabled={row.sendingReceipt}>
                              {row.sendingReceipt ? 'Sending…' : 'Yes, send receipt'}
                            </button>
                            <button className="eb-ghost sm" onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], showReceiptConfirm: false }; return u })}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* ── The existing payment panel, unchanged ──────────────────────────── */}
                      {row.showPayment && (
                        <div className="eb-editpanel" onClick={e => e.stopPropagation()}>
                          <div className="eb-eh">
                            Take a payment — {row.guest.name}
                            {row.folioBalance !== 0 && (
                              <span className={`eb-balance${row.folioBalance < 0 ? ' credit' : ''}`}>
                                {row.folioBalance < 0
                                  ? `Credit on account ${fmtUsd(Math.abs(row.folioBalance))}`
                                  : `Balance due ${fmtUsd(row.folioBalance)}`}
                              </span>
                            )}
                          </div>
                          <div className="eb-fields">
                            <div className="eb-field">
                              <label>Amount ($)</label>
                              <input type="number" step="0.01" value={row.paymentAmount}
                                onChange={e => updatePaymentField(i, 'paymentAmount', e.target.value)} />
                            </div>
                            <div className="eb-field">
                              <label>Method</label>
                              <select value={row.paymentMethod} onChange={e => updatePaymentField(i, 'paymentMethod', e.target.value)}>
                                {allPaymentMethods(customMethods).map(m => <option key={m} value={m}>{methodLabel(m)}</option>)}
                                <option value="other">Other</option>
                              </select>
                              {row.paymentMethod === 'card' && <span className="hint">→ opens the folio to charge the terminal</span>}
                            </div>
                            <div className="eb-field wide">
                              <label>Note (optional)</label>
                              <input placeholder="e.g. Check #1042" value={row.paymentNote}
                                onChange={e => updatePaymentField(i, 'paymentNote', e.target.value)} />
                            </div>
                          </div>
                          <div className="eb-editactions">
                            <button className="eb-primary sm" disabled={row.savingPayment || !row.paymentAmount}
                              onClick={() => {
                                if (row.paymentMethod === 'card') { router.push(`/admin/folio/guest/${row.guest.id}`) }
                                else { recordPayment(i) }
                              }}>
                              {row.savingPayment ? 'Saving…' : 'Save payment'}
                            </button>
                            <button className="eb-ghost sm" onClick={() => updatePaymentField(i, 'showPayment', false as unknown as string)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* ── The existing per-camper history, unchanged ─────────────────────── */}
                      {row.showHistory && (
                        <div className="eb-history" onClick={e => e.stopPropagation()}>
                          <div className="eb-eh">Billing history — {row.guest.name}</div>
                          {row.readings.length === 0 ? (
                            <div className="eb-muted">No billing history yet.</div>
                          ) : (
                            <table className="eb-table">
                              <thead>
                                <tr>{['Month', 'Prev', 'Curr', 'kWh', 'Rate', 'Billed', 'Date', ''].map(h => <th key={h}>{h}</th>)}</tr>
                              </thead>
                              <tbody>
                                {row.readings.map(r => {
                                  // ⚠ CADY-ONLY: a voided bill stays visible, struck through, with
                                  // who voided it and why on hover. Hiding it would make the folio
                                  // and this table disagree.
                                  const isVoided = r.voided === true
                                  return (
                                  <tr key={r.id} className={isVoided ? 'voided' : undefined}>
                                    <td>{r.billing_month}{isVoided && <span className="eb-tag void">Voided</span>}</td>
                                    <td className="tnum">{fmtNum(r.previous_reading)}</td>
                                    <td className="tnum">{fmtNum(r.current_reading)}</td>
                                    <td className="tnum">{fmtNum(r.kwh_used)}</td>
                                    <td className="tnum">${Number(r.rate_per_kwh).toFixed(3)}</td>
                                    <td className="tnum">{fmtUsd(r.final_amount)}</td>
                                    <td className="eb-muted">{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                                    <td className="eb-voidcell">
                                      {isVoided ? (
                                        <span className="eb-muted" title={`Voided${r.voided_by ? ' by ' + r.voided_by : ''}${r.reason ? ' · ' + r.reason : ''}${r.voided_at ? ' · ' + new Date(r.voided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : ''}`}>
                                          voided{r.voided_by ? ' · ' + r.voided_by : ''}
                                        </span>
                                      ) : (
                                        <button className="eb-void" onClick={() => openVoid(i, r)}>Void</button>
                                      )}
                                    </td>
                                  </tr>
                                  )
                                })}
                              </tbody>
                              <tfoot>
                                {/* ⚠ CADY-ONLY, AND DELIBERATELY KEPT. Template PR #87 dropped this
                                    row; on Cady it also excludes voided bills, so it is the only
                                    place the true all-time figure appears. */}
                                <tr>
                                  <td colSpan={5}>Total billed (all time)</td>
                                  <td className="tnum">{fmtUsd(row.readings.filter(r => !r.voided).reduce((s, r) => s + r.final_amount, 0))}</td>
                                  <td />
                                  <td />
                                </tr>
                              </tfoot>
                            </table>
                          )}
                          {row.folioPayments.length > 0 && (
                            <>
                              <div className="eb-eh sub">Payments received</div>
                              {row.folioPayments.map(pm => (
                                <div key={pm.id} className="eb-payrow">
                                  <span>
                                    <strong>{methodLabel(pm.method)}</strong>
                                    {pm.note ? <span className="eb-muted"> {pm.note}</span> : null}
                                    <span className="eb-muted"> {new Date(pm.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                                    {pm.receipt_sent_at
                                      ? <span className="eb-tag good">receipt sent</span>
                                      : <span className="eb-tag">no receipt</span>}
                                  </span>
                                  <span className="eb-payright">
                                    <span className="tnum">−{fmtUsd(pm.amount - (pm.surcharge_amount || 0))}</span>
                                    <button className="eb-ghost xs" onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], lastPaymentRecorded: pm, showReceiptConfirm: true, receiptSent: false }; return u })}>
                                      {pm.receipt_sent_at ? 'Re-send' : 'Send receipt'}
                                    </button>
                                  </span>
                                </div>
                              ))}
                            </>
                          )}
                          <div className={`eb-balrow${row.folioBalance > 0 ? ' due' : ''}`}>
                            <span>{row.folioBalance < 0 ? 'Credit on account' : row.folioBalance === 0 ? 'Paid in full' : 'Balance due'}</span>
                            <span className="tnum">{fmtUsd(Math.abs(row.folioBalance))}</span>
                          </div>
                          <div className="eb-editactions">
                            <button className="eb-ghost sm" onClick={() => loadHistory(i)}>Hide history</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'history' && (
        campers.length === 0
          ? <div className="eb-empty">No seasonal campers found.</div>
          : <div className="eb-cards">
              {campers.map(row => <GuestAccountCard key={row.guest.id} guest={row.guest} folioBalance={row.folioBalance} />)}
            </div>
      )}

      {/* Phase C2 — Void dialog */}
      {voidTarget && (() => {
        const camper = campers[voidTarget.index]
        const hasPayments = (camper?.folioPayments?.length || 0) > 0
        const r = voidTarget.reading
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            onClick={() => { if (!voiding) setVoidTarget(null) }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: '1.5rem', width: '100%', maxWidth: 460 }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Void this bill?</div>
              <div style={{ fontSize: 14, color: '#374151', marginBottom: 12 }}>
                <strong>{r.billing_month}</strong> · ${(r.final_amount / 100).toFixed(2)} — {camper?.guest.name} · Site {camper?.guest.site_number}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
                Voiding removes this bill from the balance and statements. It stays visible on admin surfaces as an audit record. To re-bill this period, void it here, then bill it again.
              </div>
              {hasPayments && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: '#92400e' }}>
                  ⚠ This guest's folio has payments on it. Voiding this charge may leave a <strong>credit on their account</strong> — handle that credit on the guest folio the usual way (refund or apply to a future charge).
                </div>
              )}
              <label style={lbl}>Reason</label>
              <input style={inp} value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="e.g. wrong month, misread meter, duplicate" />
              <label style={{ ...lbl, marginTop: 12 }}>Your name / initials</label>
              <input style={inp} value={voidBy} onChange={e => setVoidBy(e.target.value)} placeholder="e.g. RC" />
              {voidError && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 10 }}>{voidError}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button onClick={performVoid} disabled={voiding}
                  style={{ flex: 1, background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 700, cursor: voiding ? 'default' : 'pointer', opacity: voiding ? 0.6 : 1 }}>
                  {voiding ? 'Voiding…' : 'Void bill'}
                </button>
                <button onClick={() => setVoidTarget(null)} disabled={voiding}
                  style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}


function GuestAccountCard({ guest, folioBalance }: { guest: Guest; folioBalance: number }) {
  const [readings, setReadings] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)

  async function load() {
    if (loaded) { setOpen(!open); return }
    const [{ data: r }, { data: folio }] = await Promise.all([
      // Posted only — `totalBilled` below sums final_amount, and a draft is not billed.
      supabase.from('electric_readings').select('*').eq('guest_id', guest.id).eq('status', 'posted').order('created_at', { ascending: false }),
      supabase.from('folios').select('id').eq('guest_id', guest.id).eq('folio_type', 'guest_account').single(),
    ])
    let pmts: any[] = []
    if (folio) {
      const { data: pData } = await supabase.from('folio_payments').select('*').eq('folio_id', folio.id).eq('status', 'completed').order('paid_at', { ascending: false })
      pmts = pData || []
    }
    setReadings(r || [])
    setPayments(pmts)
    setLoaded(true)
    setOpen(true)
  }

  // Phase C2 — voided readings are excluded from the "billed" figures and marked in
  // the table below (display consistency on this admin surface, Decision 2d).
  const activeReadings = readings.filter((r: any) => !r.voided)
  const totalBilled = activeReadings.reduce((s, r) => s + r.final_amount, 0)
  const totalPaid = payments.reduce((s, p) => s + p.amount - (p.surcharge_amount || 0), 0)

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
      <div onClick={load} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', cursor: 'pointer' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{guest.name}</div>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>Site {guest.site_number} · {guest.email || 'No email'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {loaded && <div style={{ fontSize: 12, color: '#6b7280' }}>{activeReadings.length} bill{activeReadings.length !== 1 ? 's' : ''} · ${(totalBilled / 100).toFixed(2)} billed · ${(totalPaid / 100).toFixed(2)} paid</div>}
          <div style={{ fontWeight: 800, fontSize: 16, color: folioBalance > 0 ? '#dc2626' : '#15803d' }}>
            {folioBalance > 0 ? '$' + (folioBalance / 100).toFixed(2) + ' due' : '✓ Current'}
          </div>
          <span style={{ color: '#9ca3af', fontSize: 18 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid #e5e7eb' }}>
          {readings.length === 0 ? (
            <div style={{ padding: '1rem 20px', fontSize: 13, color: '#9ca3af' }}>No billing history yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Month', 'Prev Reading', 'Curr Reading', 'kWh Used', 'Rate', 'Amount Billed', 'Billed On'].map(h => (
                    <th key={h} style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readings.map((r, i) => {
                  const isVoided = r.voided === true
                  return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6', background: isVoided ? '#f9fafb' : (i % 2 === 0 ? '#fff' : '#fafafa'), opacity: isVoided ? 0.6 : 1 }}>
                    <td style={{ padding: '10px 16px', fontWeight: 600, color: isVoided ? '#9ca3af' : '#111827', textDecoration: isVoided ? 'line-through' : 'none' }}>{r.billing_month}{isVoided && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 4px', textDecoration: 'none' }}>VOIDED</span>}</td>
                    <td style={{ padding: '10px 16px', color: '#6b7280' }}>{Number(r.previous_reading).toLocaleString()}</td>
                    <td style={{ padding: '10px 16px', color: '#6b7280' }}>{Number(r.current_reading).toLocaleString()}</td>
                    <td style={{ padding: '10px 16px', fontWeight: 600 }}>{Number(r.kwh_used).toFixed(1)}</td>
                    <td style={{ padding: '10px 16px', color: '#6b7280' }}>${Number(r.rate_per_kwh).toFixed(3)}/kWh</td>
                    <td style={{ padding: '10px 16px', fontWeight: 700, color: isVoided ? '#9ca3af' : '#15803d', textDecoration: isVoided ? 'line-through' : 'none' }}>${(r.final_amount / 100).toFixed(2)}</td>
                    <td style={{ padding: '10px 16px', color: '#9ca3af' }}>{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f0fdf4', borderTop: '2px solid #bbf7d0' }}>
                  <td colSpan={5} style={{ padding: '10px 16px', fontWeight: 700, color: '#15803d' }}>All-time totals</td>
                  <td style={{ padding: '10px 16px', fontWeight: 800, color: '#15803d' }}>${(totalBilled / 100).toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          {payments.length > 0 && (
            <div style={{ borderTop: '1px solid #e5e7eb', padding: '0 0 4px' }}>
              <div style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>Payments received</div>
              {payments.map((p, pi) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', borderBottom: pi < payments.length - 1 ? '1px solid #f3f4f6' : 'none', fontSize: 13 }}>
                  <div>
                    <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{p.method}</span>
                    {p.note && <span style={{ color: '#9ca3af', marginLeft: 10 }}>{p.note}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>{new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <span style={{ fontWeight: 700, color: '#15803d' }}>-${((p.amount - (p.surcharge_amount || 0)) / 100).toFixed(2)}</span>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderTop: '2px solid #bbf7d0', background: '#f0fdf4' }}>
                <span style={{ fontWeight: 700, color: '#15803d' }}>Total paid</span>
                <span style={{ fontWeight: 800, color: '#15803d' }}>${(totalPaid / 100).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── THE LOOK ─────────────────────────────────────────────────────────────────────────────────
//
// Spacing, radii and hierarchy come from the approved mock-up; every COLOUR and FACE comes from
// the `.seasonal-theme` tokens in globals.css, which app/admin/electric-billing/layout.tsx puts
// on this page. That split is deliberate: the mock-up is the spec for the shape, the tokens are
// the single source of truth for the palette, so a later change to the theme carries here for
// free and there is no second copy of the cream to drift.
//
// It is a <style> element rather than inline styles because the design needs three things inline
// styles cannot express: the ::before status spine, hover/focus states, and the ≤560px reflow.
// Every selector is prefixed `eb-` so it cannot reach anything else in the admin.
// ⚠ CADY-ONLY. The void dialog is the one surface the redesign does not restyle — it keeps its
// own inline styles so the void flow is untouched by this change. These two were defined in the
// page's previous render, which the redesign replaced; they move here rather than disappear.
const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 8 }
const inp: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' }

const EB_CSS = `
.eb-wrap{max-width:820px;margin:0 auto;padding:28px 20px 80px;font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif;color:var(--ink);font-size:15px;line-height:1.5}
.eb-wrap *{box-sizing:border-box}
.tnum{font-family:var(--font-jetbrains-mono),ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}

.eb-pagehead{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
.eb-title{font-family:var(--font-newsreader),ui-serif,Georgia,serif;font-weight:500;font-size:30px;letter-spacing:-.01em;color:var(--forest);margin:0}
.eb-monthwrap{display:flex;align-items:center;gap:10px}
.eb-month{font-family:inherit;font-weight:600;font-size:14px;color:var(--forest);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 14px;cursor:pointer}
.eb-month:focus-visible{outline:2px solid var(--forest);outline-offset:2px}
.eb-loadingnote{font-size:12px;color:var(--muted)}

.eb-viewtabs{display:flex;gap:4px;margin:18px 0 4px;border-bottom:1px solid var(--line)}
.eb-viewtab{font-family:inherit;font-size:14px;font-weight:600;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;padding:10px 16px;margin-bottom:-1px;cursor:pointer}
.eb-viewtab.on{color:var(--forest);border-bottom-color:var(--forest)}

.eb-summary{margin:18px 0 6px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
.eb-headline{font-family:var(--font-newsreader),ui-serif,Georgia,serif;font-size:19px;color:var(--forest);font-weight:500;margin:0 0 3px}
.eb-sub{color:var(--ink-soft);font-size:13.5px}
.eb-total{text-align:right}
.eb-amt{font-size:26px;font-weight:600;color:var(--forest);letter-spacing:-.02em}
.eb-lbl{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}

.eb-sendall{margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.eb-primary{appearance:none;border:none;cursor:pointer;font-family:inherit;font-weight:600;font-size:14.5px;background:var(--forest);color:var(--on-forest);border-radius:11px;padding:11px 20px}
.eb-primary:hover:not(:disabled){background:var(--forest-deep)}
.eb-primary:disabled{opacity:.45;cursor:default}
.eb-primary.sm{font-size:13.5px;padding:9px 16px;border-radius:9px}
.eb-ghost{appearance:none;cursor:pointer;font-family:inherit;font-weight:600;font-size:14px;background:transparent;color:var(--forest);border:1px solid var(--line-strong);border-radius:11px;padding:10px 16px;text-decoration:none;display:inline-flex;align-items:center}
.eb-ghost:hover:not(:disabled){background:var(--card)}
.eb-ghost:disabled{opacity:.45;cursor:default}
.eb-ghost.sm{font-size:13px;padding:8px 14px;border-radius:9px}
.eb-ghost.xs{font-size:11.5px;padding:4px 9px;border-radius:7px}

.eb-tabs{display:flex;gap:6px;margin:26px 0 12px;flex-wrap:wrap}
.eb-tab{font-family:inherit;font-size:13.5px;font-weight:600;color:var(--ink-soft);background:transparent;border:1px solid transparent;border-radius:999px;padding:6px 14px;cursor:pointer}
.eb-tab .n{color:var(--muted);font-weight:600;margin-left:5px;font-size:12.5px}
.eb-tab.active{background:var(--forest);color:var(--on-forest);border-color:var(--forest)}
.eb-tab.active .n{color:var(--gold)}
.eb-tab:not(.active):hover{background:var(--card);border-color:var(--line)}

.eb-cards{display:flex;flex-direction:column;gap:12px}
.eb-card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px 18px 22px}
.eb-card::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:4px;border-radius:4px;background:var(--good)}
.eb-card.billed::before{background:var(--muted)}
.eb-card.attention::before{background:var(--gold)}
.eb-card.manual::before{background:var(--line-strong)}
.eb-card.editing::before{background:var(--forest)}
.eb-card.editing{outline:2px solid var(--card-2);outline-offset:-2px}
.eb-card.skipped{opacity:.72}
.eb-row{display:flex;align-items:flex-start;gap:18px}

.eb-site{flex:0 0 auto;width:56px;height:56px;border-radius:13px;background:var(--card-2);border:1px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.eb-site .num{font-family:var(--font-jetbrains-mono),ui-monospace,monospace;font-weight:600;font-size:19px;color:var(--forest);line-height:1}
.eb-site.dbl .num{font-size:13px}
.eb-site .cap{font-size:9.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}

.eb-who{flex:1 1 auto;min-width:0}
.eb-name{font-family:var(--font-newsreader),ui-serif,Georgia,serif;font-size:18px;font-weight:500;color:var(--ink);letter-spacing:-.01em}
.eb-meter{margin-top:3px;font-size:12.5px;color:var(--ink-soft);letter-spacing:-.01em}
.eb-meter.two{display:flex;flex-direction:column;gap:2px}
.eb-meter .mlabel{color:var(--muted);margin-right:6px}
.eb-meter .arrow{color:var(--muted);margin:0 5px}
.eb-meter .kwh{color:var(--forest);font-weight:500}
.eb-pencil{background:none;border:none;cursor:pointer;color:var(--muted);font-size:11px;margin-left:7px;font-family:inherit;padding:2px 4px}
.eb-pencil:hover{color:var(--gold-ink)}
.eb-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.eb-tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;border-radius:999px;padding:3px 9px;background:var(--card-2);color:var(--ink-soft)}
.eb-tag.draft{background:var(--draft-bg);color:var(--draft)}
.eb-tag.done{background:var(--good-bg);color:var(--good)}
.eb-tag.good{background:var(--good-bg);color:var(--good)}
.eb-tag.warn{background:var(--watch-bg);color:var(--watch)}
.eb-tag.manual{background:var(--card-2);color:var(--ink-soft)}

.eb-attn{margin-top:9px;font-size:12.5px;color:var(--gold-ink);display:flex;align-items:flex-start;gap:7px;line-height:1.45}
.eb-attn .dot{flex:0 0 auto;width:15px;height:15px;margin-top:2px;border-radius:50%;background:var(--watch-bg);color:var(--gold-ink);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
.eb-inlinelink{background:none;border:none;padding:0;font-family:inherit;font-size:12.5px;font-weight:700;color:var(--gold-ink);text-decoration:underline;cursor:pointer}
.eb-err{margin-top:7px;font-size:12.5px;color:var(--danger);font-weight:600}
.eb-muted{font-size:12px;color:var(--muted)}

.eb-act{flex:0 0 auto;display:flex;align-items:center;gap:10px}
.eb-amtwrap{text-align:right;min-width:88px}
.eb-big{font-size:19px;font-weight:600;color:var(--forest);letter-spacing:-.02em}
.eb-amtwrap.dim .eb-big{color:var(--muted)}
.eb-foot{font-size:11px;color:var(--muted);margin-top:1px}
.eb-bill{appearance:none;border:none;cursor:pointer;font-family:inherit;font-weight:600;font-size:14px;background:var(--forest);color:var(--on-forest);border-radius:10px;padding:10px 16px;white-space:nowrap}
.eb-bill:hover:not(:disabled){background:var(--forest-deep)}
.eb-bill:disabled{opacity:.45;cursor:default}
.eb-bill.gold{background:var(--gold);color:var(--on-watch)}
.eb-billed{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:14px;color:var(--good);white-space:nowrap}
.eb-billed .ck{width:19px;height:19px;border-radius:50%;background:var(--good-bg);display:flex;align-items:center;justify-content:center;font-size:12px}
.eb-skipped{font-size:13px;font-weight:600;color:var(--muted);white-space:nowrap}
.eb-more{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:transparent;cursor:pointer;color:var(--muted);font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center}
.eb-more:hover,.eb-more.open{background:var(--card-2);color:var(--forest);border-color:var(--line-strong)}

.eb-menuwrap{position:relative}
.eb-menu{position:absolute;right:0;top:40px;z-index:20;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 30px rgba(34,64,45,.14);padding:6px;width:236px;
  /* ⚠ max-width:none IS LOAD-BEARING. A global \`* { max-width:100% }\` in the app stylesheet
     clamps an absolutely-positioned child to its containing block — here the 34px "⋯" button —
     which squeezed every menu item into a four-line column. The global rule is right (it is what
     keeps pages from scrolling sideways) so it stays; this is the one element that must opt out.
     The menu opens leftward from the button, well inside the card, so nothing overflows. */
  max-width:none}
.eb-menu button{display:flex;width:100%;align-items:center;gap:10px;padding:9px 11px;border:none;background:none;border-radius:8px;font-family:inherit;font-size:13.5px;font-weight:500;color:var(--ink);text-align:left;cursor:pointer;white-space:nowrap}
.eb-menu button:hover{background:var(--card-2)}
.eb-menu button.warn{color:var(--danger)}
.eb-menu .div{height:1px;background:var(--line-soft);margin:5px 8px}
.eb-menu .mi{width:16px;color:var(--muted);text-align:center;font-size:13px}

.eb-panel{margin:14px 0 2px;background:var(--draft-bg);border:1px solid var(--draft);border-radius:13px;padding:15px 16px}
.eb-panel.warm{background:var(--watch-bg);border-color:var(--watch)}
.eb-paneltext{font-size:13px;color:var(--ink);margin-bottom:12px;line-height:1.5}
.eb-panelactions,.eb-editactions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.eb-editactions{margin-top:14px}

.eb-settings,.eb-editpanel,.eb-history{margin:14px 0 2px;background:var(--card-2);border:1px solid var(--line);border-radius:13px;padding:15px 16px}
.eb-settings{margin-top:16px}
.eb-eh{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--forest);margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.eb-eh.sub{margin-top:14px}
.eb-balance{font-weight:600;text-transform:none;letter-spacing:0;font-size:12px;color:var(--watch)}
.eb-balance.credit{color:var(--good)}
.eb-fields{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end}
.eb-field{display:flex;flex-direction:column;gap:5px}
.eb-field.wide{flex:1 1 260px}
.eb-field label{font-size:11.5px;color:var(--ink-soft);font-weight:600}
.eb-field input,.eb-field select,.eb-field textarea{font-family:var(--font-jetbrains-mono),ui-monospace,monospace;font-size:15px;font-weight:500;color:var(--forest);background:var(--card);border:1px solid var(--line-strong);border-radius:9px;padding:9px 11px;width:120px}
.eb-field.wide input,.eb-field textarea{width:100%;font-family:inherit}
.eb-field textarea{height:76px;resize:vertical;font-size:14px;color:var(--ink)}
.eb-field select{width:auto;font-family:inherit;font-size:14px}
.eb-field input:focus-visible,.eb-field select:focus-visible,.eb-field textarea:focus-visible{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(180,132,43,.16)}
.eb-field .hint{font-size:10.5px;color:var(--muted)}
.eb-live{font-family:var(--font-jetbrains-mono),ui-monospace,monospace;font-size:13px;color:var(--forest);font-weight:600;padding-bottom:10px}
.eb-note{font-size:12px;font-weight:600}
.eb-note.good{color:var(--good)} .eb-note.bad{color:var(--danger)}

.eb-table{width:100%;border-collapse:collapse;font-size:12.5px}
.eb-table th{text-align:left;color:var(--muted);font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;border-bottom:1px solid var(--line)}
.eb-table td{padding:7px 10px;border-bottom:1px solid var(--line-soft);color:var(--ink-soft)}
.eb-payrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:12.5px;flex-wrap:wrap}
.eb-payright{display:flex;align-items:center;gap:10px}
.eb-balrow{display:flex;justify-content:space-between;padding:10px 0 2px;margin-top:8px;border-top:1px solid var(--line);font-weight:700;font-size:13px;color:var(--good)}
.eb-balrow.due{color:var(--watch)}
.eb-empty{text-align:center;color:var(--muted);padding:3rem 0}

/* ── CADY-ONLY. Styles for the two capabilities the template's page has never had: the
   billing-period guard inside the bill confirm, and voiding a posted bill from the history
   panel. Kept here at the end so a future template sync shows them as an obvious block. ── */
.eb-panel.warn{background:var(--watch-bg);border-color:var(--watch)}
.eb-panel.danger{background:var(--draft-bg);border-color:var(--danger)}
.eb-guard{font-size:13px;font-weight:700;line-height:1.45;margin-bottom:9px;color:var(--watch)}
.eb-panel.danger .eb-guard{color:var(--danger)}
.eb-tag.void{background:var(--card-2);color:var(--danger);margin-left:7px}
.eb-table tr.voided td{opacity:.55}
.eb-table tr.voided td:first-child,.eb-table tr.voided td:nth-child(6){text-decoration:line-through}
.eb-table tr.voided td .eb-tag.void{text-decoration:none;opacity:1}
.eb-voidcell{text-align:right;white-space:nowrap}
.eb-void{appearance:none;font-family:inherit;font-size:11.5px;font-weight:600;color:var(--danger);background:var(--card-2);border:1px solid var(--line);border-radius:7px;padding:3px 10px;cursor:pointer}
.eb-void:hover{border-color:var(--danger)}
.eb-table tfoot td{border-bottom:none;border-top:1px solid var(--line);padding-top:9px;font-weight:700;color:var(--forest)}
.eb-gear{font-family:inherit;font-weight:600;font-size:14px;color:var(--ink-soft);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 14px;cursor:pointer;white-space:nowrap}
.eb-gear:hover{border-color:var(--line-strong);color:var(--forest)}

.eb-drawer{margin:16px 0 4px;background:var(--card);border:1px solid var(--gold);border-radius:16px;padding:18px 20px}
.eb-dh{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.eb-dh .t{font-family:var(--font-newsreader),ui-serif,Georgia,serif;font-size:18px;color:var(--forest);font-weight:500}
.eb-dh .x{cursor:pointer;color:var(--muted);font-size:18px;border:none;background:none;line-height:1}
.eb-dnote{font-size:12px;color:var(--muted);margin:0 0 14px}
.eb-dnote.sm{margin:-6px 0 14px}
.eb-srow{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:14px;align-items:flex-end}
.eb-field.email{flex:1 1 100%}
.eb-field.email textarea{width:100%;min-height:96px;font-family:inherit;font-size:13.5px;color:var(--ink);line-height:1.55;resize:vertical}
.eb-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
.eb-chips .cl{font-size:11.5px;color:var(--muted);margin-right:2px}
.eb-chip{font-family:var(--font-jetbrains-mono),ui-monospace,monospace;font-size:11.5px;font-weight:500;color:var(--forest);background:var(--card-2);border:1px solid var(--line);border-radius:7px;padding:3px 8px;cursor:pointer}
.eb-chip:hover{border-color:var(--gold);color:var(--gold-ink)}

.eb-bal{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;border-radius:999px;padding:3px 9px}
.eb-bal.owe{background:var(--watch-bg);color:var(--gold-ink)}
.eb-bal.paid{background:var(--good-bg);color:var(--good)}
.eb-bal .bd{font-weight:600}

.eb-draftnote{margin:16px 0 0;background:var(--draft-bg);border:1px solid var(--draft);border-radius:12px;padding:11px 15px;font-size:13.5px;color:var(--draft)}

@media (max-width:560px){
  .eb-row{flex-wrap:wrap}
  .eb-act{width:100%;justify-content:flex-end;border-top:1px dashed var(--line-soft);padding-top:12px;margin-top:12px}
  .eb-amtwrap{flex:1 1 auto;text-align:left}
  .eb-menu{width:212px}
}
`
