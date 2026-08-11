// Integration tests for the admin-session gate on /api/*, exercised through the REAL routes,
// served by a real Next server:
//
//   node --test --test-timeout=180000 lib/api-auth.test.ts
//
// WHY THIS FILE EXISTS: middleware.ts guards admin PAGES only (matcher '/admin/:path*'), so the
// API routes are unauthenticated unless each one checks for itself. A security audit found ~20
// service-role-backed routes open to anyone — refunds, terminal charges, manual bookings, guest
// PII, outbound email. lib/require-role.ts closed that. Nothing but this file can tell you it
// STAYS closed: a future refactor that drops a guard leaves every other test green.
//
// The second half matters just as much and is easy to forget: the camper-facing routes must stay
// OPEN. Gating /api/payment or /api/availability would take the booking flow offline for every
// visitor, and it is exactly the kind of mistake a sweeping "add auth everywhere" change makes.
// Those assertions are here so that mistake fails a test instead of a customer's booking.
//
// SAFETY. Same interlock as payment-route.test.ts: the server starts with SQUARE_ACCESS_TOKEN
// deliberately invalid, so no request from this file can charge a card. Beyond that, the
// authenticated case is asserted ONLY against read-only routes — this file never sends a valid
// admin cookie to a money route, so it cannot issue a refund or a terminal charge by accident.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServerClient } from '@supabase/ssr'
import { existsSync, readFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = resolvePath(REPO_ROOT, '.env.local')

const env: Record<string, string> = {}
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    env[line.slice(0, line.indexOf('=')).trim()] = line.slice(line.indexOf('=') + 1).trim()
  }
}

// Same placeholder guard as payment-route.test.ts: the template ships a .env.local of
// placeholders, so the file existing proves nothing.
const placeholder = (v: string | undefined) =>
  !v || /YOUR_|EXAMPLE|CHANGEME|xxxx/i.test(v)
const configured =
  !placeholder(env.NEXT_PUBLIC_SUPABASE_URL) &&
  /^https:\/\/[a-z0-9]+\.supabase\./i.test(env.NEXT_PUBLIC_SUPABASE_URL || '') &&
  !placeholder(env.SUPABASE_SERVICE_ROLE_KEY)

const haveEnv = configured
const skip = configured ? false : 'no configured Supabase project in .env.local'

// A different port from payment-route.test.ts so the two files can run concurrently.
const PORT = 4874
const BASE = `http://127.0.0.1:${PORT}`

// A real admin session.
//
// PR 5c-2 CHANGED HOW THIS IS OBTAINED, because it changed what a session IS. Until then a cookie
// could be had by posting the shared ADMIN_PASSWORD to /api/admin-auth; that endpoint is deleted
// and the shared password no longer authenticates anything. The only session that exists now is a
// Supabase Auth session belonging to a specific person.
//
// So the cookies are built with the REAL @supabase/ssr client against an in-memory jar, which is
// the point: the encoding, the chunking and the cookie names all come from the library the server
// reads them with, rather than from a hand-rolled copy here that could agree with itself and prove
// nothing.
//
// It needs a test account, which cannot be hardcoded in a public repository, so it is read from
// .env.local and these tests SKIP when it is absent. The account only ever has to be able to log
// in — every assertion below that uses it is read-only:
//
//   ADMIN_TEST_EMAIL=staff@example.test
//   ADMIN_TEST_PASSWORD=...
const canLogIn =
  configured && !placeholder(env.ADMIN_TEST_EMAIL) && !placeholder(env.ADMIN_TEST_PASSWORD)
const skipLogin = canLogIn
  ? false
  : 'no ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD in .env.local'
let ADMIN_COOKIE = ''

async function logIn(): Promise<string> {
  const jar = new Map<string, string>()
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => {
        if (value) jar.set(name, value)
        else jar.delete(name)
      }),
    },
  })

  const { error } = await client.auth.signInWithPassword({
    email: env.ADMIN_TEST_EMAIL,
    password: env.ADMIN_TEST_PASSWORD,
  })
  assert.equal(error, null, `signing in as ${env.ADMIN_TEST_EMAIL} should succeed`)
  assert.ok(jar.size > 0, 'sign-in produced no session cookies')

  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ')
}

let server: ChildProcess | null = null

before(async () => {
  if (!haveEnv) return
  server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    cwd: REPO_ROOT,
    // THE SAFETY INTERLOCK: no request from this file can result in a charge.
    env: { ...process.env, ...env, SQUARE_ACCESS_TOKEN: 'INVALID_TOKEN_FOR_TESTING' },
    stdio: 'ignore',
  })

  const deadline = Date.now() + 120_000
  for (;;) {
    try {
      await fetch(`${BASE}/api/availability?arrival=2026-08-18&departure=2026-08-20`)
      break
    } catch {
      if (Date.now() > deadline) throw new Error('next dev did not come up in time')
      await new Promise(r => setTimeout(r, 500))
    }
  }

  if (canLogIn) ADMIN_COOKIE = await logIn()
}, { timeout: 130_000 })

after(() => { server?.kill('SIGTERM') })

// Every route that requires an admin session, with a method that reaches its handler.
// Bodies are intentionally empty: the guard is the FIRST statement in each handler, so an
// unauthenticated request must be refused before the body is ever parsed.
const GATED: [string, string][] = [
  // PR 5c-1. These two create logins and change roles over the service-role key, so they are the
  // routes where an unauthenticated caller would matter most — an open POST /api/admin-users is a
  // "make yourself an owner" endpoint. Owner-gated in the handler; asserted 401 here.
  ['GET', '/api/admin-users'],
  ['POST', '/api/admin-users'],
  ['PATCH', '/api/admin-users/00000000-0000-0000-0000-000000000000'],
  ['POST', '/api/admin-card-payment'],
  ['POST', '/api/broadcast-email'],
  ['POST', '/api/electric-bill-email'],
  ['POST', '/api/electric-payment-receipt'],
  ['POST', '/api/email'],
  ['POST', '/api/guest-notes'],
  ['POST', '/api/guests/balances'],
  ['GET', '/api/me'],
  ['POST', '/api/manual-booking'],
  ['POST', '/api/receipt'],
  ['POST', '/api/refund'],
  ['POST', '/api/reservation-cancel'],
  ['POST', '/api/reservation-refund'],
  ['PATCH', '/api/seasonal-contracts/00000000-0000-0000-0000-000000000000'],
  ['POST', '/api/seasonal-contracts/00000000-0000-0000-0000-000000000000/resend'],
  ['POST', '/api/seasonal-contracts/00000000-0000-0000-0000-000000000000/send'],
  ['POST', '/api/seasonal-contracts/00000000-0000-0000-0000-000000000000/sign-now'],
  ['POST', '/api/seasonal-contracts/clone'],
  ['POST', '/api/seasonal-contracts/create'],
  ['POST', '/api/seasonals/guest'],
  ['GET', '/api/seasonals/guest/00000000-0000-0000-0000-000000000000'],
  ['GET', '/api/seasonals/list'],
  ['GET', '/api/seasonals/unsigned-count'],
  ['POST', '/api/send-waiver'],
  ['POST', '/api/sync-guests'],
  ['POST', '/api/terminal/cancel'],
  ['GET', '/api/terminal/charge'],
  ['POST', '/api/terminal/charge'],
  ['GET', '/api/terminal/pair'],
  ['POST', '/api/terminal/pair'],
]

for (const [method, path] of GATED) {
  test(`${method} ${path} refuses an unauthenticated caller`, { skip }, async () => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    })
    assert.equal(res.status, 401, `${method} ${path} should be 401 without an admin session`)
  })
}

// The other half: the camper-facing routes must NOT be gated. If a future change sweeps auth
// across /api/* indiscriminately, these fail rather than the live booking flow.
//
// "Reachable" is asserted as "not 401", not as a success code — /api/payment with an empty body
// legitimately fails validation or the bookability gate. What must never happen is that an
// unauthenticated camper is turned away at the door.
const PUBLIC: [string, string][] = [
  ['POST', '/api/payment'],
  ['GET', '/api/availability?arrival=2026-08-18&departure=2026-08-20'],
  ['GET', '/api/cancellation-policy?arrival=2026-08-18'],
]

for (const [method, path] of PUBLIC) {
  test(`${method} ${path} stays reachable without auth`, { skip }, async () => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    })
    assert.notEqual(
      res.status, 401,
      `${method} ${path} must stay open to unauthenticated visitors — gating it breaks the booking flow`
    )
  })
}

// /api/availability is the one the booking page cannot work without, so assert it actually
// serves rather than merely not-401-ing.
test('GET /api/availability serves data to an anonymous visitor', { skip }, async () => {
  const res = await fetch(`${BASE}/api/availability?arrival=2026-08-18&departure=2026-08-20`)
  assert.equal(res.status, 200)
  const json: any = await res.json()
  assert.ok(Array.isArray(json?.sites), 'expected a sites array')
})


// The gate must accept a real admin session, not just reject everyone — a `return 401` with no
// session check would pass every test above while locking staff out entirely.
//
// Read-only routes ONLY. This test never sends the admin cookie to a money route.
test('a valid admin session is accepted (read-only routes)', { skip: skipLogin }, async () => {
  for (const path of ['/api/seasonals/list', '/api/seasonals/unsigned-count']) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: ADMIN_COOKIE } })
    assert.notEqual(res.status, 401, `${path} should accept a valid Supabase session`)
  }
})

// ---------------------------------------------------------------------------
// THE RETIRED SHARED-PASSWORD PATH (PR 5c-2), and the PR 5a-0 forgery before it.
//
// Two vulnerabilities are pinned closed here, and they are related.
//
// PR 5a-0: the guards used to accept `admin_session=authenticated` — a constant, published in this
// public repository, that any caller could send. Knowing ADMIN_PASSWORD was not required. 5a-0
// replaced it with an HMAC-signed value.
//
// PR 5c-2: the signed cookie is gone too, along with /api/admin-auth and lib/admin-session.ts. A
// shared-password session carried no identity, so lib/require-role.ts had to resolve it to Owner —
// which meant anyone who knew one password outranked every role in the system, and their database
// queries ran as `anon` rather than `authenticated`.
//
// So the assertion is now stronger and simpler than "the forged value is refused": NO admin_session
// cookie of any shape grants anything, because nothing reads that cookie at all. These fail if a
// future change ever reintroduces a password-shaped back door, and they are cheap to keep.
// ---------------------------------------------------------------------------

const STALE_SESSION_COOKIES = [
  'admin_session=authenticated',                 // the 5a-0 forgery
  'admin_session=not-authenticated',             // an arbitrary value
  `admin_session=v1.${Math.floor(Date.now() / 1000) + 86400}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, // a well-formed 5a-0 shape
]

for (const cookie of STALE_SESSION_COOKIES) {
  test(`an admin_session cookie grants nothing on API routes (${cookie.slice(0, 32)})`, { skip }, async () => {
    for (const path of ['/api/seasonals/list', '/api/seasonals/unsigned-count']) {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
      assert.equal(
        res.status, 401,
        `${path} accepted an admin_session cookie — the shared-password path is back`
      )
    }
  })
}

// The same cookie reached admin PAGES through middleware.ts, which had its own copy of the check.
// Asserting only the API half would leave that one free to regress.
test('an admin_session cookie grants nothing on admin pages', { skip }, async () => {
  const res = await fetch(`${BASE}/admin/reservations`, {
    headers: { cookie: 'admin_session=authenticated' },
    redirect: 'manual',
  })
  assert.ok(
    [302, 303, 307, 308].includes(res.status),
    `expected a redirect to the login page, got ${res.status} — middleware accepted the cookie`
  )
  assert.match(res.headers.get('location') || '', /\/admin\/login/)
})

// The login ENDPOINT itself must be gone. While it existed, posting the shared password to it
// minted a session; if it were ever restored, every assertion above would still pass while the
// back door was wide open. 404 (or 405) is the proof that it is not there.
test('POST /api/admin-auth no longer exists', { skip }, async () => {
  const res = await fetch(`${BASE}/api/admin-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'anything' }),
  })
  assert.ok(
    res.status === 404 || res.status === 405,
    `expected the shared-password login route to be gone, got ${res.status}`
  )
})
