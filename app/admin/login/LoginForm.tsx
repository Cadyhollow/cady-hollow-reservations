'use client'

// The interactive half of the login screen. Branding arrives as props from the server component
// (page.tsx) — this file makes no Supabase data reads.
//
// PR 5c-2: ONE LOGIN PATH. Email + password, against Supabase Auth, for a real per-user account.
//
// From 5a until now this screen offered two, selected by whether the email field was filled in:
// leaving it blank posted the password to /api/admin-auth and logged you in with the single shared
// ADMIN_PASSWORD that every member of staff knew. That path is gone — the endpoint is deleted, the
// cookie is unread, and the "leave blank to use the shared staff password" hint below the email
// field went with it.
//
// WHY IT HAD TO GO, beyond tidiness: a shared-password session carried no identity, so
// lib/require-role.ts had to treat it as Owner. Every role in the system was optional for anyone
// who knew one password. And because that session never authenticated to Supabase, its database
// queries ran as `anon` — so PR 6's revoke of the anon role would have locked those users out.
//
// The no-lockout rule was satisfied before this shipped, not after: 5c-1 proved that accounts can
// be created, roles changed and passwords reset and self-changed, and scripts/seed-user.mjs was
// re-confirmed as the break-glass — it is now the only way back in if every Owner is locked out.

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { createBrowserSupabase } from '@/lib/supabase-browser'

export default function LoginForm({
  parkName,
  logoUrl,
}: {
  parkName: string | null
  logoUrl: string | null
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // PR 5c-1. Set by middleware.ts when it turns away a session that authenticated fine but has no
  // usable role — a deactivated account, or a Supabase user with no profiles row. Without this the
  // user is dumped on a blank login form having just been signed in, which reads as a bug.
  //
  // Read from window.location rather than useSearchParams(), matching app/admin/layout.tsx: the
  // hook opts the whole subtree into a Suspense boundary at build time, which is a lot of
  // machinery for one line of copy.
  const [inactive, setInactive] = useState(false)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('inactive')) setInactive(true)
  }, [])

  async function handleLogin() {
    if (!email.trim()) { setError('Please enter your email address.'); return }
    if (!password) { setError('Please enter your password.'); return }
    setLoading(true)
    setError('')

    try {
      // Supabase Auth. On success the session is written to cookies by the browser client, which
      // is what makes it visible to middleware and requireRole on the very next request.
      const supabase = createBrowserSupabase()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        setError('Incorrect email or password.')
        setLoading(false)
        return
      }

      // PR 5c-1: SIGNING IN IS NOT THE SAME AS HAVING ACCESS.
      //
      // Supabase Auth knows nothing about profiles.active — a deactivated staff member's password
      // still works, because deactivation is this application's concept, not GoTrue's. Their
      // session is real and every server guard then refuses it, so without this check they would
      // land on /admin, be bounced to the login page by middleware, sign in successfully again,
      // and loop — apparently at random.
      //
      // /api/me is the authority because it runs the SAME roleForSession() the guards use, so this
      // cannot drift from what will actually be enforced on the next request. A 401 here means
      // authenticated-but-not-provisioned. Sign them back out so the browser is not left holding a
      // session that opens nothing.
      const me = await fetch('/api/me')
      if (!me.ok) {
        await supabase.auth.signOut()
        setError('This account is not active. Ask an owner to reactivate it.')
        setLoading(false)
        return
      }

      // A full navigation rather than router.push: the session cookie was just set, and this
      // guarantees the next request carries it through middleware rather than relying on a
      // client-side transition to pick it up.
      window.location.href = '/admin'
    } catch {
      setError('Could not reach the server. Please try again.')
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <main className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#1C1C1C' }}>
      <div className="w-full max-w-sm px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image
            src={logoUrl || '/images/logo.png'}
            alt={parkName || 'Campground Logo'}
            width={100}
            height={100}
            className="rounded-full mx-auto mb-4"
            style={{ filter: 'hue-rotate(20deg) saturate(1.2)' }}
          />
          <h1 className="text-white font-bold text-xl">{parkName || 'Campground'}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--accent-color)' }}>Admin Dashboard</p>
        </div>

        {/* Login Card */}
        <div className="rounded-2xl p-6" style={{ backgroundColor: '#2B2B2B' }}>
          <h2 className="text-white font-bold text-lg mb-6 text-center">Staff Login</h2>

          {inactive && (
            <div role="alert" className="rounded-lg px-3 py-2 mb-4 text-sm"
              style={{ background: 'rgba(180,83,9,0.25)', color: '#fcd34d', border: '1px solid rgba(217,119,6,0.5)' }}>
              Your account is no longer active. Ask an owner to reactivate it.
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="admin-email">
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="admin-password">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full py-3 rounded-xl text-white font-semibold transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-color)' }}
              onMouseOver={e => (e.currentTarget.style.backgroundColor = '#2DADC4')}
              onMouseOut={e => (e.currentTarget.style.backgroundColor = 'var(--accent-color)')}
            >
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </div>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          © 2026 {parkName || 'Campground'}
        </p>
      </div>
    </main>
  )
}
