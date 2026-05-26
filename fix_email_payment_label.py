path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/api/email/route.ts'

with open(path, 'r') as f:
    content = f.read()

old_label = "paymentType === 'deposit' ? 'Deposit' : paymentType === 'unpaid' ? 'Pay on Arrival' : 'Full Payment'"
new_label = "paymentType === 'deposit' ? 'Deposit' : paymentType === 'unpaid' ? 'Pay on Arrival' : paymentType === 'full' ? 'Full Payment' : amountPaid >= totalPrice ? 'Full Payment' : amountPaid > 0 ? 'Deposit' : 'Pay on Arrival'"

if old_label in content:
    content = content.replace(old_label, new_label, 1)
    print('  \u2713 Payment label fixed')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Email: fix payment type label to correctly show Deposit vs Full Payment" && git push')
else:
    print('  \u2717 MISSING: label not found \u2014 file NOT saved. Paste output to Claude.')
