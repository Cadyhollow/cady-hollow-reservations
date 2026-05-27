path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Remove the misplaced useEffect from after the conditional return
old_misplaced = """  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading folio...</div>
  // Gate walk-up sale by pos_enabled
  useEffect(() => {
    if (isNew) {
      supabase.from('settings').select('pos_enabled').single().then(({ data }) => {
        if (!data?.pos_enabled) router.replace('/admin')
      })
    }
  }, [isNew])
  if (isNew && !folio) {"""

new_misplaced = """  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading folio...</div>
  if (isNew && !folio) {"""

# Add it in the right place — after the existing useEffect(() => { init() }, [reservationId]) line
old_correct_location = "  useEffect(() => { init() }, [reservationId])"
new_correct_location = """  useEffect(() => { init() }, [reservationId])

  // Gate walk-up sale by pos_enabled — must be here at top level, not after conditional returns
  useEffect(() => {
    if (isNew) {
      supabase.from('settings').select('pos_enabled').single().then(({ data }) => {
        if (!data?.pos_enabled) router.replace('/admin')
      })
    }
  }, [isNew])"""

checks = [
    ('Remove misplaced useEffect', old_misplaced, new_misplaced),
    ('Add useEffect at correct location', old_correct_location, new_correct_location),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Folio: fix useEffect hook placement causing React error #310" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
