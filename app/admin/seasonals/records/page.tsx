'use client'

// RECORDS — placeholder (Pass 1).
//
// The real module is Pass 3: registration types a park defines (pets, golf carts, pool
// memberships), the per-camper records against them, the criteria each one has to satisfy
// (vaccination, insurance, a signed waiver) and any optional fee.
//
// ⚠ THIS IS NOT "ADD-ONS", AND THE DISTINCTION IS THE REASON THIS ROUTE EXISTS. /admin/addons is
// the checkout upsell — things a guest buys while booking. Records are things a park REGISTERS
// about a camper and then has requirements about. The Command Center card used to point at
// /admin/addons, which sent an operator looking for a camper's pet registration to a page for
// selling firewood.
//
// A stub with nothing on it beats a card pointing at the wrong concept, which is why it ships now.

import SummitOnly from '../SummitOnly'
import CommandCenterLink from '../CommandCenterLink'

export default function SeasonalRecordsPage() {
  return (
    <SummitOnly>
      <div className="p-4 md:p-6">
        <CommandCenterLink className="mb-3" />
        <h2 className="text-2xl font-bold text-ink">Records</h2>
        <p className="mt-3 max-w-2xl text-sm text-ink-soft">
          This is where a park will register a camper&rsquo;s pets, golf carts and pool memberships
          — each with whatever it requires (a vaccination record, proof of insurance, a signed
          waiver) and an optional fee.
        </p>
        <p className="mt-4 text-sm text-muted italic font-display">Coming soon.</p>
      </div>
    </SummitOnly>
  )
}
