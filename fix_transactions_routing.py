path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/transactions/page.tsx'

with open(path, 'r') as f:
    content = f.read()

old_href = """  function getFolioHref(p: Payment) {
    if (p.folio_type === 'guest_account' && p.guest_id) return '/admin/folio/guest/' + p.guest_id
    if (p.reservation_id) return '/admin/folio/' + p.reservation_id
    if (p.folio_id) return '/admin/folio/' + p.folio_id
    return '/admin/reservations'
  }"""

new_href = """  function getFolioHref(p: Payment) {
    // Seasonal guest account — goes to guest folio page
    if (p.folio_type === 'guest_account' && p.guest_id) return '/admin/folio/guest/' + p.guest_id
    // Online reservation payment (no folio) — go to reservation detail
    if (p.is_reservation_payment && p.reservation_id) return '/admin/reservations?id=' + p.reservation_id
    // Folio linked to a reservation — use reservation ID as the folio route param
    if (p.reservation_id) return '/admin/folio/' + p.reservation_id
    // Walk-up folio — use folio ID directly
    if (p.folio_id) return '/admin/folio/' + p.folio_id
    return '/admin/reservations'
  }"""

if old_href in content:
    content = content.replace(old_href, new_href, 1)
    print('  \u2713 getFolioHref routing fixed')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Transactions: fix Open Folio routing" && git push')
else:
    print('  \u2717 MISSING: routing function not found \u2014 file NOT saved. Paste output to Claude.')
