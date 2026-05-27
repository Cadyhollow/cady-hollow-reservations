import shutil, os

# ── Step 1: Create refund API route ──────────────────────────────────────────
src = os.path.expanduser('~/Downloads/refund_route.ts')
dst_dir = '/Users/charissachiaravalloti/cady-hollow-reservations/app/api/refund'
dst = dst_dir + '/route.ts'
os.makedirs(dst_dir, exist_ok=True)
shutil.copy2(src, dst)
print('  \u2713 Refund API route created at app/api/refund/route.ts')

# ── Step 2: Add refund modal + button to folio page ───────────────────────────
folio_path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(folio_path, 'r') as f:
    content = f.read()

# Add refund state variables
old_state = "  const [customDesc, setCustomDesc] = useState('')\n  const [customPrice, setCustomPrice] = useState('')\n  const [customQty, setCustomQty] = useState('1')"
new_state = """  const [customDesc, setCustomDesc] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [customQty, setCustomQty] = useState('1')
  const [showRefund, setShowRefund] = useState(false)
  const [refundPayment, setRefundPayment] = useState<any>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [processingRefund, setProcessingRefund] = useState(false)
  const [refundError, setRefundError] = useState('')"""

# Add refund handler after voidPayment function
old_void = """  async function voidPayment(id: string) {
    if (!confirm('Void this payment? This cannot be undone.')) return
    await supabase.from('folio_payments').update({ status: 'voided' }).eq('id', id)
    await loadFolioData(folio!.id)
  }"""

new_void = """  async function voidPayment(id: string) {
    if (!confirm('Void this payment? This cannot be undone.')) return
    await supabase.from('folio_payments').update({ status: 'voided' }).eq('id', id)
    await loadFolioData(folio!.id)
  }

  function openRefund(payment: any) {
    const suggestedAmount = ((payment.amount - (payment.surcharge_amount || 0)) * 0.9 / 100).toFixed(2)
    setRefundPayment(payment)
    setRefundAmount(suggestedAmount)
    setRefundReason('')
    setRefundError('')
    setShowRefund(true)
  }

  async function processRefund() {
    if (!refundPayment || !refundAmount || !folio) return
    setProcessingRefund(true)
    setRefundError('')
    const res = await fetch('/api/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentId: refundPayment.id,
        refundAmount: parseFloat(refundAmount),
        reason: refundReason,
        folioId: folio.id,
      }),
    })
    const data = await res.json()
    setProcessingRefund(false)
    if (data.success) {
      setShowRefund(false)
      setRefundPayment(null)
      await loadFolioData(folio.id)
    } else {
      setRefundError(data.error || 'Refund failed. Please try again.')
    }
  }"""

# Add refund button next to void button on each payment row
old_payment_row = """                  <div style={{ fontWeight: 600, fontSize: 14, color: '#15803d' }}>-${(p.amount/100).toFixed(2)}</div>
                  <button onClick={() => voidPayment(p.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}>×</button>"""

new_payment_row = """                  <div style={{ fontWeight: 600, fontSize: 14, color: p.status === 'refunded' ? '#dc2626' : '#15803d' }}>
                    {p.status === 'refunded' ? '' : '-'}${(Math.abs(p.amount)/100).toFixed(2)}
                    {p.status === 'refunded' && <span style={{ fontSize: 10, marginLeft: 4, color: '#dc2626' }}>REFUND</span>}
                    {p.status === 'partially_refunded' && <span style={{ fontSize: 10, marginLeft: 4, color: '#f59e0b' }}>PARTIAL</span>}
                  </div>
                  {p.status === 'completed' && (
                    <button onClick={() => openRefund(p)} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 5, color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '2px 7px', fontWeight: 600 }}>Refund</button>
                  )}
                  {p.status !== 'refunded' && (
                    <button onClick={() => voidPayment(p.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}>×</button>
                  )}"""

# Add refund modal before the closing div of the component
old_terminal_waiting = """      {terminalStatus === 'waiting' && ("""
new_terminal_waiting = """      {/* Refund Modal */}
      {showRefund && refundPayment && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '1.5rem', width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Issue Refund</h2>
              <button onClick={() => setShowRefund(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>×</button>
            </div>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: '#6b7280' }}>Original payment</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginTop: 2 }}>
                ${((refundPayment.amount - (refundPayment.surcharge_amount || 0)) / 100).toFixed(2)} · {refundPayment.method}
                {refundPayment.method === 'card' && refundPayment.square_payment_id
                  ? <span style={{ fontSize: 11, color: '#15803d', marginLeft: 8 }}>✓ Will refund to card via Square</span>
                  : refundPayment.method === 'card'
                  ? <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 8 }}>⚠ No Square ID — record manually</span>
                  : <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>Cash/check — record return manually</span>
                }
              </div>
              {refundPayment.note && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{refundPayment.note}</div>}
            </div>
            <label style={ml}>Refund amount ($)</label>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 18 }}>$</span>
              <input
                style={{ ...si, paddingLeft: 30, fontSize: 22, fontWeight: 700, height: 52 }}
                type='number'
                step='0.01'
                min='0'
                max={((refundPayment.amount - (refundPayment.surcharge_amount || 0)) / 100).toFixed(2)}
                value={refundAmount}
                onChange={e => setRefundAmount(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[100, 90, 50].map(pct => (
                <button key={pct} onClick={() => setRefundAmount(((refundPayment.amount - (refundPayment.surcharge_amount || 0)) * pct / 10000).toFixed(2))}
                  style={{ flex: 1, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 7, padding: '7px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                  {pct}%
                </button>
              ))}
            </div>
            <label style={ml}>Reason</label>
            <input style={{ ...si, marginBottom: 16 }} placeholder='e.g. Cancellation — outside 7 days' value={refundReason} onChange={e => setRefundReason(e.target.value)} />
            {refundError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>{refundError}</div>}
            <button
              onClick={processRefund}
              disabled={processingRefund || !refundAmount || parseFloat(refundAmount) <= 0}
              style={{ width: '100%', background: processingRefund || !refundAmount ? '#d1d5db' : '#dc2626', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
            >
              {processingRefund ? 'Processing...' : `Issue Refund · $${refundAmount || '0.00'}`}
            </button>
            {refundPayment.method !== 'card' && (
              <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
                Cash/check refunds are recorded here. Please return ${refundAmount} to the guest manually.
              </p>
            )}
          </div>
        </div>
      )}

      {terminalStatus === 'waiting' && ("""

checks = [
    ('Refund state vars', old_state, new_state),
    ('Refund handlers', old_void, new_void),
    ('Refund button on payment row', old_payment_row, new_payment_row),
    ('Refund modal', old_terminal_waiting, new_terminal_waiting),
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
    with open(folio_path, 'w') as f:
        f.write(content)
    print('\n\u2705 All edits applied!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Add refund functionality with Square API integration" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
