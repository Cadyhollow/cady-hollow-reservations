import shutil, os

src = os.path.expanduser('~/Downloads/reports_page_new.tsx')
dst = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reports/page.tsx'

# Back up the original
backup = dst + '.backup'
shutil.copy2(dst, backup)
print(f'  ✓ Backup saved to {backup}')

shutil.copy2(src, dst)
print(f'  ✓ New reports page written')

# Verify key features landed
with open(dst, 'r') as f:
    content = f.read()

checks = [
    ('Overview tab', "activeTab === 'overview'"),
    ('Payment Date toggle', "'payment_date'"),
    ('Stay Date toggle', "'stay_date'"),
    ('Fixed date end bound', ".lte('arrival_date', end)"),
    ('Cancelled count', 'cancelledCount'),
    ('Combined revenue', 'totalCombined'),
    ('Square-style day grouping', 'txByDay'),
    ('Payment date bar chart', 'Revenue by Payment Date'),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reports: overview tab, payment/stay date toggle, fixed date ranges, Square-style tx log" && git push')
else:
    print('\n\u274c Some checks failed. Restoring backup...')
    shutil.copy2(backup, dst)
    print('Original file restored. Paste output above to Claude.')
