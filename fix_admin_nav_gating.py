path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/layout.tsx'

with open(path, 'r') as f:
    content = f.read()

# ── Edit 1: Add planRequired to NavGroup type ─────────────────────────────────
old_type = """type NavGroup = {
  label: string
  icon: string
  posOnly?: boolean
  items: NavItem[]
}"""

new_type = """type NavGroup = {
  label: string
  icon: string
  posOnly?: boolean
  minPlan?: 'ridgeline' | 'summit'
  items: NavItem[]
}

// Plan hierarchy for comparison
const PLAN_LEVELS: { [key: string]: number } = {
  trailhead: 1,
  ridgeline: 2,
  summit: 3,
}

function planAtLeast(current: string, required: 'ridgeline' | 'summit'): boolean {
  return (PLAN_LEVELS[current] || 1) >= (PLAN_LEVELS[required] || 99)
}"""

# ── Edit 2: Add minPlan to Finance group items that need gating ───────────────
# Reports requires ridgeline+, Electric Billing requires summit
old_finance = """  {
    label: 'Finance',
    icon: '💰',
    items: [
      { name: 'Taxes & Fees', href: '/admin/fees', icon: '🧾' },
      { name: 'Electric Billing', href: '/admin/electric-billing', icon: '⚡' },
      { name: 'Discounts', href: '/admin/discounts', icon: '🏷️' },
      { name: 'Reports', href: '/admin/reports', icon: '📊' },
    ],
  },"""

new_finance = """  {
    label: 'Finance',
    icon: '💰',
    items: [
      { name: 'Taxes & Fees', href: '/admin/fees', icon: '🧾' },
      { name: 'Electric Billing', href: '/admin/electric-billing', icon: '⚡', minPlan: 'summit' as const },
      { name: 'Discounts', href: '/admin/discounts', icon: '🏷️' },
      { name: 'Reports', href: '/admin/reports', icon: '📊', minPlan: 'ridgeline' as const },
    ],
  },"""

# ── Edit 3: Add minPlan to Guest Folios ───────────────────────────────────────
old_guests = """  {
    label: 'Guests',
    icon: '👥',
    items: [
      { name: 'Guest Folios', href: '/admin/folios', icon: '🗂️' },
      { name: 'Guest Directory', href: '/admin/guests', icon: '📇' },
    ],
  },"""

new_guests = """  {
    label: 'Guests',
    icon: '👥',
    items: [
      { name: 'Guest Folios', href: '/admin/folios', icon: '🗂️', minPlan: 'summit' as const },
      { name: 'Guest Directory', href: '/admin/guests', icon: '📇' },
    ],
  },"""

# ── Edit 4: Update NavItem type to support minPlan ───────────────────────────
old_navitem = """type NavItem = {
  name: string
  href: string
  icon: string
}"""

new_navitem = """type NavItem = {
  name: string
  href: string
  icon: string
  minPlan?: 'ridgeline' | 'summit'
}"""

# ── Edit 5: Fetch plan in useEffect ──────────────────────────────────────────
old_fetch = """  useEffect(() => {
    supabase
      .from('settings')
      .select('park_name, logo_url, logo_shape, plan, pos_enabled')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setSettings(data)
          setPosEnabled(!!data.pos_enabled)
        }
      })
  }, [])"""

new_fetch = """  const [plan, setPlan] = useState<string>('summit') // default to summit for Cady Hollow

  useEffect(() => {
    supabase
      .from('settings')
      .select('park_name, logo_url, logo_shape, plan, pos_enabled')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setSettings(data)
          setPosEnabled(!!data.pos_enabled)
          if (data.plan) setPlan(data.plan)
        }
      })
  }, [])"""

# ── Edit 6: Update visibleGroups to filter by plan ───────────────────────────
old_visible = "  const visibleGroups = navGroups.filter(g => !g.posOnly || posEnabled)"
new_visible = "  const visibleGroups = navGroups.filter(g => (!g.posOnly || posEnabled) && (!g.minPlan || planAtLeast(plan, g.minPlan)))"

# ── Edit 7: Filter items within groups by plan ───────────────────────────────
old_group_items = """                  {group.items.map((item) => {
                    const itemActive = item.href === pathname ||
                      (item.href !== '/admin' && pathname.startsWith(item.href))
                    return ("""

new_group_items = """                  {group.items.filter(item => !item.minPlan || planAtLeast(plan, item.minPlan) || posEnabled).map((item) => {
                    const itemActive = item.href === pathname ||
                      (item.href !== '/admin' && pathname.startsWith(item.href))
                    return ("""

checks = [
    ('NavItem type updated', old_navitem, new_navitem),
    ('NavGroup type + planAtLeast helper', old_type, new_type),
    ('Finance group with minPlan', old_finance, new_finance),
    ('Guests group with minPlan', old_guests, new_guests),
    ('Plan state + fetch', old_fetch, new_fetch),
    ('visibleGroups filter', old_visible, new_visible),
    ('Item-level plan filter', old_group_items, new_group_items),
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
    print('\n\u2705 All edits applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Admin nav: add plan-based feature gating" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
