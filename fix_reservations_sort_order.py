path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reservations/page.tsx'

with open(path, 'r') as f:
    content = f.read()

old_sort = """  }).sort((a, b) => {
    if (sortBy === 'arrival_date') return a.arrival_date.localeCompare(b.arrival_date)
    if (sortBy === 'created_at') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (sortBy === 'guest_name') return a.guest_name.localeCompare(b.guest_name)
    return 0
  })"""

new_sort = """  }).sort((a, b) => {
    if (sortBy === 'arrival_date') {
      const today = new Date().toISOString().split('T')[0]
      const aUpcoming = a.arrival_date >= today
      const bUpcoming = b.arrival_date >= today
      if (aUpcoming && !bUpcoming) return -1
      if (!aUpcoming && bUpcoming) return 1
      if (aUpcoming && bUpcoming) return a.arrival_date.localeCompare(b.arrival_date)
      return b.arrival_date.localeCompare(a.arrival_date)
    }
    if (sortBy === 'created_at') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (sortBy === 'guest_name') return a.guest_name.localeCompare(b.guest_name)
    return 0
  })"""

if old_sort in content:
    content = content.replace(old_sort, new_sort, 1)
    print('  \u2713 Arrival date sort fixed')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reservations: upcoming arrivals first, past at bottom" && git push')
else:
    print('  \u2717 MISSING: sort block not found \u2014 file NOT saved. Paste output to Claude.')
