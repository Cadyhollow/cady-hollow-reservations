'use client'

// The interactive half of the login screen. Branding arrives as props from the server component
// (page.tsx) — this file makes no Supabase data reads.
//
// PR 5a runs TWO login paths at once, deliberately:
//
//   • Email + password  -> Supabase Auth. A real per-user account. This is the one that survives.
//   • Password only     -> POST /api/admin-auth, the shared ADMIN_PASSWORD, minting the 5a-0
//                          signed cookie. Unchanged, still works, removed in 5c.
//
// Both are offered until a real login has been proven in production, because the no-lockout rule
// says the old way keeps working until the new way is known to. The email field is what selects
// between them: fill it in and you get Supabase, leave it blank and you get the shared password
// exactly as before. That means Cady's existing habit — type the password, press enter — is
// completely undisturbed by this deploy.
//
// The "leave blank" affordance is temporary and slightly awkward on purpose. It disappears in 5c
// along with the legacy branch, and until then it is better than a mode toggle that someone has
// to understand.

import { useState } from 'react'
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

  async function handleLogin() {
    if (!password) { setError('Please enter your password.'); return }
    setLoading(true)
    setError('')

    try {
      if (email.trim()) {
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

        // Drop any legacy shared-password cookie this browser is still carrying.
        //
        // readAdminSession() now prefers a real session, so a leftover admin_session no longer
        // grants Owner on its own — but leaving one behind keeps a second, weaker way into this
        // browser that outlives the account actually being used, and it would come back the
        // moment this user's token expired. Clearing it makes "signed in as this person" mean
        // exactly one thing.
        //
        // allSettled: the sign-in already succeeded, so failing to clear a cookie that may not
        // even exist must never turn a good login into an error.
        await Promise.allSettled([fetch('/api/admin-auth', { method: 'DELETE' })])
      } else {
        // Legacy shared password. Unchanged from 5a-0.
        const res = await fetch('/api/admin-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        const data = await res.json().catch(() => ({}))
        if (!data.success) {
          setError('Incorrect password. Please try again.')
          setLoading(false)
          return
        }
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
              <p className="text-xs text-gray-500 mt-1">
                Leave blank to use the shared staff password.
              </p>
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
