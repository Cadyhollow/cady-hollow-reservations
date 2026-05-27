path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(path, 'r') as f:
    content = f.read()

old = """  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading folio...</div>
  // Gate walk-up sale by pos_enabled
  useEffect(() => {
    if (isNew) {
      supabase.from('settings').select('pos_enabled').single().then(({ data }) => {
        if (!data?.pos_enabled) router.replace('/admin')
      })
    }
  }, [isNew])
  if (isNew && !folio) {"""

new = """  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading folio...</div>
  if (isNew && !folio) {"""

if old in content:
    content = content.replace(old, new, 1)
    print('  \u2713 Misplaced useEffect removed')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Folio: fix useEffect hook placement causing React error #310" && git push')
else:
    print('  \u2717 MISSING \u2014 file NOT saved. Paste output to Claude.')
