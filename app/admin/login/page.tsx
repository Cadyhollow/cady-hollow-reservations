// The admin login screen — a SERVER component as of PR 5a.
//
// It used to be 'use client' and fetched its own branding:
//
//     supabase.from('settings').select('park_name, logo_url')...
//
// with the anon key, from the browser, on a page that by definition has no session yet. That was
// the last anon read left on an admin path, and the one PR 6 cannot revoke around: every other
// admin page could in principle switch to an authenticated session, but the login page runs
// BEFORE anyone is authenticated, so there is no session for it to use. Left alone, revoking anon
// would have left the login screen with no park name and a broken logo — the one page you cannot
// afford to break, because it is how you get in to fix anything else.
//
// It now reads through lib/settings-server.ts (service-role, server-side, request-cached and
// shared with the layout), and hands the form what it needs as props. The browser makes no
// Supabase call to render this page at all.
//
// The interactive half lives in LoginForm.tsx.

import { getSettings } from '@/lib/settings-server'
import LoginForm from './LoginForm'

export default async function AdminLoginPage() {
  const settings = await getSettings()

  return (
    <LoginForm
      parkName={settings?.park_name ?? null}
      logoUrl={settings?.logo_url ?? null}
    />
  )
}
