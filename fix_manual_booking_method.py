path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/manual-booking/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add payment_method to form state ──────────────────────────────────
old_form_state = """    payment_type: 'full',
    amount_paid: '',
    notes: '',
  })"""

new_form_state = """    payment_type: 'full',
    amount_paid: '',
    payment_method: 'cash',
    notes: '',
  })"""

# ── Edit 2: Add payment_method to form reset after save ───────────────────────
old_form_reset = """      payment_type: 'full',
      amount_paid: '',
      notes: '',
    })"""

new_form_reset = """      payment_type: 'full',
      amount_paid: '',
      payment_method: 'cash',
      notes: '',
    })"""

# ── Edit 3: Pass payment_method to the API ────────────────────────────────────
old_api_call = """        amount_paid: amountPaid,
        payment_type: amountPaid > 0 ? 'deposit' : 'unpaid',"""

new_api_call = """        amount_paid: amountPaid,
        payment_type: amountPaid > 0 ? 'deposit' : 'unpaid',
        payment_method: form.payment_method,"""

# ── Edit 4: Add method selector UI above Amount Paid ─────────────────────────
old_payment_ui = """              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount Paid Today ($)</label>
                <input type="number" min="0" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0.00" value={form.amount_paid} onChange={e => setForm({ ...form, amount_paid: e.target.value })} />
                <p className="text-xs text-gray-400 mt-1">Card total: ${(total / 100).toFixed(2)} · Cash total: ${(cashTotal / 100).toFixed(2)}</p>
              </div>"""

new_payment_ui = """              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['cash', 'card', 'check'] as const).map(m => (
                    <button key={m} type="button" onClick={() => setForm({ ...form, payment_method: m })}
                      className="py-2 rounded-lg text-sm font-semibold border-2 capitalize transition-colors"
                      style={{ borderColor: form.payment_method === m ? '#15803d' : '#e5e7eb', background: form.payment_method === m ? '#f0fdf4' : '#fff', color: form.payment_method === m ? '#15803d' : '#374151' }}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount Paid Today ($)</label>
                <input type="number" min="0" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0.00" value={form.amount_paid} onChange={e => setForm({ ...form, amount_paid: e.target.value })} />
                <p className="text-xs text-gray-400 mt-1">Card total: ${(total / 100).toFixed(2)} · Cash total: ${(cashTotal / 100).toFixed(2)}</p>
              </div>"""

checks = [
    ('payment_method in form state', old_form_state, new_form_state),
    ('payment_method in form reset', old_form_reset, new_form_reset),
    ('payment_method passed to API', old_api_call, new_api_call),
    ('payment method selector UI', old_payment_ui, new_payment_ui),
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
    print('Next step: update the manual-booking API route to save payment_method')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
