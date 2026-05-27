'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Reservation = {
  id: string
  arrival_date: string
  departure_date: string
  total_price: number
  status: string
  site_id: string
  sites: { site_number: string; site_type: string }
}

type PaymentRow = {
  id: string
  paid_at: string
  method: string
  amount: number
  surcharge_amount: number
  status: string
  folio_id: string
  folios: {
    id: string
    guest_name: string
    folio_type: string
    reservation_id: string | null
  }
}

type LineItemRow = {
  folio_id: string
  category: string
  line_total: number
  description: string
  quantity: number
  unit_price: number
}

const COLORS = ['#12c9e5', '#C4873C', '#2D6A4F', '#9B59B6', '#E74C3C']

export default function ReportsPage() {
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<'overview' | 'reservations' | 'transactions'>('overview')
  const [posEnabled, setPosEnabled] = useState(false)
  const [reportBy, setReportBy] = useState<'payment_date' | 'stay_date'>('payment_date')

  // Shared date range
  const [dateRange, setDateRange] = useState('this_year')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  // Reservations tab
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [cancelledCount, setCancelledCount] = useState(0)
  const [resPayments, setResPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)

  // Guest account (electric + other seasonal charges)
  const [guestAccountPayments, setGuestAccountPayments] = useState<PaymentRow[]>([])
  const [guestAccountLineItems, setGuestAccountLineItems] = useState<LineItemRow[]>([])

  // Transactions tab
  const [transactions, setTransactions] = useState<PaymentRow[]>([])
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [txSearch, setTxSearch] = useState('')
  const [txMethodFilter, setTxMethodFilter] = useState('all')
  const [txTypeFilter, setTxTypeFilter] = useState('all')

  useEffect(() => { checkPosEnabled() }, [])
  useEffect(() => { fetchAll() }, [dateRange, reportBy])
  useEffect(() => {
    if (dateRange !== 'custom') fetchAll()
  }, [dateRange])

  async function checkPosEnabled() {
    const { data } = await supabase.from('settings').select('pos_enabled').single()
    if (data?.pos_enabled) setPosEnabled(true)
  }

  function getDateBounds(range: string, customS: string, customE: string) {
    const now = new Date()
    if (range === 'custom' && customS && customE) return { start: customS, end: customE }
    if (range === 'today') {
      const d = now.toISOString().split('T')[0]
      return { start: d, end: d }
    }
    if (range === 'this_week') {
      const day = now.getDay()
      const mon = new Date(now)
      mon.setDate(now.getDate() - day + (day === 0 ? -6 : 1))
      return { start: mon.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
    }
    if (range === 'this_month') return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
    }
    if (range === 'last_month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: first.toISOString().split('T')[0], end: last.toISOString().split('T')[0] }
    }
    if (range === 'last_year') return {
      start: new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0],
      end: new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0],
    }
    // this_year default
    return {
      start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
    }
  }

  // For stay-date mode: extend end to cover the full period (e.g. all of this year)
  // so future reservations are included. Payments still use today as the cutoff.
  function getStayDateEnd(range: string, customE: string) {
    const now = new Date()
    if (range === 'custom' && customE) return customE
    if (range === 'this_month') return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
    if (range === 'last_month') return new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
    if (range === 'this_year') return new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0]
    if (range === 'last_year') return new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0]
    if (range === 'this_week') {
      const day = now.getDay()
      const sun = new Date(now)
      sun.setDate(now.getDate() + (day === 0 ? 0 : 7 - day))
      return sun.toISOString().split('T')[0]
    }
    return now.toISOString().split('T')[0]
  }

  async function fetchAll() {
    setLoading(true)
    setTxLoading(true)
    const { start, end } = getDateBounds(dateRange, customStart, customEnd)
    const startISO = start + 'T00:00:00'
    const endISO = end + 'T23:59:59'

    // ── Reservations by stay date ──────────────────────────────────────────
    const stayEnd = getStayDateEnd(dateRange, customEnd)

    const { data: resData } = await supabase
      .from('reservations')
      .select('id, arrival_date, departure_date, total_price, status, site_id, sites(site_number, site_type)')
      .neq('status', 'cancelled')
      .gte('arrival_date', start)
      .lte('arrival_date', stayEnd)
      .order('arrival_date')

    const { data: cancelledData } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'cancelled')
      .gte('arrival_date', start)
      .lte('arrival_date', stayEnd)

    // ── All payments (reservation + POS) in date range ────────────────────
    const { data: pmtData } = await supabase
      .from('folio_payments')
      .select(`
        id, paid_at, method, amount, surcharge_amount, status, folio_id,
        folios ( id, guest_name, folio_type, reservation_id )
      `)
      .eq('status', 'completed')
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    // Line items for category breakdown
    if (pmtData && pmtData.length > 0) {
      const folioIds = [...new Set(pmtData.map((t: any) => t.folio_id))]
      const { data: liData } = await supabase
        .from('folio_line_items')
        .select('folio_id, category, line_total, description, quantity, unit_price')
        .in('folio_id', folioIds)
      if (liData) setLineItems(liData as any)
    } else {
      setLineItems([])
    }

    // ── Guest account payments (electric + other seasonal charges) ──────────
    const { data: gaPmtData } = await supabase
      .from('folio_payments')
      .select(`
        id, paid_at, method, amount, surcharge_amount, status, folio_id,
        folios ( id, guest_name, folio_type, reservation_id )
      `)
      .eq('status', 'completed')
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .eq('folios.folio_type', 'guest_account')

    // Line items for guest account folios to break out electric vs other
    if (gaPmtData && gaPmtData.length > 0) {
      const gaFolioIds = [...new Set(gaPmtData.map((t: any) => t.folio_id))]
      const { data: gaLiData } = await supabase
        .from('folio_line_items')
        .select('folio_id, category, line_total, description, quantity, unit_price, charged_at')
        .in('folio_id', gaFolioIds)
        .gte('charged_at', startISO)
        .lte('charged_at', endISO)
      if (gaLiData) setGuestAccountLineItems(gaLiData as any)
    } else {
      setGuestAccountLineItems([])
    }

    if (resData) setReservations(resData as any)
    if (cancelledData !== null) setCancelledCount((cancelledData as any)?.length || 0)
    if (pmtData) {
      const all = pmtData as any[]
      setResPayments(all.filter(p => p.folios?.reservation_id !== null))
      setTransactions(all)
    }
    setGuestAccountPayments((gaPmtData as any) || [])

    setLoading(false)
    setTxLoading(false)
  }

  // ── Computed: reservation revenue ─────────────────────────────────────────
  // Stay-date mode: sum total_price from reservations table
  const stayDateRevenue = reservations.reduce((s, r) => s + (r.total_price || 0), 0) / 100

  // Payment-date mode: sum actual payments on reservation folios
  const paymentDateResRevenue = resPayments.reduce((s, p) => s + (p.amount || 0) - (p.surcharge_amount || 0), 0) / 100

  const resRevenue = reportBy === 'payment_date' ? paymentDateResRevenue : stayDateRevenue

  // ── Computed: POS / walk-up revenue ──────────────────────────────────────
  const posPayments = transactions.filter(t => (t.folios as any)?.reservation_id === null)
  const posRevenue = posPayments.reduce((s, p) => s + (p.amount || 0) - (p.surcharge_amount || 0), 0) / 100

  // ── Computed: guest account revenue broken out by type ──────────────────
  // Electric = line items whose description contains 'Electric'
  // Other = everything else on guest_account folios (visitors, golf, store, etc.)
  const electricLineItems = guestAccountLineItems.filter(li => li.description.toLowerCase().includes('electric'))
  const otherGuestLineItems = guestAccountLineItems.filter(li => !li.description.toLowerCase().includes('electric'))
  const electricRevenue = electricLineItems.reduce((s, li) => s + (li.line_total || 0), 0) / 100
  const otherGuestRevenue = otherGuestLineItems.reduce((s, li) => s + (li.line_total || 0), 0) / 100

  // Guest account category breakdown for donut chart
  const guestCategoryMap: { [key: string]: number } = {}
  guestAccountLineItems.forEach(li => {
    const cat = li.description.toLowerCase().includes('electric') ? 'Electric' : (li.category || 'Other')
    guestCategoryMap[cat] = (guestCategoryMap[cat] || 0) + (li.line_total || 0) / 100
  })
  const guestCategoryData = Object.entries(guestCategoryMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  // ── Computed: combined overview ───────────────────────────────────────────
  const totalCombined = resRevenue + (posEnabled ? posRevenue : 0) + electricRevenue + otherGuestRevenue
  const totalCash = transactions.filter(t => t.method === 'cash').reduce((s, t) => s + t.amount, 0) / 100
  const totalCard = transactions.filter(t => t.method === 'card').reduce((s, t) => s + t.amount, 0) / 100
  const totalCheck = transactions.filter(t => t.method === 'check').reduce((s, t) => s + t.amount, 0) / 100
  const totalSurcharge = transactions.reduce((s, t) => s + (t.surcharge_amount || 0), 0) / 100

  // ── Computed: monthly chart ───────────────────────────────────────────────
  const monthlyMap: { [key: string]: { label: string; value: number } } = {}

  if (reportBy === 'stay_date') {
    reservations.forEach(r => {
      const d = new Date(r.arrival_date + 'T12:00:00')
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      if (!monthlyMap[key]) monthlyMap[key] = { label, value: 0 }
      monthlyMap[key].value += (r.total_price || 0) / 100
    })
  } else {
    transactions.forEach(t => {
      if (!t.paid_at) return
      const d = new Date(t.paid_at)
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      if (!monthlyMap[key]) monthlyMap[key] = { label, value: 0 }
      monthlyMap[key].value += ((t.amount || 0) - (t.surcharge_amount || 0)) / 100
    })
  }
  const monthlyData = Object.entries(monthlyMap).sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)

  // ── Computed: site type breakdown ─────────────────────────────────────────
  const siteTypeMap: { [key: string]: number } = {}
  reservations.forEach(r => {
    const type = (r.sites as any)?.site_type || 'unknown'
    const label = ({ rv_site: 'RV Sites', cabin: 'Cabins', tent: 'Tent Sites' } as any)[type] || type
    siteTypeMap[label] = (siteTypeMap[label] || 0) + (r.total_price || 0) / 100
  })
  const siteTypeData = Object.entries(siteTypeMap).map(([name, value]) => ({ name, value }))

  // ── Computed: top sites ───────────────────────────────────────────────────
  const siteMap: { [key: string]: { name: string; revenue: number; bookings: number } } = {}
  reservations.forEach(r => {
    const n = (r.sites as any)?.site_number || 'Unknown'
    if (!siteMap[n]) siteMap[n] = { name: n, revenue: 0, bookings: 0 }
    siteMap[n].revenue += (r.total_price || 0) / 100
    siteMap[n].bookings += 1
  })
  const topSites = Object.values(siteMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5)

  // ── Computed: avg stay ────────────────────────────────────────────────────
  const avgStay = reservations.length > 0
    ? reservations.reduce((sum, r) => {
        const nights = Math.round((new Date(r.departure_date).getTime() - new Date(r.arrival_date).getTime()) / 86400000)
        return sum + nights
      }, 0) / reservations.length
    : 0

  // ── Computed: transactions tab ────────────────────────────────────────────
  const filteredTransactions = transactions.filter(t => {
    const folio = t.folios as any
    const matchSearch = txSearch === '' ||
      (folio?.guest_name || '').toLowerCase().includes(txSearch.toLowerCase())
    const matchMethod = txMethodFilter === 'all' || t.method === txMethodFilter
    const matchType = txTypeFilter === 'all' ||
      (txTypeFilter === 'reservation' && folio?.reservation_id !== null) ||
      (txTypeFilter === 'walkin' && folio?.reservation_id === null)
    return matchSearch && matchMethod && matchType
  })

  // Group transactions by day for Square-style display
  const txByDay: { [day: string]: PaymentRow[] } = {}
  filteredTransactions.forEach(t => {
    if (!t.paid_at) return
    const day = new Date(t.paid_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    if (!txByDay[day]) txByDay[day] = []
    txByDay[day].push(t)
  })

  // ── Computed: category + top products ────────────────────────────────────
  const categoryMap: { [key: string]: number } = {}
  lineItems.forEach(li => {
    const cat = li.category || 'Uncategorized'
    categoryMap[cat] = (categoryMap[cat] || 0) + (li.line_total || 0) / 100
  })
  const categoryData = Object.entries(categoryMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  const productMap: { [key: string]: { name: string; revenue: number; qty: number } } = {}
  lineItems.forEach(li => {
    const name = li.description || 'Unknown'
    if (!productMap[name]) productMap[name] = { name, revenue: 0, qty: 0 }
    productMap[name].revenue += (li.line_total || 0) / 100
    productMap[name].qty += li.quantity || 0
  })
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5)

  // ── Chart components ──────────────────────────────────────────────────────
  function BarChart({ data }: { data: { label: string; value: number }[] }) {
    if (data.length === 0) return <p className="text-gray-400 text-center py-8">No data for selected period</p>
    const max = Math.max(...data.map(d => d.value), 1)
    const chartH = 180, barW = 32, gap = 8, leftPad = 48
    const totalW = leftPad + data.length * (barW + gap) + 16
    return (
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg width={totalW} height={chartH + 40} style={{ display: 'block' }}>
          {[0, 0.5, 1].map((pct, i) => {
            const y = 8 + (1 - pct) * chartH
            const val = max * pct
            return (
              <g key={i}>
                <line x1={leftPad - 4} y1={y} x2={totalW - 8} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                <text x={leftPad - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#9CA3AF">
                  ${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)}
                </text>
              </g>
            )
          })}
          {data.map((d, i) => {
            const barH = Math.max(3, (d.value / max) * chartH)
            const x = leftPad + i * (barW + gap)
            const y = 8 + chartH - barH
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={barH} fill="var(--accent-color)" rx={4} />
                <text x={x + barW / 2} y={chartH + 22} textAnchor="middle" fontSize={10} fill="#6B7280">{d.label}</text>
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={9} fill="#374151">
                  ${d.value >= 1000 ? (d.value / 1000).toFixed(1) + 'k' : d.value.toFixed(0)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    )
  }

  function DonutChart({ data }: { data: { name: string; value: number }[] }) {
    if (data.length === 0) return <p className="text-gray-400 text-center py-8">No data</p>
    const total = data.reduce((s, d) => s + d.value, 0)
    const cx = 80, cy = 80, r = 65, inner = 38
    let angle = -Math.PI / 2
    const slices = data.map((d, i) => {
      const sweep = (d.value / total) * 2 * Math.PI
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle)
      angle += sweep
      const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle)
      const ix1 = cx + inner * Math.cos(angle - sweep), iy1 = cy + inner * Math.sin(angle - sweep)
      const ix2 = cx + inner * Math.cos(angle), iy2 = cy + inner * Math.sin(angle)
      const large = sweep > Math.PI ? 1 : 0
      return {
        path: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`,
        color: COLORS[i % COLORS.length], ...d,
      }
    })
    return (
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <svg width={160} height={160} style={{ flexShrink: 0 }}>
          {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11} fill="#374151" fontWeight="bold">Total</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize={11} fill="#6B7280">
            ${total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total.toFixed(0)}
          </text>
        </svg>
        <div className="space-y-2 flex-1 w-full">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm text-gray-700 truncate">{s.name}</span>
              </div>
              <span className="text-sm font-medium text-gray-900 shrink-0">
                ${s.value.toFixed(0)} ({((s.value / total) * 100).toFixed(0)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Shared header controls ────────────────────────────────────────────────
  const dateControls = (
    <div className="flex flex-wrap gap-2 items-center">
      <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={dateRange} onChange={e => setDateRange(e.target.value)}>
        <option value="today">Today</option>
        <option value="this_week">This Week</option>
        <option value="this_month">This Month</option>
        <option value="last_month">Last Month</option>
        <option value="this_year">This Year</option>
        <option value="last_year">Last Year</option>
        <option value="custom">Custom Range</option>
      </select>
      {dateRange === 'custom' && (
        <>
          <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={customStart} onChange={e => setCustomStart(e.target.value)} />
          <span className="text-gray-400">to</span>
          <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
          <button onClick={fetchAll} className="px-3 py-2 rounded-lg text-white text-sm" style={{ backgroundColor: 'var(--accent-color)' }}>Go</button>
        </>
      )}
    </div>
  )

  const reportByToggle = (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-500 font-medium whitespace-nowrap">Report by:</span>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        {(['payment_date', 'stay_date'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setReportBy(mode)}
            className="px-3 py-1.5 text-xs font-medium transition-colors"
            style={reportBy === mode
              ? { background: 'var(--accent-color)', color: '#fff' }
              : { background: '#fff', color: '#6b7280' }
            }
          >
            {mode === 'payment_date' ? 'Payment Date' : 'Stay Date'}
          </button>
        ))}
      </div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <div className="flex flex-wrap gap-3 items-center">
          {reportByToggle}
          {dateControls}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['overview', 'reservations', ...(posEnabled ? ['transactions'] : [])] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className="px-4 py-2 text-sm font-medium capitalize rounded-t-lg transition-colors"
            style={activeTab === tab
              ? { backgroundColor: 'var(--accent-color)', color: '#fff', borderBottom: '2px solid var(--accent-color)' }
              : { color: '#6B7280' }
            }
          >
            {tab === 'overview' ? 'Overview' : tab === 'reservations' ? 'Reservations' : 'Transactions'}
          </button>
        ))}
      </div>

      {loading ? <div className="p-6 text-gray-500">Loading reports...</div> : (
        <>

          {/* ── OVERVIEW TAB ── */}
          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
                {[
                  { label: 'Total Collected', value: '$' + totalCombined.toFixed(2), sub: reportBy === 'payment_date' ? 'all payments received' : 'based on stay dates' },
                  { label: 'Reservation Revenue', value: '$' + resRevenue.toFixed(2), sub: reservations.length + ' reservations' },
                  ...(posEnabled ? [{ label: 'POS Revenue', value: '$' + posRevenue.toFixed(2), sub: posPayments.length + ' transactions' }] : []),
                  { label: 'Electric Billing', value: '$' + electricRevenue.toFixed(2), sub: 'seasonal electric' },
                  ...(otherGuestRevenue > 0 ? [{ label: 'Other Guest Charges', value: '$' + otherGuestRevenue.toFixed(2), sub: 'visitors, golf, store, etc.' }] : []),
                  { label: 'Cash + Check', value: '$' + (totalCash + totalCheck).toFixed(2), sub: 'non-card' },
                  { label: 'Card', value: '$' + totalCard.toFixed(2), sub: totalSurcharge > 0 ? `incl. $${totalSurcharge.toFixed(2)} fees` : 'card payments' },
                ].map((stat, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500">{stat.label}</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{stat.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>
                  </div>
                ))}
              </div>

              {cancelledCount > 0 && (
                <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                  {cancelledCount} cancelled reservation{cancelledCount !== 1 ? 's' : ''} in this period — excluded from revenue totals
                </div>
              )}

              <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">
                  {reportBy === 'payment_date' ? 'Revenue by Payment Date' : 'Revenue by Stay Date'}
                </h2>
                <p className="text-xs text-gray-400 mb-4">
                  {reportBy === 'payment_date' ? 'Amounts shown when payment was received' : 'Amounts attributed to arrival month'}
                </p>
                <BarChart data={monthlyData} />
              </div>

              {guestCategoryData.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6 mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">Guest Account Revenue</h2>
                  <p className="text-xs text-gray-400 mb-4">Electric billing and other charges on seasonal guest accounts</p>
                  <DonutChart data={guestCategoryData} />
                </div>
              )}
            </>
          )}

          {/* ── RESERVATIONS TAB ── */}
          {activeTab === 'reservations' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                {[
                  { label: 'Reservation Revenue', value: '$' + resRevenue.toFixed(2), sub: reportBy === 'payment_date' ? 'payments received' : 'based on stay dates' },
                  { label: 'Total Bookings', value: reservations.length.toString(), sub: 'active reservations' },
                  { label: 'Avg Stay', value: avgStay.toFixed(1) + ' nights', sub: 'per booking' },
                  { label: 'Cancelled', value: cancelledCount.toString(), sub: 'in this period' },
                ].map((stat, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500">{stat.label}</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{stat.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue by Site Type</h2>
                  <DonutChart data={siteTypeData} />
                </div>
                <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Earning Sites</h2>
                  {topSites.length === 0 ? <p className="text-gray-400 text-center py-8">No data</p> : (
                    <div className="space-y-3">
                      {topSites.map((site, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs flex items-center justify-center font-medium">{i + 1}</span>
                            <span className="text-sm font-medium text-gray-900">{site.name}</span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-900">${site.revenue.toFixed(2)}</p>
                            <p className="text-xs text-gray-400">{site.bookings} booking{site.bookings !== 1 ? 's' : ''}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Reservation list */}
              <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Reservations</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: '480px' }}>
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 text-gray-500 font-medium">Site</th>
                        <th className="text-left py-2 text-gray-500 font-medium">Arrival</th>
                        <th className="text-left py-2 text-gray-500 font-medium">Departure</th>
                        <th className="text-left py-2 text-gray-500 font-medium">Nights</th>
                        <th className="text-right py-2 text-gray-500 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reservations.map(r => {
                        const nights = Math.round((new Date(r.departure_date).getTime() - new Date(r.arrival_date).getTime()) / 86400000)
                        return (
                          <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/admin/reservations/${r.id}`)}>
                            <td className="py-2 text-gray-900">{(r.sites as any)?.site_number || '—'}</td>
                            <td className="py-2 text-gray-600">{r.arrival_date}</td>
                            <td className="py-2 text-gray-600">{r.departure_date}</td>
                            <td className="py-2 text-gray-600">{nights}</td>
                            <td className="py-2 text-right font-medium text-gray-900">${((r.total_price || 0) / 100).toFixed(2)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── TRANSACTIONS TAB ── */}
          {activeTab === 'transactions' && posEnabled && (
            <>
              {/* Filters */}
              <div className="flex flex-wrap gap-2 items-center mb-6">
                <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={txMethodFilter} onChange={e => setTxMethodFilter(e.target.value)}>
                  <option value="all">All Methods</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="check">Check</option>
                </select>
                <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={txTypeFilter} onChange={e => setTxTypeFilter(e.target.value)}>
                  <option value="all">All Types</option>
                  <option value="reservation">Reservation</option>
                  <option value="walkin">Walk-Up</option>
                </select>
                <input
                  type="text"
                  placeholder="Search guest name..."
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  style={{ minWidth: 180 }}
                  value={txSearch}
                  onChange={e => setTxSearch(e.target.value)}
                />
                <span className="text-sm text-gray-400">{filteredTransactions.length} result{filteredTransactions.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'Total Collected', value: '$' + (filteredTransactions.reduce((s, t) => s + t.amount, 0) / 100).toFixed(2), sub: 'all methods' },
                  { label: 'Cash', value: '$' + (filteredTransactions.filter(t => t.method === 'cash').reduce((s, t) => s + t.amount, 0) / 100).toFixed(2), sub: '' },
                  { label: 'Card', value: '$' + (filteredTransactions.filter(t => t.method === 'card').reduce((s, t) => s + t.amount, 0) / 100).toFixed(2), sub: '' },
                  { label: 'Check', value: '$' + (filteredTransactions.filter(t => t.method === 'check').reduce((s, t) => s + t.amount, 0) / 100).toFixed(2), sub: '' },
                ].map((stat, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500">{stat.label}</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{stat.value}</p>
                    {stat.sub && <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>}
                  </div>
                ))}
              </div>

              {/* Category + products */}
              {categoryData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Sales by Category</h2>
                    <DonutChart data={categoryData} />
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Products</h2>
                    <div className="space-y-3">
                      {topProducts.map((p, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs flex items-center justify-center font-medium">{i + 1}</span>
                            <span className="text-sm font-medium text-gray-900">{p.name}</span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-900">${p.revenue.toFixed(2)}</p>
                            <p className="text-xs text-gray-400">qty {p.qty}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Transaction log — Square style, grouped by day */}
              <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Transaction Log</h2>
                {filteredTransactions.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No transactions found</p>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(txByDay).map(([day, dayTx]) => {
                      const dayTotal = dayTx.reduce((s, t) => s + t.amount, 0) / 100
                      return (
                        <div key={day}>
                          <div className="flex items-center justify-between mb-2 pb-1 border-b border-gray-100">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{day}</span>
                            <span className="text-xs font-semibold text-gray-700">${dayTotal.toFixed(2)}</span>
                          </div>
                          <div className="space-y-1">
                            {dayTx.map(t => {
                              const folio = t.folios as any
                              const timeStr = t.paid_at ? new Date(t.paid_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
                              const isWalkup = folio?.reservation_id === null
                              return (
                                <div
                                  key={t.id}
                                  className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 cursor-pointer"
                                  onClick={() => router.push(`/admin/folio/${t.folio_id}`)}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                      t.method === 'cash' ? 'bg-yellow-400' :
                                      t.method === 'card' ? 'bg-purple-400' : 'bg-gray-400'
                                    }`} />
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium text-gray-900 truncate">
                                        {folio?.guest_name || 'Walk-up Guest'}
                                        {isWalkup && <span className="ml-2 text-xs text-blue-600 font-normal">Walk-up</span>}
                                      </div>
                                      <div className="text-xs text-gray-400">{timeStr} · {t.method}</div>
                                    </div>
                                  </div>
                                  <div className="text-sm font-semibold text-gray-900 flex-shrink-0 ml-3">
                                    ${(t.amount / 100).toFixed(2)}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
