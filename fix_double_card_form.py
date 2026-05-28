path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/manual-booking/page.tsx'

with open(path, 'r') as f:
    content = f.read()

old_card_div = """                  <div id="manual-booking-card" className="border border-gray-200 rounded-lg p-2 min-h-[89px]"
                    ref={el => { if (el && !squareCardLoaded) setTimeout(loadSquareCard, 100) }}
                  />"""

new_card_div = """                  <div id="manual-booking-card" className="border border-gray-200 rounded-lg p-2 min-h-[89px]" />"""

# Also add a useEffect to load the card when payment_method changes to 'card'
old_useeffect = "  useEffect(() => { fetchSites(); fetchAddons(); fetchSettings(); fetchFees() }, [])"
new_useeffect = """  useEffect(() => { fetchSites(); fetchAddons(); fetchSettings(); fetchFees() }, [])

  useEffect(() => {
    if (form.payment_method === 'card') {
      setTimeout(loadSquareCard, 100)
    } else {
      setSquareCardLoaded(false)
      setSquareCardRef(null)
    }
  }, [form.payment_method])"""

checks = [
    ('Remove ref callback causing double load', old_card_div, new_card_div),
    ('useEffect for card load on method change', old_useeffect, new_useeffect),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Manual booking: fix double card form" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
