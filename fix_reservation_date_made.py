path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reservations/page.tsx'

with open(path, 'r') as f:
    content = f.read()

old_dates = """                <div>
                  <p className="text-gray-500">Dates</p>
                  <p className="font-medium text-gray-900">{selected.arrival_date} → {selected.departure_date} ({nights(selected)} nights)</p>
                </div>"""

new_dates = """                <div>
                  <p className="text-gray-500">Dates</p>
                  <p className="font-medium text-gray-900">{selected.arrival_date} → {selected.departure_date} ({nights(selected)} nights)</p>
                </div>
                <div>
                  <p className="text-gray-500">Reservation Made</p>
                  <p className="font-medium text-gray-900">{new Date(selected.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                </div>"""

if old_dates in content:
    content = content.replace(old_dates, new_dates, 1)
    print('  \u2713 Date reservation made added to detail panel')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
else:
    print('  \u2717 MISSING: dates block not found \u2014 file NOT saved. Paste output to Claude.')
