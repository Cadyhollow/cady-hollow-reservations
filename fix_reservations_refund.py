path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reservations/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add square_payment_id to Reservation type ────────────────────────
old_type = """  waiver_signed: boolean
  notes: string
  created_at: string
  site_id: string
  camper_type: string
  camper_length: number
  camper_amperage: string
  sites: { site_number: string; site_type: string } | null
}"""

new_type = """  waiver_signed: boolean
  notes: string
  created_at: string
  site_id: string
  camper_type: string
  camper_length: number
  camper_amperage: string
  square_payment_id: string | null
  sites: { site_number: string; site_type: string } | null
}"""

# ── Edit 2: Add square_payment_id to fetchReservations select ────────────────
old_fetch = """    const { data } = await supabase
      .from('reservations')
      .select('*, sites(site_number, site_type)')
      .order('arrival_date', { ascending: true })"""

new_fetch = """    const { data } = await supabase
      .from('reservations')
      .select('*, sites(site_number, site_type), square_payment_id')
      .order('arrival_date', { ascending: true })"""

# ── Edit 3: Add refund state variables ───────────────────────────────────────
old_state = """  const [overrideTotal, setOverrideTotal] = useState(false)
  const [overrideTotalValue, setOverrideTotalValue] = useState('')"""

new_state = """  const [overrideTotal, setOverrideTotal] = useState(false)
  const [overrideTotalValue, setOverrideTotalValue] = useState('')
  const [showResRefund, setShowResRefund] = useState(false)
  const [resRefundAmount, setResRefundAmount] = useState('')
  const [resRefundReason, setResRefundReason] = useState('')
  const [processingResRefund, setProcessingResRefund] = useState(false)
  const [resRefundError, setResRefundError] = useState('')"""

# ── Edit 4: Add refund handler ────────────────────────────────────────────────
old_cancel_handler = """  async function handleCancel(res: Reservation) {"""

new_cancel_handler = """  async function handleResRefund() {
    if (!selected || !resRefundAmount) return
    setProcessingResRefund(true)
    setResRefundError('')
    const refundAmountCents = Math.round(parseFloat(resRefundAmount) * 100)

    // Process Square refund if card payment with square_payment_id
    if (selected.square_payment_id) {
      const squareResponse = await fetch('https://connect.squareup.com/v2/refunds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SQUARE_ACCESS_TOKEN}`,
          'Square-Version': '2024-01-18',
        },
        body: JSON.stringify({
          idempotency_key: `res-refund-${selected.id}-${Date.now()}`,
          payment_id: selected.square_payment_id,
          amount_money: { amount: refundAmountCents, currency: 'USD' },
          reason: resRefundReason || 'Refund',
        }),
      })
      const squareData = await squareResponse.json()
      if (!squareResponse.ok || squareData.errors) {
        setResRefundError(squareData.errors?.[0]?.detail || 'Square refund failed')
        setProcessingResRefund(false)
        return
      }
    }

    // Update amount_paid on reservation and append audit note
    const newAmountPaid = Math.max(0, selected.amount_paid - refundAmountCents)
    const refundNote = `[Refund ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}] $${parseFloat(resRefundAmount).toFixed(2)} refunded${resRefundReason ? ` — ${resRefundReason}` : ''}${selected.square_payment_id ? ' (Square)' : ' (cash/check)'}`
    const updatedNotes = selected.notes ? `${selected.notes}\n${refundNote}` : refundNote

    await supabase.from('reservations').update({
      amount_paid: newAmountPaid,
      notes: updatedNotes,
    }).eq('id', selected.id)

    toast.success('Refund recorded successfully!')
    setProcessingResRefund(false)
    setShowResRefund(false)
    setResRefundAmount('')
    setResRefundReason('')
    await fetchReservations()
    const { data } = await supabase.from('reservations').select('*, sites(site_number, site_type), square_payment_id').eq('id', selected.id).single()
    if (data) { setSelected(data); fetchAddons(data.id) }
  }

  async function handleCancel(res: Reservation) {"""

# ── Edit 5: Add Refund button in detail panel ─────────────────────────────────
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
                  <div className="flex gap-2 pt-3 flex-wrap">
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
                {selected.amount_paid > 0 && selected.status !== 'cancelled' && (
                  <div className="pt-2">
                    {!showResRefund ? (
                      <button
                        onClick={() => { setResRefundAmount(((selected.amount_paid * 0.9) / 100).toFixed(2)); setShowResRefund(true); setResRefundError('') }}
                        className="w-full bg-orange-50 text-orange-700 border border-orange-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-100"
                      >
                        Issue Refund
                      </button>
                    ) : (
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-orange-800">Issue Refund</span>
                          <span className="text-xs text-gray-500">Paid: ${(selected.amount_paid / 100).toFixed(2)}</span>
                        </div>
                        <div className="flex gap-2">
                          {[100, 90, 50].map(pct => (
                            <button key={pct} onClick={() => setResRefundAmount((selected.amount_paid * pct / 10000).toFixed(2))}
                              className="flex-1 bg-white border border-gray-200 rounded text-xs font-semibold py-1 hover:bg-gray-50">
                              {pct}%
                            </button>
                          ))}
                        </div>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                          <input type="number" step="0.01" className="w-full border border-gray-200 rounded pl-6 pr-2 py-1.5 text-sm"
                            value={resRefundAmount} onChange={e => setResRefundAmount(e.target.value)} />
                        </div>
                        <input type="text" placeholder="Reason (e.g. Cancellation — outside 7 days)"
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                          value={resRefundReason} onChange={e => setResRefundReason(e.target.value)} />
                        {selected.square_payment_id
                          ? <p className="text-xs text-green-700">✓ Will refund to card via Square</p>
                          : <p className="text-xs text-gray-500">Cash/check — return funds manually</p>}
                        {resRefundError && <p className="text-xs text-red-600">{resRefundError}</p>}
                        <div className="flex gap-2">
                          <button onClick={() => setShowResRefund(false)}
                            className="flex-1 bg-white border border-gray-200 rounded py-1.5 text-sm">Cancel</button>
                          <button onClick={handleResRefund} disabled={processingResRefund || !resRefundAmount}
                            className="flex-1 bg-red-600 text-white rounded py-1.5 text-sm font-semibold disabled:opacity-50">
                            {processingResRefund ? 'Processing...' : `Refund $${resRefundAmount}`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}"""

checks = [
    ('square_payment_id in type', old_type, new_type),
    ('Fetch square_payment_id', old_fetch, new_fetch),
    ('Refund state vars', old_state, new_state),
    ('Refund handler', old_cancel_handler, new_cancel_handler),
    ('Refund button in panel', old_buttons, new_buttons),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reservations: add refund button for online/manual reservations" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
