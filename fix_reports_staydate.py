path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/admin/reports/page.tsx'

with open(path, 'r') as f:
    content = f.read()

# The fix: when fetching reservations by stay date, use the full period end
# (e.g. Dec 31 for "this year") not today's date.
# We need to add a separate getFullPeriodEnd helper and use it for the res query.

old_bounds = '''  function getDateBounds(range: string, customS: string, customE: string) {
    const now = new Date()
    if (range === 'custom' && customS && customE) return { start: customS, end: customE }
    if (range === 'today') {
      const d = now.toISOString().split('T')[0]
      return { start: d, end: d }
    }
    if (range === 'this_week') {
      const day = now.getDay()
      const mon = new Date(now)
      mon.setDate(now.getDate() - day + (day === 0 ? -6 : 1))
      return { start: mon.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
    }
    if (range === 'this_month') return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
    }
    if (range === 'last_month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: first.toISOString().split('T')[0], end: last.toISOString().split('T')[0] }
    }
    if (range === 'last_year') return {
      start: new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0],
      end: new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0],
    }
    // this_year default
    return {
      start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
    }
  }'''

new_bounds = '''  function getDateBounds(range: string, customS: string, customE: string) {
    const now = new Date()
    if (range === 'custom' && customS && customE) return { start: customS, end: customE }
    if (range === 'today') {
      const d = now.toISOString().split('T')[0]
      return { start: d, end: d }
    }
    if (range === 'this_week') {
      const day = now.getDay()
      const mon = new Date(now)
      mon.setDate(now.getDate() - day + (day === 0 ? -6 : 1))
      return { start: mon.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
    }
    if (range === 'this_month') return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
    }
    if (range === 'last_month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: first.toISOString().split('T')[0], end: last.toISOString().split('T')[0] }
    }
    if (range === 'last_year') return {
      start: new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0],
      end: new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0],
    }
    // this_year default
    return {
      start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
    }
  }

  // For stay-date mode: extend end to cover the full period (e.g. all of this year)
  // so future reservations are included. Payments still use today as the cutoff.
  function getStayDateEnd(range: string, customE: string) {
    const now = new Date()
    if (range === 'custom' && customE) return customE
    if (range === 'this_month') return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
    if (range === 'last_month') return new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
    if (range === 'this_year') return new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0]
    if (range === 'last_year') return new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0]
    if (range === 'this_week') {
      const day = now.getDay()
      const sun = new Date(now)
      sun.setDate(now.getDate() + (day === 0 ? 0 : 7 - day))
      return sun.toISOString().split('T')[0]
    }
    return now.toISOString().split('T')[0]
  }'''

# Fix the reservation query to use getStayDateEnd for the arrival_date upper bound
old_res_query = '''    const { data: resData } = await supabase
      .from('reservations')
      .select('id, arrival_date, departure_date, total_price, status, site_id, sites(site_number, site_type)')
      .neq('status', 'cancelled')
      .gte('arrival_date', start)
      .lte('arrival_date', end)
      .order('arrival_date')

    const { data: cancelledData } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'cancelled')
      .gte('arrival_date', start)
      .lte('arrival_date', end)'''

new_res_query = '''    const stayEnd = getStayDateEnd(dateRange, customEnd)

    const { data: resData } = await supabase
      .from('reservations')
      .select('id, arrival_date, departure_date, total_price, status, site_id, sites(site_number, site_type)')
      .neq('status', 'cancelled')
      .gte('arrival_date', start)
      .lte('arrival_date', stayEnd)
      .order('arrival_date')

    const { data: cancelledData } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'cancelled')
      .gte('arrival_date', start)
      .lte('arrival_date', stayEnd)'''

checks = [
    ('New getStayDateEnd function', old_bounds, new_bounds),
    ('Reservation query uses stayEnd', old_res_query, new_res_query),
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
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Reports: fix stay-date filter to include full period including future reservations" && git push')
else:
    print('\n\u274c Edit did not apply \u2014 file NOT saved. Paste output above to Claude.')
