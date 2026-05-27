path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/transactions/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add Reservation type to Payment type ─────────────────────────────
old_type = """type Payment = {
  id: string
  paid_at: string
  method: string
  amount: number
  surcharge_amount: number
  status: string
  note: string
  folio_id: string
  folio_type: string
  guest_name: string
  reservation_id: string | null
  guest_id: string | null
}"""

new_type = """type Payment = {
  id: string
  paid_at: string
  method: string
  amount: number
  surcharge_amount: number
  status: string
  note: string
  folio_id: string
  folio_type: string
  guest_name: string
  reservation_id: string | null
  guest_id: string | null
  is_reservation_payment?: boolean // true for direct reservation payments (no folio)
}"""

# ── Edit 2: Fetch reservation payments in fetchPayments ──────────────────────
old_fetch_end = """    if (pmtData) {
      const mapped: Payment[] = (pmtData as any[]).map(p => ({
        id: p.id,
        paid_at: p.paid_at,
        method: p.method,
        amount: p.amount,
        surcharge_amount: p.surcharge_amount || 0,
        status: p.status,
        note: p.note || '',
        folio_id: p.folio_id,
        folio_type: p.folios?.folio_type || '',
        guest_name: p.folios?.guest_name || 'Unknown',
        reservation_id: p.folios?.reservation_id || null,
        guest_id: p.folios?.guest_id || null,
      }))
      setPayments(mapped)
    }
    setLoading(false)
  }"""

new_fetch_end = """    // Also fetch online reservation payments (stored directly on reservations, no folio)
    const { data: resData } = await supabase
      .from('reservations')
      .select('id, guest_name, amount_paid, payment_type, created_at, square_payment_id')
      .gt('amount_paid', 0)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .neq('status', 'cancelled')
      .is('id', null) // placeholder — will be replaced below

    // Get reservation IDs that already have folios (to avoid double counting)
    const { data: folioResIds } = await supabase
      .from('folios')
      .select('reservation_id')
      .not('reservation_id', 'is', null)
    const folioResIdSet = new Set((folioResIds || []).map((f: any) => f.reservation_id))

    // Fetch online reservations WITHOUT folios
    const { data: onlineResData } = await supabase
      .from('reservations')
      .select('id, guest_name, amount_paid, payment_type, created_at, square_payment_id')
      .gt('amount_paid', 0)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .neq('status', 'cancelled')

    const onlinePayments: Payment[] = (onlineResData || [])
      .filter((r: any) => !folioResIdSet.has(r.id))
      .map((r: any) => ({
        id: 'res-' + r.id,
        paid_at: r.created_at,
        method: 'card',
        amount: r.amount_paid,
        surcharge_amount: 0,
        status: 'completed',
        note: r.payment_type === 'deposit' ? 'Deposit' : r.payment_type === 'unpaid' ? 'Pay on arrival' : 'Full payment',
        folio_id: '',
        folio_type: 'reservation',
        guest_name: r.guest_name,
        reservation_id: r.id,
        guest_id: null,
        is_reservation_payment: true,
      }))

    if (pmtData) {
      const folioPayments: Payment[] = (pmtData as any[]).map(p => ({
        id: p.id,
        paid_at: p.paid_at,
        method: p.method,
        amount: p.amount,
        surcharge_amount: p.surcharge_amount || 0,
        status: p.status,
        note: p.note || '',
        folio_id: p.folio_id,
        folio_type: p.folios?.folio_type || '',
        guest_name: p.folios?.guest_name || 'Unknown',
        reservation_id: p.folios?.reservation_id || null,
        guest_id: p.folios?.guest_id || null,
        is_reservation_payment: false,
      }))
      // Merge and sort by date descending
      const all = [...folioPayments, ...onlinePayments]
        .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())
      setPayments(all)
    }
    setLoading(false)
  }"""

# ── Edit 3: Fix getFolioHref to handle online reservations ───────────────────
old_href = """  function getFolioHref(p: Payment) {
    if (p.folio_type === 'guest_account' && p.guest_id) return '/admin/folio/guest/' + p.guest_id
    if (p.reservation_id) return '/admin/folio/' + p.reservation_id
    return '/admin/folio/' + p.folio_id
  }"""

new_href = """  function getFolioHref(p: Payment) {
    if (p.folio_type === 'guest_account' && p.guest_id) return '/admin/folio/guest/' + p.guest_id
    if (p.reservation_id) return '/admin/folio/' + p.reservation_id
    if (p.folio_id) return '/admin/folio/' + p.folio_id
    return '/admin/reservations'
  }"""

# ── Edit 4: Handle online reservations in expand (no line items) ─────────────
old_expand = """                        {/* Line items */}
                                {folioLineItems.length > 0 ? ("""

new_expand = """                        {/* Online reservation payments have no line items */}
                                {p.is_reservation_payment ? (
                                  <div className="mt-3 bg-white rounded-lg border border-gray-200 px-3 py-3">
                                    <p className="text-sm text-gray-600">Online reservation payment via Square.</p>
                                    <p className="text-xs text-gray-400 mt-1">Full itemized details are on the reservation record.</p>
                                  </div>
                                ) : folioLineItems.length > 0 ? ("""

# Close the ternary after the existing else clause
old_no_items = """                                ) : (
                                  <p className="text-xs text-gray-400 mt-3">No itemized charges on record.</p>
                                )}"""

new_no_items = """                                ) : (
                                  <p className="text-xs text-gray-400 mt-3">No itemized charges on record.</p>
                                )}"""

checks = [
    ('Payment type updated', old_type, new_type),
    ('Fetch online reservations', old_fetch_end, new_fetch_end),
    ('Fix getFolioHref', old_href, new_href),
    ('Handle online res in expand', old_expand, new_expand),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Transactions: include online reservation payments from reservations table" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
