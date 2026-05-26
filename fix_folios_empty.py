path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folios/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Add a filter to hide empty folios (no payments and no items) from the list
old_search = '''  // Search filter
  const filtered = folios.filter(f => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const nameMatch = (f.guest_name || '').toLowerCase().includes(q)
    const amountMatch = ((f.payments_total) / 100).toFixed(2).includes(q)
    const siteMatch = f.reservations?.site_number?.toLowerCase().includes(q) || false
    const methodMatch = f.last_payment_method.toLowerCase().includes(q)
    return nameMatch || amountMatch || siteMatch || methodMatch
  })'''

new_search = '''  // Search filter — also hide empty folios (no payments, no items, no reservation balance)
  const filtered = folios.filter(f => {
    const hasActivity = f.payments_total > 0 || f.items_total > 0 || (f.reservations && f.reservations.total_price > 0)
    if (!hasActivity) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const nameMatch = (f.guest_name || '').toLowerCase().includes(q)
    const amountMatch = ((f.payments_total) / 100).toFixed(2).includes(q)
    const siteMatch = f.reservations?.site_number?.toLowerCase().includes(q) || false
    const methodMatch = f.last_payment_method.toLowerCase().includes(q)
    return nameMatch || amountMatch || siteMatch || methodMatch
  })'''

if old_search in content:
    content = content.replace(old_search, new_search, 1)
    print('  \u2713 Empty folio filter added')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Folios: hide empty test folios with no activity" && git push')
else:
    print('  \u2717 MISSING: search filter block not found \u2014 file NOT saved. Paste output to Claude.')
