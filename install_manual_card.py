import shutil, os

# Step 1: Create the API route
src = os.path.expanduser('~/Downloads/admin_card_payment_route.ts')
dst_dir = '/Users/charissachiaravalloti/cady-hollow-reservations/app/api/admin-card-payment'
dst = dst_dir + '/route.ts'
os.makedirs(dst_dir, exist_ok=True)
shutil.copy2(src, dst)
print('  \u2713 Admin card payment API route created')

# Step 2: Add manual card entry state + logic to folio page
path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Add state for manual card entry
old_state = "  const [customDesc, setCustomDesc] = useState('')\n  const [customPrice, setCustomPrice] = useState('')\n  const [customQty, setCustomQty] = useState('1')"
new_state = """  const [customDesc, setCustomDesc] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [customQty, setCustomQty] = useState('1')
  const [cardEntryMode, setCardEntryMode] = useState<'terminal' | 'manual'>('terminal')
  const [squareCardLoaded, setSquareCardLoaded] = useState(false)
  const [squareCardRef, setSquareCardRef] = useState<any>(null)
  const [squareInstanceRef, setSquareInstanceRef] = useState<any>(null)
  const [chargingCard, setChargingCard] = useState(false)"""

# Add Square card loader function after init()
old_load = "  async function loadFolioData(folioId: string) {"
new_load = """  async function loadSquareCard() {
    if (squareCardLoaded) return
    const existing = document.getElementById('admin-square-card-container')
    if (!existing) return
    try {
      let sq = squareInstanceRef
      if (!sq) {
        const script = document.createElement('script')
        script.src = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production'
          ? 'https://web.squarecdn.com/v1/square.js'
          : 'https://sandbox.web.squarecdn.com/v1/square.js'
        await new Promise((resolve) => { script.onload = resolve; document.head.appendChild(script) })
        sq = (window as any).Square.payments(process.env.NEXT_PUBLIC_SQUARE_APP_ID!, 'L42H3PRBWB5CJ')
        setSquareInstanceRef(sq)
      }
      const card = await sq.card()
      await card.attach('#admin-square-card-container')
      setSquareCardRef(card)
      setSquareCardLoaded(true)
    } catch (e) { console.error('Square card load error:', e) }
  }

  async function chargeManualCard() {
    if (!squareCardRef || !folio) return
    setChargingCard(true)
    try {
      const result = await squareCardRef.tokenize()
      if (result.status !== 'OK') {
        setChargingCard(false)
        return
      }
      const baseAmount = Math.round(parseFloat(paymentAmount) * 100)
      const surchargeAmount = cardSurcharge > 0 && !waiveFee
        ? Math.round(baseAmount * (cardSurcharge / 100))
        : 0
      const totalAmount = baseAmount + surchargeAmount

      const res = await fetch('/api/admin-card-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: result.token,
          folioId: folio.id,
          amount: totalAmount,
          surchargeAmount,
          note: paymentNote,
          guestName: folio.guest_name,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setShowPayment(false)
        setPaymentAmount('')
        setPaymentNote('')
        setCardEntryMode('terminal')
        setSquareCardLoaded(false)
        setSquareCardRef(null)
        await loadFolioData(folio.id)
      } else {
        alert(data.error || 'Card payment failed')
      }
    } catch (e) { console.error('Card charge error:', e) }
    setChargingCard(false)
  }

  async function loadFolioData(folioId: string) {"""

# Add manual card option in the payment modal — replace the terminal card section
old_terminal_section = """            {paymentMethod === 'card' && terminalDeviceId ? (
              <div style={{ background: '#e8f2f7', border: '1px solid #b8d4e8', borderRadius: 10, padding: '1.25rem', marginBottom: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>💳</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1e3f52', marginBottom: 4 }}>Send to Square Terminal</div>
                <div style={{ fontSize: 13, color: '#4a6275', marginBottom: 12 }}>
                  Amount: <strong>${(totalDue/100).toFixed(2)}</strong>
                  {cardSurcharge > 0 && <span> + {cardSurcharge}% fee = <strong>${((totalDue + Math.round(totalDue * cardSurcharge / 100))/100).toFixed(2)}</strong></span>}
                </div>
                <button
                  onClick={() => { setShowPayment(false); sendToTerminal() }}
                  disabled={sendingToTerminal}
                  style={{ background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
                >
                  {sendingToTerminal ? 'Sending...' : 'Send to Terminal →'}
                </button>
              </div>"""

new_terminal_section = """            {paymentMethod === 'card' && (
              <div style={{ marginBottom: 16 }}>
                {/* Card mode selector */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  {terminalDeviceId && (
                    <button onClick={() => setCardEntryMode('terminal')}
                      style={{ padding: '10px', border: '2px solid', borderColor: cardEntryMode === 'terminal' ? '#2E6B8A' : '#e5e7eb', borderRadius: 8, background: cardEntryMode === 'terminal' ? '#e8f2f7' : '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: cardEntryMode === 'terminal' ? '#2E6B8A' : '#374151' }}>
                      💳 Use Terminal
                    </button>
                  )}
                  <button onClick={() => { setCardEntryMode('manual'); setTimeout(loadSquareCard, 100) }}
                    style={{ padding: '10px', border: '2px solid', borderColor: cardEntryMode === 'manual' ? '#2E6B8A' : '#e5e7eb', borderRadius: 8, background: cardEntryMode === 'manual' ? '#e8f2f7' : '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: cardEntryMode === 'manual' ? '#2E6B8A' : '#374151', gridColumn: terminalDeviceId ? 'auto' : '1 / -1' }}>
                    ⌨️ Enter Card Manually
                  </button>
                </div>
              </div>
            )}
            {paymentMethod === 'card' && cardEntryMode === 'terminal' && terminalDeviceId ? (
              <div style={{ background: '#e8f2f7', border: '1px solid #b8d4e8', borderRadius: 10, padding: '1.25rem', marginBottom: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>💳</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1e3f52', marginBottom: 4 }}>Send to Square Terminal</div>
                <div style={{ fontSize: 13, color: '#4a6275', marginBottom: 12 }}>
                  Amount: <strong>${(totalDue/100).toFixed(2)}</strong>
                  {cardSurcharge > 0 && <span> + {cardSurcharge}% fee = <strong>${((totalDue + Math.round(totalDue * cardSurcharge / 100))/100).toFixed(2)}</strong></span>}
                </div>
                <button
                  onClick={() => { setShowPayment(false); sendToTerminal() }}
                  disabled={sendingToTerminal}
                  style={{ background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
                >
                  {sendingToTerminal ? 'Sending...' : 'Send to Terminal →'}
                </button>
              </div>"""

# Add manual card form before the closing of the payment modal
old_modal_end = """            {!(paymentMethod === 'card' && terminalDeviceId) && ("""
new_modal_end = """            {paymentMethod === 'card' && cardEntryMode === 'manual' && (
              <div style={{ marginBottom: 16 }}>
                <label style={ml}>Card Details</label>
                <div id='admin-square-card-container' style={{ minHeight: 89, border: '1px solid #d1d5db', borderRadius: 8, padding: 4 }} />
                {!squareCardLoaded && <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Loading card form...</p>}
                {cardSurcharge > 0 && !waiveFee && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginTop: 8, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#92400e' }}>{cardSurcharge}% card fee</span>
                      <span style={{ color: '#92400e', fontWeight: 600 }}>+${(Math.round(Math.round(parseFloat(paymentAmount || '0') * 100) * cardSurcharge / 100) / 100).toFixed(2)}</span>
                    </div>
                  </div>
                )}
                <label style={{ ...ml, marginTop: 12 }}>Note (optional)</label>
                <input style={{ ...si, marginBottom: 12 }} placeholder='e.g. phone reservation' value={paymentNote} onChange={e => setPaymentNote(e.target.value)} />
                <button
                  onClick={chargeManualCard}
                  disabled={chargingCard || !squareCardLoaded || !paymentAmount}
                  style={{ width: '100%', background: chargingCard || !squareCardLoaded || !paymentAmount ? '#d1d5db' : '#2E6B8A', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
                >
                  {chargingCard ? 'Processing...' : `Charge Card · $${paymentAmount || '0.00'}`}
                </button>
              </div>
            )}
            {!(paymentMethod === 'card' && terminalDeviceId && cardEntryMode === 'terminal') && !(paymentMethod === 'card' && cardEntryMode === 'manual') && ("""

checks = [
    ('Manual card state vars', old_state, new_state),
    ('Square card loader + charge function', old_load, new_load),
    ('Card mode selector in modal', old_terminal_section, new_terminal_section),
    ('Manual card form in modal', old_modal_end, new_modal_end),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Folio: add manual card entry option in payment modal" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
