'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useParams, useRouter } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const FALLBACK_CATEGORIES = ['Camping Supplies', 'Food & Drink', 'Rentals', 'Fees', 'General']

type LineItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
  tax_amount: number
  line_total: number
  category: string
  charged_at: string
  product_id: string | null
  voided: boolean
}

type Payment = {
  id: string
  method: string
  amount: number
  surcharge_amount: number
  status: string
  note: string
  paid_at: string
}

type Product = {
  id: string
  name: string
  category: string
  price: number
  tax_class: string
  active: boolean
  variable_price: boolean
}

type Reservation = {
  id: string
  guest_name: string
  guest_email: string
  site_number: string
  site_type: string
  arrival_date: string
  departure_date: string
  total_price: number
  amount_paid: number
  fees_total: number
  num_adults: number
  num_children: number
}

type Folio = {
  id: string
  reservation_id: string | null
  guest_name: string
  guest_email: string
  folio_type: string
  status: string
  notes: string
}

export default function FolioPage() {
  const params = useParams()
  const router = useRouter()
  const reservationId = params.id as string
  const isNew = reservationId === 'new'

  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [folio, setFolio] = useState<Folio | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [cardSurcharge, setCardSurcharge] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('')
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES)
  const [activeTab, setActiveTab] = useState<'tab'|'items'>('tab')
  const [showPayment, setShowPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)
  const [walkUpName, setWalkUpName] = useState('')
  const [showCustomItem, setShowCustomItem] = useState(false)
  const [cashTendered, setCashTendered] = useState('')
  const [waiveFee, setWaiveFee] = useState(false)
  const [terminalDeviceId, setTerminalDeviceId] = useState('')
  const [terminalStatus, setTerminalStatus] = useState('')
  const [sendingToTerminal, setSendingToTerminal] = useState(false)
  const [customDesc, setCustomDesc] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [customQty, setCustomQty] = useState('1')

  useEffect(() => { init() }, [reservationId])

  async function init() {
    setLoading(true)
    const [{ data: prods }, { data: settings }, { data: cats }] = await Promise.all([
      supabase.from('products').select('*').eq('active', true).order('display_order'),
      supabase.from('settings').select('card_surcharge_percent, square_terminal_device_id').single(),
      supabase.from('product_categories').select('name').order('display_order'),
    ])
    if (cats && cats.length > 0) setCategories(cats.map((c: any) => c.name))
    setProducts(prods || [])
    if (settings?.card_surcharge_percent) setCardSurcharge(Number(settings.card_surcharge_percent))
    if (settings?.square_terminal_device_id) setTerminalDeviceId(settings.square_terminal_device_id)

    if (isNew) { setLoading(false); return }

    const { data: res } = await supabase.from('reservations').select('*').eq('id', reservationId).single()
    if (res) setReservation(res)

    const { data: existingFolio } = await supabase.from('folios').select('*').eq('reservation_id', reservationId).single()
    if (existingFolio) {
      setFolio(existingFolio)
      await loadFolioData(existingFolio.id)
    } else if (res) {
      const { data: newFolio } = await supabase.from('folios').insert({
        reservation_id: res.id,
        guest_name: res.guest_name,
        guest_email: res.guest_email || '',
        folio_type: 'reservation',
        status: 'open',
      }).select().single()
      if (newFolio) {
        setFolio(newFolio)
        await loadFolioData(newFolio.id)
      }
    }
    setLoading(false)
  }

  async function loadFolioData(folioId: string) {
    const [{ data: items }, { data: pmts }] = await Promise.all([
      supabase.from('folio_line_items').select('*').eq('folio_id', folioId).order('charged_at'),
      supabase.from('folio_payments').select('*').eq('folio_id', folioId).eq('status', 'completed').order('paid_at'),
    ])
    setLineItems(items || [])
    setPayments(pmts || [])
  }

  async function createWalkUpFolio() {
    const { data: newFolio } = await supabase.from('folios').insert({
      reservation_id: null,
      guest_name: walkUpName.trim() || 'Walk-up Guest',
      guest_email: '',
      folio_type: 'walkin',
      status: 'open',
    }).select().single()
    if (newFolio) {
      setFolio(newFolio)
      await loadFolioData(newFolio.id)
      setActiveTab('items')
    }
  }

  async function addProduct(product: Product, overridePrice?: number) {
    if (!folio) return
    const price = overridePrice ?? product.price
    const taxAmount = product.tax_class === 'standard' ? Math.round(price * 0.06) : 0
    const lineTotal = price + taxAmount
    await supabase.from('folio_line_items').insert({
      folio_id: folio.id,
      product_id: product.id,
      description: product.name,
      quantity: 1,
      unit_price: price,
      tax_amount: taxAmount,
      line_total: lineTotal,
      category: product.category,
    })
    await loadFolioData(folio.id)
    setActiveTab('tab')
    setActiveCategory('')
  }

  async function addCustomItem() {
    if (!folio || !customDesc.trim()) return
    const price = Math.round(parseFloat(customPrice) * 100) || 0
    const qty = parseInt(customQty) || 1
    const lineTotal = price * qty
    await supabase.from('folio_line_items').insert({
      folio_id: folio.id,
      product_id: null,
      description: customDesc.trim(),
      quantity: qty,
      unit_price: price,
      tax_amount: 0,
      line_total: lineTotal,
      category: 'General',
    })
    setCustomDesc('')
    setCustomPrice('')
    setCustomQty('1')
    setShowCustomItem(false)
    await loadFolioData(folio.id)
    setActiveTab('tab')
    setActiveCategory('')
  }

  async function removeLineItem(id: string) {
    if (!folio) return
    if (!confirm('Remove this item?')) return
    await supabase.from('folio_line_items').delete().eq('id', id)
    await loadFolioData(folio.id)
  }

  async function voidPayment(id: string) {
    if (!confirm('Void this payment? This cannot be undone.')) return
    await supabase.from('folio_payments').update({ status: 'voided' }).eq('id', id)
    await loadFolioData(folio!.id)
  }

  async function collectPayment() {
    if (!folio) return
    const baseAmount = paymentMethod === 'cash' && cashTendered !== '' ? Math.min(Math.round(parseFloat(cashTendered) * 100), Math.round(parseFloat(paymentAmount) * 100)) : Math.round(parseFloat(paymentAmount) * 100)
    if (!baseAmount || baseAmount <= 0) return
    const surchargeAmount = paymentMethod === 'card' && cardSurcharge > 0 && !waiveFee
      ? Math.round(baseAmount * (cardSurcharge / 100))
      : 0
    const totalAmount = baseAmount + surchargeAmount
    setSavingPayment(true)
    await supabase.from('folio_payments').insert({
      folio_id: folio.id,
      method: paymentMethod,
      amount: totalAmount,
      surcharge_amount: surchargeAmount,
      status: 'completed',
      note: paymentNote + (surchargeAmount > 0 ? ` (incl. ${cardSurcharge}% card fee: $${(surchargeAmount/100).toFixed(2)})` : ''),
    })
    setSavingPayment(false)
    setShowPayment(false)
    setPaymentAmount('')
    setPaymentNote('')
    setPaymentMethod('cash')
    setCashTendered('')
    setWaiveFee(false)
    await loadFolioData(folio.id)
  }

  // Totals — single source of truth
  const activeItems = lineItems.filter(i => !i.voided)
  async function sendToTerminal() {
    if (!folio) return
    const amount = Math.max(0, (reservation ? Math.max(0, reservation.total_price - reservation.amount_paid) : 0) + activeItems.reduce((sum, i) => sum + i.line_total, 0) - payments.reduce((sum, p) => sum + p.amount - (p.surcharge_amount || 0), 0))
    if (!amount || amount <= 0) return
    const surchargeAmount = cardSurcharge > 0 ? Math.round(amount * (cardSurcharge / 100)) : 0
    const totalAmount = amount + surchargeAmount
    setSendingToTerminal(true)
    setTerminalStatus('')
    const res = await fetch('/api/terminal/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folioId: folio.id,
        amount: totalAmount,
        surchargeAmount,
        note: (folio?.guest_name || '') + (reservation ? ' · Site ' + reservation.site_number : ''),
      }),
    })
    const data = await res.json()
    setSendingToTerminal(false)
    if (data.success) {
      setTerminalStatus('waiting')
      setShowPayment(false)
      let attempts = 0
      const interval = setInterval(async () => {
        attempts++
        await loadFolioData(folio.id)
        if (attempts >= 60) { clearInterval(interval); setTerminalStatus('timeout') }
      }, 3000)
    } else {
      setTerminalStatus('error: ' + (data.error || 'Failed to send to Terminal'))
    }
  }

  const itemsTotal = activeItems.reduce((sum, i) => sum + i.line_total, 0)
  const paymentsTotal = payments.reduce((sum, p) => sum + p.amount - (p.surcharge_amount || 0), 0)
  const reservationBalance = reservation ? Math.max(0, reservation.total_price - reservation.amount_paid) : 0
  // Cash balance removes proportional fees from remaining balance
  const feesTotal = reservation?.fees_total || 0
  const baseTotal = reservation ? reservation.total_price - feesTotal : 0
  const basePaid = reservation ? Math.min(reservation.amount_paid, baseTotal) : 0
  const cashReservationBalance = reservation ? Math.max(0, baseTotal - basePaid) : 0
  const hasFeeDiscount = feesTotal > 0 && cashReservationBalance < reservationBalance
  const grandTotal = reservationBalance + itemsTotal
  const totalDue = Math.max(0, grandTotal - paymentsTotal)
  const overpaid = paymentsTotal > grandTotal ? paymentsTotal - grandTotal : 0

  // Card surcharge preview
  const paymentAmountCents = Math.round(parseFloat(paymentAmount) * 100) || 0
  const surchargePreview = paymentMethod === 'card' && cardSurcharge > 0 && !waiveFee
    ? Math.round(paymentAmountCents * (cardSurcharge / 100))
    : 0
  const totalWithSurcharge = paymentAmountCents + surchargePreview

  const filteredProducts = products.filter(p => p.category === activeCategory)

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading folio...</div>

  if (isNew && !folio) {
    return (
      <div style={{ padding: '2rem', maxWidth: 480, margin: '0 auto', fontFamily: 'sans-serif', minHeight: '100vh', background: '#C9D2D9' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, marginBottom: 24 }}>← Back</button>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>New Walk-Up Sale</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>Start a tab for a visitor, family member, or anyone not attached to a reservation.</p>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Guest name (optional)</label>
        <input
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: 15, boxSizing: 'border-box', marginBottom: 16 }}
          placeholder="e.g. Smith family, Site 12 visitor..."
          value={walkUpName}
          onChange={e => setWalkUpName(e.target.value)}
        />
        <button onClick={createWalkUpFolio} style={{ width: '100%', background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>
          Open Tab
        </button>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'sans-serif', minHeight: '100vh', background: '#C9D2D9' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #b8c4cc', padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' }}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folio?.guest_name || reservation?.guest_name}</h1>
          {reservation && (
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
              Site {reservation.site_number} · {reservation.arrival_date} → {reservation.departure_date}
            </p>
          )}
          {folio?.folio_type === 'walkin' && <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Walk-up sale</p>}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: overpaid > 0 ? '#6b7280' : totalDue > 0 ? '#dc2626' : '#15803d' }}>
            {overpaid > 0 ? `Change: $${(overpaid/100).toFixed(2)}` : `$${(totalDue/100).toFixed(2)}`}
          </div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            {overpaid > 0 ? 'give change' : totalDue > 0 ? 'balance due' : '✓ paid in full'}
          </div>
        </div>
      </div>

      {/* Mobile tab switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid #b8c4cc', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <button
          onClick={() => setActiveTab('tab')}
          style={{ flex: 1, padding: '12px', fontSize: 14, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === 'tab' ? '2px solid #15803d' : '2px solid transparent', color: activeTab === 'tab' ? '#15803d' : '#6b7280' }}
        >
          Guest Tab
        </button>
        <button
          onClick={() => { setActiveTab('items'); setActiveCategory('') }}
          style={{ flex: 1, padding: '12px', fontSize: 14, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === 'items' ? '2px solid #15803d' : '2px solid transparent', color: activeTab === 'items' ? '#15803d' : '#6b7280' }}
        >
          Add Items
        </button>
      </div>

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 120px)' }}>
        {/* Left: Folio tab */}
        <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: activeTab === 'tab' ? 'block' : 'none', background: '#C9D2D9' }}>

          {/* Reservation balance */}
          {reservation && reservationBalance > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '0.875rem 1rem', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Reservation balance</div>
                  <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>
                    Total ${(reservation.total_price/100).toFixed(2)} · Paid ${(reservation.amount_paid/100).toFixed(2)}
                  </div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 17, color: '#92400e' }}>${(reservationBalance/100).toFixed(2)}</div>
              </div>
            </div>
          )}

          {reservation && reservationBalance === 0 && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#15803d', fontWeight: 700 }}>✓</span>
              <span style={{ fontSize: 14, color: '#15803d', fontWeight: 600 }}>Reservation paid in full</span>
            </div>
          )}

          {/* Line items */}
          {activeItems.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
                Additional Charges
              </div>
              {activeItems.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < activeItems.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{item.description}</div>
                    {item.tax_amount > 0 && <div style={{ fontSize: 11, color: '#9ca3af' }}>incl. ${(item.tax_amount/100).toFixed(2)} tax</div>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>${(item.line_total/100).toFixed(2)}</div>
                  <button onClick={() => removeLineItem(item.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f3f4f6', fontWeight: 700, fontSize: 14 }}>
                <span>Items subtotal</span>
                <span>${(itemsTotal/100).toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Grand total row */}
          {(reservationBalance > 0 || activeItems.length > 0) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#f3f4f6', borderRadius: 8, marginBottom: 12, fontWeight: 700, fontSize: 15 }}>
              <span>Grand total</span>
              <span>${(grandTotal/100).toFixed(2)}</span>
            </div>
          )}

          {/* Payments */}
          {payments.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
                Payments
              </div>
              {payments.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < payments.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, textTransform: 'capitalize' }}>{p.method}</div>
                    {p.note && <div style={{ fontSize: 11, color: '#9ca3af' }}>{p.note}</div>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#15803d' }}>-${(p.amount/100).toFixed(2)}</div>
                  <button onClick={() => voidPayment(p.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {activeItems.length === 0 && payments.length === 0 && reservationBalance === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '3rem 0', fontSize: 14 }}>
              No charges yet. Tap "Add Items" to get started.
            </div>
          )}

          {/* Collect payment button */}
          {totalDue > 0 && (
            <div style={{ marginTop: 8 }}>
              {hasFeeDiscount ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#4a6275', textAlign: 'center', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Select payment method</div>
                  <button
                    onClick={() => { const cashTotal = Math.max(0, cashReservationBalance + itemsTotal - paymentsTotal); setPaymentAmount((cashTotal/100).toFixed(2)); setWaiveFee(true); setShowPayment(true) }}
                    style={{ width: '100%', background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 20, paddingRight: 20 }}
                  >
                    <span>💵 Cash / Check</span>
                    <span>${(Math.max(0, cashReservationBalance + itemsTotal - paymentsTotal)/100).toFixed(2)}</span>
                  </button>
                  <button
                    onClick={() => { setPaymentAmount((totalDue/100).toFixed(2)); setWaiveFee(false); setShowPayment(true) }}
                    style={{ width: '100%', background: '#1e3f52', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 20, paddingRight: 20 }}
                  >
                    <span>💳 Card</span>
                    <span>${(totalDue/100).toFixed(2)}</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setPaymentAmount((totalDue/100).toFixed(2)); setShowPayment(true) }}
                  style={{ width: '100%', background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
                >
                  Collect Payment · ${(totalDue/100).toFixed(2)}
                </button>
              )}
            </div>
          )}

          {overpaid > 0 && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '1rem', marginTop: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#15803d' }}>Give change: ${(overpaid/100).toFixed(2)}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Folio complete</div>
            </div>
          )}

          {/* Receipt buttons */}
          {(lineItems.length > 0 || payments.length > 0) && (
            <ReceiptButtons folioId={folio?.id || ''} guestEmail={folio?.guest_email || reservation?.guest_email || ''} receiptType='reservation' />
          )}
        </div>

        {/* Right: Product picker */}
        <div style={{ width: 'min(420px, 100%)', background: '#C9D2D9', borderLeft: '1px solid #b8c4cc', display: activeTab === 'items' ? 'flex' : 'none', flexDirection: 'column' }}>
          {/* Category or Items view */}
          {activeCategory === '' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4a6275', marginBottom: 4 }}>Select a category</div>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{ background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 12, padding: '18px 20px', fontSize: 16, fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 6px rgba(46,107,138,0.3)', transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#245875')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#2E6B8A')}
                >
                  <span>{cat}</span>
                  <span style={{ fontSize: 20, opacity: 0.7 }}>›</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #b8c4cc', background: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => setActiveCategory('')}
                  style={{ background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  ‹ Back
                </button>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1e3f52' }}>{activeCategory}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0.875rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignContent: 'start' }}>
                {filteredProducts.map(product => (
                  <VariableProductTile key={product.id} product={product} onAdd={addProduct} />
                ))}
                {filteredProducts.length === 0 && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#4a6275', fontSize: 13, padding: '2rem 0' }}>
                    No products in this category
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ borderTop: '1px solid #e5e7eb', padding: '0.875rem' }}>
            {!showCustomItem ? (
              <button onClick={() => setShowCustomItem(true)} style={{ width: '100%', background: 'none', border: '1px dashed #d1d5db', borderRadius: 8, padding: '10px', fontSize: 13, color: '#6b7280', cursor: 'pointer' }}>
                + Custom charge
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input style={si} placeholder="Description" value={customDesc} onChange={e => setCustomDesc(e.target.value)} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input style={si} placeholder="Price $" value={customPrice} onChange={e => setCustomPrice(e.target.value)} />
                  <input style={si} placeholder="Qty" value={customQty} onChange={e => setCustomQty(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowCustomItem(false)} style={{ flex: 1, background: 'none', border: '1px solid #e5e7eb', borderRadius: 7, padding: '8px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={addCustomItem} style={{ flex: 1, background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 7, padding: '8px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment modal */}
      {/* Terminal status */}
      {terminalStatus === 'waiting' && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#2E6B8A', color: '#fff', borderRadius: 12, padding: '14px 24px', fontSize: 15, fontWeight: 600, zIndex: 60, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', animation: 'pulse 1s infinite' }} />
          Waiting for customer to tap card on Terminal...
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
        </div>
      )}
      {terminalStatus === 'completed' && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#15803d', color: '#fff', borderRadius: 12, padding: '14px 24px', fontSize: 15, fontWeight: 600, zIndex: 60 }}>
          ✓ Card payment completed!
        </div>
      )}
      {terminalStatus.startsWith('error') && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#dc2626', color: '#fff', borderRadius: 12, padding: '14px 24px', fontSize: 14, fontWeight: 600, zIndex: 60 }}>
          {terminalStatus}
        </div>
      )}

      {showPayment && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '1.5rem', width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Collect Payment</h2>
              <button onClick={() => { setShowPayment(false); setCashTendered('') }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>×</button>
            </div>

            <label style={ml}>Payment method</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {['cash', 'card', 'check'].map(m => (
                <button key={m} onClick={() => setPaymentMethod(m)} style={{ padding: '12px', border: `2px solid ${paymentMethod === m ? '#2E6B8A' : '#e5e7eb'}`, borderRadius: 8, background: paymentMethod === m ? '#e8f2f7' : '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', textTransform: 'capitalize', color: paymentMethod === m ? '#2E6B8A' : '#374151' }}>
                  {m}
                </button>
              ))}
            </div>

            {paymentMethod === 'card' && terminalDeviceId ? (
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
              </div>
            ) : (
              <>
                {paymentMethod === 'card' && cardSurcharge > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '10px 14px', background: waiveFee ? '#f0fdf4' : '#fffbeb', border: '1px solid', borderColor: waiveFee ? '#bbf7d0' : '#fde68a', borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Card fee ({cardSurcharge}%)</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{waiveFee ? 'Fee waived for this payment' : 'Applied to card payments'}</div>
                </div>
                <button
                  type='button'
                  onClick={() => setWaiveFee(!waiveFee)}
                  style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', backgroundColor: waiveFee ? '#15803d' : '#d1d5db', position: 'relative', flexShrink: 0 }}
                >
                  <span style={{ position: 'absolute', top: 3, left: waiveFee ? 21 : 3, width: 16, height: 16, borderRadius: '50%', backgroundColor: 'white', transition: 'left 0.2s' }} />
                </button>
              </div>
            )}
            <label style={ml}>{paymentMethod === 'cash' ? 'Amount due' : 'Amount'}</label>
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 18 }}>$</span>
                  <input
                    style={{ ...si, paddingLeft: 30, fontSize: 24, fontWeight: 700, height: 56, background: paymentMethod === 'cash' ? '#f9fafb' : '#fff', color: paymentMethod === 'cash' ? '#6b7280' : '#111827' }}
                    type="number"
                    step="0.01"
                    value={paymentAmount}
                    readOnly={paymentMethod === 'cash'}
                    onChange={e => setPaymentAmount(e.target.value)}
                  />
                </div>
              </>
            )}
            {paymentMethod === 'cash' && (
              <>
                <label style={ml}>Cash tendered</label>
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 18 }}>$</span>
                  <input
                    style={{ ...si, paddingLeft: 30, fontSize: 24, fontWeight: 700, height: 56 }}
                    type="number"
                    step="0.01"
                    value={cashTendered}
                    onChange={e => setCashTendered(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                {parseFloat(cashTendered) > 0 && (
                  <div style={{ background: parseFloat(cashTendered) >= parseFloat(paymentAmount) ? '#f0fdf4' : '#fef2f2', border: '1px solid', borderColor: parseFloat(cashTendered) >= parseFloat(paymentAmount) ? '#bbf7d0' : '#fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: parseFloat(cashTendered) >= parseFloat(paymentAmount) ? '#15803d' : '#dc2626' }}>
                      {parseFloat(cashTendered) >= parseFloat(paymentAmount) ? 'Change due' : 'Amount short'}
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 18, color: parseFloat(cashTendered) >= parseFloat(paymentAmount) ? '#15803d' : '#dc2626' }}>
                      ${Math.abs(parseFloat(cashTendered) - parseFloat(paymentAmount)).toFixed(2)}
                    </span>
                  </div>
                )}
              </>
            )}

            {!(paymentMethod === 'card' && terminalDeviceId) && (
              <>
              {/* Card surcharge preview */}
              {paymentMethod === 'card' && cardSurcharge > 0 && paymentAmountCents > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#92400e' }}>{cardSurcharge}% card fee</span>
                    <span style={{ color: '#92400e', fontWeight: 600 }}>+${(surchargePreview/100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontWeight: 700 }}>
                    <span style={{ color: '#92400e' }}>Total charged to card</span>
                    <span style={{ color: '#92400e' }}>${(totalWithSurcharge/100).toFixed(2)}</span>
                  </div>
                </div>
              )}
  
              <label style={ml}>Note (optional)</label>
              <input style={{ ...si, marginBottom: 16 }} placeholder="e.g. check #1042" value={paymentNote} onChange={e => setPaymentNote(e.target.value)} />
  
              <button
                onClick={collectPayment}
                disabled={savingPayment}
                style={{ width: '100%', background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
              >
                {savingPayment ? 'Recording...' : paymentMethod === 'card' && surchargePreview > 0
                  ? `Charge card · $${(totalWithSurcharge/100).toFixed(2)}`
                  : paymentMethod === 'cash' && cashTendered !== ''
                  ? `Record cash · $${Math.min(parseFloat(cashTendered), parseFloat(paymentAmount)).toFixed(2)}`
                  : `Record ${paymentMethod} · $${paymentAmount}`}
              </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function VariableProductTile({ product, onAdd }: { product: any, onAdd: (p: any, price?: number) => void }) {
  const [customPrice, setCustomPrice] = useState('')
  if (!product.variable_price) {
    return (
      <button
        onClick={() => onAdd(product)}
        style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 10px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <div style={{ fontWeight: 600, fontSize: 13 }}>{product.name}</div>
        <div style={{ fontSize: 15, color: '#15803d', fontWeight: 700 }}>${(product.price/100).toFixed(2)}</div>
        {product.tax_class === 'standard' && <div style={{ fontSize: 10, color: '#9ca3af' }}>+ tax</div>}
      </button>
    )
  }
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{product.name}</div>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 13 }}>$</span>
        <input
          type='number'
          min='0'
          step='0.01'
          placeholder='0.00'
          value={customPrice}
          onChange={e => setCustomPrice(e.target.value)}
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 6px 6px 20px', fontSize: 13, boxSizing: 'border-box' }}
        />
      </div>
      <button
        onClick={() => { if (customPrice) { onAdd(product, Math.round(parseFloat(customPrice) * 100)); setCustomPrice('') } }}
        disabled={!customPrice || parseFloat(customPrice) <= 0}
        style={{ background: customPrice && parseFloat(customPrice) > 0 ? '#2E6B8A' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 6, padding: '6px', fontSize: 12, fontWeight: 600, cursor: customPrice ? 'pointer' : 'default' }}
      >
        Add
      </button>
    </div>
  )
}

function ReceiptButtons({ folioId, guestEmail, receiptType }: { folioId: string, guestEmail: string, receiptType: string }) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function sendReceipt() {
    if (!guestEmail) { setError('No email on file for this guest'); return }
    setSending(true)
    setError('')
    const res = await fetch('/api/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folioId, receiptType }),
    })
    const data = await res.json()
    setSending(false)
    if (data.success) { setSent(true); setTimeout(() => setSent(false), 3000) }
    else setError(data.error || 'Failed to send receipt')
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={sendReceipt}
          disabled={sending}
          style={{ flex: 1, background: sent ? '#15803d' : '#fff', color: sent ? '#fff' : '#2E6B8A', border: '1px solid #2E6B8A', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          {sending ? 'Sending...' : sent ? '✓ Receipt sent!' : '✉ Send Receipt'}
        </button>
        <button
          onClick={() => window.print()}
          style={{ flex: 1, background: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          🖨 Print
        </button>
      </div>
      {!guestEmail && <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, textAlign: 'center' }}>No email on file — print only</p>}
      {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
    </div>
  )
}

const si: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' }
const ml: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }
