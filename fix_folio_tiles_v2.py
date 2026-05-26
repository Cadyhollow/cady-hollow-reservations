path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Replace the entire VariableProductTile function with improved version
old_tile = '''function VariableProductTile({ product, onAdd }: { product: any, onAdd: (p: any, price?: number, qty?: number, notes?: string) => void }) {
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

  const tileStyle: React.CSSProperties = { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }

  const qtyRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={() => setQty(q => Math.max(1, q - 1))}
        style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', flexShrink: 0 }}
      >−</button>
      <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 700, fontSize: 18 }}>{qty}</span>
      <button
        onClick={() => setQty(q => q + 1)}
        style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', flexShrink: 0 }}
      >+</button>
    </div>
  )

  if (!product.variable_price) {
    return (
      <div style={tileStyle}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{product.name}</div>
        <div style={{ fontSize: 18, color: '#15803d', fontWeight: 700 }}>${(product.price/100).toFixed(2)}{product.tax_class === 'standard' && <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}> + tax</span>}</div>
        {qtyRow}
        <input
          placeholder="Note (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#374151', boxSizing: 'border-box' }}
        />
        <button
          onClick={() => handleAdd()}
          style={{ width: '100%', background: '#2E6B8A', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          Add to Tab
        </button>
      </div>
    )
  }

  return (
    <div style={tileStyle}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{product.name}</div>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 16 }}>$</span>
        <input
          type='number'
          min='0'
          step='0.01'
          placeholder='0.00'
          value={customPrice}
          onChange={e => setCustomPrice(e.target.value)}
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 10px 10px 26px', fontSize: 16, boxSizing: 'border-box' }}
        />
      </div>
      {qtyRow}
      <input
        placeholder="Note (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#374151', boxSizing: 'border-box' }}
      />
      <button
        onClick={() => { if (customPrice) handleAdd(Math.round(parseFloat(customPrice) * 100)) }}
        disabled={!customPrice || parseFloat(customPrice) <= 0}
        style={{ width: '100%', background: customPrice && parseFloat(customPrice) > 0 ? '#2E6B8A' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontSize: 15, fontWeight: 700, cursor: customPrice ? 'pointer' : 'default' }}
      >
        Add to Tab
      </button>
    </div>
  )
}'''

if old_tile in content:
    content = content.replace(old_tile, new_tile, 1)
    print('  ✓ VariableProductTile replaced')
else:
    print('  ✗ MISSING: VariableProductTile — did not match. File NOT saved.')
    exit(1)

# Verify the new tile landed
checks = [
    ('Larger qty buttons (40px)', 'width: 40, height: 40'),
    ('Add to Tab button on fixed items', 'Add to Tab'),
    ('Note field full width', 'placeholder="Note (optional)"'),
    ('Larger font on name', 'fontSize: 15 }}>{product.name}'),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "POS: larger tile targets, explicit Add to Tab button" && git push')
else:
    print('\n❌ Some checks failed — file NOT saved.')
