path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reports/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Replace the entire guest account payments section with a clean 3-step approach
old_ga_query = """    // ── Guest account payments (electric + other seasonal charges) ──────────
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

new_ga_query = """    // ── Seasonal guest account payments (is_seasonal = true guests only) ────
    // Step 1: get IDs of seasonal guests only
    const { data: seasonalGuests } = await supabase
      .from('guests')
      .select('id')
      .eq('is_seasonal', true)
    const seasonalGuestIds = (seasonalGuests || []).map((g: any) => g.id)

    // Step 2: get guest_account folio IDs belonging to seasonal guests
    let gaFolioIds: string[] = []
    if (seasonalGuestIds.length > 0) {
      const { data: gaFolios } = await supabase
        .from('folios')
        .select('id')
        .eq('folio_type', 'guest_account')
        .in('guest_id', seasonalGuestIds)
      gaFolioIds = (gaFolios || []).map((f: any) => f.id)
    }

    // Step 3: get payments and line items on those folios
    let gaPmtData: any[] = []
    if (gaFolioIds.length > 0) {
      const { data: gaPmts } = await supabase
        .from('folio_payments')
        .select('id, paid_at, method, amount, surcharge_amount, status, folio_id')
        .eq('status', 'completed')
        .gte('paid_at', startISO)
        .lte('paid_at', endISO)
        .in('folio_id', gaFolioIds)
      gaPmtData = gaPmts || []

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

# Fix the main payments query to exclude ALL guest_account folios (not just seasonal)
# by fetching all guest_account folio IDs and excluding them
old_pmt_query = """    // ── All payments (reservation + POS only, NOT guest_account) ────────────
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

new_pmt_query = """    // ── All reservation + POS payments (walkin, walkup, reservation only) ───
    // Get all guest_account folio IDs to exclude them
    const { data: allGaFolios } = await supabase
      .from('folios')
      .select('id')
      .eq('folio_type', 'guest_account')
    const allGaFolioIds = (allGaFolios || []).map((f: any) => f.id)

    // Fetch payments NOT on guest_account folios
    let pmtData: any[] = []
    if (allGaFolioIds.length > 0) {
      const { data: pmts } = await supabase
        .from('folio_payments')
        .select(`
          id, paid_at, method, amount, surcharge_amount, status, folio_id,
          folios ( id, guest_name, folio_type, reservation_id )
        `)
        .eq('status', 'completed')
        .gte('paid_at', startISO)
        .lte('paid_at', endISO)
        .not('folio_id', 'in', `(${allGaFolioIds.join(',')})`)
        .order('paid_at', { ascending: false })
      pmtData = pmts || []
    } else {
      const { data: pmts } = await supabase
        .from('folio_payments')
        .select(`
          id, paid_at, method, amount, surcharge_amount, status, folio_id,
          folios ( id, guest_name, folio_type, reservation_id )
        `)
        .eq('status', 'completed')
        .gte('paid_at', startISO)
        .lte('paid_at', endISO)
        .order('paid_at', { ascending: false })
      pmtData = pmts || []
    }"""

# Fix the stat card label from "Electric Billing" / "Other Guest Charges" to "Seasonal Revenue"
old_stat_cards = """                  { label: 'Electric Billing', value: '$' + electricRevenue.toFixed(2), sub: 'seasonal electric' },
                  ...(otherGuestRevenue > 0 ? [{ label: 'Other Guest Charges', value: '$' + otherGuestRevenue.toFixed(2), sub: 'visitors, golf, store, etc.' }] : []),"""

new_stat_cards = """                  { label: 'Seasonal Revenue', value: '$' + (electricRevenue + otherGuestRevenue).toFixed(2), sub: 'seasonal guest accounts' },"""

checks = [
    ('Seasonal guest account query', old_ga_query, new_ga_query),
    ('Exclude guest_account from main payments', old_pmt_query, new_pmt_query),
    ('Seasonal Revenue stat card', old_stat_cards, new_stat_cards),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reports: fix seasonal revenue to only include is_seasonal guests, fix double counting" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
