path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# Gate the Walk-Up Sale quick link by pos_enabled
old_links = """      {[
          { label: 'New Booking', href: '/admin/manual-booking', icon: '➕' },
          { label: 'Walk-Up Sale', href: '/admin/folio/new', icon: '🛒' },
          { label: 'Walk-In Booking', href: '/admin/walkin-booking', icon: '🏕️' },
          { label: 'Guest Directory', href: '/admin/guests', icon: '👥' },
          { label: 'Calendar', href: '/admin/calendar', icon: '📅' },
          { label: 'Reservations', href: '/admin/reservations', icon: '📋' },
          { label: 'Settings', href: '/admin/settings', icon: '⚙️' },
        ].map(link => ("""

new_links = """      {[
          { label: 'New Booking', href: '/admin/manual-booking', icon: '➕' },
          ...(settings?.pos_enabled ? [{ label: 'Walk-Up Sale', href: '/admin/folio/new', icon: '🛒' }] : []),
          { label: 'Walk-In Booking', href: '/admin/walkin-booking', icon: '🏕️' },
          { label: 'Guest Directory', href: '/admin/guests', icon: '👥' },
          { label: 'Calendar', href: '/admin/calendar', icon: '📅' },
          { label: 'Reservations', href: '/admin/reservations', icon: '📋' },
          { label: 'Settings', href: '/admin/settings', icon: '⚙️' },
        ].map(link => ("""

if old_links in content:
    content = content.replace(old_links, new_links, 1)
    print('  \u2713 Walk-Up Sale button gated by pos_enabled')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Dashboard: gate Walk-Up Sale button by pos_enabled" && git push')
else:
    print('  \u2717 MISSING: quick links block not found \u2014 file NOT saved. Paste output to Claude.')
