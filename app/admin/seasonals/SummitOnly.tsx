'use client'

// A Summit-only wrapper for seasonal PAGES.
//
// The sidebar and the dashboard hide their seasonal entries on other plans, but hiding a link
// stops nobody typing the URL — so the page itself has to say no as well. This is that.
//
// ⚠ IT BLOCKS RATHER THAN REDIRECTS, deliberately. A silent bounce to /admin leaves someone who
// typed a real URL with no idea why it did not open; the seasonal API routes already answer a
// wrong-plan request with "Not available on this plan.", and this says the same thing in the same
// words so the two never read as different problems.
//
// ⚠ AND IT AUTHORISES NOTHING. This is presentation. Every seasonal API route runs its own
// server-side `isSummit()` check (lib/contract-server.ts), which is the gate that actually holds:
// forcing this component to render its children reveals pages whose data still refuses to load.
// Role enforcement is separate again and lives in middleware.
//
// While the plan is still being read it renders a quiet placeholder rather than the refusal — a
// park that is perfectly entitled to the page should never see "not available" flash first.

import type { ReactNode } from 'react'
import { useSummit } from '@/lib/use-summit'

export default function SummitOnly({ children }: { children: ReactNode }) {
  const { isSummit, summitLoaded } = useSummit()

  if (!summitLoaded) {
    return <div className="p-6 text-sm text-muted">Loading…</div>
  }

  if (!isSummit) {
    return (
      <div className="p-6">
        <div className="max-w-lg rounded-2xl border border-line bg-card p-6 shadow-sm">
          <h2 className="font-display text-xl font-medium text-ink">Not available on this plan</h2>
          <p className="mt-3 text-sm text-ink-soft">
            The seasonal tools — campers, contracts, meter readings and records — are part of the
            Summit plan.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
