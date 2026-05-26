path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Make the product picker panel full width instead of fixed 420px ──
old_panel = "{ width: 'min(420px, 100%)', background: '#C9D2D9', borderLeft: '1px solid #b8c4cc', display: activeTab === 'items' ? 'flex' : 'none', flexDirection: 'column' }"
new_panel = "{ flex: 1, background: '#C9D2D9', display: activeTab === 'items' ? 'flex' : 'none', flexDirection: 'column' }"

# ── Edit 2: Category buttons — use a responsive grid instead of single column ──
old_cats = "{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10 }"
new_cats = "{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, alignContent: 'start' }"

# ── Edit 3: Item grid — auto-fill wider tiles instead of fixed 2 columns ──
old_grid = "{ flex: 1, overflowY: 'auto', padding: '0.875rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignContent: 'start' }"
new_grid = "{ flex: 1, overflowY: 'auto', padding: '0.875rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, alignContent: 'start' }"

checks = [
    ('Panel width fix', old_panel, new_panel),
    ('Category grid', old_cats, new_cats),
    ('Item grid wider', old_grid, new_grid),
]

all_good = True
for label, old, new in checks:
    if old in content:
        content = content.replace(old, new, 1)
        print(f'  \u2713 {label}')
    else:
        print(f'  \u2717 MISSING: {label}')
        all_good = False

if all_good:
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 All edits applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "POS: full-width category and item panels" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
