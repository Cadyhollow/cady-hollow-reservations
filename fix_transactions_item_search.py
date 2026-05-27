path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/transactions/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add folioIdsByItem state ─────────────────────────────────────────
old_state = """  const [loadingItems, setLoadingItems] = useState<string | null>(null)"""

new_state = """  const [loadingItems, setLoadingItems] = useState<string | null>(null)
  const [folioIdsByItem, setFolioIdsByItem] = useState<Set<string>>(new Set())
  const [searchingItems, setSearchingItems] = useState(false)"""

# ── Edit 2: Add item search function ─────────────────────────────────────────
old_load_items = """  async function loadLineItems(folioId: string) {"""

new_load_items = """  // Search line items by description when query doesn't match payment fields
  async function searchLineItems(q: string) {
    if (!q.trim()) { setFolioIdsByItem(new Set()); return }
    setSearchingItems(true)
    const { data } = await supabase
      .from('folio_line_items')
      .select('folio_id')
      .ilike('description', '%' + q + '%')
    setFolioIdsByItem(new Set((data || []).map((r: any) => r.folio_id)))
    setSearchingItems(false)
  }

  async function loadLineItems(folioId: string) {"""

# ── Edit 3: Trigger item search when search changes ──────────────────────────
old_useeffect = """  useEffect(() => { fetchPayments() }, [dateRange])"""

new_useeffect = """  useEffect(() => { fetchPayments() }, [dateRange])

  useEffect(() => {
    const timer = setTimeout(() => { searchLineItems(search) }, 300)
    return () => clearTimeout(timer)
  }, [search])"""

# ── Edit 4: Update filtered to also match by folio_id in folioIdsByItem ──────
old_filtered = """  // Filtered payments
  const filtered = payments.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      p.guest_name.toLowerCase().includes(q) ||
      (p.amount / 100).toFixed(2).includes(q) ||
      p.method.toLowerCase().includes(q) ||
      p.note.toLowerCase().includes(q) ||
      p.folio_type.toLowerCase().includes(q)
    const matchMethod = methodFilter === 'all' || p.method === methodFilter
    const matchType = typeFilter === 'all' ||
      (typeFilter === 'reservation' && p.folio_type === 'reservation') ||
      (typeFilter === 'walkin' && (p.folio_type === 'walkin' || p.folio_type === 'walkup')) ||
      (typeFilter === 'seasonal' && p.folio_type === 'guest_account')
    return matchSearch && matchMethod && matchType
  })"""

new_filtered = """  // Filtered payments
  const filtered = payments.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      p.guest_name.toLowerCase().includes(q) ||
      (p.amount / 100).toFixed(2).includes(q) ||
      p.method.toLowerCase().includes(q) ||
      p.note.toLowerCase().includes(q) ||
      p.folio_type.toLowerCase().includes(q) ||
      (p.folio_id && folioIdsByItem.has(p.folio_id)) // match by line item description
    const matchMethod = methodFilter === 'all' || p.method === methodFilter
    const matchType = typeFilter === 'all' ||
      (typeFilter === 'reservation' && p.folio_type === 'reservation') ||
      (typeFilter === 'walkin' && (p.folio_type === 'walkin' || p.folio_type === 'walkup')) ||
      (typeFilter === 'seasonal' && p.folio_type === 'guest_account')
    return matchSearch && matchMethod && matchType
  })"""

# ── Edit 5: Show searching indicator in search box ───────────────────────────
old_search_input = """        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search by name, amount, method, or note..."
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>"""

new_search_input = """        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            {searchingItems ? '⏳' : '🔍'}
          </span>
          <input
            type="text"
            placeholder="Search by name, amount, method, note, or item (e.g. firewood)..."
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          )}
        </div>"""

checks = [
    ('folioIdsByItem state', old_state, new_state),
    ('searchLineItems function', old_load_items, new_load_items),
    ('useEffect for item search', old_useeffect, new_useeffect),
    ('filtered includes item match', old_filtered, new_filtered),
    ('Search placeholder updated', old_search_input, new_search_input),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Transactions: add line item search (e.g. firewood, electric)" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
