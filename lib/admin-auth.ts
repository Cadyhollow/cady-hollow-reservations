// Who is making this request — the one answer both guards use.
//
// Security PR 5a. During the cutover there are TWO ways to hold an admin session, and both are
// valid. This module is the single place that says so, so middleware.ts and lib/require-admin.ts
// cannot drift apart the way they did before 5a-0 (each carried its own copy of the cookie check,
// and both had to be fixed separately).
//
//   'legacy'   — the 5a-0 HMAC-signed admin_session cookie, minted by /api/admin-auth from the
//                shared ADMIN_PASSWORD. No user identity: it says "someone knew the password".
//   'supabase' — a real Supabase Auth session, one row in auth.users per person, carrying a user
//                id we can attribute actions to and hang a role off.
//
// WHY BOTH. Dual-accept is the no-lockout rule: the legacy path keeps working unchanged for the
// entire cutover, so no deploy in this stage can strand anyone.
//
// THE ORDER CHANGED IN 5b-2, and the reasoning is in the PRECEDENCE note further down. In 5a the
// legacy check ran first because it is a local HMAC and both branches meant the same thing. Once
// roles arrived they stopped meaning the same thing, and legacy-first became a privilege bug.
// A real session now wins; the cookie sniff keeps the legacy path free of network cost.
//
// Removing the legacy branch is 5c, and it is deliberately a one-line deletion here plus the
// login route — small enough to be its own revertible commit, which the cutover plan depends on.
//
// 5a SCOPE — AUTHENTICATION ONLY. This answers "is this a logged-in admin", NOT "may they do
// this". Every authenticated user still gets exactly what every admin got before: everything.
// Roles exist in the profiles table but nothing reads them yet. requireRole and the route→role
// map are 5b. Nothing a Staff or Manager can do changes in this stage, because nothing
// distinguishes them yet.

import type { NextRequest, NextResponse } from 'next/server'
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/admin-session'
import { createRequestSupabase } from '@/lib/supabase-server'
import { isSupabaseAuthCookie } from '@/lib/supabase-cookie'

export type AdminSession =
  | { via: 'legacy'; userId: null; email: null }
  | { via: 'supabase'; userId: string; email: string | null }

/**
 * The authenticated admin behind this request, or null.
 *
 * `response` is only meaningful from middleware: when supplied, a Supabase session that needed
 * refreshing writes its new cookies onto it. Route handlers pass nothing and simply read — they
 * have no response object at guard time, and middleware has already refreshed on the page
 * navigation that got the user here.
 */
export async function readAdminSession(
  request: NextRequest,
  response?: NextResponse
): Promise<AdminSession | null> {
  // 1. A REAL per-user session wins over the shared password. See PRECEDENCE below.
  //
  // Skipped entirely when no Supabase auth cookie is present, which is what preserves 5a's
  // "legacy costs nothing" property: a legacy-only admin never pays for a getUser() round trip
  // that was always going to miss.
  //
  // The name match is in lib/supabase-cookie.ts and pinned by lib/supabase-cookie.test.ts,
  // because it depends on a naming convention @supabase/ssr owns rather than one we do — and if
  // it silently stopped matching, every real session would fall through to the legacy branch and
  // this bug would reopen with nothing in this repository having changed.
  const hasSupabaseCookie = request.cookies.getAll().some((c) => isSupabaseAuthCookie(c.name))

  if (hasSupabaseCookie) {
    const supabaseSession = await readSupabaseSession(request, response)
    if (supabaseSession) return supabaseSession
    // Fall through on an expired or invalid token rather than refusing: dual-accept's whole job
    // is that no deploy and no expiry can strand someone who still holds a valid legacy cookie.
  }

  // 2. Legacy signed cookie — local, no network. See lib/admin-session.ts.
  const legacy = request.cookies.get(ADMIN_SESSION_COOKIE)
  if (await verifyAdminSession(legacy?.value)) {
    return { via: 'legacy', userId: null, email: null }
  }

  return null
}

// PRECEDENCE — WHY SUPABASE IS CHECKED FIRST, and why it was the other way round until 5b-2.
//
// In 5a this order was a pure performance choice and it was the right one: both branches meant
// exactly the same thing ("a logged-in admin"), so checking the local HMAC first and skipping a
// network call cost nothing. Whichever answered first, the caller got identical access.
//
// 5b-2 broke that assumption without changing this file. Once requireRole() started asking WHO is
// calling, the two branches stopped being equivalent — `legacy` resolves to Owner, because a
// shared-password cookie carries no identity to look up. Legacy-first therefore meant a stale
// admin_session cookie SHADOWED a real login: a Staff user signing in with their own email in a
// browser that had ever used the shared password was silently Owner for every server-side check —
// /api/me and the nav, middleware's page gate, and every requireRole route including /api/refund
// and /api/reservation-cancel.
//
// It did not reach RLS, because PostgREST still used the user's own JWT. That asymmetry is what
// made it hard to see: Permanently Delete stayed correctly blocked at the database while Cancel
// and Issue Refund went through, so the failure did not look like an auth problem at all.
//
// Reversing it makes the rule simple and correct: IF YOU HAVE AN IDENTITY, YOUR IDENTITY DECIDES.
// The shared password is now only what it should have been all along — a fallback for people who
// have not been given an account yet, and the break-glass path. 5c deletes the branch entirely.
async function readSupabaseSession(
  request: NextRequest,
  response?: NextResponse
): Promise<AdminSession | null> {
  //
  // getUser() over getSession(): getSession() decodes whatever JWT is in the cookie WITHOUT
  // verifying it, so a hand-written cookie would satisfy it — the same class of bug 5a-0 just
  // closed, reintroduced in a new coat. getUser() validates against the auth server, which also
  // means a signed-out or deleted user stops working immediately rather than when their token
  // expires. That matters for 5c's deactivate-a-staff-member flow.
  //
  // COST, ACKNOWLEDGED: that is a network round trip, and as of 5b-2 it is paid by everyone
  // holding a real account rather than by almost nobody — reversing the precedence moved this
  // ahead of the local HMAC check. The caller-side guard is the cookie sniff in readAdminSession:
  // an admin with no Supabase cookie never gets here, so the legacy path stays free. If the cost
  // on real sessions becomes a problem, the escape hatch is auth.getClaims() — this project signs
  // JWTs with an asymmetric ES256 key (a JWKS is published), so claims can be verified locally
  // with no round trip. The tradeoff is that local verification cannot see a revoked session
  // until the token expires, which is precisely what makes it the wrong default for a security
  // boundary.
  try {
    const supabase = createRequestSupabase(request, response)
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    return { via: 'supabase', userId: data.user.id, email: data.user.email ?? null }
  } catch {
    // Never let an auth-server hiccup read as "authenticated".
    return null
  }
}
