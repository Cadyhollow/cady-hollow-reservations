path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reports/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add guest account state variables ─────────────────────────────────
old_state = """  // Transactions tab
  const [transactions, setTransactions] = useState<PaymentRow[]>([])
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])"""

new_state = """  // Guest account (electric + other seasonal charges)
  const [guestAccountPayments, setGuestAccountPayments] = useState<PaymentRow[]>([])
  const [guestAccountLineItems, setGuestAccountLineItems] = useState<LineItemRow[]>([])

  // Transactions tab
  const [transactions, setTransactions] = useState<PaymentRow[]>([])
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])"""

# ── Edit 2: Fetch guest account payments in fetchAll ─────────────────────────
old_fetch_end = """    if (resData) setReservations(resData as any)
    if (cancelledData !== null) setCancelledCount((cancelledData as any)?.length || 0)
    if (pmtData) {
      const all = pmtData as any[]
      setResPayments(all.filter(p => p.folios?.reservation_id !== null))
      setTransactions(all)
    }

    setLoading(false)
    setTxLoading(false)
  }"""

new_fetch_end = """    // ── Guest account payments (electric + other seasonal charges) ──────────
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
  }"""

# ── Edit 3: Add computed guest account revenue ────────────────────────────────
old_computed_pos = """  // ── Computed: combined overview ───────────────────────────────────────────
  const totalCombined = resRevenue + (posEnabled ? posRevenue : 0)"""

new_computed_pos = """  // ── Computed: guest account revenue broken out by type ──────────────────
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
  const totalCombined = resRevenue + (posEnabled ? posRevenue : 0) + electricRevenue + otherGuestRevenue"""

# ── Edit 4: Add Electric and Other Guest stat cards to Overview ───────────────
old_stat_cards = """                {[
                  { label: 'Total Collected', value: '$' + totalCombined.toFixed(2), sub: reportBy === 'payment_date' ? 'all payments received' : 'based on stay dates' },
                  { label: 'Reservation Revenue', value: '$' + resRevenue.toFixed(2), sub: reservations.length + ' reservations' },
                  ...(posEnabled ? [{ label: 'POS Revenue', value: '$' + posRevenue.toFixed(2), sub: posPayments.length + ' transactions' }] : []),
                  { label: 'Cash + Check', value: '$' + (totalCash + totalCheck).toFixed(2), sub: 'non-card' },
                  { label: 'Card', value: '$' + totalCard.toFixed(2), sub: totalSurcharge > 0 ? `incl. $${totalSurcharge.toFixed(2)} fees` : 'card payments' },
                ].map((stat, i) => ("""

new_stat_cards = """                {[
                  { label: 'Total Collected', value: '$' + totalCombined.toFixed(2), sub: reportBy === 'payment_date' ? 'all payments received' : 'based on stay dates' },
                  { label: 'Reservation Revenue', value: '$' + resRevenue.toFixed(2), sub: reservations.length + ' reservations' },
                  ...(posEnabled ? [{ label: 'POS Revenue', value: '$' + posRevenue.toFixed(2), sub: posPayments.length + ' transactions' }] : []),
                  { label: 'Electric Billing', value: '$' + electricRevenue.toFixed(2), sub: 'seasonal electric' },
                  ...(otherGuestRevenue > 0 ? [{ label: 'Other Guest Charges', value: '$' + otherGuestRevenue.toFixed(2), sub: 'visitors, golf, store, etc.' }] : []),
                  { label: 'Cash + Check', value: '$' + (totalCash + totalCheck).toFixed(2), sub: 'non-card' },
                  { label: 'Card', value: '$' + totalCard.toFixed(2), sub: totalSurcharge > 0 ? `incl. $${totalSurcharge.toFixed(2)} fees` : 'card payments' },
                ].map((stat, i) => ("""

# ── Edit 5: Add guest account donut chart to Overview ────────────────────────
old_bar_chart_end = """              <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">
                  {reportBy === 'payment_date' ? 'Revenue by Payment Date' : 'Revenue by Stay Date'}
                </h2>
                <p className="text-xs text-gray-400 mb-4">
                  {reportBy === 'payment_date' ? 'Amounts shown when payment was received' : 'Amounts attributed to arrival month'}
                </p>
                <BarChart data={monthlyData} />
              </div>"""

new_bar_chart_end = """              <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6 mb-6">
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
              )}"""

checks = [
    ('Guest account state', old_state, new_state),
    ('Fetch guest account payments', old_fetch_end, new_fetch_end),
    ('Computed guest revenue', old_computed_pos, new_computed_pos),
    ('Electric stat cards', old_stat_cards, new_stat_cards),
    ('Guest account donut chart', old_bar_chart_end, new_bar_chart_end),
]

all_good = True
for label, old, new in checks:
    if old in content:
        content = content.replace(old, new, 1)
        print(f'  \u2713 {label}')
    else:
        print(f'  \u2717 MISSING: {label}')
        all_good = False

if all_good:
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 All edits applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reports: add electric billing and guest account revenue to overview" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
