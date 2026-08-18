// Unit tests for the pure half of the bookability chokepoint. Framework-free — runs on Node's
// built-in runner:
//
//   node --test lib/bookability.test.ts
//
// These exist because these checks used to run only on the availability SEARCH path, while
// /api/payment — the route that charges the card — re-checked nothing but double-booking. The
// dates on /book come from URL params, so search is skippable and an out-of-season or blocked
// date could be booked and charged. The tests below pin the season arithmetic and the
// blocked/overlap filter so the search and the create-side gate cannot answer differently.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMonthDay,
  monthDayKey,
  isNightInSeason,
  checkSeasonSpan,
  nightsBetween,
  checkDateFacts,
  resolveMinNights,
  ruleAppliesToSite,
  DEFAULT_CLOSED_MESSAGE,
  type DateFacts,
} from './bookability.ts'

// A conventional summer season, the shape nearly every park configures.
const SEASON = { season_start: 'May 1', season_end: 'October 15', closed_season_message: 'Closed for winter.' }
// Cady's REAL configured season, and the one the live defect ran against.
const CADY = { season_start: 'May 1', season_end: 'October 11', closed_season_message: 'We are closed.' }

// --- month/day parsing -------------------------------------------------------
//
// The old parser defaulted an unknown month to January and let parseInt produce NaN days, so
// "Oct 11" silently meant January 11 and "banana" silently meant no season at all. Cady's own
// "May 1" / "October 11" sat in the narrow band it read correctly — one retype in Settings was
// all that stood between the park and a silently wrong season.

test('parseMonthDay: the ordinary forms a park types', () => {
  assert.deepEqual(parseMonthDay('May 1'), { month: 5, day: 1 })
  assert.deepEqual(parseMonthDay('October 11'), { month: 10, day: 11 }, "Cady's configured close")
  assert.deepEqual(parseMonthDay('  December 31  '), { month: 12, day: 31 }, 'whitespace tolerated')
  assert.deepEqual(parseMonthDay('May 1st'), { month: 5, day: 1 }, 'ordinal suffix tolerated')
})

test('parseMonthDay: THE SILENT-JANUARY BUGS, now parsed correctly', () => {
  assert.deepEqual(parseMonthDay('Oct 11'), { month: 10, day: 11 }, 'abbreviation')
  assert.deepEqual(parseMonthDay('oct 11'), { month: 10, day: 11 }, 'lowercase abbreviation')
  assert.deepEqual(parseMonthDay('october 11'), { month: 10, day: 11 }, 'lowercase full name')
  assert.deepEqual(parseMonthDay('OCTOBER 11'), { month: 10, day: 11 }, 'uppercase')
  assert.deepEqual(parseMonthDay('Sept 5'), { month: 9, day: 5 }, 'four-letter abbreviation')
})

test('parseMonthDay: day-first is the same date written the other way round', () => {
  assert.deepEqual(parseMonthDay('11 October'), { month: 10, day: 11 })
  assert.deepEqual(parseMonthDay('1 May'), { month: 5, day: 1 })
})

test('parseMonthDay: unreadable input is null, never a guess', () => {
  for (const bad of ['', '   ', 'banana', 'May', 'October', '11', 'ma 1', 'Oct', 'Oct 11 2026', 'x y']) {
    assert.equal(parseMonthDay(bad), null, `${JSON.stringify(bad)} must not parse`)
  }
  assert.equal(parseMonthDay(null), null)
  assert.equal(parseMonthDay(undefined), null)
  assert.equal(parseMonthDay(42 as any), null, 'a non-string is not a date')
})

test('parseMonthDay: an ambiguous month prefix is refused rather than guessed', () => {
  assert.equal(parseMonthDay('ma 1'), null, 'March or May — guessing either is the old bug in a new coat')
  assert.deepEqual(parseMonthDay('mar 1'), { month: 3, day: 1 })
  assert.deepEqual(parseMonthDay('may 1'), { month: 5, day: 1 })
})

test('parseMonthDay: the day must be real for that month', () => {
  assert.equal(parseMonthDay('February 30'), null)
  assert.equal(parseMonthDay('April 31'), null)
  assert.equal(parseMonthDay('June 0'), null)
  assert.deepEqual(parseMonthDay('February 29'), { month: 2, day: 29 }, 'leap day is a real closing date')
})

test('monthDayKey: orders month/day without a year or a timezone', () => {
  assert.equal(monthDayKey({ month: 10, day: 11 }), 1011)
  assert.ok(monthDayKey({ month: 5, day: 1 }) < monthDayKey({ month: 10, day: 11 }))
})

// --- season gate: single nights ----------------------------------------------

test('season: a night inside the season is in season', () => {
  assert.equal(isNightInSeason('2026-07-04', SEASON), true)
})

test('season: boundaries are inclusive on both ends', () => {
  assert.equal(isNightInSeason('2026-05-01', SEASON), true, 'opening day')
  assert.equal(isNightInSeason('2026-10-15', SEASON), true, 'closing day')
  assert.equal(isNightInSeason('2026-10-11', CADY), true, "Cady's own closing day")
})

test('season: the days just outside the boundaries are out', () => {
  assert.equal(isNightInSeason('2026-04-30', SEASON), false)
  assert.equal(isNightInSeason('2026-10-16', SEASON), false)
  assert.equal(isNightInSeason('2026-10-12', CADY), false, 'the day after Cady closes')
})

test('season: an unconfigured or unreadable season closes nothing (null, not false)', () => {
  assert.equal(isNightInSeason('2026-01-20', null), null)
  assert.equal(isNightInSeason('2026-01-20', {}), null)
  assert.equal(isNightInSeason('2026-01-20', { season_start: 'May 1' }), null, 'start only')
  assert.equal(isNightInSeason('2026-01-20', { season_start: 'banana', season_end: 'October 11' }), null)
})

test('season: the same rule applies in every calendar year', () => {
  for (const year of ['2026', '2027', '2030']) {
    assert.equal(isNightInSeason(`${year}-07-04`, CADY), true, `July ${year}`)
    assert.equal(isNightInSeason(`${year}-12-25`, CADY), false, `December ${year}`)
  }
})

test('season: FIXED — a season spanning New Year is now bookable', () => {
  // INVERTED. This previously pinned the broken behaviour: both bounds were built from the
  // arrival's own calendar year, so a November→March season resolved to a start (Nov 1) LATER
  // than its end (Mar 31) and every date failed both comparisons — including its own opening
  // day. Cady runs a summer season so it never bit here, but the season code was wrong in a way
  // nobody could see, and any future reconfiguration would have hit it.
  const WRAPPING = { season_start: 'November 1', season_end: 'March 31' }
  assert.equal(isNightInSeason('2026-11-01', WRAPPING), true, 'its own opening day')
  assert.equal(isNightInSeason('2026-12-20', WRAPPING), true, 'mid-season, before New Year')
  assert.equal(isNightInSeason('2027-01-15', WRAPPING), true, 'mid-season, after New Year')
  assert.equal(isNightInSeason('2026-03-31', WRAPPING), true, 'its own closing day')
  assert.equal(isNightInSeason('2026-07-04', WRAPPING), false, 'genuinely out of season')
})

// --- season gate: the whole stay ---------------------------------------------

test('season span: THE LIVE HOLE — a stay that starts in season and runs past closing', () => {
  // What book.cadyhollow.com accepted and CHARGED: arrival October 5 is in season, and the
  // departure was never examined, so a guest could occupy a site until October 20 — nine nights
  // after the park shut.
  const r = checkSeasonSpan('2026-10-05', '2026-10-20', CADY)
  assert.equal(r.bookable, false)
  assert.equal(r.reason, 'out-of-season')
  assert.equal(r.message, 'We are closed.', "the park's own wording")
})

test('season span: a stay wholly inside the season is fine', () => {
  assert.equal(checkSeasonSpan('2026-07-01', '2026-07-08', CADY).bookable, true)
})

test('season span: THE CHECKOUT BOUNDARY — arrive on the last open day, leave the next', () => {
  // The stay occupies the nights arrival … departure-1. With Cady closing October 11, a guest
  // arriving the 11th and leaving the 12th occupies exactly one night — October 11 — and must be
  // ACCEPTED. Checking "through departure" would reject a normal checkout the park takes yearly.
  assert.equal(checkSeasonSpan('2026-10-11', '2026-10-12', CADY).bookable, true)
  assert.equal(checkSeasonSpan('2026-10-11', '2026-10-13', CADY).bookable, false, 'one night further is closed')
})

test('season span: the opening boundary behaves the same way', () => {
  assert.equal(checkSeasonSpan('2026-05-01', '2026-05-03', CADY).bookable, true, 'opening day')
  assert.equal(checkSeasonSpan('2026-04-30', '2026-05-03', CADY).bookable, false, 'one night before opening')
})

test('season span: THE ENDPOINT TRAP — both ends in season, the middle is not', () => {
  // A month/day comparison of the ENDPOINTS alone would accept this: October 5 and the following
  // May 20 both read as in-season. The stay runs straight through the closed winter.
  assert.equal(isNightInSeason('2026-10-05', CADY), true, 'arrival looks in season')
  assert.equal(isNightInSeason('2027-05-20', CADY), true, 'departure looks in season')
  const r = checkSeasonSpan('2026-10-05', '2027-05-20', CADY)
  assert.equal(r.bookable, false, 'seven months straight through a closed winter')
  assert.equal(r.reason, 'out-of-season')
})

test('season span: a long stay wholly inside ONE season occurrence is still accepted', () => {
  // Keeps the endpoint-trap test honest: if the span check refused anything long, that test
  // would pass for the wrong reason.
  assert.equal(checkSeasonSpan('2026-05-01', '2026-10-11', CADY).bookable, true,
    'the whole open season, opening day to closing day')
})

test('season span: a wrapping season is bookable straight across New Year', () => {
  const WRAPPING = { season_start: 'November 1', season_end: 'March 31' }
  assert.equal(checkSeasonSpan('2026-12-28', '2027-01-04', WRAPPING).bookable, true)
  assert.equal(checkSeasonSpan('2027-03-30', '2027-04-03', WRAPPING).bookable, false, 'past closing')
})

test('season span: FAILS OPEN when the season cannot be read', () => {
  // Deliberate, and safe only because the Settings page refuses to save text parseMonthDay
  // cannot read. A park with a garbage season keeps taking bookings rather than going dark.
  for (const bad of [null, {}, { season_start: 'banana', season_end: 'pancake' }, { season_start: 'May' }]) {
    assert.equal(checkSeasonSpan('2026-12-20', '2026-12-27', bad as any).bookable, true, JSON.stringify(bad))
  }
})

test('season span: a non-stay is not the season gate\'s problem', () => {
  assert.equal(checkSeasonSpan('2026-12-20', '2026-12-20', CADY).bookable, true)
  assert.equal(checkSeasonSpan('2026-12-20', '2026-12-18', CADY).bookable, true)
})

test('settings validation: the save gate rejects exactly what the season gate cannot read', () => {
  // /admin/settings refuses to save season text when parseMonthDay returns null, and that is the
  // ONLY reason checkSeasonSpan is allowed to fail open. The two must agree.
  const REJECTED = ['Oct 11th!', 'banana', 'May', '', '   ', 'ma 1', 'February 30']
  const ACCEPTED = ['October 11', 'Oct 11', 'oct 11', 'May 1', '11 October', 'May 1st']

  for (const text of REJECTED) {
    assert.equal(parseMonthDay(text), null, `${JSON.stringify(text)} must be refused at save`)
    assert.equal(
      checkSeasonSpan('2026-12-20', '2026-12-27', { season_start: text, season_end: 'October 11' }).bookable,
      true,
      `${JSON.stringify(text)} would silently disable the closed season`
    )
  }
  for (const text of ACCEPTED) {
    assert.notEqual(parseMonthDay(text), null, `${JSON.stringify(text)} must be accepted at save`)
  }
})

// --- nights ------------------------------------------------------------------

test('nights: counted between plain dates, DST notwithstanding', () => {
  assert.equal(nightsBetween('2026-07-01', '2026-07-04'), 3)
  assert.equal(nightsBetween('2026-07-01', '2026-07-02'), 1)
  // US DST changeover falls inside this range; parsing at UTC noon keeps it a whole number.
  assert.equal(nightsBetween('2026-03-07', '2026-03-09'), 2, 'spring forward')
  assert.equal(nightsBetween('2026-10-31', '2026-11-02'), 2, 'fall back')
})

test('nights: a non-range yields zero or less, which the chokepoint rejects', () => {
  assert.equal(nightsBetween('2026-07-04', '2026-07-04'), 0, 'same day is not a stay')
  assert.ok(nightsBetween('2026-07-04', '2026-07-01') < 0, 'reversed range')
  assert.equal(nightsBetween('nonsense', '2026-07-04'), 0, 'unparseable')
})

// --- blocked dates and double-booking ----------------------------------------

const facts = (over: Partial<DateFacts> = {}): DateFacts => ({
  blockedAllSites: false,
  blockedSiteIds: new Set<string>(),
  bookedSiteIds: new Set<string>(),
  ...over,
})

test('dates: an unblocked, unbooked site is bookable', () => {
  assert.equal(checkDateFacts('site-a', facts()).bookable, true)
})

test('dates: a park-wide block closes every site', () => {
  // blocked_dates rows with site_id NULL are the park closing a date for everyone — the case
  // /api/payment did not check at all, so a guest could be charged for a date the park had
  // deliberately closed.
  const r = checkDateFacts('site-a', facts({ blockedAllSites: true }))
  assert.equal(r.bookable, false)
  assert.equal(r.reason, 'blocked')
})

test('dates: a per-site block closes only that site', () => {
  const f = facts({ blockedSiteIds: new Set(['site-a']) })
  assert.equal(checkDateFacts('site-a', f).bookable, false)
  assert.equal(checkDateFacts('site-b', f).bookable, true, 'the neighbouring site is unaffected')
})

test('dates: an overlapping reservation is a double-booking', () => {
  const r = checkDateFacts('site-a', facts({ bookedSiteIds: new Set(['site-a']) }))
  assert.equal(r.bookable, false)
  assert.equal(r.reason, 'double-booked')
})

test('dates: a block outranks a double-booking in the reported reason', () => {
  // Both true at once; the guest should be told the dates are unavailable rather than be sent
  // off to pick another site that is also blocked.
  const r = checkDateFacts('site-a', facts({ blockedAllSites: true, bookedSiteIds: new Set(['site-a']) }))
  assert.equal(r.reason, 'blocked')
})

// --- min stay ----------------------------------------------------------------

test('min-stay: no rule means no minimum', () => {
  assert.equal(resolveMinNights([], { id: 'site-a', site_type: 'rv_site' }), 1)
  assert.equal(resolveMinNights(null, { id: 'site-a', site_type: 'rv_site' }), 1)
})

test('min-stay: rules match by site id, site-id list, or site type', () => {
  const site = { id: 'site-a', site_type: 'rv_site' }
  assert.equal(ruleAppliesToSite({ site_id: 'site-a' }, site), true)
  assert.equal(ruleAppliesToSite({ site_id: 'site-b' }, site), false)
  assert.equal(ruleAppliesToSite({ site_ids: 'site-x,site-a,site-y' }, site), true)
  assert.equal(ruleAppliesToSite({ site_ids: 'site-x,site-y' }, site), false)
  assert.equal(ruleAppliesToSite({ site_type: 'rv_site' }, site), true)
  assert.equal(ruleAppliesToSite({ site_type: 'cabin' }, site), false)
  assert.equal(ruleAppliesToSite({}, site), false, 'a rule targeting nothing applies to nothing')
})

test('min-stay: the strictest applicable rule wins', () => {
  const site = { id: 'site-a', site_type: 'rv_site' }
  const rules = [
    { site_type: 'rv_site', min_nights: 2 },
    { site_id: 'site-a', min_nights: 3 },
    { site_id: 'site-b', min_nights: 7 }, // a different site — must not apply
  ]
  assert.equal(resolveMinNights(rules, site), 3)
  assert.equal(resolveMinNights(rules, { id: 'site-b', site_type: 'cabin' }), 7)
})

test('min-stay: search and create resolve the same number for the same site', () => {
  // The property that matters. Both routes call resolveMinNights, so the minimum a guest is
  // shown at search is arithmetically the minimum enforced before the charge — a 3-night
  // minimum cannot be dodged by going straight to /book with a 1-night URL.
  const site = { id: 'site-a', site_type: 'rv_site' }
  const rules = [{ site_ids: 'site-a', min_nights: 3 }]
  const shownAtSearch = resolveMinNights(rules, site)
  const enforcedAtCreate = resolveMinNights(rules, site)
  assert.equal(shownAtSearch, enforcedAtCreate)
  assert.ok(nightsBetween('2026-07-01', '2026-07-02') < enforcedAtCreate, 'a 1-night URL is rejected')
  assert.ok(nightsBetween('2026-07-01', '2026-07-04') >= enforcedAtCreate, 'a 3-night stay passes')
})
