path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/electric-billing/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Fix: sort numerically in JS after fetch instead of relying on Supabase text sort
old_sort = "    const { data: guests } = await supabase\n      .from('guests')\n      .select('*')\n      .eq('is_seasonal', true)\n      .order('site_number', { ascending: true })"

new_sort = "    const { data: guests } = await supabase\n      .from('guests')\n      .select('*')\n      .eq('is_seasonal', true)"

old_check = "    if (!guests || guests.length === 0) { setLoading(false); return }"
new_check = "    const sortedGuests = (guests || []).sort((a, b) => parseInt(a.site_number) - parseInt(b.site_number))\n    if (sortedGuests.length === 0) { setLoading(false); return }"

old_map = "    const rows: CamperRow[] = await Promise.all(guests.map(async (guest: Guest) => {"
new_map = "    const rows: CamperRow[] = await Promise.all(sortedGuests.map(async (guest: Guest) => {"

checks = [
    ('Remove Supabase text sort', old_sort, new_sort),
    ('Add numeric sort', old_check, new_check),
    ('Use sorted array', old_map, new_map),
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
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Electric billing: sort sites numerically" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
