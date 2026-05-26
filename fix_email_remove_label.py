path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/api/email/route.ts'

with open(path, 'r') as f:
    content = f.read()

# Try both possible versions of the label line
old1 = "$${(amountPaid / 100).toFixed(2)} (${paymentType === 'deposit' ? 'Deposit' : paymentType === 'unpaid' ? 'Pay on Arrival' : paymentType === 'full' ? 'Full Payment' : amountPaid >= totalPrice ? 'Full Payment' : amountPaid > 0 ? 'Deposit' : 'Pay on Arrival'})"
old2 = "$${(amountPaid / 100).toFixed(2)} (${paymentType === 'deposit' ? 'Deposit' : paymentType === 'unpaid' ? 'Pay on Arrival' : 'Full Payment'})"
new_val = "$${(amountPaid / 100).toFixed(2)}"

if old1 in content:
    content = content.replace(old1, new_val, 1)
    print('  \u2713 Payment label removed')
elif old2 in content:
    content = content.replace(old2, new_val, 1)
    print('  \u2713 Payment label removed')
else:
    print('  \u2717 MISSING: label line not found \u2014 file NOT saved. Paste output to Claude.')
    exit(1)

with open(path, 'w') as f:
    f.write(content)
print('\n\u2705 Fix applied and file saved!')
print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Email: remove payment type label from staff notification" && git push')
