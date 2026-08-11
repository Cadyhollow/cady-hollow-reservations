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
// WHY BOTH, AND IN THIS ORDER. Dual-accept is the no-lockout rule: the legacy path keeps working
// unchanged for the entire cutover, so no deploy in this stage can strand anyone. The legacy check
// runs FIRST because it is a local HMAC over a cookie — no network, no allocation worth measuring.
// Only when it misses do we pay for a Supabase round trip. Everyone logged in today therefore
// notices nothing at all, and the new path costs nothing until someone uses it.
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
  // 1. Legacy signed cookie — local, no network. See lib/admin-session.ts.
  const legacy = request.cookies.get(ADMIN_SESSION_COOKIE)
  if (await verifyAdminSession(legacy?.value)) {
    return { via: 'legacy', userId: null, email: null }
  }

  // 2. Supabase Auth session.
  //
  // getUser() over getSession(): getSession() decodes whatever JWT is in the cookie WITHOUT
  // verifying it, so a hand-written cookie would satisfy it — the same class of bug 5a-0 just
  // closed, reintroduced in a new coat. getUser() validates against the auth server, which also
  // means a signed-out or deleted user stops working immediately rather than when their token
  // expires. That matters for 5c's deactivate-a-staff-member flow.
  //
  // COST, ACKNOWLEDGED: that is a network round trip on admin requests that reach this line.
  // Today almost none do, because the legacy check above short-circuits for everyone already
  // logged in. Once 5c removes the legacy branch, every admin request pays it. If that becomes
  // a problem, the escape hatch is auth.getClaims() — this project signs JWTs with an asymmetric
  // ES256 key (a JWKS is published), so claims can be verified locally with no round trip. The
  // tradeoff is that local verification cannot see a revoked session until the token expires,
  // which is precisely what makes it the wrong default for a security boundary.
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
