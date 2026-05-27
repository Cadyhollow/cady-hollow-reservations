path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reports/page.tsx'

with open(path, 'r') as f:
    content = f.read()

old_totals = """  // ── Computed: combined overview ───────────────────────────────────────────
  const totalCombined = resRevenue + (posEnabled ? posRevenue : 0) + electricRevenue + otherGuestRevenue
  const totalCash = transactions.filter(t => t.method === 'cash').reduce((s, t) => s + t.amount, 0) / 100
  const totalCard = transactions.filter(t => t.method === 'card').reduce((s, t) => s + t.amount, 0) / 100
  const totalCheck = transactions.filter(t => t.method === 'check').reduce((s, t) => s + t.amount, 0) / 100
  const totalSurcharge = transactions.reduce((s, t) => s + (t.surcharge_amount || 0), 0) / 100"""

new_totals = """  // ── Computed: combined overview ───────────────────────────────────────────
  const totalCombined = resRevenue + (posEnabled ? posRevenue : 0) + electricRevenue + otherGuestRevenue
  // Include seasonal payments in method totals
  const allPayments = [...transactions, ...guestAccountPayments]
  const totalCash = allPayments.filter(t => t.method === 'cash').reduce((s, t) => s + t.amount, 0) / 100
  const totalCard = allPayments.filter(t => t.method === 'card').reduce((s, t) => s + t.amount, 0) / 100
  const totalCheck = allPayments.filter(t => t.method === 'check').reduce((s, t) => s + t.amount, 0) / 100
  const totalSurcharge = allPayments.reduce((s, t) => s + (t.surcharge_amount || 0), 0) / 100"""

if old_totals in content:
    content = content.replace(old_totals, new_totals, 1)
    print('  \u2713 Method totals include seasonal payments')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reports: include seasonal payments in cash/card/check totals" && git push')
else:
    print('  \u2717 MISSING: totals block not found \u2014 file NOT saved. Paste output to Claude.')
