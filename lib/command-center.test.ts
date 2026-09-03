// The Seasonal Command Center's rules, pinned.
//
// These are the owner's definitions, and they are the part of this feature most likely to be
// argued about later, so each one is a named test rather than a comment. The most important
// group is THE CALM CONTRACT at the bottom: the page must never imply work that does not exist.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCommandCenter,
  obligationsFor,
  isSquaredAway,
  parseSchedule,
  dueState,
  daysBetween,
  COMING_UP_WINDOW_DAYS,
  type CamperInput,
  type ContractInput,
} from './command-center.ts'

const TODAY = '2026-09-03'

const camper = (over: Partial<CamperInput> = {}): CamperInput => ({
  id: 'g1', name: 'A Camper', site_number: '12',
  accountBalance: 0, seasonalBalance: 0, seasonalPaid: 0, campBalance: 0,
  ...over,
})

const contract = (over: Partial<ContractInput> = {}): ContractInput => ({
  id: 'c1', guest_id: 'g1', ...over,
})

const build = (over: Partial<Parameters<typeof buildCommandCenter>[0]> = {}) =>
  buildCommandCenter({
    today: TODAY, campers: [], seasonalSites: 0, contracts: [], waiverByContractId: {}, ...over,
  })

const item = (m: ReturnType<typeof buildCommandCenter>, kind: string) =>
  m.items.find(i => i.kind === kind)

// ── DATES ─────────────────────────────────────────────────────────────────────────────────────

test('daysBetween counts whole calendar days and goes negative for the past', () => {
  assert.equal(daysBetween('2026-09-03', '2026-09-13'), 10)
  assert.equal(daysBetween('2026-09-03', '2026-09-03'), 0)
  assert.equal(daysBetween('2026-09-03', '2026-08-12'), -22)
  assert.equal(daysBetween('2026-09-03', 'not-a-date'), null)
})

test('a date is only overdue once it has PASSED — due today is not late', () => {
  assert.equal(dueState(TODAY, TODAY), 'coming_up', 'due today is a heads-up, never a reproach')
  assert.equal(dueState('2026-09-02', TODAY), 'overdue')
  assert.equal(dueState('2026-09-04', TODAY), 'coming_up')
})

test('a date beyond the window is simply not mentioned', () => {
  assert.equal(dueState('2027-04-30', TODAY), 'later')
  assert.equal(dueState('2026-10-03', TODAY, 30), 'coming_up', 'exactly on the window edge')
  assert.equal(dueState('2026-10-04', TODAY, 30), 'later')
  assert.equal(dueState(null, TODAY), null)
  // The window is a parameter (asserted explicitly above with 30); the DEFAULT is 60 days, chosen
  // so this park's 11 Oct deposit — 38 days out — is surfaced rather than hidden.
  assert.equal(COMING_UP_WINDOW_DAYS, 60)
  assert.equal(dueState('2026-10-11', TODAY), 'coming_up', "this park's deposit, 38 days out")
  assert.equal(dueState('2026-11-02', TODAY), 'coming_up', 'the 60-day edge')
  assert.equal(dueState('2026-11-03', TODAY), 'later')
})

// ── PAYMENT SCHEDULE (jsonb, free-shaped) ─────────────────────────────────────────────────────

test('parseSchedule survives every shape a park can leave in the column', () => {
  assert.deepEqual(parseSchedule([]), [], "Cady's empty array")
  assert.deepEqual(parseSchedule(null), [])
  assert.deepEqual(parseSchedule(undefined), [])
  assert.deepEqual(parseSchedule({ amount: 100 }), [], 'an object, not an array')
  assert.deepEqual(parseSchedule('nonsense'), [])
  assert.deepEqual(parseSchedule([null, 3, { nope: 1 }, { amount: 0 }, { amount: -5 }]), [])
  assert.deepEqual(
    parseSchedule([{ amount: 25000, due_by: '2026-11-01' }, { amount: 25000 }]),
    [{ amount: 25000, due_by: '2026-11-01' }, { amount: 25000, due_by: null }],
  )
})

// ── OBLIGATIONS ───────────────────────────────────────────────────────────────────────────────

test('a deposit is paid once seasonal payments cover it', () => {
  const c = contract({ deposit_due_cents: 37500, deposit_due_by: '2026-10-11' })
  const unpaid = obligationsFor(c, { seasonalPaid: 0, seasonalBalance: 120000 }, TODAY)
  assert.equal(unpaid[0].paid, false)
  const paid = obligationsFor(c, { seasonalPaid: 37500, seasonalBalance: 82500 }, TODAY)
  assert.equal(paid[0].paid, true, 'exactly the deposit counts as paid')
})

test('instalments settle in due-date order, so an overpaid later one cannot mask an early miss', () => {
  const c = contract({
    payment_schedule: [
      { amount: 20000, due_by: '2026-12-01' },
      { amount: 20000, due_by: '2026-10-01' },
    ],
  })
  // Enough money for one instalment. It must settle the OCTOBER one (earlier), not December.
  const obs = obligationsFor(c, { seasonalPaid: 20000, seasonalBalance: 20000 }, TODAY)
  const oct = obs.find(o => o.dueBy === '2026-10-01')!
  const dec = obs.find(o => o.dueBy === '2026-12-01')!
  assert.equal(oct.paid, true)
  assert.equal(dec.paid, false)
})

test('the deposit comes first in the waterfall, so instalments follow it', () => {
  const c = contract({
    deposit_due_cents: 10000, deposit_due_by: '2026-09-01',
    payment_schedule: [{ amount: 10000, due_by: '2026-10-01' }],
  })
  const obs = obligationsFor(c, { seasonalPaid: 10000, seasonalBalance: 10000 }, TODAY)
  assert.equal(obs.find(o => o.kind === 'deposit')!.paid, true)
  assert.equal(obs.find(o => o.kind === 'installment')!.paid, false)
})

test('the season balance is settled by the seasonal bucket, not by the waterfall', () => {
  const c = contract({ total_due_cents: 120000, total_due_by: '2027-04-30' })
  const owing = obligationsFor(c, { seasonalPaid: 0, seasonalBalance: 120000 }, TODAY)
  assert.equal(owing[0].paid, false)
  assert.equal(owing[0].state, 'later', 'April is not news in September')
  const settled = obligationsFor(c, { seasonalPaid: 120000, seasonalBalance: 0 }, TODAY)
  assert.equal(settled[0].paid, true)
  const credit = obligationsFor(c, { seasonalPaid: 130000, seasonalBalance: -10000 }, TODAY)
  assert.equal(credit[0].paid, true, 'a credit counts as settled')
})

// ── SQUARED AWAY ──────────────────────────────────────────────────────────────────────────────

test('a future obligation does NOT count against squared away', () => {
  const c = contract({ signed_at: '2026-08-01', total_due_cents: 120000, total_due_by: '2027-04-30' })
  const g = camper({ accountBalance: 120000, seasonalBalance: 120000 })
  assert.equal(isSquaredAway(g, c, 'signed', TODAY), true, 'owes April, but is on track today')
})

test('an obligation past its date and unpaid DOES count against squared away', () => {
  const c = contract({ signed_at: '2026-08-01', deposit_due_cents: 37500, deposit_due_by: '2026-08-01' })
  const g = camper({ accountBalance: 37500, seasonalBalance: 37500 })
  assert.equal(isSquaredAway(g, c, 'signed', TODAY), false)
})

test('an unsigned contract, an electric balance or an unsigned waiver each break squared away', () => {
  const signed = contract({ signed_at: '2026-08-01' })
  assert.equal(isSquaredAway(camper(), contract({ sent_at: '2026-08-01' }), 'signed', TODAY), false)
  assert.equal(isSquaredAway(camper({ campBalance: 4200, accountBalance: 4200 }), signed, 'signed', TODAY), false)
  assert.equal(isSquaredAway(camper(), signed, 'unsigned', TODAY), false)
  assert.equal(isSquaredAway(camper(), signed, 'signed', TODAY), true)
})

test('a camper with NO contract is squared away — nothing has been asked of them', () => {
  assert.equal(isSquaredAway(camper(), undefined, null, TODAY), true)
})

test('an electric CREDIT is settled, not an obligation', () => {
  const g = camper({ campBalance: -2500, accountBalance: -2500 })
  assert.equal(isSquaredAway(g, contract({ signed_at: 'x' }), 'signed', TODAY), true)
})

// ── THE CALM CONTRACT — the rules this page exists to honour ──────────────────────────────────

test('CALM: an empty park produces no items at all', () => {
  const m = build()
  assert.deepEqual(m.items, [])
  assert.deepEqual(m.settled, [])
  assert.equal(m.squaredAway.percent, 100)
})

test('CALM: campers with no contracts never produce a "contracts missing" item', () => {
  const campers = Array.from({ length: 49 }, (_, i) => camper({ id: 'g' + i }))
  const m = build({ campers, seasonalSites: 52 })
  assert.deepEqual(m.items, [], 'no contracts exist, so there is nothing to send and nothing to sign')
  assert.equal(m.stats.contractsTotal, 0)
  assert.equal(m.stats.contractsSigned, 0)
  assert.equal(m.squaredAway.count, 49, 'nobody is behind on something nobody created')
  assert.equal(m.squaredAway.percent, 100)
})

test('CALM: signed/total is measured against contracts that exist, not against the roster', () => {
  const campers = Array.from({ length: 49 }, (_, i) => camper({ id: 'g' + i }))
  const contracts = [contract({ id: 'c1', guest_id: 'g0', signed_at: 'x', sent_at: 'x' })]
  const m = build({ campers, contracts, waiverByContractId: {} })
  assert.equal(m.stats.contractsTotal, 1, 'never 49')
  assert.equal(m.stats.contractsSigned, 1)
})

test('CALM: every item disappears at zero rather than showing a 0', () => {
  const m = build({
    campers: [camper()],
    contracts: [contract({ sent_at: 'x', signed_at: 'x' })],
    waiverByContractId: { c1: 'signed' },
  })
  for (const i of m.items) assert.ok(i.count > 0, `item ${i.kind} was built with count 0`)
  assert.equal(item(m, 'contracts_to_send'), undefined)
  assert.equal(item(m, 'awaiting_signature'), undefined)
  assert.equal(item(m, 'electric_due'), undefined)
})

test('CALM: a mid-summer park with everything satisfied is silent and fully settled', () => {
  const campers = [camper({ id: 'g1' }), camper({ id: 'g2' })]
  const contracts = [
    contract({ id: 'c1', guest_id: 'g1', sent_at: 'x', signed_at: 'x', deposit_due_cents: 100, deposit_due_by: '2026-05-01' }),
    contract({ id: 'c2', guest_id: 'g2', sent_at: 'x', signed_at: 'x', deposit_due_cents: 100, deposit_due_by: '2026-05-01' }),
  ]
  campers[0].seasonalPaid = 100
  campers[1].seasonalPaid = 100
  const m = build({ campers, contracts, waiverByContractId: { c1: 'signed', c2: 'signed' } })
  assert.deepEqual(m.items, [], 'nothing worth a look')
  assert.equal(m.squaredAway.count, 2)
  assert.deepEqual(m.settled.sort(), ['contracts', 'deposits', 'electric', 'waivers'])
})

test('CALM: a waiver that was never requested is not outstanding and does not block squared away', () => {
  const m = build({
    campers: [camper()],
    contracts: [contract({ sent_at: 'x', signed_at: 'x' })],
    waiverByContractId: {}, // no waiver record at all
  })
  assert.equal(item(m, 'waivers_outstanding'), undefined)
  assert.equal(m.squaredAway.count, 1)
  assert.ok(!m.settled.includes('waivers'), 'with no waiver records there is nothing to call settled')
})

test('CALM: "all settled" never claims a category that has no records', () => {
  const m = build({ campers: [camper()], contracts: [], waiverByContractId: {} })
  assert.ok(!m.settled.includes('contracts'))
  assert.ok(!m.settled.includes('deposits'))
  assert.ok(!m.settled.includes('installments'))
  assert.ok(!m.settled.includes('balances'))
  assert.ok(m.settled.includes('electric'), 'electric is real for every camper: theirs is $0')
})

// ── THE ITEMS ─────────────────────────────────────────────────────────────────────────────────

test('electric reports a balance due and never a lateness', () => {
  const m = build({ campers: [camper({ campBalance: 4200, accountBalance: 4200 }), camper({ id: 'g2' })] })
  const e = item(m, 'electric_due')!
  assert.equal(e.count, 1)
  assert.equal(e.amountCents, 4200)
  assert.equal(e.oldestDaysPastDue, undefined, 'electric rolls forward; it carries no lateness at all')
})

test('outstanding sums only what is owed — a credit does not cancel another camper out', () => {
  const m = build({ campers: [camper({ accountBalance: 10000 }), camper({ id: 'g2', accountBalance: -5000 })] })
  assert.equal(m.stats.outstandingCents, 10000)
})

test('an overdue line reports the oldest age; a coming-up line reports the date', () => {
  const campers = [camper({ id: 'g1' }), camper({ id: 'g2' })]
  const contracts = [
    contract({ id: 'c1', guest_id: 'g1', signed_at: 'x', deposit_due_cents: 500, deposit_due_by: '2026-08-12' }),
    contract({ id: 'c2', guest_id: 'g2', signed_at: 'x', deposit_due_cents: 700, deposit_due_by: '2026-09-20' }),
  ]
  const m = build({ campers, contracts })
  const overdue = item(m, 'deposits_overdue')!
  assert.equal(overdue.count, 1)
  assert.equal(overdue.amountCents, 500)
  assert.equal(overdue.oldestDaysPastDue, 22, 'days PAST due, counted forward from 2026-08-12')
  const soon = item(m, 'deposits_coming_up')!
  assert.equal(soon.count, 1)
  assert.equal(soon.dueBy, '2026-09-20')
})

test('the season balance gets an overdue line but never a coming-up one', () => {
  const m = build({
    campers: [camper({ id: 'g1', seasonalBalance: 5000 })],
    contracts: [contract({ guest_id: 'g1', signed_at: 'x', total_due_cents: 5000, total_due_by: '2026-09-10' })],
  })
  assert.equal(item(m, 'balance_overdue'), undefined, 'due in a week — not overdue, and no nag')
  const late = build({
    campers: [camper({ id: 'g1', seasonalBalance: 5000 })],
    contracts: [contract({ guest_id: 'g1', signed_at: 'x', total_due_cents: 5000, total_due_by: '2026-08-10' })],
  })
  assert.equal(item(late, 'balance_overdue')!.count, 1)
})

test('instalments are built even though this park has none — the lines appear when a park uses them', () => {
  const m = build({
    campers: [camper({ id: 'g1' })],
    contracts: [contract({
      guest_id: 'g1', signed_at: 'x',
      payment_schedule: [{ amount: 25000, due_by: '2026-08-01' }, { amount: 25000, due_by: '2026-09-15' }],
    })],
  })
  assert.equal(item(m, 'installments_overdue')!.count, 1)
  assert.equal(item(m, 'installments_coming_up')!.count, 1)
})

// ── THE PARK AS IT STANDS TODAY ───────────────────────────────────────────────────────────────

test("today's live shape: 47 to send, 2 awaiting, deposit coming up, balance and instalments silent", () => {
  // 49 seasonal campers, 50 contracts across two seasons — the 2027 season holds 49 of them.
  const campers = Array.from({ length: 49 }, (_, i) => camper({ id: 'g' + i }))
  const contracts: ContractInput[] = Array.from({ length: 49 }, (_, i) => contract({
    id: 'c' + i,
    guest_id: 'g' + i,
    // 47 drafted-not-sent, 2 sent-unsigned.
    sent_at: i < 2 ? '2026-08-20' : null,
    signed_at: null,
    // Two carry the park's $375 deposit due 11 Oct, and a balance due 30 Apr 2027.
    ...(i < 2
      ? { deposit_due_cents: 37500, deposit_due_by: '2026-10-11', total_due_cents: 120000, total_due_by: '2027-04-30' }
      : {}),
    payment_schedule: [],
  }))
  const m = build({
    campers, contracts, seasonalSites: 52,
    waiverByContractId: { c0: 'unsigned', c1: 'unsigned' },
  })

  assert.equal(m.stats.campers, 49)
  assert.equal(m.stats.sites, 52)
  assert.equal(m.stats.contractsTotal, 49)
  assert.equal(m.stats.contractsSigned, 0)
  assert.equal(item(m, 'contracts_to_send')!.count, 47)
  assert.equal(item(m, 'awaiting_signature')!.count, 2)
  // The deposit is a gentle heads-up, not a nag — 11 Oct has not arrived.
  assert.equal(item(m, 'deposits_overdue'), undefined)
  assert.equal(item(m, 'deposits_coming_up')!.dueBy, '2026-10-11')
  // April 2027 is far away, and there are no instalments here.
  assert.equal(item(m, 'balance_overdue'), undefined)
  assert.equal(item(m, 'installments_overdue'), undefined)
  assert.equal(item(m, 'installments_coming_up'), undefined)
  assert.equal(item(m, 'waivers_outstanding')!.count, 2)
  assert.equal(item(m, 'electric_due'), undefined, 'every camper is $0 today')
  assert.ok(m.settled.includes('electric'))
})
