// THE SEASONAL COMMAND CENTER — the rules, with no database and no React in sight.
//
// Everything on that page is decided here: what counts as late, what counts as squared away,
// which lines appear at all. The route feeds it rows and it returns a finished model. That split
// is deliberate — these are the owner's rules, they are the part most likely to be argued about,
// and a pure function is the only version of them that can be tested without a park attached.
//
// ── THE ONE RULE ABOVE ALL OTHERS: THE PAGE NEVER INVENTS WORK ────────────────────────────────
//
// Every number here comes from a record that EXISTS. Nothing is measured against an expectation
// of records that ought to exist. A park with 49 seasonal campers and no contracts drafted is not
// "missing 49 contracts" — it has nothing to send, and the contracts line is simply absent.
//
// This is why every list below is built by filtering real rows and then dropped when it is empty,
// rather than by comparing a count against a roster. There is no code path that can produce
// "you have not created X yet", and that is the point: mid-season, when everything is satisfied,
// this page is supposed to go quiet and say so. The calm is a feature, not an empty state to fill.
//
// ⚠ NO MONEY IS COMPUTED HERE. Balances arrive already worked out by lib/ledger-lanes.ts and
// lib/account-buckets.ts — the same functions the folio and the guest directory use. This module
// only compares figures to due dates. If you find yourself summing a payment in this file, it
// belongs in one of those two instead.

/** ISO calendar date, `YYYY-MM-DD`. Dates here are calendar days, never instants. */
export type Iso = string

/**
 * How far ahead an unpaid obligation is worth mentioning as a heads-up.
 *
 * A parameter with a default rather than a literal buried in a branch, because it is a judgement
 * call a park may reasonably want to move, and because a test needs to pin it. Anything further
 * out than this is simply not mentioned — a payment due in April is not news in September.
 *
 * ⚠ SIXTY DAYS, AND THE VALUE WAS CHOSEN AGAINST REAL DATES. This park's deposit falls due 11 Oct,
 * which is 38 days out at the time of writing — a 30-day window would have hidden precisely the
 * heads-up the page was asked to give. Two months reads as "the next thing coming" without
 * dragging in an April balance.
 *
 * It only ever affects DEPOSITS AND INSTALMENTS. The season balance never gets a coming-up line at
 * all (see buildCommandCenter), so widening this cannot put a distant balance on screen.
 */
export const COMING_UP_WINDOW_DAYS = 60

// ── DATES ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A `YYYY-MM-DD` string as a UTC day number.
 *
 * Parsed by hand rather than with `new Date(s)`, which reads a bare date as UTC midnight but a
 * date-time as local — the classic way a due date lands a day early for anyone west of Greenwich.
 * Comparing whole days in UTC keeps "is it past its date" the same answer everywhere.
 */
function dayNumber(iso: Iso): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '').trim())
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : Math.floor(t / 86400000)
}

/** Whole days from `from` to `to`; negative when `to` is in the past. Null on an unparseable date. */
export function daysBetween(from: Iso, to: Iso): number | null {
  const a = dayNumber(from)
  const b = dayNumber(to)
  return a === null || b === null ? null : b - a
}

/**
 * Where a due date sits relative to today.
 *
 * ⚠ `overdue` REQUIRES THE DATE TO HAVE PASSED. Due *today* is not late — it is due today, and a
 * camper who pays this afternoon was never behind. This is the owner's rule stated exactly:
 * nothing is "behind" before its date.
 */
export type DueState = 'overdue' | 'coming_up' | 'later'

export function dueState(
  dueBy: Iso | null | undefined,
  today: Iso,
  windowDays: number = COMING_UP_WINDOW_DAYS,
): DueState | null {
  if (!dueBy) return null
  const days = daysBetween(today, dueBy)
  if (days === null) return null
  if (days < 0) return 'overdue'
  return days <= windowDays ? 'coming_up' : 'later'
}

// ── INPUTS ────────────────────────────────────────────────────────────────────────────────────

/** One row of a contract's `payment_schedule` jsonb: an amount in cents and the day it is due. */
export type ScheduleEntry = { amount: number; due_by: Iso | null }

/**
 * Read a contract's `payment_schedule`.
 *
 * ⚠ DEFENSIVE ON PURPOSE. This is free-shaped jsonb: it may be absent, null, `[]`, an object
 * instead of an array, or carry rows with a missing amount or date. Every one of those is a park
 * that simply has no instalments, never an exception on a landing page. Cady's is `[]` today — so
 * this returns nothing here and the instalment lines stay silent, which is exactly right — but
 * other parks add mid-season payments this way, which is why it is built rather than skipped.
 */
export function parseSchedule(value: unknown): ScheduleEntry[] {
  if (!Array.isArray(value)) return []
  const out: ScheduleEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const amount = Number(r.amount)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const dueRaw = r.due_by
    const due_by = typeof dueRaw === 'string' && dueRaw.trim() ? dueRaw.trim().slice(0, 10) : null
    out.push({ amount: Math.round(amount), due_by })
  }
  return out
}

/**
 * A season contract, as much of it as the rules need.
 *
 * Every field past the ids is optional, because a park that has not run one of the seasonal
 * migrations genuinely does not have that column. A missing field means "this park does not track
 * that", which reads as nothing to show — never as an unmet obligation.
 */
export type ContractInput = {
  id: string
  guest_id: string
  status?: string | null
  sent_at?: string | null
  signed_at?: string | null
  waiver_signature_id?: string | null
  deposit_due_cents?: number | null
  deposit_due_by?: Iso | null
  total_due_cents?: number | null
  total_due_by?: Iso | null
  payment_schedule?: unknown
}

/**
 * A seasonal camper with their money already totalled.
 *
 * ⚠ THESE FOUR FIGURES ARE NOT COMPUTED HERE. They come from laneBalances() and
 * campFromAccount() in the route — the same library the folio uses — so this module cannot
 * invent a second answer to "what do they owe".
 */
export type CamperInput = {
  id: string
  name: string
  site_number?: string | null
  /** Whole-account balance, cents. Positive means they owe. */
  accountBalance: number
  /** The Seasonal bucket's balance, cents. */
  seasonalBalance: number
  /** Net payments tagged to the seasonal lane, cents. What a deposit is measured against. */
  seasonalPaid: number
  /** The everyday / Camp balance, cents — the electric figure. */
  campBalance: number
}

/** Is this waiver signed? `null` = the camper has no waiver record, which is NOT an obligation. */
export type WaiverState = 'signed' | 'unsigned' | null

export type BuildInput = {
  today: Iso
  campers: CamperInput[]
  /** Count of seasonal sites. A park property, not a camper-derived figure, so it is passed in. */
  seasonalSites: number
  /** Contracts for the SELECTED season only. A camper may have none. */
  contracts: ContractInput[]
  /** Waiver state per contract id. Absent id = no waiver record exists — see WaiverState. */
  waiverByContractId: Record<string, WaiverState>
  comingUpWindowDays?: number
}

// ── OBLIGATIONS ───────────────────────────────────────────────────────────────────────────────

export type ObligationKind = 'deposit' | 'installment' | 'balance'

export type Obligation = {
  kind: ObligationKind
  amountCents: number
  dueBy: Iso | null
  paid: boolean
  state: DueState | null
}

/**
 * Every scheduled seasonal obligation on one contract, and whether it has been met.
 *
 * ── HOW "PAID" IS DECIDED, AND WHY IT IS A WATERFALL ──────────────────────────────────────────
 *
 * Seasonal payments do not carry a note saying which instalment they were for — there is one
 * tagged total per camper. So obligations are settled in DUE-DATE ORDER: sort them, run a running
 * total, and an obligation is met once the seasonal money received covers everything up to and
 * including it. The deposit is normally first, which reproduces the owner's simpler rule ("paid =
 * seasonal payments ≥ deposit_due_cents") exactly, and extends it honestly to instalments.
 *
 * Any other rule would have to guess which payment settled what, and guessing would let a camper
 * who is genuinely behind on instalment one look current because they overpaid instalment two.
 *
 * ⚠ THE BALANCE IS DELIBERATELY NOT IN THE WATERFALL. It is the whole season's total, not another
 * slice of it, so counting it in a running sum would double-count the deposit and instalments
 * inside it. It is met when the camper's seasonal balance is settled — see below.
 */
export function obligationsFor(
  contract: ContractInput,
  camper: Pick<CamperInput, 'seasonalPaid' | 'seasonalBalance'>,
  today: Iso,
  windowDays: number = COMING_UP_WINDOW_DAYS,
): Obligation[] {
  const scheduled: { kind: ObligationKind; amountCents: number; dueBy: Iso | null }[] = []

  const deposit = Number(contract.deposit_due_cents || 0)
  if (deposit > 0) {
    scheduled.push({ kind: 'deposit', amountCents: deposit, dueBy: contract.deposit_due_by || null })
  }
  for (const entry of parseSchedule(contract.payment_schedule)) {
    scheduled.push({ kind: 'installment', amountCents: entry.amount, dueBy: entry.due_by })
  }

  // Due-date order; an obligation with no date sorts last, since nothing can be late without one.
  scheduled.sort((a, b) => {
    if (a.dueBy === b.dueBy) return 0
    if (!a.dueBy) return 1
    if (!b.dueBy) return -1
    return a.dueBy < b.dueBy ? -1 : 1
  })

  const out: Obligation[] = []
  let running = 0
  for (const s of scheduled) {
    running += s.amountCents
    out.push({
      ...s,
      paid: camper.seasonalPaid >= running,
      state: dueState(s.dueBy, today, windowDays),
    })
  }

  // The season balance. "Paid in full" is the seasonal bucket being settled (≤ 0 — a credit counts
  // as settled), which is the same test the folio's Seasonal card applies.
  const total = Number(contract.total_due_cents || 0)
  if (total > 0 || contract.total_due_by) {
    out.push({
      kind: 'balance',
      amountCents: total,
      dueBy: contract.total_due_by || null,
      paid: camper.seasonalBalance <= 0,
      state: dueState(contract.total_due_by, today, windowDays),
    })
  }

  return out
}

/** An obligation that needs attention TODAY: past its date and still unpaid. */
export const isBehind = (o: Obligation) => o.state === 'overdue' && !o.paid

/** An unpaid obligation whose date is near — a heads-up, never a reproach. */
export const isComingUp = (o: Obligation) => o.state === 'coming_up' && !o.paid

// ── THE MODEL ─────────────────────────────────────────────────────────────────────────────────

export type ItemKind =
  | 'contracts_to_send'
  | 'awaiting_signature'
  | 'deposits_overdue'
  | 'deposits_coming_up'
  | 'installments_overdue'
  | 'installments_coming_up'
  | 'balance_overdue'
  | 'electric_due'
  | 'waivers_outstanding'

/**
 * One line of "Worth a look".
 *
 * ⚠ AN ITEM WITH count 0 IS NEVER BUILT. Emptiness is expressed by the item's absence from the
 * list, not by a zero on the screen — a row reading "0 contracts to send" is exactly the invented
 * nag this page exists to avoid.
 */
export type Item = {
  kind: ItemKind
  count: number
  /** Money at stake, cents. Omitted where the line is not about money. */
  amountCents?: number
  /** The soonest date involved — "coming up Oct 11". */
  dueBy?: Iso | null
  /** Days past due on the oldest overdue thing in this line — "oldest is 22 days". */
  oldestDaysPastDue?: number | null
}

/** A category with records that are ALL clear right now. */
export type SettledKey = 'contracts' | 'waivers' | 'deposits' | 'installments' | 'balances' | 'electric'

export type CommandCenter = {
  stats: {
    campers: number
    sites: number
    contractsSigned: number
    contractsTotal: number
    outstandingCents: number
  }
  squaredAway: { count: number; total: number; percent: number }
  /** Only lines that have something in them. Empty array = a genuinely quiet park. */
  items: Item[]
  settled: SettledKey[]
}

/**
 * Is this camper squared away — is there nothing that needs them today?
 *
 * ⚠ A FUTURE OBLIGATION DOES NOT COUNT AGAINST THEM. A camper who owes their April balance in
 * September is on track, not outstanding, and this page must not imply otherwise. Only something
 * past its date and unpaid counts.
 *
 * ⚠ AND NEITHER DOES A RECORD THAT DOES NOT EXIST. No contract for this season means nothing has
 * been asked of them yet, so there is nothing to be behind on; no waiver record means no waiver
 * was requested. Both read as settled. Counting them as problems would be the page inventing work
 * for a camper nobody has enrolled — the one thing it must never do.
 */
export function isSquaredAway(
  camper: CamperInput,
  contract: ContractInput | undefined,
  waiver: WaiverState,
  today: Iso,
  windowDays: number = COMING_UP_WINDOW_DAYS,
): boolean {
  // Everyday money is due-or-settled, never late: electric rolls forward month to month.
  if (camper.campBalance > 0) return false
  if (waiver === 'unsigned') return false
  if (!contract) return true
  if (!contract.signed_at) return false
  return !obligationsFor(contract, camper, today, windowDays).some(isBehind)
}

/** Build the whole page model. Pure: same inputs, same output, no clock and no network. */
export function buildCommandCenter(input: BuildInput): CommandCenter {
  const { today, campers, contracts, waiverByContractId, seasonalSites } = input
  const windowDays = input.comingUpWindowDays ?? COMING_UP_WINDOW_DAYS

  const contractByGuest = new Map<string, ContractInput>()
  for (const c of contracts) if (!contractByGuest.has(c.guest_id)) contractByGuest.set(c.guest_id, c)

  // ── Header stats ────────────────────────────────────────────────────────────────────────────
  // Signed / total is measured against contracts that EXIST, never against the camper roster —
  // "40 of 49" when only 3 contracts have been drafted would be inventing 46 of them.
  const contractsSigned = contracts.filter(c => !!c.signed_at).length
  // Only what is actually owed. A camper in credit does not quietly cancel out another's debt,
  // which would understate the money the park is waiting on.
  const outstandingCents = campers.reduce((sum, c) => sum + Math.max(0, c.accountBalance), 0)

  // ── Worth a look ────────────────────────────────────────────────────────────────────────────
  const items: Item[] = []
  const push = (item: Item) => { if (item.count > 0) items.push(item) }

  const toSend = contracts.filter(c => !c.sent_at)
  push({ kind: 'contracts_to_send', count: toSend.length })

  const awaiting = contracts.filter(c => !!c.sent_at && !c.signed_at)
  push({ kind: 'awaiting_signature', count: awaiting.length })

  // Gather every obligation across every camper once, then slice it.
  type Held = { obligation: Obligation; camper: CamperInput }
  const held: Held[] = []
  for (const camper of campers) {
    const contract = contractByGuest.get(camper.id)
    if (!contract) continue
    for (const obligation of obligationsFor(contract, camper, today, windowDays)) {
      held.push({ obligation, camper })
    }
  }

  const summarise = (kind: ItemKind, rows: Held[], overdue: boolean): Item => {
    const amountCents = rows.reduce((s, r) => s + r.obligation.amountCents, 0)
    const dates = rows.map(r => r.obligation.dueBy).filter((d): d is Iso => !!d).sort()
    const oldest = overdue && dates.length ? daysBetween(dates[0], today) : null
    return {
      kind,
      count: rows.length,
      amountCents,
      dueBy: dates.length ? dates[0] : null,
      oldestDaysPastDue: oldest,
    }
  }

  const of = (kind: ObligationKind, pred: (o: Obligation) => boolean) =>
    held.filter(h => h.obligation.kind === kind && pred(h.obligation))

  push(summarise('deposits_overdue', of('deposit', isBehind), true))
  push(summarise('deposits_coming_up', of('deposit', isComingUp), false))
  push(summarise('installments_overdue', of('installment', isBehind), true))
  push(summarise('installments_coming_up', of('installment', isComingUp), false))
  // The season balance gets an overdue line only. A balance due next April is not news today, and
  // a "coming up" for it would be on screen for months — the definition of manufactured urgency.
  push(summarise('balance_overdue', of('balance', isBehind), true))

  // Electric / everyday money: due or settled. Never late — it rolls forward month to month.
  const electric = campers.filter(c => c.campBalance > 0)
  push({
    kind: 'electric_due',
    count: electric.length,
    amountCents: electric.reduce((s, c) => s + c.campBalance, 0),
  })

  // Waivers: only contracts that HAVE a waiver record which is unsigned. A contract with no waiver
  // record has had no waiver asked of it, so it is not outstanding — see WaiverState.
  const waiversOutstanding = contracts.filter(c => waiverByContractId[c.id] === 'unsigned')
  push({ kind: 'waivers_outstanding', count: waiversOutstanding.length })

  // ── Squared away ────────────────────────────────────────────────────────────────────────────
  const squared = campers.filter(c =>
    isSquaredAway(c, contractByGuest.get(c.id), waiverByContractId[contractByGuest.get(c.id)?.id ?? ''] ?? null, today, windowDays),
  ).length
  const percent = campers.length ? Math.round((squared / campers.length) * 100) : 100

  // ── All settled ─────────────────────────────────────────────────────────────────────────────
  // A category appears ONLY when it has records AND every one of them is clear. With no records
  // there is nothing to have settled, and claiming otherwise would be as invented as a false nag.
  const settled: SettledKey[] = []
  const allClear = (hasRecords: boolean, outstanding: number) => hasRecords && outstanding === 0

  if (allClear(contracts.length > 0, contracts.length - contractsSigned)) settled.push('contracts')

  const waiverStates = contracts.map(c => waiverByContractId[c.id]).filter((w): w is 'signed' | 'unsigned' => !!w)
  if (allClear(waiverStates.length > 0, waiverStates.filter(w => w === 'unsigned').length)) settled.push('waivers')

  const deposits = held.filter(h => h.obligation.kind === 'deposit')
  if (allClear(deposits.length > 0, deposits.filter(h => !h.obligation.paid).length)) settled.push('deposits')

  const installments = held.filter(h => h.obligation.kind === 'installment')
  if (allClear(installments.length > 0, installments.filter(h => !h.obligation.paid).length)) settled.push('installments')

  const balances = held.filter(h => h.obligation.kind === 'balance')
  if (allClear(balances.length > 0, balances.filter(h => isBehind(h.obligation)).length)) settled.push('balances')

  if (allClear(campers.length > 0, electric.length)) settled.push('electric')

  return {
    stats: {
      campers: campers.length,
      sites: seasonalSites,
      contractsSigned,
      contractsTotal: contracts.length,
      outstandingCents,
    },
    squaredAway: { count: squared, total: campers.length, percent },
    items,
    settled,
  }
}
