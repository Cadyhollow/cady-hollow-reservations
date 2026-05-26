path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reservations/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add sortBy state ──────────────────────────────────────────────────
old_state = "  const [savingNotes, setSavingNotes] = useState(false)"
new_state = "  const [savingNotes, setSavingNotes] = useState(false)\n  const [sortBy, setSortBy] = useState<'arrival_date' | 'created_at' | 'guest_name'>('arrival_date')"

# ── Edit 2: Add hard delete handler after handleCancel ────────────────────────
old_cancel = """  async function handleCancel(res: Reservation) {
    if (!confirm(`Cancel reservation for ${res.guest_name}? This cannot be undone.`)) return
    await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', res.id)
    toast.success('Reservation cancelled.')
    fetchReservations()
    setSelected(null)
  }"""

new_cancel = """  async function handleCancel(res: Reservation) {
    if (!confirm(`Cancel reservation for ${res.guest_name}?\\n\\nThis marks it as cancelled but keeps the record in your history.`)) return
    await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', res.id)
    toast.success('Reservation cancelled.')
    fetchReservations()
    setSelected(null)
  }

  async function handleDelete(res: Reservation) {
    if (!confirm(`PERMANENTLY DELETE this reservation for ${res.guest_name}?\\n\\nThis cannot be undone and will remove all records. Only use this for test data or duplicates.`)) return
    const secondConfirm = prompt(`Type DELETE to confirm permanently removing this reservation:`)
    if (secondConfirm !== 'DELETE') { toast.error('Deletion cancelled.'); return }
    await supabase.from('reservation_addons').delete().eq('reservation_id', res.id)
    await supabase.from('folios').delete().eq('reservation_id', res.id)
    await supabase.from('reservations').delete().eq('id', res.id)
    toast.success('Reservation permanently deleted.')
    fetchReservations()
    setSelected(null)
  }"""

# ── Edit 3: Add sort logic to filtered ───────────────────────────────────────
old_filtered = """  const filtered = reservations.filter(res => {
    const matchesSearch =
      res.guest_name.toLowerCase().includes(search.toLowerCase()) ||
      res.guest_email.toLowerCase().includes(search.toLowerCase()) ||
      res.sites?.site_number.includes(search)
    const matchesStatus = statusFilter === 'all' || res.status === statusFilter
    return matchesSearch && matchesStatus
  })"""

new_filtered = """  const filtered = reservations.filter(res => {
    const matchesSearch =
      res.guest_name.toLowerCase().includes(search.toLowerCase()) ||
      res.guest_email.toLowerCase().includes(search.toLowerCase()) ||
      res.sites?.site_number.includes(search)
    const matchesStatus = statusFilter === 'all' || res.status === statusFilter
    return matchesSearch && matchesStatus
  }).sort((a, b) => {
    if (sortBy === 'arrival_date') return a.arrival_date.localeCompare(b.arrival_date)
    if (sortBy === 'created_at') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (sortBy === 'guest_name') return a.guest_name.localeCompare(b.guest_name)
    return 0
  })"""

# ── Edit 4: Add sort dropdown to filters row ─────────────────────────────────
old_filters = """        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm shrink-0"
          style={{ width: '180px' }}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="manual">Manual</option>
          <option value="cancelled">Cancelled</option>
        </select>"""

new_filters = """        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm shrink-0"
          style={{ width: '180px' }}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="manual">Manual</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm shrink-0"
          style={{ width: '180px' }}
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
        >
          <option value="arrival_date">Sort: Arrival Date</option>
          <option value="created_at">Sort: Date Booked</option>
          <option value="guest_name">Sort: Guest Name</option>
        </select>"""

# ── Edit 5: Add Delete button in detail panel for cancelled reservations ─────
old_buttons = """                {selected.status !== 'cancelled' && (
                  <div className="flex gap-2 pt-3">
                    <button
                      onClick={() => startEditing(selected)}
                      className="flex-1 bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800"
                    >
                      Edit Reservation
                    </button>
                    <button
                      onClick={() => window.location.href = '/admin/folio/' + selected.id}
                      className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white"
                      style={{ background: '#2E6B8A', border: 'none', cursor: 'pointer' }}
                    >
                      Open Folio
                    </button>
                    <button
                      onClick={() => handleCancel(selected)}
                      className="flex-1 bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100"
                    >
                      Cancel
                    </button>
                  </div>
                )}"""

new_buttons = """                {selected.status !== 'cancelled' && (
                  <div className="flex gap-2 pt-3">
                    <button
                      onClick={() => startEditing(selected)}
                      className="flex-1 bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800"
                    >
                      Edit Reservation
                    </button>
                    <button
                      onClick={() => window.location.href = '/admin/folio/' + selected.id}
                      className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white"
                      style={{ background: '#2E6B8A', border: 'none', cursor: 'pointer' }}
                    >
                      Open Folio
                    </button>
                    <button
                      onClick={() => handleCancel(selected)}
                      className="flex-1 bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {selected.status === 'cancelled' && (
                  <div className="pt-3">
                    <div className="text-xs text-gray-400 mb-2 text-center">This reservation is cancelled and kept for records.</div>
                    <button
                      onClick={() => handleDelete(selected)}
                      className="w-full bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
                    >
                      🗑 Permanently Delete
                    </button>
                  </div>
                )}"""

checks = [
    ('sortBy state', old_state, new_state),
    ('handleDelete function', old_cancel, new_cancel),
    ('Sort logic on filtered', old_filtered, new_filtered),
    ('Sort dropdown in filters', old_filters, new_filters),
    ('Delete button for cancelled', old_buttons, new_buttons),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reservations: sort control, soft cancel message, hard delete for cancelled" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
