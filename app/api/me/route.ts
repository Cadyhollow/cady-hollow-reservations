import { NextRequest, NextResponse } from 'next/server'
import { readAdminSession } from '@/lib/admin-auth'
import { roleForSession } from '@/lib/require-role'

// GET /api/me → { role, email, userId, via }
//
// Security PR 5b-2. The admin layout hides nav items the user cannot use, and it cannot work the
// role out for itself. A legacy 5a-0 cookie has no Supabase session at all, so a browser-side
// `select role from profiles` returns nothing for exactly the users who have the MOST access —
// the nav would collapse to Staff for anyone holding the shared password. Only the server can
// answer for both halves of dual-accept, so it does, here.
//
// PR 5c-1 added the identity fields. /admin/account changes your own password, which it can only
// offer to someone who HAS an account: a legacy shared-password session has no user to update, and
// `via` is what lets that page say so plainly instead of failing at the Supabase call. `email`
// spares the page a second round trip to name who is signed in, and doubles as the identity the
// self-service form re-authenticates with. Both describe the CALLER's own session only — this
// route never reveals anything about another user.
//
// This is presentation only. Nothing is authorised on the strength of this response: pages are
// enforced by middleware.ts and API routes by their own requireRole() call. Tampering with the
// reply in devtools reveals menu items whose pages then redirect and whose routes then 403.
//
// Returns 401 rather than a null role when there is no session, so it behaves like every other
// gated route and lib/api-auth.test.ts's blanket assertion covers it. A DEACTIVATED user reaches
// here with a valid Supabase session but no role — roleForSession fails closed on `active` — and
// gets that same 401, which is what app/admin/login/LoginForm.tsx uses to catch a deactivated
// account at sign-in rather than bouncing them around the admin.
export async function GET(request: NextRequest) {
  const session = await readAdminSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = await roleForSession(session, request)
  if (!role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    role,
    email: session.email,
    userId: session.userId,
    via: session.via,
  })
}
