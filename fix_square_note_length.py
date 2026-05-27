path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/api/admin-card-payment/route.ts'

with open(path, 'r') as f:
    content = f.read()

old_note = "          note: guestName ? `${guestName} · Manual entry` : 'Admin manual card entry',"
new_note = "          note: guestName ? `${guestName.slice(0, 30)} · Manual entry`.slice(0, 45) : 'Admin manual card entry',"

if old_note in content:
    content = content.replace(old_note, new_note, 1)
    print('  \u2713 Note field truncated to 45 chars')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Admin card payment: fix Square note field 45 char limit" && git push')
else:
    print('  \u2717 MISSING \u2014 file NOT saved. Paste output to Claude.')
