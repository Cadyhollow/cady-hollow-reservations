'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ymd } from '@/lib/transactions'
import { computePricing, type PricingSite, type PricingSettings, type PricingFee, type PricingRule } from '@/lib/pricing'

type Reservation = {
  id: string
  guest_name: string
  site_id: string
  arrival_date: string
  departure_date: string
  status: string
  checked_in?: boolean
  payment_type: string
  total_price: number
  amount_paid: number
  total_paid?: number
  guest_email: string
  guest_phone: string
  num_adults: number
  num_children: number
  sites: { site_number: string; site_type: string }
}

type Site = { id: string; site_number: string; site_type: string; in_rotation: boolean; is_available: boolean }

const SITE_TYPE_DOT: Record<string, string> = {
  rv_site: '#86efac', cabin: '#fde047', tent: '#93c5fd', yurt: '#f9a8d4',
  tiny_home: '#c4b5fd', lodge: '#fca5a5', glamping: '#fdba74', treehouse: '#4ade80',
}

const STATUS_BAR: Record<string, { bg: string; text: string }> = {
  checked_in: { bg: '#065f46', text: '#ffffff' },
  confirmed:  { bg: '#16a34a', text: '#ffffff' },
  manual:     { bg: '#7c3aed', text: '#ffffff' },
  pending:    { bg: '#d97706', text: '#ffffff' },
}

const MONTH_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  rv_site: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  cabin: { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },
  tent: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  yurt: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  tiny_home: { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' },
  lodge: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  glamping: { bg: '#fff7ed', text: '#9a3412', border: '#fdba74' },
  treehouse: { bg: '#f0fdf4', text: '#14532d', border: '#86efac' },
}

const DAY_W = 44          // px per day column
const LABEL_W = 148       // px site label column
const ROW_H = 46          // px per site row
const DAYS = 21           // visible window
const FETCH_AHEAD = 45    // days of data loaded (for availability chips)

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function diffDays(a: string, b: string) {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)
}

export default function CalendarPage() {
  const [windowStart, setWindowStart] = useState<Date>(() => addDays(new Date(), -3))
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [seasonalSites, setSeasonalSites] = useState<Set<string>>(new Set())
  const [showSeasonal, setShowSeasonal] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Reservation | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  // ── Slice 2: drag-to-adjust engine ──
  type DragState = {
    resId: string; side: 'L' | 'R'
    origArrival: string; origDeparture: string
    ghostArrival: string; ghostDeparture: string
    minArrival: string; maxDeparture: string
    blocked: boolean; startX: number; active: boolean
  }
  const [pricingData, setPricingData] = useState<{ settings: PricingSettings | null; fees: PricingFee[]; rules: PricingRule[] }>({ settings: null, fees: [], rules: [] })
  const [adjustModal, setAdjustModal] = useState<null | { r: Reservation; ghostArrival: string; ghostDeparture: string }>(null)
  const [adjAdults, setAdjAdults] = useState(2)
  const [adjChildren, setAdjChildren] = useState(0)
  const [adjSaving, setAdjSaving] = useState(false)
  const [adjError, setAdjError] = useState('')
  const [drag, setDragState] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  function setDrag(d: DragState | null) { dragRef.current = d; setDragState(d) }

  function beginDrag(r: Reservation, side: 'L' | 'R', clientX: number) {
    if (r.checked_in && side === 'L') return
    touchStart.current = null // disarm the grid axis-locker — this gesture is ours
    const siblings = (resBySite[r.site_id] || []).filter(x => x.id !== r.id)
    let minArrival = fetchLo
    let maxDeparture = fetchHi
    for (const s of siblings) {
      if (s.departure_date <= r.arrival_date && s.departure_date > minArrival) minArrival = s.departure_date
      if (s.arrival_date >= r.departure_date && s.arrival_date < maxDeparture) maxDeparture = s.arrival_date
    }
    setDrag({
      resId: r.id, side,
      origArrival: r.arrival_date, origDeparture: r.departure_date,
      ghostArrival: r.arrival_date, ghostDeparture: r.departure_date,
      minArrival, maxDeparture, blocked: false, startX: clientX, active: true,
    })
  }

  function moveDrag(clientX: number) {
    const d = dragRef.current
    if (!d || !d.active) return
    const dayDelta = Math.round((clientX - d.startX) / DAY_W)
    let blocked = false
    if (d.side === 'R') {
      let target = ymd(addDays(new Date(d.origDeparture + 'T12:00:00'), dayDelta))
      const minDep = ymd(addDays(new Date(d.ghostArrival + 'T12:00:00'), 1))
      if (target < minDep) { target = minDep; blocked = true }
      if (target > d.maxDeparture) { target = d.maxDeparture; blocked = true }
      setDrag({ ...d, ghostDeparture: target, blocked })
    } else {
      let target = ymd(addDays(new Date(d.origArrival + 'T12:00:00'), dayDelta))
      const maxArr = ymd(addDays(new Date(d.ghostDeparture + 'T12:00:00'), -1))
      if (target > maxArr) { target = maxArr; blocked = true }
      if (target < d.minArrival) { target = d.minArrival; blocked = true }
      setDrag({ ...d, ghostArrival: target, blocked })
    }
  }

  function endDrag() {
    const d = dragRef.current
    if (!d) return
    if (d.ghostArrival === d.origArrival && d.ghostDeparture === d.origDeparture) setDrag(null)
    else setDrag({ ...d, active: false, blocked: false })
  }

  function cancelDragAll() { setDrag(null); setFocusId(null) }

  // iOS Safari: React's synthetic touch handlers can't reliably beat native scroll.
  // While a drag is active, attach NATIVE non-passive listeners that preventDefault,
  // so the gesture belongs to the drag — not the scroller.
  useEffect(() => {
    if (!drag?.active) return
    const mv = (e: TouchEvent) => { e.preventDefault(); moveDrag(e.touches[0].clientX) }
    const end = () => endDrag()
    document.addEventListener('touchmove', mv, { passive: false })
    document.addEventListener('touchend', end)
    document.addEventListener('touchcancel', end)
    return () => {
      document.removeEventListener('touchmove', mv)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', end)
    }
  }, [drag?.active])
  // Long-press-to-focus: 600ms hold on a bar, cancelled by >8px movement
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  function startLongPress(r: Reservation, e: React.TouchEvent) {
    const t = e.touches[0]
    cancelLongPress()
    longPress.current = {
      x: t.clientX, y: t.clientY,
      timer: setTimeout(() => { setSelected(r); setFocusId(r.id); longPress.current = null }, 600),
    }
  }
  function moveLongPress(e: React.TouchEvent) {
    if (!longPress.current) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - longPress.current.x) > 8 || Math.abs(t.clientY - longPress.current.y) > 8) cancelLongPress()
  }
  function cancelLongPress() {
    if (longPress.current) { clearTimeout(longPress.current.timer); longPress.current = null }
  }
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'timeline' | 'month'>('timeline')
  const [monthDate, setMonthDate] = useState<Date>(new Date())
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set())

  // ── Touch axis locking: first few px of a swipe decide the axis; the gesture
  // stays locked to it so the grid never drifts diagonally on iPad. ──
  const gridRef = useRef<HTMLDivElement | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const axisLock = useRef<'x' | 'y' | null>(null)
  function onGridTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    axisLock.current = null
  }
  function onGridTouchMove(e: React.TouchEvent) {
    if (dragRef.current?.active) return
    const el = gridRef.current
    if (!el || !touchStart.current) return
    if (!axisLock.current) {
      const dx = Math.abs(e.touches[0].clientX - touchStart.current.x)
      const dy = Math.abs(e.touches[0].clientY - touchStart.current.y)
      if (dx < 6 && dy < 6) return // not enough movement to judge yet
      axisLock.current = dx > dy ? 'x' : 'y'
      el.style.overflowX = axisLock.current === 'x' ? 'auto' : 'hidden'
      el.style.overflowY = axisLock.current === 'y' ? 'auto' : 'hidden'
    }
  }
  function onGridTouchEnd() {
    const el = gridRef.current
    if (el) { el.style.overflowX = 'auto'; el.style.overflowY = 'auto' }
    touchStart.current = null
    axisLock.current = null
  }

  const startStr = ymd(windowStart)
  const endStr = ymd(addDays(windowStart, DAYS - 1))
  const fetchEndStr = ymd(addDays(windowStart, FETCH_AHEAD))
  const todayStr = ymd(new Date())
  // Month bounds — one fetch covers BOTH the timeline window and the viewed month
  const monthFirstStr = ymd(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1))
  const monthLastStr = ymd(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0))
  const fetchLo = monthFirstStr < startStr ? monthFirstStr : startStr
  const fetchHi = monthLastStr > fetchEndStr ? monthLastStr : fetchEndStr

  useEffect(() => { fetchData() }, [startStr, monthFirstStr])

  async function fetchData() {
    setLoading(true)
    const [{ data: resData }, { data: siteData }, { data: seasonalGuests }] = await Promise.all([
      supabase
        .from('reservations')
        .select('*, sites(site_number, site_type)')
        .neq('status', 'cancelled')
        .lte('arrival_date', fetchHi)
        .gt('departure_date', fetchLo)
        .order('arrival_date'),
      supabase.from('sites').select('*'),
      supabase.from('guests').select('site_number').eq('is_seasonal', true),
    ])
    // Pricing inputs for the adjust-dates modal (tiny tables; fetched once per load)
    const [{ data: pSettings }, { data: pFees }, { data: pRules }] = await Promise.all([
      supabase.from('settings').select('*').limit(1).single(),
      supabase.from('fees').select('*'),
      supabase.from('pricing_rules').select('*'),
    ])
    setPricingData({ settings: pSettings as any, fees: (pFees as any) || [], rules: (pRules as any) || [] })

    // Fold in folio payments so the detail panel "Paid" is complete (display-only).
    const resList = resData || []
    const resIds = resList.map((r: any) => r.id)
    const folioPaidByRes: Record<string, number> = {}
    if (resIds.length > 0) {
      const { data: folios } = await supabase.from('folios').select('id, reservation_id').in('reservation_id', resIds)
      const folioIds = (folios || []).map((f: any) => f.id)
      if (folioIds.length > 0) {
        const { data: pmts } = await supabase
          .from('folio_payments')
          .select('folio_id, amount, surcharge_amount, status')
          .in('folio_id', folioIds)
          .eq('status', 'completed')
        const paidByFolio: Record<string, number> = {}
        for (const pm of (pmts || [])) paidByFolio[pm.folio_id] = (paidByFolio[pm.folio_id] || 0) + (pm.amount - (pm.surcharge_amount || 0))
        for (const f of (folios || [])) if (f.reservation_id) folioPaidByRes[f.reservation_id] = (folioPaidByRes[f.reservation_id] || 0) + (paidByFolio[f.id] || 0)
      }
    }
    setReservations(resList.map((r: any) => ({ ...r, total_paid: (r.amount_paid || 0) + (folioPaidByRes[r.id] || 0) })))
    setSites(siteData || [])
    setSeasonalSites(new Set((seasonalGuests || []).map((g: any) => String(g.site_number))))
    setLoading(false)
  }

  const dayList = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(windowStart, i)), [startStr])

  const siteTypeLabel = (t: string) => ({ rv_site: 'RV', cabin: 'Cabin', tent: 'Tent', yurt: 'Yurt', tiny_home: 'Tiny Home', lodge: 'Lodge', glamping: 'Glamping', treehouse: 'Treehouse' } as any)[t] || t

  const resBySite = useMemo(() => {
    const m: Record<string, Reservation[]> = {}
    for (const r of reservations) { if (!m[r.site_id]) m[r.site_id] = []; m[r.site_id].push(r) }
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.arrival_date.localeCompare(b.arrival_date))
    return m
  }, [reservations])

  // Next availability per site, from today, using the fetched horizon.
  function availabilityFor(siteId: string): { label: string; open: boolean } {
    let cur = todayStr
    for (const r of (resBySite[siteId] || [])) {
      if (r.arrival_date <= cur && r.departure_date > cur) cur = r.departure_date
      else if (r.arrival_date > cur) break
    }
    if (cur === todayStr) return { label: 'open now', open: true }
    if (cur >= fetchEndStr) return { label: 'booked ' + FETCH_AHEAD + '+ days', open: false }
    return { label: 'frees ' + new Date(cur + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), open: false }
  }

  const visibleRows = useMemo(() => {
    const naturalSort = (a: Site, b: Site) => a.site_number.localeCompare(b.site_number, undefined, { numeric: true })
    // A site appears on the calendar if staff have it marked available (the
    // Sites-admin toggle) OR it has any reservation in the window — a real
    // booking must always be visible regardless of flags.
    let list = sites.filter(s => s.is_available || (resBySite[s.id] || []).length > 0)
    // Hide a seasonal site ONLY if it has no reservations in the fetched window.
    // A transient booking on a seasonal guest's site must always be visible —
    // never hide a real reservation behind the seasonal filter.
    if (!showSeasonal) list = list.filter(s =>
      !seasonalSites.has(String(s.site_number)) || (resBySite[s.id] || []).length > 0
    )
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(s => s.site_number.toLowerCase().includes(q) || siteTypeLabel(s.site_type).toLowerCase().includes(q))
    }
    const hasRes = (s: Site) => (resBySite[s.id] || []).some(r => r.arrival_date <= endStr && r.departure_date > startStr)
    const active = list.filter(hasRes).sort(naturalSort)
    const empty = list.filter(s => !hasRes(s)).sort(naturalSort)
    return { active, empty }
  }, [sites, seasonalSites, showSeasonal, search, resBySite, startStr, endStr])

  function barsFor(site: Site) {
    return (resBySite[site.id] || [])
      .filter(r => r.arrival_date <= endStr && r.departure_date > startStr)
      .map(r => {
        const startOff = diffDays(startStr, r.arrival_date)
        const endOff = diffDays(startStr, r.departure_date)
        const rawLeft = (startOff + 0.5) * DAY_W
        const rawRight = (endOff + 0.5) * DAY_W
        const left = Math.max(0, rawLeft)
        const right = Math.min(DAYS * DAY_W, rawRight)
        const clippedL = rawLeft < 0
        const clippedR = rawRight > DAYS * DAY_W
        const nights = diffDays(r.arrival_date, r.departure_date)
        const statusKey = r.checked_in ? 'checked_in' : (STATUS_BAR[r.status] ? r.status : 'confirmed')
        return { r, left, width: right - left, clippedL, clippedR, nights, colors: STATUS_BAR[statusKey] }
      })
  }

  // Count only sites the toggle actually governs: on the calendar at all
  // (available or booked), seasonal-flagged, and with no reservations.
  const seasonalHiddenCount = sites.filter(s =>
    (s.is_available || (resBySite[s.id] || []).length > 0) &&
    seasonalSites.has(String(s.site_number)) &&
    (resBySite[s.id] || []).length === 0
  ).length
  // ── Month view helpers ──
  const mYear = monthDate.getFullYear()
  const mMonth = monthDate.getMonth()
  const mFirstDow = new Date(mYear, mMonth, 1).getDay()
  const mDaysInMonth = new Date(mYear, mMonth + 1, 0).getDate()
  const monthName = monthDate.toLocaleString('default', { month: 'long', year: 'numeric' })
  const mDateStr = (day: number) => `${mYear}-${String(mMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const monthResForDay = (day: number) => {
    const ds = mDateStr(day)
    return reservations.filter(r => r.arrival_date <= ds && r.departure_date >= ds)
  }
  function toggleDay(day: number) {
    setExpandedDays(prev => { const n = new Set(prev); n.has(day) ? n.delete(day) : n.add(day); return n })
  }
  const activeSiteTypes = [...new Set(sites.map(s => s.site_type))]

  const rangeLabel =
    windowStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' +
    addDays(windowStart, DAYS - 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  // Statuses that may be date-adjusted: confirmed / manual / checked-in. Never pending.
  function draggableStatus(r: Reservation) {
    return r.checked_in || r.status === 'confirmed' || r.status === 'manual'
  }

  function SiteRow({ site }: { site: Site }) {
    const avail = availabilityFor(site.id)
    return (
      <div className="flex" style={{ height: ROW_H }}>
        <div className="sticky left-0 z-10 bg-white border-b border-r border-gray-100 flex flex-col justify-center px-2 shrink-0" style={{ width: LABEL_W }}>
          <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5 truncate">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SITE_TYPE_DOT[site.site_type] || '#d1d5db' }} />
            {siteTypeLabel(site.site_type)} {site.site_number}
          </span>
          <span className="text-[10px] font-medium truncate" style={{ color: avail.open ? '#16a34a' : '#9ca3af' }}>
            {avail.open ? '● open now' : '→ ' + avail.label}
          </span>
        </div>
        <div className="relative border-b border-gray-100" style={{ width: DAYS * DAY_W, height: ROW_H }}>
          {dayList.map((d, i) => {
            const ds = ymd(d)
            const wknd = d.getDay() === 0 || d.getDay() === 6
            return <div key={i} className="absolute top-0 bottom-0"
              style={{ left: i * DAY_W, width: DAY_W, borderRight: '1px solid rgba(17,24,39,0.08)', background: ds === todayStr ? 'rgba(46,107,138,0.07)' : wknd ? 'rgba(0,0,0,0.03)' : 'transparent' }} />
          })}
          {barsFor(site).map(({ r, left, width, clippedL, clippedR, nights, colors }) => (
            <div key={r.id} className="absolute" style={(() => {
              const isGhosting = drag && drag.resId === r.id
              const dLeft = isGhosting ? Math.max(0, (diffDays(startStr, drag.ghostArrival) + 0.5) * DAY_W) : left
              const dRight = isGhosting ? Math.min(DAYS * DAY_W, (diffDays(startStr, drag.ghostDeparture) + 0.5) * DAY_W) : left + Math.max(width, 20)
              return { left: dLeft, width: Math.max(dRight - dLeft, 20),
              top: focusId === r.id ? -6 : 7,
              height: focusId === r.id ? ROW_H + 12 : ROW_H - 14,
              zIndex: focusId === r.id ? 30 : undefined,
              opacity: focusId && focusId !== r.id ? 0.3 : 1,
              transition: drag && drag.resId === r.id ? 'opacity 150ms' : 'opacity 150ms, top 150ms, height 150ms, left 120ms, width 120ms',
              WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties })()}>
              <button
                onClick={() => { if (!focusId) setSelected(selected?.id === r.id ? null : r) }}
                onTouchStart={(e) => { if (!focusId && draggableStatus(r)) startLongPress(r, e) }}
                onTouchMove={moveLongPress}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                className="w-full h-full flex items-center gap-1 px-2 font-semibold truncate transition-all hover:brightness-110"
                title={r.guest_name + ' · ' + r.arrival_date + ' → ' + r.departure_date + ' · ' + nights + ' night' + (nights !== 1 ? 's' : '')}
                style={{
                  fontSize: focusId === r.id ? 14 : 11,
                  background: colors.bg, color: colors.text,
                  WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none',
                  borderRadius: (clippedL ? '2px' : '8px') + ' ' + (clippedR ? '2px' : '8px') + ' ' + (clippedR ? '2px' : '8px') + ' ' + (clippedL ? '2px' : '8px'),
                  outline: selected?.id === r.id && !focusId ? '2px solid #111827' : 'none',
                  outlineOffset: 1,
                  boxShadow: focusId === r.id ? '0 6px 20px rgba(0,0,0,0.35)' : 'none',
                }}
              >
                <span className="truncate">{r.guest_name}</span>
                {width > 120 && <span className="opacity-75 shrink-0">· {nights}n</span>}
              </button>
              {/* Fat grab handles — inert in Slice 1, drag logic arrives in Slice 2 */}
              {drag && drag.resId === r.id && (drag.ghostArrival !== drag.origArrival || drag.ghostDeparture !== drag.origDeparture) && (() => {
                const dLeft = Math.max(0, (diffDays(startStr, drag.ghostArrival) + 0.5) * DAY_W)
                const oEdge = drag.side === 'R'
                  ? Math.min(DAYS * DAY_W, (diffDays(startStr, drag.origDeparture) + 0.5) * DAY_W) - dLeft
                  : Math.max(0, (diffDays(startStr, drag.origArrival) + 0.5) * DAY_W) - dLeft
                const gNights = diffDays(drag.ghostArrival, drag.ghostDeparture)
                const dN = gNights - diffDays(drag.origArrival, drag.origDeparture)
                const label = (dN > 0 ? '+' + dN : String(dN)) + ' night' + (Math.abs(dN) !== 1 ? 's' : '') +
                  (drag.side === 'R'
                    ? ' · thru ' + new Date(drag.ghostDeparture + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : ' · from ' + new Date(drag.ghostArrival + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
                return (
                  <>
                    {/* Dashed marker where the ORIGINAL edge was — the solid bar is the live preview */}
                    <div className="absolute pointer-events-none" style={{ left: oEdge - 1, top: -4, bottom: -4, width: 0,
                      borderLeft: '2px dashed rgba(17,24,39,0.5)', zIndex: 32 }} />
                    <div className="absolute pointer-events-none whitespace-nowrap px-2 py-1 rounded-lg text-xs font-bold"
                      style={{ left: '50%', transform: 'translateX(-50%)', top: -36,
                        background: drag.blocked ? '#dc2626' : '#111827', color: '#fff', zIndex: 40,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                      {drag.blocked ? 'No availability' : (dN === 0 ? 'No change' : label)}
                    </div>
                  </>
                )
              })()}
              {focusId === r.id && !clippedL && !r.checked_in && (
                <div className="absolute flex items-center justify-center"
                  onTouchStart={(e) => { e.stopPropagation(); beginDrag(r, 'L', e.touches[0].clientX) }}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); beginDrag(r, 'L', e.clientX)
                    const mv = (ev: MouseEvent) => moveDrag(ev.clientX)
                    const up = () => { endDrag(); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
                    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up) }}
                  style={{ left: -18, top: 0, bottom: 0, width: 36, zIndex: 31, touchAction: 'none', cursor: 'ew-resize' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }} />)}
                  </div>
                </div>
              )}
              {focusId === r.id && !clippedR && (
                <div className="absolute flex items-center justify-center"
                  onTouchStart={(e) => { e.stopPropagation(); beginDrag(r, 'R', e.touches[0].clientX) }}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); beginDrag(r, 'R', e.clientX)
                    const mv = (ev: MouseEvent) => moveDrag(ev.clientX)
                    const up = () => { endDrag(); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
                    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up) }}
                  style={{ right: -18, top: 0, bottom: 0, width: 36, zIndex: 31, touchAction: 'none', cursor: 'ew-resize' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }} />)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Reservation Calendar</h2>
          <p className="text-sm text-gray-500 mt-0.5">{viewMode === 'timeline' ? rangeLabel : monthName}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['timeline','month'] as const).map(m => (
              <button key={m} onClick={() => { setViewMode(m); setSelected(null) }}
                className="px-3 py-2 text-sm font-medium"
                style={viewMode === m ? { background: '#2E6B8A', color: '#fff' } : { background: '#fff', color: '#6b7280' }}>
                {m === 'timeline' ? 'Timeline' : 'Month'}
              </button>
            ))}
          </div>
          <input
            type="text" placeholder="Find site…" value={search} onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-32"
          />
          {viewMode === 'timeline' && <button onClick={() => setShowSeasonal(v => !v)}
            className="px-3 py-2 text-xs font-medium rounded-lg border"
            style={showSeasonal ? { background: '#f0fdf4', borderColor: '#86efac', color: '#166534' } : { background: '#fff', borderColor: '#e5e7eb', color: '#6b7280' }}>
            {showSeasonal ? 'Hide' : 'Show'} seasonal ({seasonalHiddenCount})
          </button>}
          <button onClick={() => { if (viewMode === 'timeline') setWindowStart(addDays(new Date(), -3)); else setMonthDate(new Date()); setSelected(null) }}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Today</button>
          <button onClick={() => { if (viewMode === 'timeline') setWindowStart(addDays(windowStart, -7)); else setMonthDate(new Date(mYear, mMonth - 1, 1)); setSelected(null) }}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">←</button>
          <button onClick={() => { if (viewMode === 'timeline') setWindowStart(addDays(windowStart, 7)); else setMonthDate(new Date(mYear, mMonth + 1, 1)); setSelected(null) }}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">→</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        {[['checked_in','Checked in'],['confirmed','Confirmed'],['manual','Manual'],['pending','Pending']].map(([k, label]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: STATUS_BAR[k].bg }} />
            <span className="text-xs text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-6 items-start">
        {/* Grid */}
        {viewMode === 'timeline' && (
        <div ref={gridRef} onClick={() => { if (focusId) cancelDragAll() }}
          onTouchStart={onGridTouchStart} onTouchMove={onGridTouchMove} onTouchEnd={onGridTouchEnd} onTouchCancel={onGridTouchEnd}
          className="flex-1 min-w-0 bg-white rounded-xl border border-gray-100 overflow-auto" style={{ maxHeight: "calc(100vh - 210px)" }}>
          <div style={{ width: LABEL_W + DAYS * DAY_W, minWidth: LABEL_W + DAYS * DAY_W }}>
            {/* Date header */}
            <div className="flex sticky top-0 z-20 bg-white border-b border-gray-200">
              <div className="sticky left-0 z-30 bg-white border-r border-gray-100 shrink-0 flex items-end px-2 pb-1" style={{ width: LABEL_W, height: 48 }}>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Site</span>
              </div>
              {dayList.map((d, i) => {
                const ds = ymd(d)
                const isT = ds === todayStr
                return (
                  <div key={i} className="flex flex-col items-center justify-center shrink-0" style={{ width: DAY_W, height: 48 }}>
                    <span className="text-[10px] font-medium" style={{ color: isT ? '#2E6B8A' : '#9ca3af' }}>
                      {d.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className="text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full"
                      style={isT ? { background: '#2E6B8A', color: '#fff' } : { color: '#374151' }}>
                      {d.getDate()}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Active site rows */}
            {visibleRows.active.map(site => <SiteRow key={site.id} site={site} />)}

            {/* Divider + available rows */}
            {visibleRows.empty.length > 0 && (
              <>
                <div className="flex sticky left-0">
                  <div className="px-2 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100" style={{ width: LABEL_W + DAYS * DAY_W }}>
                    Available this window ({visibleRows.empty.length})
                  </div>
                </div>
                {visibleRows.empty.map(site => <SiteRow key={site.id} site={site} />)}
              </>
            )}

            {visibleRows.active.length === 0 && visibleRows.empty.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-10">No sites match.</p>
            )}
          </div>
        </div>

        )}

        {/* Month view — the original holiday-tested layout, colors untouched */}
        {viewMode === 'month' && (
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
            {activeSiteTypes.map(type => { const c = MONTH_TYPE_COLORS[type]; if (!c) return null; return (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.bg, border: '1px solid ' + c.border }} />
                <span className="text-xs text-gray-500">{siteTypeLabel(type)}</span>
              </div>
            )})}
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#ede9fe', border: '1px solid #c4b5fd' }} />
              <span className="text-xs text-gray-500">Checkout day</span>
            </div>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} className="text-center text-xs font-semibold text-gray-500 py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: mFirstDow }).map((_, i) => (
              <div key={'e' + i} className="min-h-24 bg-gray-50 rounded-lg opacity-40" />
            ))}
            {Array.from({ length: mDaysInMonth }).map((_, i) => {
              const day = i + 1
              const dayRes = monthResForDay(day)
              const isT = mDateStr(day) === todayStr
              return (
                <div key={day} className="min-h-24 bg-white rounded-lg border border-gray-100 p-1 hover:border-gray-300 transition-colors"
                  style={{ outline: isT ? '2px solid var(--accent-color)' : 'none' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold w-5 h-5 flex items-center justify-center rounded-full"
                      style={{ backgroundColor: isT ? 'var(--accent-color)' : 'transparent', color: isT ? 'white' : '#374151' }}>{day}</span>
                    {dayRes.length > 0 && <span className="text-xs text-gray-400">{dayRes.length}</span>}
                  </div>
                  <div className="space-y-0.5">
                    {(expandedDays.has(day) ? dayRes : dayRes.slice(0, 3)).map(r => {
                      const c = MONTH_TYPE_COLORS[r.sites?.site_type] || MONTH_TYPE_COLORS.rv_site
                      const arrival = r.arrival_date === mDateStr(day)
                      const checkout = r.departure_date === mDateStr(day)
                      return (
                        <button key={r.id} onClick={() => setSelected(selected?.id === r.id ? null : r)}
                          className="w-full text-left px-1 py-0.5 rounded text-xs font-medium truncate transition-opacity hover:opacity-80"
                          style={{
                            backgroundColor: checkout ? '#ede9fe' : c.bg,
                            color: checkout ? '#6d28d9' : c.text,
                            border: '1px solid ' + (checkout ? '#c4b5fd' : (selected?.id === r.id ? c.text : c.border)),
                            borderLeftWidth: arrival ? '3px' : '1px',
                          }}>
                          {siteTypeLabel(r.sites?.site_type)} {r.sites?.site_number} · {r.guest_name.split(' ')[0]}
                        </button>
                      )
                    })}
                    {dayRes.length > 3 && (
                      <button onClick={(e) => { e.stopPropagation(); toggleDay(day) }}
                        className="text-xs text-blue-400 hover:text-blue-600 pl-1 w-full text-left">
                        {expandedDays.has(day) ? '▲ less' : '+' + (dayRes.length - 3) + ' more'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        )}

        {/* Detail panel (unchanged behavior) */}
        {selected && (
          <div className="w-72 shrink-0">
            <div className="bg-white rounded-xl border border-gray-100 p-5 sticky top-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{selected.guest_name}</h3>
                  <p className="text-sm text-gray-500">{'#' + selected.id.slice(0, 8).toUpperCase()}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-lg font-medium">×</button>
              </div>
              <div className="mb-4">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: (selected.checked_in ? STATUS_BAR.checked_in : STATUS_BAR[selected.status] || STATUS_BAR.confirmed).bg }}>
                  {selected.checked_in ? 'Checked in' : selected.status.charAt(0).toUpperCase() + selected.status.slice(1)}
                </span>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Site</span><span className="font-medium text-gray-900">{siteTypeLabel(selected.sites?.site_type)} {selected.sites?.site_number}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Arrival</span><span className="font-medium text-gray-900">{selected.arrival_date}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Departure</span><span className="font-medium text-gray-900">{selected.departure_date}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Guests</span><span className="font-medium text-gray-900">{selected.num_adults} adults, {selected.num_children} children</span></div>
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-medium text-gray-900">{'$' + (selected.total_price / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between mt-1"><span className="text-gray-500">Paid</span>
                    <span className="font-medium" style={{ color: (selected.total_paid ?? selected.amount_paid) >= selected.total_price ? '#16a34a' : '#d97706' }}>
                      {'$' + ((selected.total_paid ?? selected.amount_paid) / 100).toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex justify-between"><span className="text-gray-500">Email</span><span className="font-medium text-gray-900 text-right truncate max-w-36">{selected.guest_email}</span></div>
                  <div className="flex justify-between mt-1"><span className="text-gray-500">Phone</span><span className="font-medium text-gray-900">{selected.guest_phone || '—'}</span></div>
                </div>
              </div>
              {viewMode === 'timeline' && draggableStatus(selected) && (
                <button onClick={() => setFocusId(focusId === selected.id ? null : selected.id)}
                  className="mt-4 w-full block text-center py-2 rounded-lg text-sm font-semibold border-2 transition-colors"
                  style={focusId === selected.id
                    ? { borderColor: '#111827', background: '#111827', color: '#fff' }
                    : { borderColor: 'var(--accent-color)', color: 'var(--accent-color)', background: '#fff' }}>
                  {focusId === selected.id ? 'Done adjusting' : 'Adjust dates'}
                </button>
              )}
              <a href={'/admin/reservations?id=' + selected.id}
                className="mt-2 w-full block text-center py-2 rounded-lg text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--accent-color)' }}>
                View Full Reservation
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Parked-drag action bar: always visible, can't hide behind panels ── */}
      {drag && !drag.active && !adjustModal && (drag.ghostArrival !== drag.origArrival || drag.ghostDeparture !== drag.origDeparture) && (() => {
        const r = reservations.find(x => x.id === drag.resId)
        if (!r) return null
        const dN = diffDays(drag.ghostArrival, drag.ghostDeparture) - diffDays(drag.origArrival, drag.origDeparture)
        return (
          <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-4 px-4 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 bg-white rounded-2xl shadow-2xl border border-gray-200 px-5 py-3">
              <div className="text-sm">
                <span className="font-bold text-gray-900">{r.guest_name}</span>
                <span className="text-gray-500 ml-2">{dN > 0 ? '+' + dN : dN} night{Math.abs(dN) !== 1 ? 's' : ''} · {new Date(drag.ghostArrival + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → {new Date(drag.ghostDeparture + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
              <button onClick={() => setDrag(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => { setAdjAdults(r.num_adults); setAdjChildren(r.num_children); setAdjError(''); setAdjustModal({ r, ghostArrival: drag.ghostArrival, ghostDeparture: drag.ghostDeparture }) }}
                className="px-5 py-2 rounded-xl text-sm font-bold text-white" style={{ background: '#16a34a' }}>Continue →</button>
            </div>
          </div>
        )
      })()}

      {/* ── Confirmation modal: real pricing, editable party size, nothing mutates until Confirm ── */}
      {adjustModal && pricingData.settings && (() => {
        const { r, ghostArrival, ghostDeparture } = adjustModal
        const site = sites.find(s => s.id === r.site_id)
        const pSite: PricingSite | null = site ? { id: site.id, site_type: site.site_type, base_rate: (site as any).base_rate ?? 0 } : null
        const base = { site: pSite, num_adults: adjAdults, num_children: adjChildren,
          settings: pricingData.settings, fees: pricingData.fees, pricingRules: pricingData.rules }
        const orig = computePricing({ ...base, arrival_date: r.arrival_date, departure_date: r.departure_date })
        const next = computePricing({ ...base, arrival_date: ghostArrival, departure_date: ghostDeparture })
        const delta = next.cashTotal - orig.cashTotal
        const dN = next.nights - orig.nights
        const newTotal = (r.total_price || 0) + delta
        const paid = r.total_paid ?? r.amount_paid ?? 0
        const newBalance = newTotal - paid
        async function confirmAdjust() {
          setAdjSaving(true); setAdjError('')
          // Last-second conflict re-check against the live database
          const { data: clash } = await supabase.from('reservations').select('id')
            .eq('site_id', r.site_id).neq('id', r.id).neq('status', 'cancelled')
            .lt('arrival_date', ghostDeparture).gt('departure_date', ghostArrival)
          if (clash && clash.length > 0) { setAdjError('Another reservation now overlaps these dates. Please re-check the calendar.'); setAdjSaving(false); return }
          const { error } = await supabase.from('reservations')
            .update({ arrival_date: ghostArrival, departure_date: ghostDeparture, total_price: newTotal })
            .eq('id', r.id)
          if (error) { setAdjError(error.message); setAdjSaving(false); return }
          setAdjSaving(false); setAdjustModal(null); setDrag(null); setFocusId(null); setSelected(null)
          fetchData()
        }
        const Stepper = ({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) => (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{label}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => onChange(Math.max(label === 'Adults' ? 1 : 0, value - 1))} className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50">−</button>
              <span className="w-6 text-center text-sm font-bold text-gray-900">{value}</span>
              <button onClick={() => onChange(value + 1)} className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50">+</button>
            </div>
          </div>
        )
        return (
          <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={() => !adjSaving && setAdjustModal(null)} />
            <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[420px] bg-white rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-900">{dN > 0 ? 'Extend stay' : 'Adjust dates'}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{r.guest_name} · Site {r.sites?.site_number}</p>
              </div>
              <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div className="flex items-center justify-between text-sm">
                  <div className="text-gray-500">
                    <div className="line-through">{r.arrival_date} → {r.departure_date}</div>
                    <div className="font-semibold text-gray-900">{ghostArrival} → {ghostDeparture}</div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: '#f0fdf4', color: '#166534' }}>
                    {dN > 0 ? '+' + dN : dN} night{Math.abs(dN) !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2 border-t border-gray-100 pt-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Party for added nights</p>
                  <Stepper label="Adults" value={adjAdults} onChange={setAdjAdults} />
                  <Stepper label="Children" value={adjChildren} onChange={setAdjChildren} />
                </div>
                <div className="border-t border-gray-100 pt-3 space-y-1.5">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Price change</p>
                  {next.lines.map((ln, i) => {
                    const oLn = orig.lines.find(o => o.label.replace(/^\d+ nights? × /, '') === ln.label.replace(/^\d+ nights? × /, ''))
                    const diff = ln.amount - (oLn?.amount || 0)
                    if (diff === 0) return null
                    return (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-600">{ln.label}</span>
                        <span className="font-medium text-gray-900">{diff > 0 ? '+' : '−'}${(Math.abs(diff) / 100).toFixed(2)}</span>
                      </div>
                    )
                  })}
                  <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-2">
                    <span className="text-gray-900">Added charges</span>
                    <span style={{ color: delta >= 0 ? '#166534' : '#dc2626' }}>{delta >= 0 ? '+' : '−'}${(Math.abs(delta) / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500">New reservation total</span><span className="font-semibold text-gray-900">${(newTotal / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500">Paid so far</span><span className="font-medium text-gray-700">${(paid / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between text-sm font-bold"><span className="text-gray-900">Balance due</span>
                    <span style={{ color: newBalance > 0 ? '#d97706' : '#16a34a' }}>${(Math.max(newBalance, 0) / 100).toFixed(2)}</span></div>
                </div>
                {adjError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{adjError}</div>}
                <p className="text-xs text-gray-400">Balance can be collected on the guest's folio by cash, card, or any payment method.</p>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
                <button onClick={() => setAdjustModal(null)} disabled={adjSaving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">Go back</button>
                <button onClick={confirmAdjust} disabled={adjSaving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: '#16a34a' }}>
                  {adjSaving ? 'Saving…' : 'Confirm change'}
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {loading && (
        <div className="fixed inset-0 bg-white bg-opacity-60 flex items-center justify-center">
          <p className="text-gray-500 text-sm">Loading reservations…</p>
        </div>
      )}
    </div>
  )
}
