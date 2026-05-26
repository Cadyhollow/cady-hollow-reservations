import re

path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(path, 'r') as f:
    content = f.read()

original = content

# ── Edit 1: Add notes to LineItem type ──────────────────────────────────────
content = content.replace(
    '  voided: boolean\n}',
    '  voided: boolean\n  notes: string | null\n}',
    1
)

# ── Edit 2: Update addProduct signature + body ───────────────────────────────
content = content.replace(
    'async function addProduct(product: Product, overridePrice?: number) {\n    if (!folio) return\n    const price = overridePrice ?? product.price\n    const taxAmount = product.tax_class === \'standard\' ? Math.round(price * 0.06) : 0\n    const lineTotal = price + taxAmount\n    await supabase.from(\'folio_line_items\').insert({\n      folio_id: folio.id,\n      product_id: product.id,\n      description: product.name,\n      quantity: 1,\n      unit_price: price,\n      tax_amount: taxAmount,\n      line_total: lineTotal,\n      category: product.category,\n    })',
    'async function addProduct(product: Product, overridePrice?: number, qty: number = 1, notes: string = \'\') {\n    if (!folio) return\n    const price = overridePrice ?? product.price\n    const taxAmount = product.tax_class === \'standard\' ? Math.round(price * 0.06) : 0\n    const lineTotal = (price + taxAmount) * qty\n    await supabase.from(\'folio_line_items\').insert({\n      folio_id: folio.id,\n      product_id: product.id,\n      description: product.name,\n      quantity: qty,\n      unit_price: price,\n      tax_amount: taxAmount,\n      line_total: lineTotal,\n      category: product.category,\n      notes: notes.trim() || null,\n    })',
    1
)

# ── Edit 3: Show qty × and notes on Guest Tab line items ─────────────────────
content = content.replace(
    '                  <div style={{ flex: 1 }}>\n                    <div style={{ fontSize: 14, fontWeight: 500 }}>{item.description}</div>\n                    {item.tax_amount > 0 && <div style={{ fontSize: 11, color: \'#9ca3af\' }}>incl. ${(item.tax_amount/100).toFixed(2)} tax</div>}\n                  </div>',
    '                  <div style={{ flex: 1 }}>\n                    <div style={{ fontSize: 14, fontWeight: 500 }}>{item.description}{item.quantity > 1 ? ` ×${item.quantity}` : \'\'}</div>\n                    {item.notes && <div style={{ fontSize: 11, color: \'#6b7280\', fontStyle: \'italic\' }}>{item.notes}</div>}\n                    {item.tax_amount > 0 && <div style={{ fontSize: 11, color: \'#9ca3af\' }}>incl. ${(item.tax_amount/100).toFixed(2)} tax</div>}\n                  </div>',
    1
)

# ── Edit 4: Replace VariableProductTile function ─────────────────────────────
old_tile = '''function VariableProductTile({ product, onAdd }: { product: any, onAdd: (p: any, price?: number) => void }) {
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
}'''

new_tile = '''function VariableProductTile({ product, onAdd }: { product: any, onAdd: (p: any, price?: number, qty?: number, notes?: string) => void }) {
  const [customPrice, setCustomPrice] = useState('')
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')

  function handleAdd(overridePrice?: number) {
    onAdd(product, overridePrice, qty, notes)
    setQty(1)
    setNotes('')
    setCustomPrice('')
  }

  const tileStyle: React.CSSProperties = { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px', display: 'flex', flexDirection: 'column', gap: 6 }

  const qtyRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
      <button
        onClick={() => setQty(q => Math.max(1, q - 1))}
        style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', flexShrink: 0 }}
      >−</button>
      <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{qty}</span>
      <button
        onClick={() => setQty(q => q + 1)}
        style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', flexShrink: 0 }}
      >+</button>
      <input
        placeholder="Note (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#374151', minWidth: 0 }}
      />
    </div>
  )

  if (!product.variable_price) {
    return (
      <div style={tileStyle}>
        <button
          onClick={() => handleAdd()}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>{product.name}</div>
          <div style={{ fontSize: 15, color: '#15803d', fontWeight: 700 }}>${(product.price/100).toFixed(2)}</div>
          {product.tax_class === 'standard' && <div style={{ fontSize: 10, color: '#9ca3af' }}>+ tax</div>}
        </button>
        {qtyRow}
      </div>
    )
  }

  return (
    <div style={tileStyle}>
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
      {qtyRow}
      <button
        onClick={() => { if (customPrice) handleAdd(Math.round(parseFloat(customPrice) * 100)) }}
        disabled={!customPrice || parseFloat(customPrice) <= 0}
        style={{ background: customPrice && parseFloat(customPrice) > 0 ? '#2E6B8A' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 6, padding: '6px', fontSize: 12, fontWeight: 600, cursor: customPrice ? 'pointer' : 'default' }}
      >
        Add
      </button>
    </div>
  )
}'''

content = content.replace(old_tile, new_tile, 1)

# ── Verify all edits landed ──────────────────────────────────────────────────
checks = [
    ('LineItem notes field', 'notes: string | null'),
    ('addProduct qty/notes params', 'qty: number = 1, notes: string = \'\''),
    ('line_total uses qty', '(price + taxAmount) * qty'),
    ('notes saved to DB', 'notes: notes.trim() || null'),
    ('Guest Tab shows qty', 'item.quantity > 1'),
    ('Guest Tab shows notes', 'item.notes &&'),
    ('VariableProductTile updated', 'function handleAdd(overridePrice?: number)'),
]

all_good = True
for label, snippet in checks:
    if snippet in content:
        print(f'  ✓ {label}')
    else:
        print(f'  ✗ MISSING: {label}')
        all_good = False

if all_good:
    with open(path, 'w') as f:
        f.write(content)
    print('\n✅ All edits applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "POS: add qty and notes to item tiles" && git push')
else:
    print('\n❌ Some edits did not apply — file NOT saved. Paste the output above to Claude.')
