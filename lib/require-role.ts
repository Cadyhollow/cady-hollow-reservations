import { NextRequest, NextResponse } from 'next/server'
import { readAdminSession, type AdminSession } from '@/lib/admin-auth'
import { createRequestSupabase } from '@/lib/supabase-server'
import { atLeast, rankOf, type Role } from '@/lib/roles'

// Re-exported so server-side callers have one import for the guard and its vocabulary. The
// browser must import from '@/lib/roles' directly — see the note at the top of that file.
export { atLeast, type Role }

// WHY THIS EXISTS: middleware.ts guards admin PAGES only — its matcher is ['/admin/:path*'],
// which never matches /api/*. So every API route is reachable unauthenticated unless it checks
// for itself. Before this helper only /api/guests/balances did, leaving ~20 service-role-backed
// routes (refunds, terminal charges, manual bookings, guest PII, outbound email) open to anyone
// who could guess the URL.
//
// Usage — first statement in the handler, before reading the body or touching Supabase:
//
//   const denied = await requireRole(request, 'manager')
//   if (denied) return denied
//
// The await is not optional. Without it `denied` is a Promise, which is always truthy, and every
// gated route would return the Promise instead of running — a failure loud enough to catch in
// development, but await it and read this note rather than finding out.
//
// Returning the response rather than throwing keeps the guard explicit at each call site: a
// reader can see the route is gated, and at what level, without following a throw.
//
// HISTORY. PR 5a-0 made the legacy shared-password cookie unforgeable (it used to be the constant
// string 'authenticated', published in this repository). PR 5a added real per-user Supabase logins
// alongside it. Both stages were AUTHENTICATION only: they answered "is a logged-in admin
// calling", and granted every caller everything.
//
// PR 5b-2 is the authorization half. This file was lib/require-admin.ts and exported
// requireAdmin(); that function is gone, because "is an admin" is no longer a question any route
// should be asking. Every route now names the minimum role it needs.
//
// PR 5c-2 retired the shared password entirely, so every caller reaching this file has a personal
// account behind them. There is no longer a login ROUTE to exempt: signing in happens against
// Supabase Auth directly from the browser, so the "never gate /api/admin-auth" rule that used to
// sit here is gone along with the endpoint.
//
// DO NOT apply this to:
//   • Camper-facing routes (/api/payment, /api/availability, /api/cancellation-policy,
//     /api/discount), token-authenticated links (/api/sign/[token], /api/packet/[packetId],
//     /api/unsubscribe), or /api/webhooks/square, which Square calls with its own signature.
//   lib/api-auth.test.ts asserts both halves — that the gated routes stay gated, AND that those
//   camper-facing routes stay open.

/**
 * The caller's role, or null if they are not a logged-in admin at all.
 *
 * PR 5c-2 REMOVED THE CAVEAT THAT USED TO LIVE HERE. Until the legacy path was retired, a
 * shared-password session carried no identity and therefore resolved to Owner — so anyone who knew
 * ADMIN_PASSWORD was an Owner whatever their profile said, and the ladder was enforced only for
 * people signing in with their own email. Every session now has a user id behind it, so every
 * answer this function gives comes from that person's own profiles row. The role model is
 * enforced, with no way around it.
 */
export async function resolveRole(request: NextRequest): Promise<Role | null> {
  const session = await readAdminSession(request)
  return session ? roleForSession(session, request) : null
}

/**
 * The role for a session that has ALREADY been read.
 *
 * Middleware needs this split out: it calls readAdminSession() itself, with a response to write
 * refreshed cookies onto, and would otherwise pay for a second getUser() round trip on every
 * admin page navigation just to learn the role.
 */
export async function roleForSession(
  session: AdminSession,
  request: NextRequest
): Promise<Role | null> {
  // The role lives in public.profiles (PR 5a).
  //
  // Read over the USER'S OWN session, not service-role. The 5a policy "Users read their own
  // profile" scopes SELECT to auth.uid() = id, so this can only ever return the caller's row,
  // and it keeps the service key out of a code path that middleware also runs on the Edge.
  // It is not a trust problem: profiles has no INSERT or UPDATE policy for `authenticated` and
  // the grants are revoked, so a user cannot write the column they are being judged by.
  try {
    const supabase = createRequestSupabase(request)
    const { data, error } = await supabase
      .from('profiles')
      .select('role, active')
      .eq('id', session.userId)
      .single()

    // FAIL CLOSED on every ambiguous case: no row (an auth user who was never provisioned),
    // a deactivated account, a role outside the ladder, or an error reaching the database.
    // Public signup is disabled on this project, so a profile-less auth user should not exist —
    // this is what keeps that true if signup is ever switched back on.
    if (error || !data || !data.active) return null
    return rankOf(data.role) > 0 ? (data.role as Role) : null
  } catch {
    return null
  }
}

/**
 * Gate a route handler on a minimum role.
 *
 * 401 vs 403 is a deliberate distinction, not decoration:
 *   401 — no admin session at all. lib/api-auth.test.ts asserts exactly this for every gated
 *         route, so an unauthenticated caller must keep getting 401 and not 403.
 *   403 — a real, logged-in admin whose role is too low. This is the acceptance test for 5b-2:
 *         a Staff user hitting /api/refund gets 403, from the server, with no UI involved.
 */
export async function requireRole(
  request: NextRequest,
  minimum: Role
): Promise<NextResponse | null> {
  const role = await resolveRole(request)

  if (!role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!atLeast(role, minimum)) {
    return NextResponse.json(
      { error: 'Forbidden', required: minimum, role },
      { status: 403 }
    )
  }

  return null
}
