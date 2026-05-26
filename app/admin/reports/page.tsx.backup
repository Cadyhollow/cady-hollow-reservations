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

type AddonRevenue = {
  quantity: number
  price: number
  addons: { name: string }
}

type TransactionRow = {
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

  // Tab state
  const [activeTab, setActiveTab] = useState<'reservations' | 'transactions'>('reservations')
  const [posEnabled, setPosEnabled] = useState(false)

  // Reservations tab state
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [addonRevenue, setAddonRevenue] = useState<AddonRevenue[]>([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('this_year')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  // Transactions tab state
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [txDateRange, setTxDateRange] = useState('today')
  const [txCustomStart, setTxCustomStart] = useState('')
  const [txCustomEnd, setTxCustomEnd] = useState('')
  const [txSearch, setTxSearch] = useState('')
  const [txMethodFilter, setTxMethodFilter] = useState('all')
  const [txTypeFilter, setTxTypeFilter] = useState('all')

  useEffect(() => {
    checkPosEnabled()
  }, [])

  useEffect(() => {
    fetchReservationData()
  }, [dateRange])

  useEffect(() => {
    if (posEnabled && activeTab === 'transactions') {
      fetchTransactionData()
    }
  }, [activeTab, posEnabled, txDateRange])

  async function checkPosEnabled() {
    const { data } = await supabase.from('settings').select('pos_enabled').single()
    if (data?.pos_enabled) setPosEnabled(true)
  }

  // ─── Date range helper ───────────────────────────────────────────────────────
  function getDateBounds(range: string, customS: string, customE: string) {
    const now = new Date()
    if (range === 'custom' && customS && customE) {
      return { start: customS, end: customE }
    }
    if (range === 'today') {
      const d = now.toISOString().split('T')[0]
      return { start: d, end: d }
    }
    if (range === 'this_week') {
      const day = now.getDay()
      const mon = new Date(now); mon.setDate(now.getDate() - day + (day === 0 ? -6 : 1))
      return { start: mon.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
    }
    if (range === 'this_month') {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
        end: now.toISOString().split('T')[0],
      }
    }
    if (range === 'last_month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: first.toISOString().split('T')[0], end: last.toISOString().split('T')[0] }
    }
    if (range === 'this_year') {
      return {
        start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0],
        end: now.toISOString().split('T')[0],
      }
    }
    if (range === 'last_year') {
      return {
        start: new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0],
        end: new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0],
      }
    }
    return { start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
  }

  // ─── Reservations data ───────────────────────────────────────────────────────
  async function fetchReservationData() {
    setLoading(true)
    const { start } = getDateBounds(dateRange, customStart, customEnd)

    const { data: resData } = await supabase
      .from('reservations')
      .select('id, arrival_date, departure_date, total_price, status, site_id, sites(site_number, site_type)')
      .neq('status', 'cancelled')
      .gte('arrival_date', start)
      .order('arrival_date')

    const { data: addonData } = await supabase
      .from('reservation_addons')
      .select('quantity, price, addons(name)')

    if (resData) setReservations(resData as any)
    if (addonData) setAddonRevenue(addonData as any)
    setLoading(false)
  }

  // ─── Transactions data ───────────────────────────────────────────────────────
  async function fetchTransactionData() {
    setTxLoading(true)
    const { start, end } = getDateBounds(txDateRange, txCustomStart, txCustomEnd)

    const startISO = start + 'T00:00:00'
    const endISO = end + 'T23:59:59'

    const { data: txData } = await supabase
      .from('folio_payments')
      .select(`
        id, paid_at, method, amount, surcharge_amount, status, folio_id,
        folios ( id, guest_name, folio_type, reservation_id )
      `)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    // Get line items for folios in this period for category breakdown
    if (txData && txData.length > 0) {
      const folioIds = [...new Set(txData.map((t: any) => t.folio_id))]
      const { data: liData } = await supabase
        .from('folio_line_items')
        .select('folio_id, category, line_total, description, quantity, unit_price')
        .in('folio_id', folioIds)
      if (liData) setLineItems(liData as any)
    } else {
      setLineItems([])
    }

    if (txData) setTransactions(txData as any)
    setTxLoading(false)
  }

  // ─── Transaction computed values ─────────────────────────────────────────────
  const filteredTransactions = transactions.filter(t => {
    const folio = t.folios as any
    const matchSearch = txSearch === '' ||
      (folio?.guest_name || '').toLowerCase().includes(txSearch.toLowerCase())
    const matchMethod = txMethodFilter === 'all' || t.method === txMethodFilter
    const matchType = txTypeFilter === 'all' || (folio?.folio_type || '') === txTypeFilter
    return matchSearch && matchMethod && matchType
  })

  const txTotalRevenue = filteredTransactions.reduce((s, t) => s + (t.amount || 0), 0) / 100
  const txTotalSurcharge = filteredTransactions.reduce((s, t) => s + (t.surcharge_amount || 0), 0) / 100
  const txCash = filteredTransactions.filter(t => t.method === 'cash').reduce((s, t) => s + t.amount, 0) / 100
  const txCard = filteredTransactions.filter(t => t.method === 'card').reduce((s, t) => s + t.amount, 0) / 100
  const txCheck = filteredTransactions.filter(t => t.method === 'check').reduce((s, t) => s + t.amount, 0) / 100

  // Category breakdown from line items
  const categoryMap: { [key: string]: number } = {}
  lineItems.forEach(li => {
    const cat = li.category || 'Uncategorized'
    categoryMap[cat] = (categoryMap[cat] || 0) + (li.line_total || 0) / 100
  })
  const categoryData = Object.entries(categoryMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  // Top products
  const productMap: { [key: string]: { name: string; revenue: number; qty: number } } = {}
  lineItems.forEach(li => {
    const name = li.description || 'Unknown'
    if (!productMap[name]) productMap[name] = { name, revenue: 0, qty: 0 }
    productMap[name].revenue += (li.line_total || 0) / 100
    productMap[name].qty += li.quantity || 0
  })
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5)

  // ─── Reservations computed values ────────────────────────────────────────────
  const totalRevenue = reservations.reduce((sum, r) => sum + ((r.total_price || 0) / 100), 0)
  const totalAddons = addonRevenue.reduce((sum, a) => sum + (a.price * a.quantity || 0), 0)
  const totalBookings = reservations.length
  const avgStay = reservations.length > 0
    ? reservations.reduce((sum, r) => {
        const nights = Math.round((new Date(r.departure_date).getTime() - new Date(r.arrival_date).getTime()) / (1000 * 60 * 60 * 24))
        return sum + nights
      }, 0) / reservations.length
    : 0

  const monthlyMap: { [key: string]: { label: string; value: number } } = {}
  reservations.forEach(r => {
    const arrivalDate = new Date(r.arrival_date + 'T12:00:00')
    const key = arrivalDate.getFullYear() + '-' + String(arrivalDate.getMonth() + 1).padStart(2, '0')
    const label = arrivalDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    if (!monthlyMap[key]) monthlyMap[key] = { label, value: 0 }
    monthlyMap[key].value += (r.total_price || 0) / 100
  })
  const monthlyData = Object.values(monthlyMap)

  const siteTypeMap: { [key: string]: number } = {}
  reservations.forEach(r => {
    const type = (r.sites as any)?.site_type || 'unknown'
    const label = ({ rv_site: 'RV Sites', cabin: 'Cabins', tent: 'Tent Sites' } as any)[type] || type
    siteTypeMap[label] = (siteTypeMap[label] || 0) + ((r.total_price || 0) / 100)
  })
  const siteTypeData = Object.entries(siteTypeMap).map(([name, value]) => ({ name, value }))

  const siteMap: { [key: string]: { name: string; revenue: number; bookings: number } } = {}
  reservations.forEach(r => {
    const n = (r.sites as any)?.site_number || 'Unknown'
    if (!siteMap[n]) siteMap[n] = { name: n, revenue: 0, bookings: 0 }
    siteMap[n].revenue += (r.total_price || 0) / 100
    siteMap[n].bookings += 1
  })
  const topSites = Object.values(siteMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5)

  // ─── Chart components ────────────────────────────────────────────────────────
  function BarChart({ data }: { data: { label: string; value: number }[] }) {
    if (data.length === 0) return <p className="text-gray-400 text-center py-8">No data for selected period</p>
    const max = Math.max(...data.map(d => d.value), 1)
    const chartH = 180
    const barW = 32
    const gap = 8
    const leftPad = 48
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
      const x1 = cx + r * Math.cos(angle)
      const y1 = cy + r * Math.sin(angle)
      angle += sweep
      const x2 = cx + r * Math.cos(angle)
      const y2 = cy + r * Math.sin(angle)
      const ix1 = cx + inner * Math.cos(angle - sweep)
      const iy1 = cy + inner * Math.sin(angle - sweep)
      const ix2 = cx + inner * Math.cos(angle)
      const iy2 = cy + inner * Math.sin(angle)
      const large = sweep > Math.PI ? 1 : 0
      return {
        path: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`,
        color: COLORS[i % COLORS.length],
        ...d,
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

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>

        {/* Date range — shown on Reservations tab */}
        {activeTab === 'reservations' && (
          <div className="flex flex-wrap gap-2 items-center">
            <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={dateRange} onChange={e => setDateRange(e.target.value)}>
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
                <button onClick={fetchReservationData} className="px-3 py-2 rounded-lg text-white text-sm" style={{ backgroundColor: 'var(--accent-color)' }}>Go</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs — only show Transactions tab if pos_enabled */}
      {posEnabled && (
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          {(['reservations', 'transactions'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 text-sm font-medium capitalize rounded-t-lg transition-colors"
              style={activeTab === tab
                ? { backgroundColor: 'var(--accent-color)', color: '#fff', borderBottom: '2px solid var(--accent-color)' }
                : { color: '#6B7280' }
              }
            >
              {tab === 'reservations' ? 'Reservations' : 'Transactions'}
            </button>
          ))}
        </div>
      )}

      {/* ── RESERVATIONS TAB ── */}
      {activeTab === 'reservations' && (
        loading ? <div className="p-6 text-gray-500">Loading reports...</div> : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
              {[
                { label: 'Total Revenue', value: '$' + (totalRevenue + totalAddons).toFixed(2), sub: 'incl. add-ons' },
                { label: 'Accommodation', value: '$' + totalRevenue.toFixed(2), sub: 'excl. add-ons' },
                { label: 'Add-on Revenue', value: '$' + totalAddons.toFixed(2), sub: 'from add-ons' },
                { label: 'Total Bookings', value: totalBookings.toString(), sub: 'reservations' },
                { label: 'Avg Stay', value: avgStay.toFixed(1) + ' nights', sub: 'per booking' },
              ].map((stat, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500">{stat.label}</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{stat.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>
                </div>
              ))}
            </div>

            {/* Monthly Revenue */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Revenue</h2>
              <BarChart data={monthlyData} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue by Site Type</h2>
                <DonutChart data={siteTypeData} />
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Earning Sites</h2>
                {topSites.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No data</p>
                ) : (
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

            {/* Reservations table */}
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
                      <th className="text-right py-2 text-gray-500 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservations.slice(0, 10).map(r => {
                      const nights = Math.round((new Date(r.departure_date).getTime() - new Date(r.arrival_date).getTime()) / (1000 * 60 * 60 * 24))
                      return (
                        <tr key={r.id} className="border-b border-gray-50">
                          <td className="py-2 text-gray-900">{(r.sites as any)?.site_number || '—'}</td>
                          <td className="py-2 text-gray-600">{r.arrival_date}</td>
                          <td className="py-2 text-gray-600">{r.departure_date}</td>
                          <td className="py-2 text-gray-600">{nights}</td>
                          <td className="py-2 text-gray-900 text-right font-medium">${((r.total_price || 0) / 100).toFixed(2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}

      {/* ── TRANSACTIONS TAB ── */}
      {activeTab === 'transactions' && posEnabled && (
        <>
          {/* Filters row */}
          <div className="flex flex-wrap gap-2 items-center mb-6" style={{rowGap: "8px"}}>
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={txDateRange}
              onChange={e => setTxDateRange(e.target.value)}
            >
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="this_year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>
            {txDateRange === 'custom' && (
              <>
                <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={txCustomStart} onChange={e => setTxCustomStart(e.target.value)} />
                <span className="text-gray-400">to</span>
                <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={txCustomEnd} onChange={e => setTxCustomEnd(e.target.value)} />
                <button onClick={fetchTransactionData} className="px-3 py-2 rounded-lg text-white text-sm" style={{ backgroundColor: 'var(--accent-color)' }}>Go</button>
              </>
            )}
            <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={txMethodFilter} onChange={e => setTxMethodFilter(e.target.value)}>
              <option value="all">All Methods</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="check">Check</option>
            </select>
            <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={txTypeFilter} onChange={e => setTxTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="reservation">Reservation</option>
              <option value="walkup">Walk-Up</option>
            </select>
            <input
              type="text"
              placeholder="Search guest..."
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={txSearch}
              onChange={e => setTxSearch(e.target.value)}
            />
          </div>

          {txLoading ? <div className="p-6 text-gray-500">Loading transactions...</div> : (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                {[
                  { label: 'Total Collected', value: '$' + txTotalRevenue.toFixed(2), sub: 'all methods' },
                  { label: 'Cash', value: '$' + txCash.toFixed(2), sub: 'cash payments' },
                  { label: 'Card', value: '$' + txCard.toFixed(2), sub: 'card payments' },
                  { label: 'Check', value: '$' + txCheck.toFixed(2), sub: 'check payments' },
                  { label: 'Card Fees', value: '$' + txTotalSurcharge.toFixed(2), sub: 'surcharges collected' },
                ].map((stat, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500">{stat.label}</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{stat.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>
                  </div>
                ))}
              </div>

              {/* Category + top products */}
              {categoryData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Sales by Category</h2>
                    <DonutChart data={categoryData} />
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Products</h2>
                    {topProducts.length === 0 ? (
                      <p className="text-gray-400 text-center py-8">No data</p>
                    ) : (
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
                    )}
                  </div>
                </div>
              )}

              {/* Transaction log */}
              <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Transaction Log
                  <span className="ml-2 text-sm font-normal text-gray-400">({filteredTransactions.length} results)</span>
                </h2>
                {filteredTransactions.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No transactions found for this period</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: '560px' }}>
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 text-gray-500 font-medium">Date / Time</th>
                          <th className="text-left py-2 text-gray-500 font-medium">Guest</th>
                          <th className="text-left py-2 text-gray-500 font-medium">Type</th>
                          <th className="text-left py-2 text-gray-500 font-medium">Method</th>
                          <th className="text-right py-2 text-gray-500 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map(t => {
                          const folio = t.folios as any
                          const dt = t.paid_at ? new Date(t.paid_at) : null
                          const dateStr = dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
                          const timeStr = dt ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
                          return (
                            <tr
                              key={t.id}
                              className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                              onClick={() => router.push(`/admin/folio/${t.folio_id}`)}
                            >
                              <td className="py-2 text-gray-600">
                                <span className="font-medium text-gray-900">{dateStr}</span>
                                <span className="ml-2 text-gray-400 text-xs">{timeStr}</span>
                              </td>
                              <td className="py-2 text-gray-900">{folio?.guest_name || '—'}</td>
                              <td className="py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  folio?.folio_type === 'walkup'
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-green-50 text-green-700'
                                }`}>
                                  {folio?.folio_type === 'walkup' ? 'Walk-Up' : 'Reservation'}
                                </span>
                              </td>
                              <td className="py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  t.method === 'cash' ? 'bg-yellow-50 text-yellow-700' :
                                  t.method === 'card' ? 'bg-purple-50 text-purple-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {t.method}
                                </span>
                              </td>
                              <td className="py-2 text-right font-semibold text-gray-900">
                                ${((t.amount || 0) / 100).toFixed(2)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
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
