path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Add refundSuccess state
old_state = "  const [processingRefund, setProcessingRefund] = useState(false)\n  const [refundError, setRefundError] = useState('')"
new_state = "  const [processingRefund, setProcessingRefund] = useState(false)\n  const [refundError, setRefundError] = useState('')\n  const [refundSuccess, setRefundSuccess] = useState(false)"

# Update processRefund to set success state instead of just closing
old_process = """    if (data.success) {
      setShowRefund(false)
      setRefundPayment(null)
      await loadFolioData(folio.id)
    } else {
      setRefundError(data.error || 'Refund failed. Please try again.')
    }"""

new_process = """    if (data.success) {
      setRefundSuccess(true)
      await loadFolioData(folio.id)
      setTimeout(() => {
        setShowRefund(false)
        setRefundPayment(null)
        setRefundSuccess(false)
      }, 3000)
    } else {
      setRefundError(data.error || 'Refund failed. Please try again.')
    }"""

# Add success screen to refund modal
old_refund_button = """            <button
              onClick={processRefund}
              disabled={processingRefund || !refundAmount || parseFloat(refundAmount) <= 0}
              style={{ width: '100%', background: processingRefund || !refundAmount ? '#d1d5db' : '#dc2626', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
            >
              {processingRefund ? 'Processing...' : `Issue Refund · $${refundAmount || '0.00'}`}
            </button>"""

new_refund_button = """            {refundSuccess ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#15803d', marginBottom: 6 }}>Refund Successful!</div>
                <div style={{ fontSize: 14, color: '#6b7280' }}>${refundAmount} has been refunded{refundPayment?.method === 'card' ? ' to the card' : ' — return cash to guest'}</div>
              </div>
            ) : (
              <button
                onClick={processRefund}
                disabled={processingRefund || !refundAmount || parseFloat(refundAmount) <= 0}
                style={{ width: '100%', background: processingRefund || !refundAmount ? '#d1d5db' : '#dc2626', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
              >
                {processingRefund ? 'Processing...' : `Issue Refund · $${refundAmount || '0.00'}`}
              </button>
            )}"""

checks = [
    ('refundSuccess state', old_state, new_state),
    ('processRefund sets success', old_process, new_process),
    ('Success screen in modal', old_refund_button, new_refund_button),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Folio: add refund success confirmation screen" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
