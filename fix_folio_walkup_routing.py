path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Fix the init function to try folio ID lookup if reservation lookup fails
old_init = """    if (isNew) { setLoading(false); return }

    const { data: res } = await supabase.from('reservations').select('*').eq('id', reservationId).single()
    if (res) setReservation(res)

    const { data: existingFolio } = await supabase.from('folios').select('*').eq('reservation_id', reservationId).single()
    if (existingFolio) {
      setFolio(existingFolio)
      await loadFolioData(existingFolio.id)
    } else if (res) {
      const { data: newFolio } = await supabase.from('folios').insert({
        reservation_id: res.id,
        guest_name: res.guest_name,
        guest_email: res.guest_email || '',
        folio_type: 'reservation',
        status: 'open',
      }).select().single()
      if (newFolio) {
        setFolio(newFolio)
        await loadFolioData(newFolio.id)
      }
    }
    setLoading(false)"""

new_init = """    if (isNew) { setLoading(false); return }

    // First try: treat the ID as a reservation ID
    const { data: res } = await supabase.from('reservations').select('*').eq('id', reservationId).single()
    if (res) setReservation(res)

    const { data: existingFolio } = await supabase.from('folios').select('*').eq('reservation_id', reservationId).single()
    if (existingFolio) {
      setFolio(existingFolio)
      await loadFolioData(existingFolio.id)
    } else if (res) {
      const { data: newFolio } = await supabase.from('folios').insert({
        reservation_id: res.id,
        guest_name: res.guest_name,
        guest_email: res.guest_email || '',
        folio_type: 'reservation',
        status: 'open',
      }).select().single()
      if (newFolio) {
        setFolio(newFolio)
        await loadFolioData(newFolio.id)
      }
    } else {
      // Second try: treat the ID as a direct folio ID (walk-up folios)
      const { data: directFolio } = await supabase.from('folios').select('*').eq('id', reservationId).single()
      if (directFolio) {
        setFolio(directFolio)
        await loadFolioData(directFolio.id)
      }
    }
    setLoading(false)"""

if old_init in content:
    content = content.replace(old_init, new_init, 1)
    print('  \u2713 Folio page handles direct folio ID for walk-ups')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Folio: support direct folio ID access for walk-up folios" && git push')
else:
    print('  \u2717 MISSING: init block not found \u2014 file NOT saved. Paste output to Claude.')
