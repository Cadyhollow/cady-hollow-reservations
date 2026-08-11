import { NextRequest, NextResponse } from 'next/server'
import { readAdminSession } from '@/lib/admin-auth'
import { roleForSession } from '@/lib/require-role'
import { atLeast } from '@/lib/roles'
import { roleForPath } from '@/lib/admin-pages'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname.startsWith('/admin') &&
    !pathname.startsWith('/admin/login')
  ) {
    // The response is created BEFORE the check so a Supabase session that needs refreshing has
    // somewhere to write its new cookies. Handing it to readAdminSession is what keeps a logged-in
    // user logged in past their access token's hour.
    const response = NextResponse.next({ request })

    // Dual-accept: a 5a-0 signed legacy cookie OR a real Supabase Auth session. Either is enough;
    // neither is enough on its own to grant more than the other. See lib/admin-auth.ts.
    const session = await readAdminSession(request, response)
    if (!session) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }

    // PR 5b-2: authentication is no longer the whole story. Every admin page has a minimum role
    // (lib/admin-pages.ts) and this is where it is ENFORCED — before the page renders, on the
    // server, whether the user clicked a link or typed the URL. Hiding the nav item in
    // app/admin/layout.tsx is a courtesy on top of this, never a substitute for it.
    const required = roleForPath(pathname)
    const role = await roleForSession(session, request)

    if (!atLeast(role, required)) {
      // Redirect rather than a bare 403 body. The page never renders either way — this is the
      // same server-side refusal — but a 403 leaves a browser user on a dead end with no way
      // back, while /admin can tell them what happened and is Staff-level, so it is reachable by
      // anyone who got this far. The API routes are where a machine-readable 403 belongs, and
      // requireRole returns one there.
      //
      // Note the failure mode when `role` is null — a Supabase user with no profiles row, or a
      // deactivated one. atLeast(null, ...) is false, so they land here rather than anywhere
      // useful. That is deliberate: they are authenticated but not provisioned.
      const denied = new URL('/admin', request.url)
      denied.searchParams.set('denied', pathname)
      return NextResponse.redirect(denied)
    }

    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
