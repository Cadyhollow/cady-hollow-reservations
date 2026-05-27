import shutil, os

# ── Step 1: Create the transactions page ─────────────────────────────────────
src = os.path.expanduser('~/Downloads/transactions_page.tsx')
dst_dir = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/transactions'
dst = dst_dir + '/page.tsx'

os.makedirs(dst_dir, exist_ok=True)
shutil.copy2(src, dst)
print('  \u2713 Transactions page created at app/admin/transactions/page.tsx')

# ── Step 2: Add Transactions to Finance nav group ─────────────────────────────
nav_path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/layout.tsx'

with open(nav_path, 'r') as f:
    nav_content = f.read()

old_finance = """      { name: 'Taxes & Fees', href: '/admin/fees', icon: '🧾' },
      { name: 'Electric Billing', href: '/admin/electric-billing', icon: '⚡', minPlan: 'summit' as const },
      { name: 'Discounts', href: '/admin/discounts', icon: '🏷️' },
      { name: 'Reports', href: '/admin/reports', icon: '📊', minPlan: 'ridgeline' as const },"""

new_finance = """      { name: 'Taxes & Fees', href: '/admin/fees', icon: '🧾' },
      { name: 'Electric Billing', href: '/admin/electric-billing', icon: '⚡', minPlan: 'summit' as const },
      { name: 'Discounts', href: '/admin/discounts', icon: '🏷️' },
      { name: 'Transactions', href: '/admin/transactions', icon: '💳' },
      { name: 'Reports', href: '/admin/reports', icon: '📊', minPlan: 'ridgeline' as const },"""

if old_finance in nav_content:
    nav_content = nav_content.replace(old_finance, new_finance, 1)
    with open(nav_path, 'w') as f:
        f.write(nav_content)
    print('  \u2713 Transactions added to Finance nav group')
else:
    print('  \u2717 MISSING: Finance nav group not found in layout.tsx')

# ── Step 3: Verify page file ──────────────────────────────────────────────────
with open(dst, 'r') as f:
    page_content = f.read()

checks = [
    ('Search field', 'Search by name, amount, method'),
    ('Day grouping', 'byDay'),
    ('All folio types', 'guest_account'),
    ('Expand for line items', 'toggleExpand'),
    ('Method color dots', 'methodDot'),
    ('Type badges', 'getTypeLabel'),
    ('Open Folio button', 'Open Folio'),
    ('Summary stats', 'totalCollected'),
]

all_good = True
for label, snippet in checks:
    if snippet in page_content:
        print(f'  \u2713 {label}')
    else:
        print(f'  \u2717 MISSING: {label}')
        all_good = False

if all_good:
    print('\n\u2705 All checks passed!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Add comprehensive Transactions page under Finance" && git push')
else:
    print('\n\u274c Some checks failed. Paste output above to Claude.')
