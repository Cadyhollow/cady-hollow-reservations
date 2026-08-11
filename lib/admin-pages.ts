// The minimum role each admin PAGE requires.
//
// Security PR 5b-2. This is the page half of the route→role map; the API half lives at each
// route's requireRole() call. It is a module of its own rather than a constant inside
// middleware.ts because two places need the same answer and they must not drift:
//
//   middleware.ts       — enforces it, server-side, before the page renders
//   app/admin/layout.tsx — hides nav items the user cannot use
//
// The nav is UX. The middleware is the guard. If these two ever disagree the nav shows a link
// that 403s, which is a cosmetic bug; the reverse — enforcing in the nav only — is the security
// bug this file exists to make impossible.
//
// WHY SOME OF THESE SIT WHERE THEY DO:
//
//   /admin/products is the product CATALOGUE editor (pricing a product), not the till. Ringing a
//   product up happens on the folio pages, which are Staff. So this is Owner.
//
//   /admin/transactions is a financial listing, so Manager — same reasoning as /admin/reports.
//
//   /admin/electric-billing is Manager, and this is a DELIBERATE DEVIATION from the §15 default
//   that recording a reading is a Staff operation. create_electric_bill() inserts the reading and
//   the folio charge in one RPC, and this page is the only place a reading can be entered, so
//   Staff-level reading entry cannot be separated from Manager-level bill issuance without
//   splitting the UI. Splitting it is a follow-up; until then the whole page is Manager.
//
//   /admin/settings/terminal is covered by the /admin/settings prefix — pairing a Square device
//   is integration configuration.

import type { Role } from '@/lib/roles'

// Longest prefix wins, so /admin/settings/terminal resolves through /admin/settings and a future
// /admin/reports/detail inherits Manager without needing its own entry.
const PAGE_ROLES: [string, Role][] = [
  ['/admin/sites', 'owner'],
  ['/admin/pricing', 'owner'],
  ['/admin/min-stay', 'owner'],
  ['/admin/cancellation-rules', 'owner'],
  ['/admin/addons', 'owner'],
  ['/admin/fees', 'owner'],
  ['/admin/discounts', 'owner'],
  ['/admin/products', 'owner'],
  ['/admin/settings', 'owner'],

  ['/admin/reports', 'manager'],
  ['/admin/transactions', 'manager'],
  ['/admin/send-email', 'manager'],
  ['/admin/electric-billing', 'manager'],
]

/**
 * The minimum role for a path. Everything else under /admin is Staff — the default is the
 * permissive one ON PURPOSE: a new page added without touching this file is reachable by staff
 * but still behind a login, rather than silently unreachable by everyone.
 *
 * The corollary is that a new SENSITIVE page must be added here. That is why the nav reads from
 * this same table: a page missing from it shows up for everyone, which is visible immediately.
 */
export function roleForPath(pathname: string): Role {
  let best: Role = 'staff'
  let bestLength = -1

  for (const [prefix, role] of PAGE_ROLES) {
    // Path-boundary match, not startsWith: '/admin/sites' must not also claim '/admin/sites-x'.
    const matches = pathname === prefix || pathname.startsWith(prefix + '/')
    if (matches && prefix.length > bestLength) {
      best = role
      bestLength = prefix.length
    }
  }

  return best
}
