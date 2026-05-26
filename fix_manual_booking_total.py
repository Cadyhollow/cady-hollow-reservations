path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/manual-booking/page.tsx'

with open(path, 'r') as f:
    content = f.read()

old_total = "        total_price: amountPaid + Math.round(parseFloat(balanceDue || '0') * 100),"
new_total = "        total_price: balanceDue ? amountPaid + Math.round(parseFloat(balanceDue) * 100) : calculatedTotal,"

if old_total in content:
    content = content.replace(old_total, new_total, 1)
    print('  \u2713 total_price fix applied')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Manual booking: fix total_price to use calculated total not just amount paid" && git push')
else:
    print('  \u2717 MISSING: line not found \u2014 file NOT saved. Paste output to Claude.')
