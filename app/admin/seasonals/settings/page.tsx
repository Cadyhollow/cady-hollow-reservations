'use client'

// SEASONAL SETTINGS — placeholder (Pass 1).
//
// Pass 2 fills this in for real by moving the seasonal half of the main Settings page here:
// contract text and packet options, the billing-mode toggle (with its confirmation, since flipping
// a live park between combined and separated changes what every money screen shows), and the
// electric billing settings.
//
// It ships empty now so the Command Center's Settings card has somewhere of its own to point.
// Sending it to /admin/settings would have been worse than a stub: that page is Owner-gated and
// park-wide, so a manager following a seasonal card would hit a wall, and an owner would land in
// tax rates and cancellation policy looking for contract text.

import SummitOnly from '../SummitOnly'
import CommandCenterLink from '../CommandCenterLink'

export default function SeasonalSettingsPage() {
  return (
    <SummitOnly>
      <div className="p-4 md:p-6">
        <CommandCenterLink className="mb-3" />
        <h2 className="text-2xl font-bold text-ink">Seasonal Settings</h2>
        <p className="mt-3 max-w-2xl text-sm text-ink-soft">
          The settings that belong to the seasonal side of the park will live here: contract and
          packet text, how seasonal money is billed, and the electric billing rates.
        </p>
        <p className="mt-4 text-sm text-muted italic font-display">Coming soon.</p>
      </div>
    </SummitOnly>
  )
}
