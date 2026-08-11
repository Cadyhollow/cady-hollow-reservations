// Who is making this request — the one answer both guards use.
//
// Security PR 5c-2. THE LEGACY SHARED-PASSWORD PATH IS GONE. There is now exactly one way to hold
// an admin session: a real Supabase Auth session, one row in auth.users per person, carrying a
// user id we can attribute actions to and a role we can enforce.
//
// WHAT THIS COMPLETES. Between 5a and 5c-1 this module accepted two kinds of session, and the
// second one — an HMAC-signed `admin_session` cookie minted from a single shared ADMIN_PASSWORD —
// carried NO IDENTITY. It said only "someone knew the password", so lib/require-role.ts had no
// choice but to resolve it to Owner. That was the caveat sitting underneath the whole role model:
// roles were enforced for anyone signing in with their own email, and merely advisory for anyone
// with the shared one. Deleting the branch is what turns the ladder from a convention into a
// boundary — a Staff account can no longer be sidestepped by typing the password everybody knows.
//
// AND IT IS WHAT MAKES PR 6 SAFE. A legacy session never authenticated to Supabase, so PostgREST
// executed its queries as `anon` — which meant revoking the anon role would have taken the admin
// offline for anyone still on that path. Now every admin request carries a user JWT and runs as
// `authenticated`, against the policy set 5b-1 authored. Revoking anon can no longer strand an
// administrator.
//
// NO-LOCKOUT, for the record: this shipped only after 5c-1 proved that real accounts, Owner-driven
// password resets and self-service changes all work, and after scripts/seed-user.mjs was confirmed
// to still reset an Owner's password over the service key. That script is now the ONLY recovery
// path if every Owner is locked out, which is why it was verified before this landed rather than
// after.
//
// STALE COOKIES: a browser may still be carrying an `admin_session` cookie from before this
// deploy. Nothing reads it — the code that verified it is deleted — so it grants exactly nothing
// and expires on its own within 24 hours. lib/api-auth.test.ts asserts that sending one, in any
// form, is refused.

import type { NextRequest, NextResponse } from 'next/server'
import { createRequestSupabase } from '@/lib/supabase-server'
import { isSupabaseAuthCookie } from '@/lib/supabase-cookie'

export type AdminSession = { userId: string; email: string | null }

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
  // The cookie sniff survives the removal of the legacy path, for a different reason than it was
  // added. It used to exist so a legacy-only admin never paid for a getUser() round trip that was
  // always going to miss; now it spares that round trip on requests with NO session at all —
  // logged-out visitors, crawlers, and anything probing the admin URLs. No auth cookie means no
  // session, and that can be answered locally.
  //
  // The name match is in lib/supabase-cookie.ts and pinned by lib/supabase-cookie.test.ts, because
  // it depends on a naming convention @supabase/ssr owns rather than one we do. Its failure mode
  // is now a clean one: if it stopped matching, real sessions would be refused and the admin would
  // be locked out loudly, rather than silently falling through to a weaker path.
  if (!request.cookies.getAll().some((c) => isSupabaseAuthCookie(c.name))) return null

  //
  // getUser() over getSession(): getSession() decodes whatever JWT is in the cookie WITHOUT
  // verifying it, so a hand-written cookie would satisfy it — the same class of bug PR 5a-0
  // closed, reintroduced in a new coat. getUser() validates against the auth server, which also
  // means a signed-out or deleted user stops working immediately rather than when their token
  // expires. That is what makes 5c-1's deactivate flow take effect on the very next request.
  //
  // COST, ACKNOWLEDGED: that is a network round trip on every authenticated admin request. If it
  // becomes a problem the escape hatch is auth.getClaims() — this project signs JWTs with an
  // asymmetric ES256 key (a JWKS is published), so claims can be verified locally with no round
  // trip. The tradeoff is that local verification cannot see a revoked session until the token
  // expires, which is precisely what makes it the wrong default for a security boundary, and more
  // so now that deactivating an account is a button in the admin.
  try {
    const supabase = createRequestSupabase(request, response)
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    return { userId: data.user.id, email: data.user.email ?? null }
  } catch {
    // Never let an auth-server hiccup read as "authenticated".
    return null
  }
}
