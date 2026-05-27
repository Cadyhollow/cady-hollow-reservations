path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reports/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Fix the guest account payments query - fetch folio IDs first, then payments
old_ga_query = """    // ── Guest account payments (electric + other seasonal charges) ──────────
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
    }"""

new_ga_query = """    // ── Guest account payments (electric + other seasonal charges) ──────────
    // Step 1: get guest_account folio IDs in this period
    const { data: gaFolios } = await supabase
      .from('folios')
      .select('id')
      .eq('folio_type', 'guest_account')

    const gaFolioIds = (gaFolios || []).map((f: any) => f.id)

    let gaPmtData: any[] = []
    if (gaFolioIds.length > 0) {
      // Step 2: get payments on those folios in the date range
      const { data: gaPmts } = await supabase
        .from('folio_payments')
        .select('id, paid_at, method, amount, surcharge_amount, status, folio_id')
        .eq('status', 'completed')
        .gte('paid_at', startISO)
        .lte('paid_at', endISO)
        .in('folio_id', gaFolioIds)
      gaPmtData = gaPmts || []

      // Step 3: get line items on those folios in the date range
      const { data: gaLiData } = await supabase
        .from('folio_line_items')
        .select('folio_id, category, line_total, description, quantity, unit_price, charged_at')
        .in('folio_id', gaFolioIds)
        .gte('charged_at', startISO)
        .lte('charged_at', endISO)
      if (gaLiData) setGuestAccountLineItems(gaLiData as any)
    } else {
      setGuestAccountLineItems([])
    }"""

# Also fix the transactions query to EXCLUDE guest_account folios to avoid double counting
old_pmt_query = """    // ── All payments (reservation + POS) in date range ────────────────────
    const { data: pmtData } = await supabase
      .from('folio_payments')
      .select(`
        id, paid_at, method, amount, surcharge_amount, status, folio_id,
        folios ( id, guest_name, folio_type, reservation_id )
      `)
      .eq('status', 'completed')
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })"""

new_pmt_query = """    // ── All payments (reservation + POS only, NOT guest_account) ────────────
    const { data: pmtData } = await supabase
      .from('folio_payments')
      .select(`
        id, paid_at, method, amount, surcharge_amount, status, folio_id,
        folios ( id, guest_name, folio_type, reservation_id )
      `)
      .eq('status', 'completed')
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .not('folio_id', 'in', gaFolioIds.length > 0 ? '(' + gaFolioIds.join(',') + ')' : '(null)')
      .order('paid_at', { ascending: false })"""

# Fix guestAccountPayments assignment
old_set_ga = "    setGuestAccountPayments((gaPmtData as any) || [])"
new_set_ga = "    setGuestAccountPayments(gaPmtData)"

checks = [
    ('Guest account query fix', old_ga_query, new_ga_query),
    ('Exclude guest_account from transactions', old_pmt_query, new_pmt_query),
    ('Set guest account payments', old_set_ga, new_set_ga),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reports: fix guest account payment query to prevent double counting" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
