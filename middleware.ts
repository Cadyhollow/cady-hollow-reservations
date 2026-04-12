import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const session = request.cookies.get('admin_session')

  // Protect all /admin routes except /admin/login
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    if (!session || session.value !== 'authenticated') {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}