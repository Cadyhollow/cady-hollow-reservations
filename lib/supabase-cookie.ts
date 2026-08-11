// Recognising @supabase/ssr's auth cookie by name.
//
// Security PR 5b-2 follow-up. lib/admin-auth.ts checks for a real Supabase session BEFORE the
// legacy shared-password cookie, because whichever answers first now decides the caller's ROLE.
// Doing that check unconditionally would cost a getUser() network round trip on every request
// from a legacy-only admin — one that was always going to miss — so it is skipped when no
// Supabase auth cookie is present, and this is how that presence is decided.
//
// WHY THIS IS ITS OWN MODULE, AND ITS OWN TEST. The predicate is load-bearing in a way that is
// easy to miss: it is a string match against a name that ANOTHER LIBRARY chooses. If @supabase/ssr
// ever changes its cookie naming, this quietly stops matching, every real session falls through to
// the legacy branch, and a Staff user with a stale admin_session cookie silently becomes Owner
// again — the exact bug the precedence change was made to close, reintroduced by a dependency
// bump rather than by any edit to this repository. Nothing else would fail. See
// lib/supabase-cookie.test.ts, which pins the assumption against the real library.
//
// It lives apart from lib/admin-auth.ts so the test can import it without dragging in next/server
// and next/headers — the same reason lib/roles.ts is split out from lib/require-role.ts.

/**
 * True for the cookie @supabase/ssr stores a session in.
 *
 * `sb-<project-ref>-auth-token`, with a `.0` / `.1` suffix when the token is large enough to be
 * split across several cookies. Deliberately loose about the project ref — this only decides
 * whether it is worth ASKING the auth server, never whether a session is valid. Being wrong in
 * the permissive direction costs one wasted round trip; being wrong in the strict direction is
 * the silent privilege bug described above.
 */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name)
}

/** The cookie name @supabase/ssr derives for a project URL. Used by the test to pin the format. */
export function supabaseAuthCookieName(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  return `sb-${ref}-auth-token`
}
