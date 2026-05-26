path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folios/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Fix 1: Change default filter from 'open' to 'all' so data is visible immediately
old_filter = "  const [filter, setFilter] = useState<'open' | 'all' | 'walkin' | 'reservation'>('open')"
new_filter = "  const [filter, setFilter] = useState<'open' | 'all' | 'walkin' | 'reservation'>('all')"

# Fix 2: Replace the single-query approach with a reliable two-step batch approach
old_fetch = """  async function fetchFolios() {
    setLoading(true)

    let query = supabase
      .from('folios')
      .select(`
        id, guest_name, guest_email, folio_type, status, opened_at, reservation_id,
        folio_line_items ( line_total ),
        folio_payments ( amount, surcharge_amount, status, method, paid_at ),
        reservations ( site_number, arrival_date, departure_date, total_price, amount_paid )
      `)
      .order('opened_at', { ascending: false })

    if (filter === 'open') query = query.eq('status', 'open')
    if (filter === 'walkin') query = query.eq('folio_type', 'walkin')
    if (filter === 'reservation') query = query.eq('folio_type', 'reservation')

    const { data } = await query

    if (data) {
      const summaries: FolioSummary[] = (data as any[]).map(f => {
        const itemsTotal = (f.folio_line_items || []).reduce((s: number, i: any) => s + i.line_total, 0)
        const completedPayments = (f.folio_payments || []).filter((p: any) => p.status === 'completed')
        const paymentsTotal = completedPayments.reduce((s: number, p: any) => s + p.amount - (p.surcharge_amount || 0), 0)
        const resBal = f.reservations ? Math.max(0, f.reservations.total_price - f.reservations.amount_paid) : 0
        const balance = Math.max(0, resBal + itemsTotal - paymentsTotal)

        // Last payment info for display
        const sorted = [...completedPayments].sort((a: any, b: any) =>
          new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()
        )
        const lastPmt = sorted[0]
        const last_payment_method = lastPmt?.method || ''
        const last_paid_at = lastPmt?.paid_at || f.opened_at

        // Display date: use last payment date if paid, else opened_at
        const display_date = last_paid_at || f.opened_at

        return { ...f, items_total: itemsTotal, payments_total: paymentsTotal, balance, last_payment_method, last_paid_at, display_date }
      })
      setFolios(summaries)
    }
    setLoading(false)
  }"""

new_fetch = """  async function fetchFolios() {
    setLoading(true)

    // Step 1: fetch folios with line items and payments
    let query = supabase
      .from('folios')
      .select(`
        id, guest_name, guest_email, folio_type, status, opened_at, reservation_id,
        folio_line_items ( line_total ),
        folio_payments ( amount, surcharge_amount, status, method, paid_at )
      `)
      .order('opened_at', { ascending: false })

    if (filter === 'open') query = query.eq('status', 'open')
    if (filter === 'walkin') query = query.eq('folio_type', 'walkin')
    if (filter === 'reservation') query = query.eq('folio_type', 'reservation')

    const { data } = await query
    if (!data) { setLoading(false); return }

    // Step 2: batch fetch reservations for folios that have a reservation_id
    const resIds = [...new Set((data as any[]).map(f => f.reservation_id).filter(Boolean))]
    let resMap: { [id: string]: any } = {}
    if (resIds.length > 0) {
      const { data: resData } = await supabase
        .from('reservations')
        .select('id, site_number, arrival_date, departure_date, total_price, amount_paid')
        .in('id', resIds)
      if (resData) resData.forEach((r: any) => { resMap[r.id] = r })
    }

    const summaries: FolioSummary[] = (data as any[]).map(f => {
      const reservation = f.reservation_id ? resMap[f.reservation_id] || null : null
      const itemsTotal = (f.folio_line_items || []).reduce((s: number, i: any) => s + i.line_total, 0)
      const completedPayments = (f.folio_payments || []).filter((p: any) => p.status === 'completed')
      const paymentsTotal = completedPayments.reduce((s: number, p: any) => s + p.amount - (p.surcharge_amount || 0), 0)
      const resBal = reservation ? Math.max(0, reservation.total_price - reservation.amount_paid) : 0
      const balance = Math.max(0, resBal + itemsTotal - paymentsTotal)

      const sorted = [...completedPayments].sort((a: any, b: any) =>
        new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()
      )
      const lastPmt = sorted[0]
      const last_payment_method = lastPmt?.method || ''
      const last_paid_at = lastPmt?.paid_at || f.opened_at
      const display_date = last_paid_at || f.opened_at

      return { ...f, reservations: reservation, items_total: itemsTotal, payments_total: paymentsTotal, balance, last_payment_method, last_paid_at, display_date }
    })
    setFolios(summaries)
    setLoading(false)
  }"""

checks = [
    ('Default filter to all', old_filter, new_filter),
    ('Two-step batch fetch', old_fetch, new_fetch),
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
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Folios: fix query to use batch reservation fetch" && git push')
else:
    print('\n\u274c Edit did not apply \u2014 file NOT saved. Paste output above to Claude.')
