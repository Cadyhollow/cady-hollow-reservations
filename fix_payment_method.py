import subprocess

# ── Fix 1: Manual booking API route ──────────────────────────────────────────
api_path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/api/manual-booking/route.ts'

with open(api_path, 'r') as f:
    api_content = f.read()

old_destructure = """      amount_paid,
      payment_type,
      notes,
      addonItems,
    } = body"""

new_destructure = """      amount_paid,
      payment_type,
      payment_method,
      notes,
      addonItems,
    } = body"""

old_insert = """        amount_paid,
        payment_type,
        square_payment_id: null,"""

new_insert = """        amount_paid,
        payment_type,
        payment_method: payment_method || 'cash',
        square_payment_id: null,"""

api_checks = [
    ('Destructure payment_method', old_destructure, new_destructure),
    ('Insert payment_method', old_insert, new_insert),
]

api_good = True
for label, old, new in api_checks:
    if old in api_content:
        api_content = api_content.replace(old, new, 1)
        print(f'  \u2713 API: {label}')
    else:
        print(f'  \u2717 MISSING API: {label}')
        api_good = False

# ── Fix 2: Transactions page — use payment_method for reservation payments ────
tx_path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/transactions/page.tsx'

with open(tx_path, 'r') as f:
    tx_content = f.read()

# Fix the online reservation mapping to use actual payment_method
old_res_select = """    const { data: onlineResData } = await supabase
      .from('reservations')
      .select('id, guest_name, amount_paid, payment_type, created_at, square_payment_id')
      .gt('amount_paid', 0)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .neq('status', 'cancelled')"""

new_res_select = """    const { data: onlineResData } = await supabase
      .from('reservations')
      .select('id, guest_name, amount_paid, payment_type, payment_method, created_at, square_payment_id')
      .gt('amount_paid', 0)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .neq('status', 'cancelled')"""

# Fix the method assignment — use payment_method if available, fall back to square_payment_id check
old_method = """      method: 'card',"""
new_method = """      method: r.payment_method || (r.square_payment_id ? 'card' : 'cash'),"""

tx_checks = [
    ('Select payment_method from reservations', old_res_select, new_res_select),
    ('Use payment_method for display', old_method, new_method),
]

tx_good = True
for label, old, new in tx_checks:
    if old in tx_content:
        tx_content = tx_content.replace(old, new, 1)
        print(f'  \u2713 Transactions: {label}')
    else:
        print(f'  \u2717 MISSING Transactions: {label}')
        tx_good = False

all_good = api_good and tx_good

if all_good:
    with open(api_path, 'w') as f:
        f.write(api_content)
    with open(tx_path, 'w') as f:
        f.write(tx_content)
    print('\n\u2705 All edits applied and files saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Manual booking: add payment method selector; fix transactions method display" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 files NOT saved. Paste output above to Claude.')
