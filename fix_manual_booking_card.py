path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/manual-booking/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add Square card state variables ───────────────────────────────────
old_state = "  const [balanceDue, setBalanceDue] = useState('')"
new_state = """  const [balanceDue, setBalanceDue] = useState('')
  const [squareCardRef, setSquareCardRef] = useState<any>(null)
  const [squareCardLoaded, setSquareCardLoaded] = useState(false)
  const [squareInstance, setSquareInstance] = useState<any>(null)"""

# ── Edit 2: Add Square card loader function after fetchFees ───────────────────
old_fetch_fees = "  async function fetchFees() {\n    const { data } = await supabase.from('fees').select('*').eq('is_active', true)\n    if (data) {"
new_fetch_fees = """  async function loadSquareCard() {
    if (squareCardLoaded) return
    const container = document.getElementById('manual-booking-card')
    if (!container) return
    try {
      let sq = squareInstance
      if (!sq) {
        const script = document.createElement('script')
        script.src = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production'
          ? 'https://web.squarecdn.com/v1/square.js'
          : 'https://sandbox.web.squarecdn.com/v1/square.js'
        await new Promise((resolve) => { script.onload = resolve; document.head.appendChild(script) })
        sq = (window as any).Square.payments(process.env.NEXT_PUBLIC_SQUARE_APP_ID!, 'L42H3PRBWB5CJ')
        setSquareInstance(sq)
      }
      const card = await sq.card()
      await card.attach('#manual-booking-card')
      setSquareCardRef(card)
      setSquareCardLoaded(true)
    } catch (e) { console.error('Square card load error:', e) }
  }

  async function fetchFees() {
    const { data } = await supabase.from('fees').select('*').eq('is_active', true)
    if (data) {"""

# ── Edit 3: Update handleSave to charge card if method is card ────────────────
old_save_start = """    setSaving(true)
    const amountPaid = form.amount_paid ? Math.round(parseFloat(form.amount_paid) * 100) : 0"""

new_save_start = """    setSaving(true)
    const amountPaid = form.amount_paid ? Math.round(parseFloat(form.amount_paid) * 100) : 0

    // If card payment, tokenize first before creating reservation
    let cardToken: string | null = null
    if (form.payment_method === 'card' && amountPaid > 0) {
      if (!squareCardRef) {
        toast.error('Card form not ready. Please wait a moment.')
        setSaving(false)
        return
      }
      const result = await squareCardRef.tokenize()
      if (result.status !== 'OK') {
        toast.error('Card details invalid. Please check and try again.')
        setSaving(false)
        return
      }
      cardToken = result.token
    }"""

# ── Edit 4: After reservation is created, charge the card ────────────────────
old_after_save = """    toast.success(`Reservation created! Confirmation #${data.confirmationNumber}`)
    setSaving(false)
    setForm({"""

new_after_save = """    // Charge card if applicable — create folio first then charge
    if (cardToken && data.reservationId && amountPaid > 0) {
      // Create folio for this reservation
      const { data: newFolio } = await supabase.from('folios').insert({
        reservation_id: data.reservationId,
        guest_name: form.guest_name,
        guest_email: form.guest_email || '',
        folio_type: 'reservation',
        status: 'open',
      }).select().single()

      if (newFolio) {
        const cardRes = await fetch('/api/admin-card-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: cardToken,
            folioId: newFolio.id,
            amount: amountPaid,
            surchargeAmount: 0,
            guestName: form.guest_name,
          }),
        })
        const cardData = await cardRes.json()
        if (!cardData.success) {
          toast.error('Reservation created but card charge failed: ' + (cardData.error || 'Unknown error'))
          setSaving(false)
          return
        }
      }
    }

    toast.success(`Reservation created! Confirmation #${data.confirmationNumber}`)
    setSaving(false)
    setSquareCardLoaded(false)
    setSquareCardRef(null)
    setForm({"""

# ── Edit 5: Add card form UI below payment method selector ────────────────────
old_amount_field = """              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount Paid Today ($)</label>
                <input type="number" min="0" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0.00" value={form.amount_paid} onChange={e => setForm({ ...form, amount_paid: e.target.value })} />
                <p className="text-xs text-gray-400 mt-1">Card total: ${(total / 100).toFixed(2)} · Cash total: ${(cashTotal / 100).toFixed(2)}</p>
              </div>"""

new_amount_field = """              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount Paid Today ($)</label>
                <input type="number" min="0" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0.00" value={form.amount_paid} onChange={e => setForm({ ...form, amount_paid: e.target.value })} />
                <p className="text-xs text-gray-400 mt-1">Card total: ${(total / 100).toFixed(2)} · Cash total: ${(cashTotal / 100).toFixed(2)}</p>
              </div>
              {form.payment_method === 'card' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Card Details</label>
                  <div id="manual-booking-card" className="border border-gray-200 rounded-lg p-2 min-h-[89px]"
                    ref={el => { if (el && !squareCardLoaded) setTimeout(loadSquareCard, 100) }}
                  />
                  {!squareCardLoaded && <p className="text-xs text-gray-400 mt-1">Loading card form...</p>}
                </div>
              )}"""

checks = [
    ('Square card state', old_state, new_state),
    ('Square card loader function', old_fetch_fees, new_fetch_fees),
    ('Tokenize before save', old_save_start, new_save_start),
    ('Charge card after reservation', old_after_save, new_after_save),
    ('Card form UI', old_amount_field, new_amount_field),
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
    print('Next: check if manual-booking API returns folioId, then push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
