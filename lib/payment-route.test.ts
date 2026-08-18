// Integration tests for the /api/payment chokepoint, exercised through the REAL route, served
// by a real Next server:
//
//   node --test --test-timeout=180000 lib/payment-route.test.ts
//
// lib/bookability.test.ts covers the pure arithmetic. These cover what that arithmetic cannot:
// that the payment route actually CALLS the check, with the right arguments, and returns before
// reaching Square. A refactor that dropped the call, passed the wrong site, or moved the check
// below the charge would leave every pure unit test green — so the unit tests alone cannot
// protect the money. These can, because they drive the route end to end.
//
// WHY THIS FILE EXISTS: the first real-card test of this feature was reported as a double-
// booking that got charged. It turned out not to be one — the booking landed on a genuinely
// free site — but nothing in the suite could have told us that, and answering it took a
// database forensic. A route-level test that can be run in seconds is the thing that was
// missing.
//
// SAFETY. The server is started with SQUARE_ACCESS_TOKEN deliberately invalid, so no request
// this file makes can charge a card even if every gate failed at once. That also gives a clean
// discriminator, since the route's own response tells us which side of Square it stopped on:
//
//   - gated  -> our JSON with a `reason` field; Square was never contacted
//   - charged -> Square's "This request could not be authorized."; the gate let it through
//
// A rejected booking returns before the database insert, and an accepted one dies at the
// invalid Square call, which is also before the insert. So nothing is ever written.
//
// Needs a CONFIGURED Supabase project in .env.local, and data to exercise: a park with no
// bookings has no double-booking to refuse. Both are treated as skips rather than failures, so
// an unconfigured template checkout reports "skipped", never a false red.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { fetchDateFacts, checkDateFacts, isNightInSeason, parseMonthDay, addDays } from './bookability.ts'
import { computeBookingQuote, resolveNightlyRate } from './booking-quote.ts'
import { ruleAppliesToSite } from './bookability.ts'

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = resolvePath(REPO_ROOT, '.env.local')

const env: Record<string, string> = {}
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    env[line.slice(0, line.indexOf('=')).trim()] = line.slice(line.indexOf('=') + 1).trim()
  }
}

// The template repo ships a .env.local of PLACEHOLDERS, so the file existing proves nothing —
// pointing these tests at "https://YOUR_PROJECT_REF.supabase.co" would hang rather than skip.
// A configured project is one with a real-looking URL and a service-role key.
const placeholder = (v: string | undefined) =>
  !v || /YOUR_|EXAMPLE|CHANGEME|xxxx/i.test(v)
const configured =
  !placeholder(env.NEXT_PUBLIC_SUPABASE_URL) &&
  /^https:\/\/[a-z0-9]+\.supabase\./i.test(env.NEXT_PUBLIC_SUPABASE_URL || '') &&
  !placeholder(env.SUPABASE_SERVICE_ROLE_KEY)

const haveEnv = configured
const skip = configured ? false : 'no configured Supabase project in .env.local'

// A high, unusual port so a developer's own `next dev` on 3000 is never disturbed.
const PORT = 4873
const BASE = `http://127.0.0.1:${PORT}`

let server: ChildProcess | null = null
let supabase: any

before(async () => {
  if (!haveEnv) return
  supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    cwd: REPO_ROOT,
    // THE SAFETY INTERLOCK: no request from this file can result in a charge.
    env: { ...process.env, ...env, SQUARE_ACCESS_TOKEN: 'INVALID_TOKEN_FOR_TESTING' },
    stdio: 'ignore',
  })

  const deadline = Date.now() + 120_000
  for (;;) {
    try {
      // Any response at all means the server is listening.
      await fetch(`${BASE}/api/availability?arrival=2026-08-18&departure=2026-08-20`)
      return
    } catch {
      if (Date.now() > deadline) throw new Error('next dev did not come up in time')
      await new Promise(r => setTimeout(r, 500))
    }
  }
}, { timeout: 130_000 })

after(() => { server?.kill('SIGTERM') })

async function post(over: Record<string, any>) {
  const res = await fetch(`${BASE}/api/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceId: 'FAKE-NONCE-MUST-NEVER-BE-CHARGEABLE',
      adults: 2, children: 0,
      guestName: 'Automated Test', guestEmail: 'test@example.invalid', guestPhone: '0000000000',
      nightlyRate: 5000, totalPrice: 15000, amountToPay: 15000, paymentType: 'full', nights: 3,
      ...over,
    }),
  })
  const json: any = await res.json()
  return {
    status: res.status,
    json,
    // `reason` is emitted only by the gates ABOVE the Square call — bookability, and now the
    // pricing chokepoint. Its presence therefore still proves Square was not contacted.
    gated: typeof json?.reason === 'string',
  }
}

// The site+dates of a real non-cancelled reservation whose site is NOT also blocked, so the
// assertion is specifically about the overlap check rather than the blocked-date check that
// runs before it.
async function anExistingReservation() {
  const { data } = await supabase
    .from('reservations')
    .select('site_id, arrival_date, departure_date')
    .neq('status', 'cancelled')
    .gte('arrival_date', '2026-01-01')
    .order('arrival_date')
    .limit(60)
  for (const r of data || []) {
    const { data: blocks } = await supabase
      .from('blocked_dates').select('site_id')
      .gte('date', r.arrival_date).lt('date', r.departure_date)
    if (!(blocks || []).some((b: any) => !b.site_id || b.site_id === r.site_id)) return r
  }
  return null
}

// THE REGRESSION GUARD. The case the first real-card test was meant to cover.
test('payment: an overlapping booking is refused, and never reaches Square', { skip }, async (t) => {
  const existing = await anExistingReservation()
  // A park with no bookings yet has nothing to double-book. Skip rather than fail: this is a
  // missing fixture, not a broken gate. Visible in the output either way.
  if (!existing) return t.skip('no non-cancelled reservation on an unblocked site to test against')

  const r = await post({
    siteId: existing.site_id,
    arrival: existing.arrival_date,
    departure: existing.departure_date,
  })

  assert.ok(r.gated, `double-booking reached Square instead of being refused: ${JSON.stringify(r.json)}`)
  assert.equal(r.json.reason, 'double-booked')
  assert.equal(r.status, 409, 'a double-booking is a 409 — someone got there first')
})

test('payment: an out-of-season booking is refused, and never reaches Square', { skip }, async (t) => {
  const { data: settings } = await supabase.from('settings').select('season_start, season_end').limit(1).single()
  if (!settings?.season_start || !settings?.season_end) return t.skip('no season configured')

  const { data: site } = await supabase.from('sites').select('id').eq('is_available', true).limit(1).single()
  const r = await post({ siteId: site.id, arrival: '2026-12-20', departure: '2026-12-23' })

  assert.ok(r.gated, `out-of-season booking reached Square: ${JSON.stringify(r.json)}`)
  assert.equal(r.json.reason, 'out-of-season')
  assert.equal(r.status, 400)
})

test('payment: a blocked date is refused, and never reaches Square', { skip }, async (t) => {
  const { data: blocks } = await supabase
    .from('blocked_dates').select('site_id, date').not('site_id', 'is', null)
    .gte('date', '2026-05-01').lte('date', '2026-10-01').order('date').limit(1)
  if (!blocks?.length) return t.skip('no per-site blocked dates configured')

  const b = blocks[0]
  const departure = new Date(Date.parse(`${b.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
  const r = await post({ siteId: b.site_id, arrival: b.date, departure, nights: 1 })

  assert.ok(r.gated, `blocked date reached Square: ${JSON.stringify(r.json)}`)
  assert.equal(r.json.reason, 'blocked')
  assert.equal(r.status, 400)
})

test('payment: a malformed range is refused, and never reaches Square', { skip }, async () => {
  const { data: site } = await supabase.from('sites').select('id').eq('is_available', true).limit(1).single()
  const r = await post({ siteId: site.id, arrival: '2026-08-13', departure: '2026-08-10' })

  assert.ok(r.gated, `malformed range reached Square: ${JSON.stringify(r.json)}`)
  assert.equal(r.json.reason, 'invalid-range')
})

// The counterpart that makes all of the above meaningful: a genuinely bookable request must get
// PAST the chokepoint. Without this, a gate that rejected everything would pass every test here
// — and "no false rejections" is the property that keeps real guests able to book.
//
// It stops at Square, which is the evidence we want: the route got as far as attempting
// payment, so nothing above it turned a legitimate booking away. The invalid token means no
// card is charged, and the reservation insert is downstream of a successful charge, so nothing
// is written.
// The authoritative price for a site and date range, assembled from the same tables
// /api/payment reads. Lets the "no false rejections" test post what a real booking page would.
async function quoteFor(siteId: string, arrival: string, departure: string) {
  const [{ data: site }, { data: rules }, { data: settings }, { data: fees }] = await Promise.all([
    supabase.from('sites').select('id, site_type, base_rate').eq('id', siteId).single(),
    supabase.from('pricing_rules').select('*').eq('is_active', true)
      .lte('start_date', departure).gte('end_date', arrival),
    supabase.from('settings').select('*').limit(1).single(),
    supabase.from('fees').select('*').eq('is_active', true),
  ])
  const nights = Math.round(
    (new Date(departure).getTime() - new Date(arrival).getTime()) / 86400000)
  const nightlyRate = resolveNightlyRate(
    { id: siteId, site_type: (site as any)?.site_type || '', base_rate: (site as any)?.base_rate || 0 },
    rules || [], ruleAppliesToSite)
  const quote = computeBookingQuote({
    site: {
      site_type: (site as any)?.site_type || '',
      nightly_rate: nightlyRate,
      total_price: nightlyRate * nights,
      nights,
    },
    adults: 2, children: 0,
    settings: settings as any,
    fees: (fees || []) as any,
    addonSelections: [],
    discount: null,
    earlyRequested: false, lateRequested: false, earlyBlocked: false, lateBlocked: false,
  })
  const pct = Number((settings as any)?.card_surcharge_percent) || 0
  const cashTotal = quote.cashTotal
  const surcharge = cashTotal <= 0 || pct <= 0
    ? 0
    : Math.round(Math.min(cashTotal, cashTotal) * Math.round(cashTotal * pct / 100) / cashTotal)
  return { nights, nightlyRate, quote, surcharge }
}

test('payment: a legitimate booking is NOT refused — it reaches the charge', { skip }, async (t) => {
  const arrival = '2026-08-18', departure = '2026-08-20'
  const { data: sites } = await supabase.from('sites').select('id').eq('is_available', true)
  const facts = await fetchDateFacts(supabase, arrival, departure)
  const free = (sites || []).find((s: any) => checkDateFacts(s.id, facts).bookable)
  if (!free) return t.skip('no free site in the sample week — nothing to prove the negative with')
  // The season must actually contain the sample week, or this asserts the wrong thing.
  const { data: st } = await supabase.from('settings').select('season_start, season_end').limit(1).single()
  if (isNightInSeason(arrival, st) === false) {
    return t.skip('sample week falls outside the configured season')
  }

  // The true price for this site and these dates, derived the way /book and /api/payment both
  // derive it. The fixture used to claim a flat 15000 for a 3-night stay while booking a real
  // site for two nights — a figure no site actually had. That passed only because the route
  // charged whatever it was told; with the pricing chokepoint in place an honest request has
  // to carry an honest number, which is the point of the change.
  const quoted = await quoteFor(free.id, arrival, departure)
  const r = await post({
    siteId: free.id, arrival, departure, nights: quoted.nights,
    nightlyRate: quoted.nightlyRate,
    totalPrice: quoted.quote.cashTotal,
    amountToPay: quoted.quote.cashTotal,
    paymentType: 'full',
    surchargeAmount: quoted.surcharge,
  })

  assert.equal(r.gated, false, `a legitimate booking was wrongly refused: ${JSON.stringify(r.json)}`)
  assert.match(String(r.json.error), /authoriz/i, 'expected to die at the deliberately invalid Square token')
})

// The exploit PR 4a closes, asserted as a test rather than a claim.
//
// /book builds its quote from URL parameters, so before the pricing chokepoint a camper could
// retype `totalPrice` in the address bar and be charged it — no crafted POST or devtools
// needed. The request below is exactly that: a real, bookable site and date range, priced at a
// dollar. It must be refused BEFORE Square is contacted, for `price-mismatch` specifically —
// not merely fail somewhere downstream for an unrelated reason.
test('payment: a forged price is refused before any charge', { skip }, async (t) => {
  const arrival = '2026-08-18', departure = '2026-08-20'
  const { data: sites } = await supabase.from('sites').select('id').eq('is_available', true)
  const facts = await fetchDateFacts(supabase, arrival, departure)
  const free = (sites || []).find((s: any) => checkDateFacts(s.id, facts).bookable)
  if (!free) return t.skip('no free site in the sample week')
  const { data: st } = await supabase.from('settings').select('season_start, season_end').limit(1).single()
  if (isNightInSeason(arrival, st) === false) {
    return t.skip('sample week falls outside the configured season')
  }

  const honest = await quoteFor(free.id, arrival, departure)
  // Only if the site actually costs something is there anything to forge.
  if (honest.quote.cashTotal <= 100) return t.skip('sample site is already free — nothing to undercut')

  const r = await post({
    siteId: free.id, arrival, departure, nights: honest.nights,
    nightlyRate: 100, totalPrice: 100, amountToPay: 100, paymentType: 'full', surchargeAmount: 0,
  })

  assert.equal(r.gated, true, 'a forged price reached Square')
  assert.equal(r.json.reason, 'price-mismatch',
    `expected the pricing chokepoint to refuse it, got: ${JSON.stringify(r.json)}`)
})

// A discount the server has never heard of must not reduce the charge. This used to be decided
// entirely in the browser, against a `discounts` row the browser read for itself.
test('payment: an unknown discount code is refused', { skip }, async (t) => {
  const arrival = '2026-08-18', departure = '2026-08-20'
  const { data: sites } = await supabase.from('sites').select('id').eq('is_available', true)
  const facts = await fetchDateFacts(supabase, arrival, departure)
  const free = (sites || []).find((s: any) => checkDateFacts(s.id, facts).bookable)
  if (!free) return t.skip('no free site in the sample week')
  const { data: st } = await supabase.from('settings').select('season_start, season_end').limit(1).single()
  if (isNightInSeason(arrival, st) === false) {
    return t.skip('sample week falls outside the configured season')
  }

  const honest = await quoteFor(free.id, arrival, departure)
  const r = await post({
    siteId: free.id, arrival, departure, nights: honest.nights,
    nightlyRate: honest.nightlyRate,
    totalPrice: honest.quote.cashTotal, amountToPay: honest.quote.cashTotal,
    paymentType: 'full', surchargeAmount: honest.surcharge,
    discountCode: 'TOTALLY-MADE-UP-CODE', discountAmount: 5000,
  })

  assert.equal(r.gated, true, 'a forged discount reached Square')
  assert.equal(r.json.reason, 'discount-invalid',
    `expected the discount check to refuse it, got: ${JSON.stringify(r.json)}`)
})


// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE CLOSED SEASON — whole-stay, hard block, public path
//
// The defect these cover was LIVE on book.cadyhollow.com and took money: checkBookability passed
// the ARRIVAL alone to the season gate, so a stay that began in season and ran past the October
// closing was accepted and charged, and a guest could occupy a site for weeks after the park had
// shut.
//
// ── THESE TESTS WRITE NOTHING ────────────────────────────────────────────────────────────────
//
// This suite runs against the LIVE production database. The template's equivalents set and
// restore the season around each test; doing that here would mutate the real park's configuration
// and, for those seconds, show real guests on book.cadyhollow.com the wrong season.
//
// They do not need to. Cady HAS a real season configured, so a stay that straddles its own
// closing date is craftable from the park's own settings with no write at all — the tests read
// the season and pick dates around it. A refusal returns before the reservation insert, and the
// server is started with an invalid Square token, so nothing is charged and nothing is stored.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// The park's real season, or null when it has none configured.
async function configuredSeason() {
  const { data } = await supabase
    .from('settings').select('season_start, season_end').limit(1).single()
  if (!data?.season_start || !data?.season_end) return null
  return data
}

// A date inside the season and a departure past its close, in a year far enough ahead that the
// site is certainly free — derived from the park's own settings, never hardcoded.
function straddlingDates(season: any, year: number) {
  const end = parseMonthDay(season.season_end)
  if (!end) return null
  const close = `${year}-${String(end.month).padStart(2, '0')}-${String(end.day).padStart(2, '0')}`
  return { arrival: addDays(close, -6), departure: addDays(close, 9), close }
}

test('payment: a stay that runs PAST CLOSING is refused, and never reaches Square', { skip }, async (t) => {
  const season = await configuredSeason()
  if (!season) return t.skip('this park has no season configured')
  const d = straddlingDates(season, new Date().getFullYear() + 1)
  if (!d) return t.skip('season_end is not readable')

  const { data: sites } = await supabase.from('sites').select('id').eq('is_available', true)
  const facts = await fetchDateFacts(supabase, d.arrival, d.departure)
  const free = (sites || []).find((x: any) => checkDateFacts(x.id, facts).bookable)
  if (!free) return t.skip('no free site across the closing date')

  const r = await post({ siteId: free.id, arrival: d.arrival, departure: d.departure, nights: 15 })

  assert.ok(r.gated, `a stay running past closing reached Square: ${JSON.stringify(r.json)}`)
  assert.equal(r.json.reason, 'out-of-season', 'refused by the season gate specifically')
  assert.equal(r.status, 400)
})

test('payment: CHECKING IN on the closing day is refused, and never reaches Square', { skip }, async (t) => {
  // INVERTED. season_end is the last allowed CHECKOUT, so an arrival ON it is a check-in the day
  // the park shuts. This asserts the real route refuses it rather than the browser merely
  // discouraging it — read-only: a refusal returns before the insert.
  const season = await configuredSeason()
  if (!season) return t.skip('this park has no season configured')
  const end = parseMonthDay(season.season_end)
  if (!end) return t.skip('season_end is not readable')

  const year = new Date().getFullYear() + 1
  const arrival = `${year}-${String(end.month).padStart(2, '0')}-${String(end.day).padStart(2, '0')}`
  const departure = addDays(arrival, 1)

  const { data: sites } = await supabase.from('sites').select('id').eq('is_available', true)
  const facts = await fetchDateFacts(supabase, arrival, departure)
  const free = (sites || []).find((x: any) => checkDateFacts(x.id, facts).bookable)
  if (!free) return t.skip('no free site on the closing date')

  const r = await post({ siteId: free.id, arrival, departure, nights: 1 })

  assert.ok(r.gated, `a check-in on the closing day reached Square: ${JSON.stringify(r.json)}`)
  assert.equal(r.json.reason, 'out-of-season', 'refused by the season gate specifically')
})

test('payment: THE LAST VALID STAY — arrive the day before closing, check out ON it', { skip }, async (t) => {
  // The counterpart that keeps the fix from overshooting. If this ever fails, Cady has lost the
  // last sellable night of its season.
  const season = await configuredSeason()
  if (!season) return t.skip('this park has no season configured')
  const end = parseMonthDay(season.season_end)
  if (!end) return t.skip('season_end is not readable')

  const year = new Date().getFullYear() + 1
  const departure = `${year}-${String(end.month).padStart(2, '0')}-${String(end.day).padStart(2, '0')}`
  const arrival = addDays(departure, -1)

  const { data: sites } = await supabase.from('sites').select('id').eq('is_available', true)
  const facts = await fetchDateFacts(supabase, arrival, departure)
  const free = (sites || []).find((x: any) => checkDateFacts(x.id, facts).bookable)
  if (!free) return t.skip('no free site on the last sellable night')

  const r = await post({ siteId: free.id, arrival, departure, nights: 1 })

  assert.notEqual(r.json.reason, 'out-of-season',
    `the last valid stay of the season was wrongly refused: ${JSON.stringify(r.json)}`)
})

test('availability: the search refuses the same past-closing stay the route does', { skip }, async (t) => {
  const season = await configuredSeason()
  if (!season) return t.skip('this park has no season configured')
  const d = straddlingDates(season, new Date().getFullYear() + 1)
  if (!d) return t.skip('season_end is not readable')

  const res = await fetch(`${BASE}/api/availability?arrival=${d.arrival}&departure=${d.departure}`)
  const json: any = await res.json()
  assert.equal(json.closed, true, `search offered a stay running past closing: ${JSON.stringify(json)}`)
  assert.ok(Array.isArray(json.sites) && json.sites.length === 0)
})
