import shutil, os

src = os.path.expanduser('~/Downloads/folios_page_new.tsx')
dst = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folios/page.tsx'

backup = dst + '.backup'
shutil.copy2(dst, backup)
print(f'  \u2713 Backup saved')

shutil.copy2(src, dst)
print(f'  \u2713 New folios page written')

with open(dst, 'r') as f:
    content = f.read()

checks = [
    ('Search field', 'Search by name, site, amount'),
    ('Day grouping', 'byDay'),
    ('Payment method dot', 'methodColor'),
    ('Walk-up filter tab', "'walkin'"),
    ('Reservation filter tab', "'reservation'"),
    ('Fixed walk-up routing', "'/admin/folio/' + f.id"),
    ('Single query no N+1', "reservations ( site_number"),
    ('Method badge on row', 'last_payment_method'),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Folios: Square-style day grouping, search, method badges, fast single query" && git push')
else:
    print('\n\u274c Some checks failed. Restoring backup...')
    shutil.copy2(backup, dst)
    print('Original restored. Paste output above to Claude.')
