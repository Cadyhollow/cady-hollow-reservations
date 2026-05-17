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

export default function WalkUpFolioPage() {
  const params = useParams()
  const router = useRouter()
  const folioId = params.id as string

  const [folio, setFolio] = useState<Folio | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [cardSurcharge, setCardSurcharge] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('Camping Supplies')
  const [activeTab, setActiveTab] = useState<'tab'|'items'>('tab')
  const [showPayment, setShowPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)
  const [showCustomItem, setShowCustomItem] = useState(false)
  const [cashTendered, setCashTendered] = useState('')
  const [customDesc, setCustomDesc] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [customQty, setCustomQty] = useState('1')

  useEffect(() => { init() }, [folioId])

  async function init() {
    setLoading(true)
    const [{ data: prods }, { data: settings }, { data: folioData }] = await Promise.all([
      supabase.from('products').select('*').eq('active', true).order('display_order'),
      supabase.from('settings').select('card_surcharge_percent').single(),
      supabase.from('folios').select('*').eq('id', folioId).single(),
    ])
    setProducts(prods || [])
    if (settings?.card_surcharge_percent) setCardSurcharge(Number(settings.card_surcharge_percent))
    if (folioData) setFolio(folioData)
    await loadFolioData(folioId)
    setLoading(false)
  }

  async function loadFolioData(fId: string) {
    const [{ data: items }, { data: pmts }] = await Promise.all([
      supabase.from('folio_line_items').select('*').eq('folio_id', fId).order('charged_at'),
      supabase.from('folio_payments').select('*').eq('folio_id', fId).eq('status', 'completed').order('paid_at'),
    ])
    setLineItems(items || [])
    setPayments(pmts || [])
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
    setActiveTab('tab')
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
  }

  async function removeLineItem(id: string) {
    if (!confirm('Remove this item?')) return
    await supabase.from('folio_line_items').delete().eq('id', id)
    await loadFolioData(folioId)
  }

  async function voidPayment(id: string) {
    if (!confirm('Void this payment?')) return
    await supabase.from('folio_payments').update({ status: 'voided' }).eq('id', id)
    await loadFolioData(folioId)
  }

  async function collectPayment() {
    if (!folio) return
    const baseAmount = paymentMethod === 'cash' && cashTendered !== '' ? Math.min(Math.round(parseFloat(cashTendered) * 100), Math.round(parseFloat(paymentAmount) * 100)) : Math.round(parseFloat(paymentAmount) * 100)
    if (!baseAmount || baseAmount <= 0) return
    const surchargeAmount = paymentMethod === 'card' && cardSurcharge > 0
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
      note: paymentNote + (surchargeAmount > 0 ? ' (incl. ' + cardSurcharge + '% card fee: $' + (surchargeAmount/100).toFixed(2) + ')' : ''),
    })
    setSavingPayment(false)
    setShowPayment(false)
    setPaymentAmount('')
    setPaymentNote('')
    setPaymentMethod('cash')
    setCashTendered('')
    await loadFolioData(folio.id)
  }

  const itemsTotal = lineItems.reduce((sum, i) => sum + i.line_total, 0)
  const paymentsTotal = payments.reduce((sum, p) => sum + p.amount - (p.surcharge_amount || 0), 0)
  const totalDue = Math.max(0, itemsTotal - paymentsTotal)
  const overpaid = paymentsTotal > itemsTotal ? paymentsTotal - itemsTotal : 0
  const paymentAmountCents = Math.round(parseFloat(paymentAmount) * 100) || 0
  const surchargePreview = paymentMethod === 'card' && cardSurcharge > 0 ? Math.round(paymentAmountCents * (cardSurcharge / 100)) : 0
  const totalWithSurcharge = paymentAmountCents + surchargePreview
  const filteredProducts = products.filter(p => p.category === activeCategory)

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading folio...</div>
  if (!folio) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Folio not found.</div>

  return (
    <div style={{ fontFamily: 'sans-serif', minHeight: '100vh', background: '#f9fafb' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' }}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{folio.guest_name}</h1>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Walk-up sale</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: overpaid > 0 ? '#6b7280' : totalDue > 0 ? '#dc2626' : '#15803d' }}>
            {overpaid > 0 ? 'Change: $' + (overpaid/100).toFixed(2) : '$' + (totalDue/100).toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            {overpaid > 0 ? 'give change' : totalDue > 0 ? 'balance due' : '✓ paid in full'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
        <button onClick={() => setActiveTab('tab')} style={{ flex: 1, padding: '12px', fontSize: 14, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === 'tab' ? '2px solid #15803d' : '2px solid transparent', color: activeTab === 'tab' ? '#15803d' : '#6b7280' }}>Guest Tab</button>
        <button onClick={() => setActiveTab('items')} style={{ flex: 1, padding: '12px', fontSize: 14, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === 'items' ? '2px solid #15803d' : '2px solid transparent', color: activeTab === 'items' ? '#15803d' : '#6b7280' }}>Add Items</button>
      </div>

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 120px)' }}>
        <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: activeTab === 'tab' ? 'block' : 'none' }}>
          {lineItems.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>Charges</div>
              {lineItems.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < lineItems.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{item.description}</div>
                    {item.tax_amount > 0 && <div style={{ fontSize: 11, color: '#9ca3af' }}>incl. ${(item.tax_amount/100).toFixed(2)} tax</div>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>${(item.line_total/100).toFixed(2)}</div>
                  <button onClick={() => removeLineItem(item.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: '1' }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f3f4f6', fontWeight: 700, fontSize: 14 }}>
                <span>Total</span>
                <span>${(itemsTotal/100).toFixed(2)}</span>
              </div>
            </div>
          )}

          {payments.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>Payments</div>
              {payments.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < payments.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, textTransform: 'capitalize' }}>{p.method}</div>
                    {p.note && <div style={{ fontSize: 11, color: '#9ca3af' }}>{p.note}</div>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#15803d' }}>-${(p.amount/100).toFixed(2)}</div>
                  <button onClick={() => voidPayment(p.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: '1' }}>×</button>
                </div>
              ))}
            </div>
          )}

          {lineItems.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '3rem 0', fontSize: 14 }}>No charges yet. Tap Add Items to get started.</div>
          )}

          {totalDue > 0 && (
            <button onClick={() => { setPaymentAmount((totalDue/100).toFixed(2)); setShowPayment(true) }} style={{ width: '100%', background: '#15803d', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginTop: 8 }}>
              Collect Payment · ${(totalDue/100).toFixed(2)}
            </button>
          )}

          {overpaid > 0 && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '1rem', marginTop: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#15803d' }}>Give change: ${(overpaid/100).toFixed(2)}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Folio complete</div>
            </div>
          )}
        </div>

        <div style={{ width: 'min(380px, 100%)', background: '#fff', borderLeft: '1px solid #e5e7eb', display: activeTab === 'items' ? 'flex' : 'none', flexDirection: 'column' }}>
          <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid #e5e7eb', padding: '0 0.75rem' }}>
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)} style={{ padding: '10px 10px', fontSize: 12, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: activeCategory === cat ? '2px solid #15803d' : '2px solid transparent', color: activeCategory === cat ? '#15803d' : '#6b7280' }}>
                {cat}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0.875rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignContent: 'start' }}>
            {filteredProducts.map(product => (
              <button key={product.id} onClick={() => addProduct(product)} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 10px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{product.name}</div>
                <div style={{ fontSize: 15, color: '#15803d', fontWeight: 700 }}>${(product.price/100).toFixed(2)}</div>
                {product.tax_class === 'standard' && <div style={{ fontSize: 10, color: '#9ca3af' }}>+ tax</div>}
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '2rem 0' }}>No products in this category</div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', padding: '0.875rem' }}>
            {!showCustomItem ? (
              <button onClick={() => setShowCustomItem(true)} style={{ width: '100%', background: 'none', border: '1px dashed #d1d5db', borderRadius: 8, padding: '10px', fontSize: 13, color: '#6b7280', cursor: 'pointer' }}>+ Custom charge</button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input style={si} placeholder='Description' value={customDesc} onChange={e => setCustomDesc(e.target.value)} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input style={si} placeholder='Price $' value={customPrice} onChange={e => setCustomPrice(e.target.value)} />
                  <input style={si} placeholder='Qty' value={customQty} onChange={e => setCustomQty(e.target.value)} />
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '1.5rem', width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Collect Payment</h2>
              <button onClick={() => setShowPayment(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>×</button>
            </div>
            <label style={ml}>Payment method</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {['cash', 'card', 'check'].map(m => (
                <button key={m} onClick={() => setPaymentMethod(m)} style={{ padding: '12px', border: '2px solid ' + (paymentMethod === m ? '#15803d' : '#e5e7eb'), borderRadius: 8, background: paymentMethod === m ? '#f0fdf4' : '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', textTransform: 'capitalize', color: paymentMethod === m ? '#15803d' : '#374151' }}>
                  {m}
                </button>
              ))}
            </div>
            <label style={ml}>{paymentMethod === 'cash' ? 'Amount due' : 'Amount'}</label>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 18 }}>$</span>
              <input style={{ ...si, paddingLeft: 30, fontSize: 24, fontWeight: 700, height: 56, background: paymentMethod === 'cash' ? '#f9fafb' : '#fff', color: paymentMethod === 'cash' ? '#6b7280' : '#111827' }} type='number' step='0.01' value={paymentAmount} readOnly={paymentMethod === 'cash'} onChange={e => setPaymentAmount(e.target.value)} />
            </div>
            {paymentMethod === 'cash' && (
              <>
                <label style={ml}>Cash tendered</label>
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 18 }}>$</span>
                  <input style={{ ...si, paddingLeft: 30, fontSize: 24, fontWeight: 700, height: 56 }} type='number' step='0.01' value={cashTendered} onChange={e => setCashTendered(e.target.value)} placeholder='0.00' autoFocus />
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
            <input style={{ ...si, marginBottom: 16 }} placeholder='e.g. check #1042' value={paymentNote} onChange={e => setPaymentNote(e.target.value)} />
            <button onClick={collectPayment} disabled={savingPayment} style={{ width: '100%', background: '#15803d', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>
              {savingPayment ? 'Recording...' : paymentMethod === 'card' && surchargePreview > 0 ? 'Charge card · $' + (totalWithSurcharge/100).toFixed(2) : 'Record ' + paymentMethod + ' · $' + paymentAmount}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const si: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' }
const ml: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }