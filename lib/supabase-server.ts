// Server-side Supabase clients that act AS THE LOGGED-IN USER.
//
// Security PR 5a. Distinct from the service-role clients scattered through app/api/*, which
// bypass RLS entirely and act as the database owner. These carry the user's session, so RLS
// applies to them — which is the whole point of moving admin onto real logins.
//
// Two shapes, because the App Router hands cookies over in two different ways:
//
//   createServerSupabase()          — server components and route handlers, via next/headers
//   createRequestSupabase(req, res) — middleware, where cookies live on the NextRequest
//
// 5a SCOPE: nothing calls createServerSupabase() yet. It is the foundation 5b's server-side role
// checks and data reads are built on, and it ships here so the session plumbing is one reviewable
// change rather than smuggled in with the enforcement work.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'

/**
 * For server components and route handlers.
 *
 * Server components cannot set cookies — React has already begun streaming by the time one runs —
 * so setAll swallows its writes there. That is the documented pattern, and it is safe because
 * middleware refreshes the session on every admin page navigation. It does mean this client must
 * never be the only thing keeping a session alive.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a server component, where the cookie store is read-only. Middleware
            // owns refresh; ignoring this is correct rather than merely tolerable.
          }
        },
      },
    }
  )
}

/**
 * For middleware, where the session may need refreshing and there IS a response to write to.
 *
 * Refreshed cookies must land on both the request (so anything later in this same pass sees the
 * new token) and the response (so the browser keeps it).
 */
export function createRequestSupabase(request: NextRequest, response?: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          if (!response) return // route handlers: no response to attach to, see lib/admin-auth.ts
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          }
        },
      },
    }
  )
}
