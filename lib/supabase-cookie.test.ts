// Pinning the Supabase auth-cookie name that lib/admin-auth.ts's precedence check depends on.
//
//   node --test lib/supabase-cookie.test.ts
//
// WHY THIS FILE EXISTS. Since PR 5b-2, readAdminSession() checks for a REAL Supabase session
// before falling back to the legacy shared-password cookie, because whichever answers first
// decides the caller's ROLE — `legacy` resolves to Owner. To keep the legacy path free of a
// pointless network round trip, the Supabase branch is skipped unless a Supabase auth cookie is
// present, decided by matching the cookie NAME.
//
// That name is chosen by @supabase/ssr, not by this repository. If a dependency bump changes it,
// isSupabaseAuthCookie() silently stops matching, every real session falls through to the legacy
// branch, and a Staff user holding a stale admin_session cookie becomes Owner again — for the
// nav, for middleware's page gate, and for every requireRole route including /api/refund. No
// other test would notice: nothing throws, nothing 500s, and the app keeps working perfectly for
// the Owner who is doing the testing.
//
// So the second test below does not assert against a string we wrote down. It hands the REAL
// library a cookie named the way we assume, and asserts the library finds a session in it. If
// Supabase changes the convention, that read returns null and this fails.
//
// No network and no secrets: getSession() reads and decodes local storage without contacting the
// auth server, which is exactly why production uses getUser() instead. Here that property is what
// makes the contract testable offline.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServerClient } from '@supabase/ssr'

import { isSupabaseAuthCookie, supabaseAuthCookieName } from './supabase-cookie.ts'

const PROJECT_URL = 'https://abcdefghijklmnop.supabase.co'
// Not a real key and never sent anywhere — createServerClient only requires it to be non-empty.
const PUBLISHABLE_KEY = 'test-anon-key'

test('isSupabaseAuthCookie matches the session cookie and its chunks', () => {
  assert.equal(isSupabaseAuthCookie('sb-abcdefghijklmnop-auth-token'), true)
  // Large sessions are split across numbered cookies; missing these would reintroduce the bug
  // for exactly the users with the biggest tokens.
  assert.equal(isSupabaseAuthCookie('sb-abcdefghijklmnop-auth-token.0'), true)
  assert.equal(isSupabaseAuthCookie('sb-abcdefghijklmnop-auth-token.1'), true)
})

test('isSupabaseAuthCookie ignores cookies that are not a Supabase session', () => {
  // The legacy cookie above all — matching it would defeat the entire precedence fix.
  assert.equal(isSupabaseAuthCookie('admin_session'), false)
  assert.equal(isSupabaseAuthCookie('sb-abcdefghijklmnop-auth-token-code-verifier'), false)
  assert.equal(isSupabaseAuthCookie('resonation_dashboard_view'), false)
  assert.equal(isSupabaseAuthCookie(''), false)
})

test('@supabase/ssr still stores its session under the name we match', async () => {
  const cookieName = supabaseAuthCookieName(PROJECT_URL)

  // Guard the helper itself, so a wrong ref cannot make the contract test pass vacuously.
  assert.equal(cookieName, 'sb-abcdefghijklmnop-auth-token')
  assert.equal(isSupabaseAuthCookie(cookieName), true)

  // A session shaped the way the library stores one. expires_at is far in the future so
  // getSession() returns it directly instead of trying to refresh over the network.
  const session = {
    access_token: 'header.payload.signature',
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: '00000000-0000-0000-0000-000000000000', email: 'staff@example.test' },
  }

  // base64url with the `base64-` prefix is @supabase/ssr's default cookie encoding.
  const encoded =
    'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')

  const supabase = createServerClient(PROJECT_URL, PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [{ name: cookieName, value: encoded }],
      setAll: () => {},
    },
  })

  const { data } = await supabase.auth.getSession()

  assert.ok(
    data.session,
    `@supabase/ssr did not read a session from '${cookieName}'. Its cookie naming has probably ` +
      'changed, which means isSupabaseAuthCookie() no longer detects real sessions and ' +
      'readAdminSession() will fall back to the legacy cookie — silently granting Owner. ' +
      'Update lib/supabase-cookie.ts to match the new name.'
  )
  assert.equal(data.session?.user?.email, 'staff@example.test')
})
