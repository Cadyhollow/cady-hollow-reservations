import shutil, os

src = os.path.expanduser('~/Downloads/electric_billing_new.tsx')
dst = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/electric-billing/page.tsx'

backup = dst + '.backup'
shutil.copy2(dst, backup)
print(f'  \u2713 Backup saved')

shutil.copy2(src, dst)
print(f'  \u2713 New electric billing page written')

with open(dst, 'r') as f:
    content = f.read()

checks = [
    ('Record payment button', 'Record Payment'),
    ('Payment entry form', 'recordPayment'),
    ('View history button', 'View History'),
    ('History panel in billing tab', 'Billing History'),
    ('Account history tab', "activeTab === 'history'"),
    ('GuestAccountCard component', 'GuestAccountCard'),
    ('All-time totals row', 'All-time totals'),
    ('Payments received section', 'Payments received'),
    ('Numeric site sort', 'parseInt(a.site_number)'),
]

all_good = True
for label, snippet in checks:
    if snippet in content:
        print(f'  \u2713 {label}')
    else:
        print(f'  \u2717 MISSING: {label}')
        all_good = False

if all_good:
    print('\n\u2705 All checks passed!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Electric billing: add payment recording, billing history, account history tab" && git push')
else:
    print('\n\u274c Some checks failed. Restoring backup...')
    shutil.copy2(backup, dst)
    print('Original restored.')
