import { NextRequest, NextResponse } from 'next/server'
import { resolveRole } from '@/lib/require-role'

// GET /api/me → { role: 'owner' | 'manager' | 'staff' }
//
// Security PR 5b-2. The admin layout hides nav items the user cannot use, and it cannot work the
// role out for itself. A legacy 5a-0 cookie has no Supabase session at all, so a browser-side
// `select role from profiles` returns nothing for exactly the users who have the MOST access —
// the nav would collapse to Staff for anyone holding the shared password. Only the server can
// answer for both halves of dual-accept, so it does, here.
//
// This is presentation only. Nothing is authorised on the strength of this response: pages are
// enforced by middleware.ts and API routes by their own requireRole() call. Tampering with the
// reply in devtools reveals menu items whose pages then redirect and whose routes then 403.
//
// Returns 401 rather than a null role when there is no session, so it behaves like every other
// gated route and lib/api-auth.test.ts's blanket assertion covers it.
export async function GET(request: NextRequest) {
  const role = await resolveRole(request)

  if (!role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ role })
}
