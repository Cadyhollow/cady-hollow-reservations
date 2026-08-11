import { NextRequest, NextResponse } from 'next/server'
import { readAdminSession } from '@/lib/admin-auth'

// WHY THIS EXISTS: middleware.ts guards admin PAGES only — its matcher is ['/admin/:path*'],
// which never matches /api/*. So every API route is reachable unauthenticated unless it checks
// for itself. Before this helper only /api/guests/balances did, leaving ~20 service-role-backed
// routes (refunds, terminal charges, manual bookings, guest PII, outbound email) open to anyone
// who could guess the URL.
//
// This is that route's check, lifted verbatim so there is one definition instead of twenty
// copies: the same 'admin_session' cookie the login sets in /api/admin-auth, covering owner AND
// staff (owner/staff is a view toggle in the UI, not a separate credential).
//
// Usage — first statement in the handler, before reading the body or touching Supabase:
//
//   const denied = await requireAdmin(request)
//   if (denied) return denied
//
// The await is not optional. Without it `denied` is a Promise, which is always truthy, and every
// gated route would return the Promise instead of running — a failure loud enough to catch in
// development, but await it and read this note rather than finding out.
//
// Returning the response rather than throwing keeps the guard explicit at each call site: a
// reader can see the route is gated without following a throw.
//
// SCOPE: this is a session check, not a redesign of admin identity. Admin still authenticates
// with a shared password cookie and still talks to Supabase with the publishable key; moving
// admin onto real per-user Supabase logins is a later PR. What this closes is the gap where no
// session was required at all.
//
// UPDATE (PR 5a-0): the cookie is now verified rather than string-compared. The original check
// accepted the constant value 'authenticated', which is published in this repository, so the
// session could be forged without knowing ADMIN_PASSWORD — this helper's coverage was correct but
// the check underneath it never failed closed. See lib/admin-session.ts.
//
// UPDATE (PR 5a): now accepts EITHER the signed legacy cookie or a real Supabase Auth session,
// via lib/admin-auth.ts. Still authentication only — this says a logged-in admin is calling, not
// which of them, and grants every caller the same access it always did. The role check that makes
// /api/refund refuse a Staff user is requireRole in 5b.
//
// DO NOT apply this to:
//   • /api/admin-auth — it is the login endpoint; gating it makes logging in impossible.
//   • Camper-facing routes (/api/payment, /api/availability, /api/cancellation-policy),
//     token-authenticated links (/api/sign/[token], /api/packet/[packetId], /api/unsubscribe),
//     or /api/webhooks/square, which Square calls with its own signature.
export async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  if (!(await readAdminSession(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
