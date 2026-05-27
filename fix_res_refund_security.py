path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reservations/page.tsx'

with open(path, 'r') as f:
    content = f.read()

old_refund = """  async function handleResRefund() {
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
    const updatedNotes = selected.notes ? `${selected.notes}\\n${refundNote}` : refundNote

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
  }"""

new_refund = """  async function handleResRefund() {
    if (!selected || !resRefundAmount) return
    setProcessingResRefund(true)
    setResRefundError('')
    const refundAmountCents = Math.round(parseFloat(resRefundAmount) * 100)

    // Route through server-side refund API (keeps Square credentials secure)
    const res = await fetch('/api/reservation-refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reservationId: selected.id,
        squarePaymentId: selected.square_payment_id,
        refundAmount: parseFloat(resRefundAmount),
        reason: resRefundReason || 'Refund',
        currentAmountPaid: selected.amount_paid,
        currentNotes: selected.notes || '',
      }),
    })
    const data = await res.json()

    if (!data.success) {
      setResRefundError(data.error || 'Refund failed. Please try again.')
      setProcessingResRefund(false)
      return
    }

    toast.success('Refund recorded successfully!')
    setProcessingResRefund(false)
    setShowResRefund(false)
    setResRefundAmount('')
    setResRefundReason('')
    await fetchReservations()
    const { data: updated } = await supabase.from('reservations').select('*, sites(site_number, site_type), square_payment_id').eq('id', selected.id).single()
    if (updated) { setSelected(updated); fetchAddons(updated.id) }
  }"""

if old_refund in content:
    content = content.replace(old_refund, new_refund, 1)
    print('  \u2713 Refund routed through server API')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: create the API route, then push')
else:
    print('  \u2717 MISSING \u2014 file NOT saved. Paste output to Claude.')
