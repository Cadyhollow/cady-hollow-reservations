'use client'

/**
 * ── "SEASON FEES ARE NOT COLLECTED HERE" ──────────────────────────────────────────────────────
 *
 * An informational notice for the RESERVATION folio's payment box. It tells a staffer who opened
 * that box intending to take a season fee that they are on the wrong screen for it, and where to
 * go instead.
 *
 * ⚠ WHY A NOTICE AND NOT A SEASONAL DOOR. The reservation folio (`folio_type='reservation'`,
 * keyed by reservation_id) and the camper's account (`folio_type='guest_account'`, keyed by
 * guest_id) are TWO DIFFERENT ACCOUNTS, not two views of one. Every seasonal charge is posted to
 * the guest account — lib/contract-server.ts does it there and only there — and every reader of
 * the seasonal lane is scoped to guest_account folios (accountBuckets is fed one folio's rows;
 * /api/guests/balances and the reports lane summary both filter on folio_type). So a payment
 * recorded here does not land in the camper's account untagged; it does not land in their account
 * at all, and a `lane:'seasonal'` tag written on it would be INERT — read by nothing. A Seasonal
 * door on this screen would therefore tell the operator the money was filed as Seasonal when it
 * was not, which is worse than saying nothing. Hence: say something true instead.
 *
 * ⚠ THE LINK GOES TO A LIST, DELIBERATELY, NOT TO A CAMPER. `reservations` carries no `guest_id`
 * (free-text guest_name/guest_email only), so this screen cannot say WHICH camper this is without
 * matching on email — and one email address covers several people at some parks, which would send
 * staff confidently to the wrong person's money. Not identifying the camper is the honest answer
 * and is the entire reason this notice exists rather than a redirect.
 *
 * INFORMATIONAL ONLY. It gates nothing, disables nothing and changes no amount. An ordinary
 * reservation payment is still taken on this screen exactly as before.
 *
 * Styled as calm information (the same soft blue the terminal panel uses), NOT as the amber this
 * app reserves for fee warnings — a staffer taking a perfectly normal site payment sees this too,
 * and it must not read as though something is wrong.
 */
export default function SeasonalFeeNotice({
  seasonalLabel,
  /** Where staff go to find the camper. A list, never a specific guest — see above. */
  href = '/admin/guests?mode=payment',
}: {
  seasonalLabel: string
  href?: string
}) {
  return (
    <div
      role="note"
      style={{
        background: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, color: '#0369a1', marginBottom: 2 }}>
        Taking a season fee?
      </div>
      <div style={{ color: '#075985' }}>
        Season fees are collected on the camper&rsquo;s {seasonalLabel} account, not on this
        reservation. Open the camper&rsquo;s account to record a season-fee payment.
      </div>
      <a
        href={href}
        style={{
          display: 'inline-block',
          marginTop: 6,
          color: '#2E6B8A',
          fontWeight: 600,
          textDecoration: 'underline',
        }}
      >
        Find the camper&rsquo;s account &rarr;
      </a>
    </div>
  )
}
