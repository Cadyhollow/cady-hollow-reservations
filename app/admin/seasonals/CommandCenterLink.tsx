'use client'

// "← Command Center" — the way back to the hub, on every seasonal page.
//
// The Command Center is the landing page for the whole seasonal side, so every screen under it
// needs a way home. One component rather than a hand-rolled link per page, because six copies of
// the same anchor is six chances for one of them to drift, point somewhere slightly different, or
// quietly not get added to the seventh page.
//
// Deliberately a plain text link and not a button: it is a way back, not an action, and the
// seasonal pages already carry their own primary actions in the same row.

import Link from 'next/link'

export default function CommandCenterLink({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/admin/seasonals/command-center"
      className={`inline-flex items-center gap-1 text-xs font-semibold text-link hover:text-link-hover ${className}`}
    >
      ← Command Center
    </Link>
  )
}
