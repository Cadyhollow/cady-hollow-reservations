path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reservations/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add override state variables ──────────────────────────────────────
old_state = "  const [saving, setSaving] = useState(false)\n  const [fees, setFees] = useState<{name:string,type:string,amount:number,applies_to:string}[]>([])"
new_state = "  const [saving, setSaving] = useState(false)\n  const [fees, setFees] = useState<{name:string,type:string,amount:number,applies_to:string}[]>([])\n  const [overrideTotal, setOverrideTotal] = useState(false)\n  const [overrideTotalValue, setOverrideTotalValue] = useState('')"

# ── Edit 2: Reset override state when startEditing is called ─────────────────
old_start_editing = "    setEditing(true)\n  }"
new_start_editing = "    setOverrideTotal(false)\n    setOverrideTotalValue('')\n    setEditing(true)\n  }"

# ── Edit 3: Use override total in handleSaveEdit ──────────────────────────────
old_save = """    const { error } = await supabase.from('reservations').update({
      site_id: editForm.site_id,
      arrival_date: editForm.arrival_date,
      departure_date: editForm.departure_date,
      num_adults: editForm.num_adults,
      num_children: editForm.num_children,
      total_price: newTotal,
      amount_paid: Math.round(parseFloat(editForm.amount_paid) * 100),
      notes: updatedNotes,
    }).eq('id', selected.id)"""

new_save = """    const finalTotal = overrideTotal && overrideTotalValue
      ? Math.round(parseFloat(overrideTotalValue) * 100)
      : newTotal

    const overrideNote = overrideTotal && overrideTotalValue
      ? `\\n[Total overridden ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}] Auto-calc: $${(newTotal/100).toFixed(2)} → Manual: $${parseFloat(overrideTotalValue).toFixed(2)}`
      : ''

    const { error } = await supabase.from('reservations').update({
      site_id: editForm.site_id,
      arrival_date: editForm.arrival_date,
      departure_date: editForm.departure_date,
      num_adults: editForm.num_adults,
      num_children: editForm.num_children,
      total_price: finalTotal,
      amount_paid: Math.round(parseFloat(editForm.amount_paid) * 100),
      notes: updatedNotes + overrideNote,
    }).eq('id', selected.id)"""

# ── Edit 4: Add override UI in the edit form, after the price summary box ─────
old_summary = """                <div className="flex gap-2 pt-2">
                  <button onClick={handleSaveEdit} disabled={saving}
                    className="flex-1 bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">
                    Cancel
                  </button>
                </div>"""

new_summary = """                {/* Override total */}
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideTotal}
                      onChange={e => {
                        setOverrideTotal(e.target.checked)
                        if (e.target.checked && editNights > 0 && editSite) {
                          setOverrideTotalValue((editTotal / 100).toFixed(2))
                        } else {
                          setOverrideTotalValue('')
                        }
                      }}
                      className="w-4 h-4 accent-green-700"
                    />
                    <span className="text-sm font-medium text-gray-700">Override total price</span>
                  </label>
                  {overrideTotal && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-500 mb-1">Enter the actual total (e.g. what was agreed at booking)</p>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-full border border-green-300 rounded-lg pl-7 pr-3 py-2 text-sm font-semibold"
                          value={overrideTotalValue}
                          onChange={e => setOverrideTotalValue(e.target.value)}
                        />
                      </div>
                      {overrideTotalValue && (
                        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                          Balance due will be: <strong>${Math.max(0, parseFloat(overrideTotalValue || '0') - parseFloat(editForm.amount_paid || '0')).toFixed(2)}</strong>
                          {' · '}An audit note will be added automatically.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <button onClick={handleSaveEdit} disabled={saving}
                    className="flex-1 bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">
                    Cancel
                  </button>
                </div>"""

checks = [
    ('Override state variables', old_state, new_state),
    ('Reset override on startEditing', old_start_editing, new_start_editing),
    ('Use override in save', old_save, new_save),
    ('Override UI in edit form', old_summary, new_summary),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reservations: add total price override with audit note" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
