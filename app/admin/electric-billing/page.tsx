'use client'
import { allPaymentMethods, methodLabel } from '@/lib/transactions'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { planAtLeast } from '@/lib/plan'
import { periodFromBillingMonth, classifyPeriod, fmtMDY, type GuardResult } from '@/lib/electric-periods'
import { notVoided, sumLineTotals } from '@/lib/ledger'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
  editEmailMode: boolean
  editEmailValue: string
  showBillConfirm: boolean
  billGuard: GuardResult | null
}

function generateMonthOptions(): string[] {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const now = new Date()
  const currentYear = now.getFullYear()
  const options: string[] = []
  for (const year of [currentYear, currentYear + 1]) {
    for (const month of months) {
      options.push(`${month} ${year}`)
    }
  }
  return options
}

function getCurrentMonthOption(): string {
  const now = new Date()
  return now.toLocaleString('default', { month: 'long' }) + ' ' + now.getFullYear()
}

function parseMonthValue(s: string): number {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const p = s.split(' ')
  return p.length === 2 ? parseInt(p[1]) * 12 + months.indexOf(p[0]) : 0
}

export default function ElectricBillingPage() {
  const router = useRouter()

  useEffect(() => {
    supabase.from('settings').select('plan, pos_enabled, custom_payment_methods').single().then(({ data }) => {
      setCustomMethods((data as any)?.custom_payment_methods || [])
      if (!planAtLeast(data?.plan, 'summit')) router.replace('/admin')
    })
  }, [])

  const [campers, setCampers] = useState<CamperRow[]>([])
  const [customMethods, setCustomMethods] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [ratePerKwh, setRatePerKwh] = useState('0.27')
  const [minimumCharge, setMinimumCharge] = useState('15.00')
  const [activeTab, setActiveTab] = useState<'billing' | 'history'>('billing')
  const [billingMonth, setBillingMonth] = useState(getCurrentMonthOption)
  const [emailMessage, setEmailMessage] = useState("Please find your monthly electric statement below. If you have any questions, please don't hesitate to reach out.")
  const [sendingAll, setSendingAll] = useState(false)
  // Phase C2 — void dialog state (electric History is the only void surface).
  const [voidTarget, setVoidTarget] = useState<{ index: number; reading: ElectricReading } | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidBy, setVoidBy] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState('')
  const [autoPopulating, setAutoPopulating] = useState(false)

  const monthOptions = generateMonthOptions()

  useEffect(() => { fetchCampers(); fetchMessage() }, [])

  async function fetchMessage() {
    const { data } = await supabase.from('settings').select('electric_bill_message').single()
    if (data?.electric_bill_message) setEmailMessage(data.electric_bill_message)
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
      }
    }))

    // Auto-populate previous readings for the current billing month
    const currentMonth = billingMonth
    const selectedVal = parseMonthValue(currentMonth)
    const populatedRows = await Promise.all(rows.map(async (row) => {
      const { data: readings } = await supabase
        .from('electric_readings')
        .select('billing_month, previous_reading, current_reading, created_at, voided')
        .eq('guest_id', row.guest.id)
        .order('created_at', { ascending: false })
      if (!readings || readings.length === 0) return row
      const thisMonthReading = readings.find(r => r.billing_month === currentMonth && r.voided !== true)
      if (thisMonthReading) {
        return { ...row, previousReading: String(thisMonthReading.previous_reading), currentReading: String(thisMonthReading.current_reading), sent: true }
      }
      const priorReadings = readings.filter(r => parseMonthValue(r.billing_month) < selectedVal && r.voided !== true)
      if (priorReadings.length === 0) return row
      return { ...row, previousReading: String(priorReadings[0].current_reading) }
    }))

    setCampers(populatedRows)
    setLoading(false)
  }

 async function handleMonthChange(newMonth: string) {
    setBillingMonth(newMonth)
    if (campers.length === 0) return
    setAutoPopulating(true)
    const selectedVal = parseMonthValue(newMonth)

    const updatedCampers = await Promise.all(campers.map(async (row) => {
      const { data: readings } = await supabase
        .from('electric_readings')
        .select('billing_month, previous_reading, current_reading, created_at, voided')
        .eq('guest_id', row.guest.id)
        .order('created_at', { ascending: false })

      if (!readings || readings.length === 0) return row

      // If this month already has a recorded reading, show that exact data
      const thisMonthReading = readings.find(r => r.billing_month === newMonth && r.voided !== true)
      if (thisMonthReading) {
        return {
          ...row,
          previousReading: String(thisMonthReading.previous_reading),
          currentReading: String(thisMonthReading.current_reading),
          sent: true,
        }
      }

      // Otherwise find the most recent reading before this month and pre-fill prev reading
      const priorReadings = readings.filter(r => parseMonthValue(r.billing_month) < selectedVal && r.voided !== true)
      if (priorReadings.length === 0) return row
      return {
        ...row,
        previousReading: String(priorReadings[0].current_reading),
        currentReading: '',
        kwhUsed: 0,
        calculatedAmount: 0,
        finalAmount: '',
        sent: false,
      }
    }))

    setCampers(updatedCampers)
    setAutoPopulating(false)
  }

  async function loadHistory(index: number) {
    const row = campers[index]
    if (row.historyLoaded) {
      setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], showHistory: !u[index].showHistory }; return u })
      return
    }
    const { data } = await supabase.from('electric_readings').select('*').eq('guest_id', row.guest.id).order('created_at', { ascending: false })
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
    const { data: readings } = await supabase.from('electric_readings').select('*').eq('guest_id', row.guest.id).order('created_at', { ascending: false })
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
    const newBalance = Math.max(0, itemsTotal - paymentsTotal)

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
      const kwh = Math.max(0, curr_r - prev_r)
      const rate = parseFloat(ratePerKwh) || 0.27
      const minCharge = Math.round((parseFloat(minimumCharge) || 15) * 100)
      const calculated = Math.max(minCharge, Math.round(kwh * rate * 100))
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
    const { data: prevBills } = await supabase.from('electric_readings').select('created_at')
      .eq('guest_id', row.guest.id).neq('billing_month', billingMonth).eq('voided', false)
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
    if (!finalAmountCents) { setCampers(prev => { const u = [...prev]; u[index] = { ...u[index], error: 'Enter meter readings first' }; return u }); return }
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
      rate_per_kwh: parseFloat(ratePerKwh) || 0.27,
      minimum_charge: Math.round((parseFloat(minimumCharge) || 15) * 100),
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

  const readyToSend = campers.filter(c => !c.skip && !c.sent && c.finalAmount).length

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading seasonal campers...</div>

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Electric Billing</h1>
        <p style={{ color: '#6b7280', margin: '4px 0 0', fontSize: 14 }}>Generate and send monthly electric bills to seasonal campers</p>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
        {(['billing', 'history'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === tab ? '2px solid #2E6B8A' : '2px solid transparent', color: activeTab === tab ? '#2E6B8A' : '#6b7280', marginBottom: -1 }}>
            {tab === 'billing' ? 'Monthly Billing' : 'Account History'}
          </button>
        ))}
      </div>

      {activeTab === 'billing' && (
        <>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.5rem', marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: 15, fontWeight: 700 }}>Billing Settings</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Billing month</label>
                <select style={inp} value={billingMonth} onChange={e => handleMonthChange(e.target.value)} disabled={autoPopulating}>
                  {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                {autoPopulating && <div style={{ fontSize: 11, color: '#2E6B8A', marginTop: 4 }}>⟳ Loading previous readings...</div>}
              </div>
              <div>
                <label style={lbl}>Rate per kWh ($)</label>
                <input style={inp} type='number' step='0.01' value={ratePerKwh} onChange={e => setRatePerKwh(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Minimum charge ($)</label>
                <input style={inp} type='number' step='0.01' value={minimumCharge} onChange={e => setMinimumCharge(e.target.value)} />
              </div>
            </div>
            <div>
              <label style={lbl}>Custom email message</label>
              <textarea style={{ ...inp, height: 80, resize: 'vertical' }} value={emailMessage} onChange={e => setEmailMessage(e.target.value)} />
              <button onClick={saveMessage} style={{ marginTop: 8, background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save Message</button>
            </div>
          </div>

          {campers.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '3rem 0' }}>No seasonal campers found.</div>
          ) : (
            <>
              <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff', minWidth: 960 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 60px 100px 100px 60px 90px 100px 110px 80px', gap: 6, padding: '10px 14px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
                    <div>Guest</div><div>Site</div><div>Prev reading</div><div>Curr reading</div><div>kWh</div><div>Calculated</div><div>Final amount</div><div>Balance</div><div>Skip</div>
                  </div>

                  {campers.map((row, i) => (
                    <div key={row.guest.id} style={{ borderBottom: i < campers.length - 1 ? '1px solid #f3f4f6' : 'none', background: row.skip ? '#f9fafb' : row.sent ? '#f0fdf4' : '#fff' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 60px 100px 100px 60px 90px 100px 110px 80px', gap: 6, padding: '10px 14px', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: row.skip ? '#9ca3af' : '#111827' }}>{row.guest.name}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>{row.guest.email || 'No email'}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>{row.guest.site_number}</div>
                        <input style={{ ...si, opacity: row.skip ? 0.4 : 1 }} type='number' placeholder='0' value={row.previousReading} disabled={row.skip || row.sent} onChange={e => updateReading(i, 'previousReading', e.target.value)} />
                        <input style={{ ...si, opacity: row.skip ? 0.4 : 1 }} type='number' placeholder='0' value={row.currentReading} disabled={row.skip || row.sent} onChange={e => updateReading(i, 'currentReading', e.target.value)} />
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{row.kwhUsed > 0 ? row.kwhUsed.toFixed(1) : '—'}</div>
                        <div style={{ fontSize: 13, color: '#6b7280' }}>{row.calculatedAmount > 0 ? '$' + (row.calculatedAmount / 100).toFixed(2) : '—'}</div>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 13 }}>$</span>
                          <input style={{ ...si, paddingLeft: 20, opacity: row.skip ? 0.4 : 1 }} type='number' step='0.01' placeholder='0.00' value={row.finalAmount} disabled={row.skip || row.sent} onChange={e => updateFinalAmount(i, e.target.value)} />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: row.folioBalance > 0 ? '#dc2626' : '#15803d' }}>
                          {row.folioBalance > 0 ? '$' + (row.folioBalance / 100).toFixed(2) : '✓ Current'}
                        </div>
                        <button onClick={() => toggleSkip(i)} disabled={row.sent} style={{ fontSize: 11, fontWeight: 600, border: '1px solid', borderColor: row.skip ? '#d1d5db' : '#fca5a5', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', background: row.skip ? '#f3f4f6' : '#fef2f2', color: row.skip ? '#6b7280' : '#dc2626' }}>
                          {row.skip ? 'Skipped' : 'Skip'}
                        </button>
                      </div>

                      {!row.skip && (
                        <div style={{ padding: '0 14px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          {/* Bill Electric — the ONLY charge-creating action; once a month, with confirm */}
                          {!row.sent ? (
                            <button onClick={() => prepareBill(i)}
                              disabled={row.sending || !row.finalAmount}
                              style={{ background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: !row.finalAmount ? 'default' : 'pointer', opacity: !row.finalAmount ? 0.5 : 1 }}>
                              {row.sending ? 'Billing...' : '⚡ Bill Electric'}
                            </button>
                          ) : (
                            <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>✓ Billed</span>
                          )}

                          {/* Send Statement — always available, emails the live ledger, NEVER creates a charge */}
                          {!row.editEmailMode ? (
                            <button onClick={() => resendBill(i)}
                              disabled={row.sending || !row.guest.email}
                              style={{ background: '#e8f2f7', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: (row.sending || !row.guest.email) ? 'default' : 'pointer', opacity: (row.sending || !row.guest.email) ? 0.6 : 1 }}>
                              {row.sending ? 'Sending...' : '✉ Send Statement'}
                            </button>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input type='email' value={row.editEmailValue}
                                onChange={e => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], editEmailValue: e.target.value }; return u })}
                                style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 10px', fontSize: 13, width: 200 }}
                                placeholder='Email address' />
                              <button onClick={() => resendBill(i, row.editEmailValue)}
                                style={{ background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                Send
                              </button>
                              <button onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], editEmailMode: false }; return u })}
                                style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 10px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>
                                Cancel
                              </button>
                            </div>
                          )}

                          {/* Secondary: send the statement to a corrected address */}
                          {!row.editEmailMode && (
                            <button onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], editEmailMode: true, editEmailValue: row.guest.email }; return u })}
                              style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', padding: '0 2px' }}>
                              wrong email?
                            </button>
                          )}

                          {row.folioBalance > 0 && !row.showPayment && (
                            <button onClick={() => { updatePaymentField(i, 'showPayment', 'true'); updatePaymentField(i, 'paymentAmount', (row.folioBalance / 100).toFixed(2)) }}
                              style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                              💵 Record Payment
                            </button>
                          )}

                          {row.lastPaymentRecorded && !row.receiptSent && !row.showReceiptConfirm && (
                            <button onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], showReceiptConfirm: true }; return u })}
                              style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                              🧾 Send Receipt
                            </button>
                          )}
                          {row.receiptSent && <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>✓ Receipt sent!</span>}

                          <button onClick={() => loadHistory(i)}
                            style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                            {row.showHistory ? 'Hide History' : '📋 View History'}
                          </button>

                          {row.error && <span style={{ fontSize: 12, color: '#dc2626' }}>{row.error}</span>}
                          {!row.guest.email && <span style={{ fontSize: 12, color: '#9ca3af' }}>No email on file</span>}
                        </div>
                      )}

                      {row.showBillConfirm && (() => {
                        const level = row.billGuard?.level ?? 'none'
                        const proposed = periodFromBillingMonth(billingMonth)
                        const span = row.billGuard?.span
                        // Palette by guard level: exact = red (fat-finger double-send),
                        // overlap = amber (days may bill twice), none = the normal blue.
                        const pal = level === 'exact'
                          ? { bg: '#fef2f2', border: '#fecaca', head: '#b91c1c' }
                          : level === 'overlap'
                          ? { bg: '#fffbeb', border: '#fde68a', head: '#92400e' }
                          : { bg: '#eff6ff', border: '#bfdbfe', head: '#1e40af' }
                        return (
                        <div style={{ margin: '0 14px 14px', background: pal.bg, border: `1px solid ${pal.border}`, borderRadius: 10, padding: '14px' }}>
                          {level === 'exact' && proposed && (
                            <div style={{ fontSize: 13, fontWeight: 700, color: pal.head, marginBottom: 6 }}>
                              ⚠ You already billed this exact period ({fmtMDY(proposed.start)}–{fmtMDY(proposed.end)}). Sending again creates a second identical charge.
                            </div>
                          )}
                          {level === 'overlap' && span && (
                            <div style={{ fontSize: 13, fontWeight: 700, color: pal.head, marginBottom: 6 }}>
                              ⚠ This overlaps {fmtMDY(span.start)}–{fmtMDY(span.end)} of an existing bill — those days may be billed twice.
                            </div>
                          )}
                          <div style={{ fontSize: 13, fontWeight: 700, color: pal.head, marginBottom: 6 }}>
                            Bill electric to {row.guest.name}?
                          </div>
                          <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
                            This creates a <strong>{billingMonth} electric charge of ${row.finalAmount}</strong> on their account and emails their statement to <strong>{row.guest.email}</strong>.
                          </div>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => { setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], showBillConfirm: false, billGuard: null }; return u }); sendBill(i) }}
                              style={{ background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                              {level === 'none' ? 'Yes, Bill Electric' : 'Bill anyway'}
                            </button>
                            <button onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], showBillConfirm: false, billGuard: null }; return u })}
                              style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                        )
                      })()}

                      {row.showReceiptConfirm && row.lastPaymentRecorded && (
                        <div style={{ margin: '0 14px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>Send payment receipt to {row.guest.name}?</div>
                          <div style={{ fontSize: 13, color: '#78350f', marginBottom: 12 }}>
                            A receipt for <strong>${(row.lastPaymentRecorded.amount / 100).toFixed(2)}</strong> will be sent to <strong>{row.guest.email}</strong>
                          </div>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => sendReceipt(i)} disabled={row.sendingReceipt}
                              style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                              {row.sendingReceipt ? 'Sending...' : 'Yes, Send Receipt'}
                            </button>
                            <button onClick={() => setCampers(prev => { const u = [...prev]; u[i] = { ...u[i], showReceiptConfirm: false }; return u })}
                              style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {row.showPayment && (
                        <div style={{ margin: '0 14px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', marginBottom: 10 }}>Record Payment — {row.guest.name}</div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div>
                              <label style={{ ...lbl, marginTop: 0 }}>Amount ($)</label>
                              <input style={{ ...si, width: 110 }} type='number' step='0.01' value={row.paymentAmount} onChange={e => updatePaymentField(i, 'paymentAmount', e.target.value)} />
                            </div>
                            <div>
                              <label style={{ ...lbl, marginTop: 0 }}>Method</label>
                              <select style={{ ...si, width: 120 }} value={row.paymentMethod} onChange={e => updatePaymentField(i, 'paymentMethod', e.target.value)}>
                                {allPaymentMethods(customMethods).map(m => <option key={m} value={m}>{methodLabel(m)}</option>)}
                                <option value='other'>Other</option>
                              </select>
                              {row.paymentMethod === 'card' && (
                                <div style={{ fontSize: 11, color: '#15803d', marginTop: 4, fontStyle: 'italic' }}>
                                  → Will open guest folio to charge terminal
                                </div>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 120 }}>
                              <label style={{ ...lbl, marginTop: 0 }}>Note (optional)</label>
                              <input style={si} placeholder='e.g. Check #1042' value={row.paymentNote} onChange={e => updatePaymentField(i, 'paymentNote', e.target.value)} />
                            </div>
                            <button onClick={() => {
                              if (row.paymentMethod === 'card') {
                                window.location.href = `/admin/folio/guest/${row.guest.id}`;
                              } else {
                                recordPayment(i);
                              }
                            }} disabled={row.savingPayment || !row.paymentAmount}
                              style={{ background: '#15803d', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', height: 34 }}>
                              {row.savingPayment ? 'Saving...' : 'Save Payment'}
                            </button>
                            <button onClick={() => updatePaymentField(i, 'showPayment', false as unknown as string)}
                              style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer', height: 34 }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {row.showHistory && (
                        <div style={{ margin: '0 14px 14px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#374151', background: '#f1f5f9', borderBottom: '1px solid #e5e7eb' }}>
                            Billing History — {row.guest.name} · Site {row.guest.site_number}
                          </div>
                          {row.readings.length === 0 ? (
                            <div style={{ padding: '1rem', fontSize: 13, color: '#9ca3af' }}>No billing history yet.</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ background: '#f9fafb' }}>
                                  {['Month', 'Prev', 'Curr', 'kWh', 'Rate', 'Billed', 'Date', ''].map(h => (
                                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {row.readings.map((r, ri) => {
                                  const isVoided = r.voided === true
                                  return (
                                  <tr key={r.id} style={{ borderBottom: ri < row.readings.length - 1 ? '1px solid #f3f4f6' : 'none', background: isVoided ? '#f9fafb' : (ri % 2 === 0 ? '#fff' : '#fafafa'), opacity: isVoided ? 0.6 : 1 }}>
                                    <td style={{ padding: '8px 12px', fontWeight: 600, color: isVoided ? '#9ca3af' : '#111827', textDecoration: isVoided ? 'line-through' : 'none' }}>{r.billing_month}{isVoided && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 4px', textDecoration: 'none' }}>VOIDED</span>}</td>
                                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{Number(r.previous_reading).toLocaleString()}</td>
                                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{Number(r.current_reading).toLocaleString()}</td>
                                    <td style={{ padding: '8px 12px', color: '#374151', fontWeight: 600 }}>{Number(r.kwh_used).toFixed(1)}</td>
                                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>${Number(r.rate_per_kwh).toFixed(3)}</td>
                                    <td style={{ padding: '8px 12px', fontWeight: 700, color: isVoided ? '#9ca3af' : '#15803d', textDecoration: isVoided ? 'line-through' : 'none' }}>${(r.final_amount / 100).toFixed(2)}</td>
                                    <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                      {isVoided ? (
                                        <span title={`Voided${r.voided_by ? ' by ' + r.voided_by : ''}${r.reason ? ' · ' + r.reason : ''}${r.voided_at ? ' · ' + new Date(r.voided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : ''}`} style={{ fontSize: 11, color: '#9ca3af', cursor: 'help' }}>voided{r.voided_by ? ' · ' + r.voided_by : ''}</span>
                                      ) : (
                                        <button onClick={() => openVoid(i, r)} style={{ fontSize: 11, fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, padding: '3px 9px', cursor: 'pointer' }}>Void</button>
                                      )}
                                    </td>
                                  </tr>
                                  )
                                })}
                              </tbody>
                              <tfoot>
                                <tr style={{ background: '#f0fdf4', borderTop: '2px solid #bbf7d0' }}>
                                  <td colSpan={5} style={{ padding: '8px 12px', fontWeight: 700, fontSize: 12, color: '#15803d' }}>Total billed (all time)</td>
                                  <td style={{ padding: '8px 12px', fontWeight: 800, color: '#15803d' }}>${(row.readings.filter(r => !r.voided).reduce((s, r) => s + r.final_amount, 0) / 100).toFixed(2)}</td>
                                  <td />
                                  <td />
                                </tr>
                              </tfoot>
                            </table>
                          )}
                          {row.folioPayments.length > 0 && (
                            <div style={{ borderTop: '1px solid #e5e7eb' }}>
                              <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', background: '#f9fafb' }}>Payments received</div>
                              {row.folioPayments.map((p, pi) => (
                                <div key={p.id} style={{ borderBottom: pi < row.folioPayments.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 14px', fontSize: 12, alignItems: 'center' }}>
                                    <div>
                                      <span style={{ fontWeight: 600, color: '#374151', textTransform: 'capitalize' }}>{p.method}</span>
                                      {p.note && <span style={{ color: '#9ca3af', marginLeft: 8 }}>{p.note}</span>}
                                      <span style={{ color: '#9ca3af', marginLeft: 8 }}>{new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                                      {p.receipt_sent_at
                                        ? <span style={{ marginLeft: 10, fontSize: 11, color: '#15803d' }}>🧾 Receipt sent {new Date(p.receipt_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                                        : <span style={{ marginLeft: 10, fontSize: 11, color: '#9ca3af' }}>No receipt sent</span>
                                      }
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                      <span style={{ fontWeight: 700, color: '#15803d' }}>-${((p.amount - (p.surcharge_amount || 0)) / 100).toFixed(2)}</span>
                                      <button
                                        onClick={() => setCampers(prev => {
                                          const u = [...prev]
                                          u[i] = { ...u[i], lastPaymentRecorded: p, showReceiptConfirm: true, receiptSent: false }
                                          return u
                                        })}
                                        style={{ fontSize: 11, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}>
                                        {p.receipt_sent_at ? '↩ Re-send' : '🧾 Send'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Balance due summary */}
                          <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px solid #e5e7eb', background: row.folioBalance < 0 ? '#f0fdf4' : row.folioBalance === 0 ? '#f0fdf4' : '#fef2f2' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: row.folioBalance < 0 ? '#15803d' : row.folioBalance === 0 ? '#15803d' : '#dc2626' }}>
                              {row.folioBalance < 0 ? 'Credit on Account' : row.folioBalance === 0 ? '✓ Paid in Full' : 'Balance Due'}
                            </span>
                            <span style={{ fontSize: 15, fontWeight: 800, color: row.folioBalance < 0 ? '#15803d' : row.folioBalance === 0 ? '#15803d' : '#dc2626' }}>
                              {row.folioBalance < 0 ? '-$' + (Math.abs(row.folioBalance) / 100).toFixed(2) : '$' + (row.folioBalance / 100).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 14, color: '#6b7280' }}>{readyToSend} bill{readyToSend !== 1 ? 's' : ''} ready to send</span>
                <button onClick={sendAllBills} disabled={sendingAll || readyToSend === 0}
                  style={{ background: readyToSend > 0 ? '#2E6B8A' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 28px', fontWeight: 700, fontSize: 15, cursor: readyToSend > 0 ? 'pointer' : 'default' }}>
                  {sendingAll ? 'Sending all...' : 'Send All Bills'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'history' && (
        <div>
          {campers.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '3rem 0' }}>No seasonal campers found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {campers.map((row) => (
                <GuestAccountCard key={row.guest.id} guest={row.guest} folioBalance={row.folioBalance} />
              ))}
            </div>
          )}
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
      supabase.from('electric_readings').select('*').eq('guest_id', guest.id).order('created_at', { ascending: false }),
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

const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 8 }
const inp: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' }
const si: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' }
