path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reservations/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# The issue: overrideNote uses newTotal which may be 0 if editSite isn't found.
# Fix: fall back to selected.total_price as the "was" value when newTotal is 0.
old_note = """    const overrideNote = overrideTotal && overrideTotalValue
      ? `\\n[Total overridden ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}] Auto-calc: $${(newTotal/100).toFixed(2)} → Manual: $${parseFloat(overrideTotalValue).toFixed(2)}`
      : ''"""

new_note = """    const prevTotal = newTotal > 0 ? newTotal : selected.total_price
    const overrideNote = overrideTotal && overrideTotalValue
      ? `\\n[Total overridden ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}] Previous total: $${(prevTotal/100).toFixed(2)} → New total: $${parseFloat(overrideTotalValue).toFixed(2)}`
      : ''"""

if old_note in content:
    content = content.replace(old_note, new_note, 1)
    print('  \u2713 Override audit note fixed')
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reservations: fix override audit note to always show previous total" && git push')
else:
    print('  \u2717 MISSING: override note block not found \u2014 file NOT saved. Paste output to Claude.')
