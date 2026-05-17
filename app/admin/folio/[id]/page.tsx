'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useParams, useRouter } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const CATEGORIES = ['Camping Supplies', 'Food & Drink', 'Rentals', 'Fees', 'General']

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
}

type Payment = {
  id: string
  method: string
  amount: number
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
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('Camping Supplies')
  const [showPayment, setShowPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)
  const [walkUpName, setWalkUpName] = useState('')
  const [showCustomItem, setShowCustomItem] = useState(false)
  const [customDesc, setCustomDesc] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [customQty, setCustomQty] = useState('1')

  useEffect(() => { init() }, [reservationId])

  async function init() {
    setLoading(true)
    const { data: prods } = await supabase.from('products').select('*').eq('active', true).order('display_order')
    setProducts(prods || [])

    if (isNew) {
      setLoading(false)
      return
    }

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
      supabase.from('folio_payments').select('*').eq('folio_id', folioId).order('paid_at'),
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
    }
  }

  async function addProduct(product: Product) {
    if (!folio) return
    const taxAmount = product.tax_class === 'standard' ? Math.round(product.price * 0.06) : 0
    const lineTotal = product.price + taxAmount
    await supabase.from('folio_line_items').insert({
      folio_id: folio.id,
      product_id: product.id,
      description: product.name,
      quantity: 1,
      unit_price: product.price,
      tax_amount: taxAmount,
      line_total: lineTotal,
      category: product.category,
    })
    await loadFolioData(folio.id)
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
  }

  async function removeLineItem(id: string) {
    if (!folio) return
    if (!confirm('Remove this item?')) return
    await supabase.from('folio_line_items').delete().eq('id', id)
    await loadFolioData(folio.id)
  }

  async function collectPayment() {
    if (!folio) return
    const amount = Math.round(parseFloat(paymentAmount) * 100)
    if (!amount || amount <= 0) return
    setSavingPayment(true)
    await supabase.from('folio_payments').insert({
      folio_id: folio.id,
      method: paymentMethod,
      amount,
      status: 'completed',
      note: paymentNote,
    })
    if (reservation) {
      const newAmountPaid = reservation.amount_paid + amount
      await supabase.from('reservations').update({ amount_paid: newAmountPaid }).eq('id', reservation.id)
      setReservation({ ...reservation, amount_paid: newAmountPaid })
    }
    setSavingPayment(false)
    setShowPayment(false)
    setPaymentAmount('')
    setPaymentNote('')
    await loadFolioData(folio.id)
  }

  const itemsTotal = lineItems.reduce((sum, i) => sum + i.line_total, 0)
  const paymentsTotal = payments.reduce((sum, p) => sum + p.amount, 0)
  const reservationBalance = reservation ? Math.max(0, reservation.total_price - reservation.amount_paid) : 0
  const folioBalance = itemsTotal
  const totalDue = Math.max(0, reservationBalance + folioBalance - paymentsTotal)
  const filteredProducts = products.filter(p => p.category === activeCategory)

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading folio...</div>

  if (isNew && !folio) {
    return (
      <div style={{ padding: '2rem', maxWidth: 480, margin: '0 auto', fontFamily: 'sans-serif' }}>
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
        <button
          onClick={createWalkUpFolio}
          style={{ width: '100%', background: '#15803d', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
        >
          Open Tab
        </button>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'sans-serif', minHeight: '100vh', background: '#f9fafb' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14 }}>← Back</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{folio?.guest_name || reservation?.guest_name}</h1>
          {reservation && (
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
              Site {reservation.site_number} · {reservation.arrival_date} → {reservation.departure_date}
            </p>
          )}
          {folio?.folio_type === 'walkin' && <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Walk-up sale</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: totalDue > 0 ? '#dc2626' : '#15803d' }}>
            ${(totalDue / 100).toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{totalDue > 0 ? 'balance due' : 'paid in full'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 0, minHeight: 'calc(100vh - 73px)' }}>
        <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
          {reservation && reservationBalance > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Reservation balance</div>
                  <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>
                    Total ${(reservation.total_price / 100).toFixed(2)} · Paid ${(reservation.amount_paid / 100).toFixed(2)}
                  </div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 18, color: '#92400e' }}>${(reservationBalance / 100).toFixed(2)}</div>
              </div>
            </div>
          )}

          {reservation && reservationBalance === 0 && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.75rem 1.25rem', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#15803d', fontWeight: 700 }}>✓</span>
              <span style={{ fontSize: 14, color: '#15803d', fontWeight: 600 }}>Reservation paid in full</span>
            </div>
          )}

          {lineItems.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f3f4f6', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
                Additional Charges
              </div>
              {lineItems.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < lineItems.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{item.description}</div>
                    {item.tax_amount > 0 && <div style={{ fontSize: 11, color: '#9ca3af' }}>incl. ${(item.tax_amount / 100).toFixed(2)} tax</div>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>${(item.line_total / 100).toFixed(2)}</div>
                  <button onClick={() => removeLineItem(item.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid #f3f4f6', fontWeight: 700, fontSize: 14 }}>
                <span>Items subtotal</span>
                <span>${(itemsTotal / 100).toFixed(2)}</span>
              </div>
            </div>
          )}

          {payments.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f3f4f6', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
                Payments
              </div>
              {payments.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: i < payments.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, textTransform: 'capitalize' }}>{p.method}</div>
                    {p.note && <div style={{ fontSize: 11, color: '#9ca3af' }}>{p.note}</div>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#15803d' }}>-${(p.amount / 100).toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}

          {lineItems.length === 0 && payments.length === 0 && reservationBalance === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '3rem 0', fontSize: 14 }}>
              No charges yet. Use the panel on the right to add items.
            </div>
          )}

          {totalDue > 0 && (
            <button
              onClick={() => { setPaymentAmount((totalDue / 100).toFixed(2)); setShowPayment(true) }}
              style={{ width: '100%', background: '#15803d', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginTop: 8 }}
            >
              Collect Payment · ${(totalDue / 100).toFixed(2)}
            </button>
          )}
        </div>

        <div style={{ background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid #e5e7eb', padding: '0 1rem' }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: activeCategory === cat ? '2px solid #15803d' : '2px solid transparent', color: activeCategory === cat ? '#15803d' : '#6b7280' }}
              >
                {cat}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {filteredProducts.map(product => (
              <button
                key={product.id}
                onClick={() => addProduct(product)}
                style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 10px', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{product.name}</div>
                <div style={{ fontSize: 14, color: '#15803d', fontWeight: 700 }}>${(product.price / 100).toFixed(2)}</div>
                {product.tax_class === 'standard' && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>+ tax</div>}
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '2rem 0' }}>
                No products in this category
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', padding: '1rem' }}>
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
                  <button onClick={addCustomItem} style={{ flex: 1, background: '#15803d', color: '#fff', border: 'none', borderRadius: 7, padding: '8px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPayment && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 420 }}>
            <h2 style={{ margin: '0 0 1.25rem', fontSize: 18, fontWeight: 700 }}>Collect Payment</h2>
            <label style={ml}>Payment method</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {['cash', 'card', 'check'].map(m => (
                <button key={m} onClick={() => setPaymentMethod(m)} style={{ padding: '10px', border: `2px solid ${paymentMethod === m ? '#15803d' : '#e5e7eb'}`, borderRadius: 8, background: paymentMethod === m ? '#f0fdf4' : '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize', color: paymentMethod === m ? '#15803d' : '#374151' }}>
                  {m}
                </button>
              ))}
            </div>
            <label style={ml}>Amount</label>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 16 }}>$</span>
              <input style={{ ...si, paddingLeft: 28, fontSize: 22, fontWeight: 700 }} type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} />
            </div>
            <label style={ml}>Note (optional)</label>
            <input style={{ ...si, marginBottom: 20 }} placeholder="e.g. check #1042" value={paymentNote} onChange={e => setPaymentNote(e.target.value)} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowPayment(false)} style={{ flex: 1, background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={collectPayment} disabled={savingPayment} style={{ flex: 2, background: '#15803d', color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                {savingPayment ? 'Recording...' : `Record ${paymentMethod} · $${paymentAmount}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const si: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' }
const ml: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }
