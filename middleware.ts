import { NextRequest, NextResponse } from 'next/server'
import { readAdminSession } from '@/lib/admin-auth'

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

    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
