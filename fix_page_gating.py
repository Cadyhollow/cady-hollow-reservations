import re

files = {
    '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reports/page.tsx': {
        'check': "data?.plan && !['ridgeline','summit'].includes(data.plan)",
        'label': 'Reports (ridgeline+)',
    },
    '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/electric-billing/page.tsx': {
        'check': "data?.plan !== 'summit'",
        'label': 'Electric Billing (summit)',
    },
    '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folios/page.tsx': {
        'check': "data?.plan !== 'summit'",
        'label': 'Guest Folios (summit)',
    },
    '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/products/page.tsx': {
        'check': '!data?.pos_enabled',
        'label': 'Products (pos_enabled)',
    },
}

# The redirect guard to inject — goes right after the existing useEffect/useState imports
GUARD_IMPORT = "import { useRouter } from 'next/navigation'\n"
GUARD_HOOK = """
  const router = useRouter()

  useEffect(() => {
    supabase.from('settings').select('plan, pos_enabled').single().then(({ data }) => {
      if (PLAN_CHECK) router.replace('/admin')
    })
  }, [])
"""

all_good = True

for path, config in files.items():
    try:
        with open(path, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f'  \u26a0 SKIPPED (not found): {config["label"]} — {path}')
        continue

    # Skip if already has redirect guard
    if "router.replace('/admin')" in content:
        print(f'  \u2713 Already protected: {config["label"]}')
        continue

    # Add router import if not present
    modified = content
    if "useRouter" not in modified:
        modified = modified.replace(
            "import { useRouter } from 'next/navigation'",
            "import { useRouter } from 'next/navigation'"
        )
        if "from 'next/navigation'" in modified:
            modified = modified.replace(
                "from 'next/navigation'",
                "from 'next/navigation'"
            )
        else:
            # Add after 'use client'
            modified = modified.replace(
                "'use client'\n",
                "'use client'\nimport { useRouter } from 'next/navigation'\n"
            )

    # Build the guard hook with the right check
    guard = f"""
  // ── Plan/feature gate — redirect if not authorized ──────────────────────
  useEffect(() => {{
    supabase.from('settings').select('plan, pos_enabled').single().then(({{ data }}) => {{
      if ({config['check']}) router.replace('/admin')
    }})
  }}, [])
"""

    # Inject after the first useEffect or useState declaration in the component
    # Find the export default function line and inject after the first state declaration
    # Look for the pattern: first useState or the opening of the component function
    insert_after = "const router = useRouter()"

    if insert_after in modified:
        # Already has router, just add the guard after it
        modified = modified.replace(
            insert_after,
            insert_after + "\n" + guard,
            1
        )
    else:
        # Need to add router + guard
        # Find first useState call in the component
        match = re.search(r'(  const \[[\w]+, set[\w]+\] = useState)', modified)
        if match:
            insert_pos = match.start()
            modified = (
                modified[:insert_pos] +
                "  const router = useRouter()\n" +
                guard +
                modified[insert_pos:]
            )
        else:
            print(f'  \u2717 Could not find injection point: {config["label"]}')
            all_good = False
            continue

    with open(path, 'w') as f:
        f.write(modified)
    print(f'  \u2713 Protected: {config["label"]}')

# Handle folio/new separately - it's inside folio/[id]/page.tsx routing
# The 'new' route is already handled by the folio page itself
# We just need to check pos_enabled at the top of the new folio flow

folio_new_path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/folio/[id]/page.tsx'
try:
    with open(folio_new_path, 'r') as f:
        folio_content = f.read()

    if "router.replace('/admin')" not in folio_content:
        # Add guard in the isNew block
        old_new_block = """  if (isNew && !folio) {
    return ("""
        new_new_block = """  // Gate walk-up sale by pos_enabled
  useEffect(() => {
    if (isNew) {
      supabase.from('settings').select('pos_enabled').single().then(({ data }) => {
        if (!data?.pos_enabled) router.replace('/admin')
      })
    }
  }, [isNew])

  if (isNew && !folio) {
    return ("""

        if old_new_block in folio_content:
            folio_content = folio_content.replace(old_new_block, new_new_block, 1)
            with open(folio_new_path, 'w') as f:
                f.write(folio_content)
            print('  \u2713 Protected: Walk-Up Sale folio/new (pos_enabled)')
        else:
            print('  \u26a0 Could not find injection point in folio/[id]/page.tsx')
    else:
        print('  \u2713 Already protected: folio/[id]/page.tsx')
except FileNotFoundError:
    print('  \u26a0 SKIPPED (not found): folio/[id]/page.tsx')

print('\n\u2705 Redirect protection complete!')
print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Feature gating: add redirect protection to gated admin pages" && git push')
