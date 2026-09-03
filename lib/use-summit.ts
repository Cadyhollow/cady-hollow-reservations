'use client'

// IS THIS PARK ON SUMMIT? — the one gate the seasonal world hangs off.
//
// The seasonal area (Command Center, campers, contracts, meters, records, seasonal settings) is a
// Summit-tier space. This answers "should any of it be visible here", for client components that
// need to hide a button or block a page.
//
// ── WHY ITS OWN SELECT, AND WHY IT MUST NOT BE COMBINED ───────────────────────────────────────
//
// `select('plan')` and nothing else. PostgREST fails the WHOLE query when it is asked for a column
// that does not exist, so folding this into a wider select would mean one absent column on some
// park takes the plan down with it — and a plan that cannot be read is a park that sees no
// seasonal UI at all. Asking on its own costs one small query and keeps the failure contained.
//
// ── IT GATES ON THE PLAN, NOT ON `seasonal_enabled` ───────────────────────────────────────────
//
// ⚠ DO NOT SWITCH THIS TO `settings.seasonal_enabled`. That flag is being retired, and on this
// park — which IS on Summit and IS running the seasonal area — the column does not exist at all
// (verified 2026-09-03). Selecting it would not merely read false: PostgREST would fail the query,
// this would fall to its closed default, and the whole feature would vanish from the one park
// using it. The plan is the switch.
//
// ── IT FAILS CLOSED ───────────────────────────────────────────────────────────────────────────
//
// A missing column, an RLS refusal, a network error, a plan value nobody recognises — every one of
// them resolves to NOT Summit. A broken read hides seasonal UI; it never leaks it onto a park that
// has not paid for it. `normalizePlan` already resolves anything unrecognised to the lowest tier,
// so there is no value that can accidentally satisfy this.
//
// ── WHY A MODULE-LEVEL CACHE ──────────────────────────────────────────────────────────────────
//
// Same reasoning as lib/use-role.ts: the sidebar, the dashboard and every gated page would
// otherwise each ask for an answer that cannot change while the page is open. The promise is
// created once per page load and shared, so this is ONE query however many components read it. A
// full navigation — which is what changing plan would require anyway — starts a new one.
//
// ⚠ PRESENTATION ONLY. Nothing here authorises anything. The seasonal API routes enforce with
// their own `isSummit()` check server-side (lib/contract-server.ts), which is the gate that
// actually matters; editing this answer in devtools reveals pages whose data still refuses to load.

import { useEffect, useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import { planAtLeast } from '@/lib/plan'

const supabase = createBrowserSupabase()

let cached: Promise<boolean> | null = null

function fetchIsSummit(): Promise<boolean> {
  if (!cached) {
    cached = Promise.resolve(
      supabase.from('settings').select('plan').limit(1).single(),
    )
      .then(({ data, error }) => (error ? false : planAtLeast(data?.plan, 'summit')))
      .catch(() => false)
  }
  return cached
}

/**
 * `isSummit` is false until proven true, so nothing seasonal flashes on a park that should never
 * see it. `summitLoaded` lets a caller hold the UI until the answer arrives rather than rendering
 * a "not available" panel for a moment on a park that is perfectly entitled to the page.
 */
export function useSummit(): { isSummit: boolean; summitLoaded: boolean } {
  const [isSummit, setIsSummit] = useState(false)
  const [summitLoaded, setSummitLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    fetchIsSummit().then(value => {
      if (!alive) return
      setIsSummit(value)
      setSummitLoaded(true)
    })
    return () => { alive = false }
  }, [])

  return { isSummit, summitLoaded }
}
