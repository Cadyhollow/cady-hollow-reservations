// The admin browser's Supabase client, session-aware.
//
// Security PR 5a. lib/supabase.ts creates a plain client with the publishable key and no session,
// so every query it makes runs as the `anon` Postgres role. This one stores the logged-in user's
// session in cookies, which means the same publishable key now travels with a user JWT and
// PostgREST executes as `authenticated` instead.
//
// WORTH BEING PRECISE ABOUT, because it changes how PR 6 should be described: the publishable key
// stays in the browser. It is the API key and it is not a secret. "Revoking anon" in PR 6 means
// revoking what the anon Postgres ROLE may do — not removing this key from the client.
//
// Cookies rather than localStorage on purpose: the server guards (middleware, requireAdmin) read
// the session from the request's cookies, and localStorage is invisible to them.
//
// 5a SCOPE: this client exists and holds the session, but the admin pages have NOT been moved onto
// it — they still import lib/supabase.ts and still read as anon. Moving them is 5b, alongside the
// authenticated-role RLS policies that have to land in the same stage or the pages break.

import { createBrowserClient } from '@supabase/ssr'

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
