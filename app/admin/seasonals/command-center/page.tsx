'use client'

// ── THE SEASONAL COMMAND CENTER ───────────────────────────────────────────────────────────────
//
// The landing page for running the seasonal side of the park: where things stand, what is worth a
// look, and a way through to everything else.
//
// ⚠ THE TONE IS THE FEATURE. This page reflects records that EXIST and never implies work that
// does not. It cannot say "you are missing 49 contracts", because it never compares a count
// against a roster — every line is built from real rows and vanishes when there are none. Long
// calm stretches are the expected mid-summer state, and the page is written to say so plainly
// rather than to find something to worry about. If you are adding a line here, the test is: can a
// park with nothing drafted ever see it? If yes, it does not belong.
//
// ⚠ READ AND NAVIGATE ONLY (v1). Nothing on this page writes, and no button sends anything. The
// actions are links into the screens that already own those jobs. Outbound reminders are v2 and
// are deliberately absent rather than stubbed — a "Remind" button that quietly does nothing is
// worse than no button.
//
// It lives under app/admin/seasonals/ so it inherits that layout's `seasonal-theme` wrapper and
// its three fonts. Per the note in globals.css, nothing here contains a hex value: colours arrive
// as theme tokens through the registered utilities (bg-card, text-ink, border-line …).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSeasons } from '../SeasonPicker'
import { seasonLabel } from '@/lib/season'
import { useRole } from '@/lib/use-role'
import { atLeast } from '@/lib/roles'
import { roleForPath } from '@/lib/admin-pages'
import type { CommandCenter, Item, ItemKind, SettledKey } from '@/lib/command-center'

type Payload = CommandCenter & {
  today: string
  parkName: string
  season: { id: string; name: string; year: number }
}

const money = (cents: number) =>
  '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A due date as a person says it — "Oct 11". Locale-formatted, never a hardcoded format. */
function dayLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * How the headline should carry a given percentage.
 *
 * ⚠ THE MOCKUP ASSUMED A HIGH NUMBER, AND THE REAL ONE IS NOT ALWAYS HIGH. Early in a season most
 * contracts are still drafts, so "squared away" can honestly read 2%. Rendering that in the same
 * celebratory green as 95% would be absurd; rendering it in red would be the manufactured urgency
 * this page exists to avoid. So the tone moves with the figure and the wording stays matter-of-
 * fact — reassuring when things are settled, plain when they are not, alarmed never.
 */
function toneFor(percent: number): { ring: string; text: string } {
  if (percent >= 80) return { ring: 'border-good', text: 'text-good' }
  if (percent >= 40) return { ring: 'border-gold', text: 'text-gold-ink' }
  return { ring: 'border-line-strong', text: 'text-ink' }
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// ── THE SIX WAYS OUT ──────────────────────────────────────────────────────────────────────────
// Each names the page that already does the job. `roleForPath` is the same map app/admin/layout
// uses to hide nav the signed-in user cannot open, so a staff-level user is never shown a tile
// that will bounce them at the door.
const NAV: { href: string; title: string; sub: string; accent: string }[] = [
  { href: '/admin/seasonals/campers', title: 'Campers', sub: 'People & records', accent: 'border-l-good bg-good-bg' },
  { href: '/admin/seasonals', title: 'Contracts', sub: 'Fees · send · sign', accent: 'border-l-draft bg-draft-bg' },
  { href: '/admin/electric-billing', title: 'Electric', sub: 'Bills & readings', accent: 'border-l-elec bg-elec-bg' },
  { href: '/admin/seasonals/meters', title: 'Read Meters', sub: 'Start a walk', accent: 'border-l-gold bg-watch-bg' },
  { href: '/admin/addons', title: 'Add-ons', sub: 'Cart · pet · more', accent: 'border-l-plum bg-plum-bg' },
  { href: '/admin/settings', title: 'Settings', sub: 'Packets · rates', accent: 'border-l-muted bg-card-2' },
]

const REPORTS: { href: string; title: string; sub: string }[] = [
  { href: '/admin/reports', title: 'Seasonal revenue', sub: 'By season · site · lane' },
  { href: '/admin/reports', title: 'Outstanding & aging', sub: "Who's behind, how long" },
  { href: '/admin/electric-billing', title: 'Electric usage', sub: 'kWh & $ by site' },
]

const SETTLED_LABEL: Record<SettledKey, string> = {
  contracts: 'Contracts — every one signed',
  waivers: 'Waivers — all signed',
  deposits: 'Deposits — every camper paid',
  installments: 'Instalments — all up to date',
  balances: 'Season balances — none past due',
  electric: 'Electric — everyone settled',
}

/**
 * The copy for one "Worth a look" line.
 *
 * ⚠ EVERY STRING HERE DESCRIBES SOMETHING THAT EXISTS. None of them is phrased as a shortfall
 * ("still needs", "missing"), because the item only renders when its count is above zero — the
 * absence of work is expressed by the line not being here at all, never by a zero or a scold.
 */
function describe(item: Item): { icon: string; tone: string; title: React.ReactNode; detail: string; href: string; cta: string } {
  const n = <span className="tnum">{item.count}</span>
  const amount = <span className="tnum">{money(item.amountCents || 0)}</span>
  const plural = (one: string, many: string) => (item.count === 1 ? one : many)

  const map: Record<ItemKind, { icon: string; tone: string; title: React.ReactNode; detail: string; href: string; cta: string }> = {
    contracts_to_send: {
      icon: '📄', tone: 'bg-draft-bg',
      title: <>{n} {plural('contract is', 'contracts are')} ready to send</>,
      detail: 'Drafted and waiting · send them whenever suits you',
      href: '/admin/seasonals', cta: 'Open',
    },
    awaiting_signature: {
      icon: '✍️', tone: 'bg-draft-bg',
      title: <>{n} {plural('contract is', 'contracts are')} waiting on a signature</>,
      detail: 'Sent, not yet signed',
      href: '/admin/seasonals', cta: 'Open',
    },
    deposits_overdue: {
      icon: '💲', tone: 'bg-watch-bg',
      title: <>{n} {plural('deposit is', 'deposits are')} past their date · {amount}</>,
      detail: item.oldestDaysPastDue ? `Oldest is ${item.oldestDaysPastDue} days` : 'Past the agreed date',
      href: '/admin/seasonals', cta: 'Open',
    },
    deposits_coming_up: {
      icon: '📅', tone: 'bg-good-bg',
      title: <>{n} {plural('deposit is', 'deposits are')} coming up · {amount}</>,
      detail: `Due ${dayLabel(item.dueBy)} · nothing to do yet`,
      href: '/admin/seasonals', cta: 'Open',
    },
    installments_overdue: {
      icon: '💲', tone: 'bg-watch-bg',
      title: <>{n} {plural('instalment is', 'instalments are')} past their date · {amount}</>,
      detail: item.oldestDaysPastDue ? `Oldest is ${item.oldestDaysPastDue} days` : 'Past the agreed date',
      href: '/admin/seasonals', cta: 'Open',
    },
    installments_coming_up: {
      icon: '📅', tone: 'bg-good-bg',
      title: <>{n} {plural('instalment is', 'instalments are')} coming up · {amount}</>,
      detail: `Due ${dayLabel(item.dueBy)} · nothing to do yet`,
      href: '/admin/seasonals', cta: 'Open',
    },
    balance_overdue: {
      icon: '💲', tone: 'bg-watch-bg',
      title: <>{n} season {plural('balance is', 'balances are')} past due · {amount}</>,
      detail: item.oldestDaysPastDue ? `Oldest is ${item.oldestDaysPastDue} days` : 'Past the agreed date',
      href: '/admin/seasonals', cta: 'Open',
    },
    electric_due: {
      icon: '⚡', tone: 'bg-elec-bg',
      title: <>{n} {plural('camper has', 'campers have')} a balance due · {amount}</>,
      detail: 'Electric and everyday charges · these roll forward month to month',
      href: '/admin/electric-billing', cta: 'Review',
    },
    waivers_outstanding: {
      icon: '🖊️', tone: 'bg-plum-bg',
      title: <>{n} {plural('waiver is', 'waivers are')} still to be signed</>,
      detail: 'The packet has gone out · the waiver is the part still open',
      href: '/admin/seasonals', cta: 'Open',
    },
  }
  return map[item.kind]
}

export default function CommandCenterPage() {
  const { seasons, defaultId } = useSeasons()
  // The chosen season, or the picker's default until someone chooses. DERIVED rather than synced
  // into state by an effect: a `setState` in an effect just to mirror another value causes a
  // second render for no gain, and leaves a frame where the two disagree.
  const [chosenSeasonId, setChosenSeasonId] = useState('')
  const seasonId = chosenSeasonId || defaultId
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const { role, roleLoaded } = useRole()

  useEffect(() => {
    let live = true
    const qs = seasonId ? `?season_id=${encodeURIComponent(seasonId)}` : ''
    fetch(`/api/seasonal-command-center${qs}`)
      .then(async r => {
        const d = await r.json()
        if (!live) return
        if (!r.ok) { setErr(d.error || 'Could not load the command center.'); setData(null) }
        else { setData(d as Payload); setErr('') }
      })
      .catch(() => { if (live) setErr('Could not load the command center.') })
    return () => { live = false }
  }, [seasonId])

  // Loading is derived too. Changing season keeps the previous figures on screen until the new
  // ones arrive, which reads as calm rather than as the page blanking and rebuilding itself.
  const loading = data === null && err === ''

  const nav = NAV.filter(n => !roleLoaded || atLeast(role, roleForPath(n.href)))
  const stats = data?.stats
  const squared = data?.squaredAway

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-[1080px] px-6 pt-6 pb-16">

        {/* ── Brand + season ─────────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-[30px] h-[30px] rounded-lg bg-forest text-on-forest grid place-items-center font-display italic font-semibold">
              {(data?.parkName || 'R').trim().charAt(0).toUpperCase() || 'R'}
            </div>
            <div>
              <b className="text-[15px] font-bold">{data?.parkName || 'Seasonal'}</b>{' '}
              <span className="text-muted text-[12.5px]">· Seasonal</span>
            </div>
          </div>
          {seasons.length > 0 && (
            <label className="flex items-center gap-2 bg-card border border-line rounded-full px-4 py-2 text-[13.5px] font-bold">
              <span className="text-muted font-semibold">Season</span>
              <select
                aria-label="Season"
                value={seasonId}
                onChange={e => setChosenSeasonId(e.target.value)}
                className="bg-transparent border-0 font-bold text-ink outline-none cursor-pointer"
              >
                {seasons.map(s => <option key={s.id} value={s.id}>{seasonLabel(s)}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* ── Greeting + the four figures ────────────────────────────────────────────────── */}
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
          <h1 className="font-display font-medium text-[27px]">{greeting()} 🌲</h1>
          {stats && (
            <div className="text-[13px] text-muted">
              <b className="tnum text-ink-soft">{stats.campers}</b> campers ·{' '}
              <b className="tnum text-ink-soft">{stats.sites}</b> seasonal sites ·{' '}
              <b className="tnum text-ink-soft">{stats.contractsSigned}/{stats.contractsTotal}</b> signed ·{' '}
              <b className="tnum text-ink-soft">{money(stats.outstandingCents)}</b> outstanding
            </div>
          )}
        </div>

        {/* ── The six ways out ───────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {nav.map(n => (
            <Link key={n.title} href={n.href}
              className={`block rounded-xl border border-line border-l-[3px] p-3 ${n.accent} hover:brightness-[0.98] transition`}>
              <b className="block text-[13.5px] font-bold text-ink">{n.title}</b>
              <span className="block text-muted text-[11px] mt-0.5">{n.sub}</span>
            </Link>
          ))}
        </div>

        {err && (
          <div className="bg-danger-bg border border-danger text-danger rounded-xl px-4 py-3 text-sm mb-4">{err}</div>
        )}

        {/* ── The calm overview ──────────────────────────────────────────────────────────── */}
        {data && squared && (
          <div className="bg-card border border-line rounded-[18px] shadow-sm px-6 py-5 mb-4">

            <div className="flex items-center gap-3.5 pb-4 border-b border-line-soft">
              <div className={`w-[46px] h-[46px] rounded-full border-4 ${toneFor(squared.percent).ring} ${toneFor(squared.percent).text} grid place-items-center font-extrabold text-[13px] tnum flex-none`}>
                {squared.percent}%
              </div>
              <div>
                <div className={`font-display font-semibold text-[23px] ${toneFor(squared.percent).text}`}>
                  {squared.total === 0
                    ? 'No seasonal campers yet'
                    : squared.count === squared.total
                      ? `All ${squared.total} of your campers are squared away`
                      : `${squared.count} of your ${squared.total} campers ${squared.count === 1 ? 'is' : 'are'} all squared away`}
                </div>
                <div className="text-ink-soft text-[13.5px] mt-0.5">
                  {/* THE CALM STATE. When nothing is outstanding the page says so and stops — it does
                      not go looking for something to list. When things ARE outstanding it stays
                      matter-of-fact: everything below is a record that already exists, so none of
                      this is a demand, and the wording does not pretend otherwise in either
                      direction. */}
                  {data.items.length === 0
                    ? 'Everything on record is settled. Nothing needs you right now — go enjoy the season.'
                    : squared.percent >= 80
                      ? 'The season is mostly running itself. A few things could use a gentle nudge — nothing urgent.'
                      : "Here's where the season stands. Everything below is already drafted or on record — none of it is overdue unless it says so."}
                </div>
              </div>
            </div>

            {data.items.length > 0 && (
              <>
                <div className="text-[13.5px] text-ink-soft font-semibold mt-3.5 mb-0.5">Worth a look</div>
                {data.items.map((item, i) => {
                  const d = describe(item)
                  return (
                    <div key={item.kind}
                      className={`flex items-center gap-3.5 py-3 flex-wrap ${i === 0 ? '' : 'border-t border-line-soft'}`}>
                      <div className={`w-9 h-9 rounded-[11px] grid place-items-center flex-none text-base ${d.tone}`} aria-hidden>
                        {d.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-[14.5px]">{d.title}</div>
                        <div className="text-muted text-[12.5px] mt-0.5">{d.detail}</div>
                      </div>
                      {/* v1: this navigates. It does not send. */}
                      <Link href={d.href}
                        className="flex-none rounded-[10px] border border-line bg-card px-3.5 py-2 text-[12.5px] font-bold text-ink-soft hover:bg-card-2">
                        {d.cta}
                      </Link>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {loading && !data && <div className="text-muted text-sm py-8">Loading…</div>}

        {/* ── Settled + reports ──────────────────────────────────────────────────────────── */}
        {data && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-card border border-line rounded-2xl shadow-sm px-6 py-5">
              <h3 className="font-display font-medium text-lg mb-3">All settled — nothing to do</h3>
              {data.settled.length === 0 ? (
                <p className="text-muted text-[13px]">
                  Nothing to report here yet. As the season&rsquo;s paperwork and payments come in,
                  each part that is fully clear will appear on this list.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.settled.map(k => (
                    <div key={k} className="flex items-center gap-2.5 text-[13px] text-ink-soft">
                      <span className="w-2 h-2 rounded-full bg-good flex-none" aria-hidden />
                      {SETTLED_LABEL[k]}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-card border border-line rounded-2xl shadow-sm px-6 py-5">
              <h3 className="font-display font-medium text-lg mb-3">One-click reports</h3>
              <div className="flex flex-col gap-2.5">
                {REPORTS.filter(r => !roleLoaded || atLeast(role, roleForPath(r.href))).map(r => (
                  <Link key={r.title} href={r.href}
                    className="flex items-center justify-between gap-3 border border-line rounded-xl px-3.5 py-3 bg-card-2 hover:bg-card">
                    <div>
                      <b className="text-[13.5px]">{r.title}</b>
                      <span className="block text-muted text-[11.5px] mt-px">{r.sub}</span>
                    </div>
                    <span className="text-xs font-bold text-forest bg-good-bg border border-good rounded-full px-3 py-1.5 whitespace-nowrap">
                      Run →
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {data && (
          <p className="mt-4 text-[12px] text-muted italic font-display text-center">
            Everything here reflects records that exist right now · nothing is sent from this page
          </p>
        )}
      </div>
    </div>
  )
}
