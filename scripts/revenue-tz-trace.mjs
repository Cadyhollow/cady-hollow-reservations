// Deterministic trace for the revenue timezone + source fix (app/admin/reports + transactions).
// Run from repo root, forcing Eastern so the assertion is machine-independent:
//   TZ=America/New_York node scripts/revenue-tz-trace.mjs
//
// Reimplements the PURE date helpers from lib/transactions.ts (ymd / dayStartUTC / dayEndUTC)
// verbatim — the app module can't be imported here (it pulls in the browser supabase client).
// These are trivial pure date functions; keep them identical to lib/transactions.ts.

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayStartUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString() }
const dayEndUTC   = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString() }

let pass = true
const check = (name, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${extra ? '   ' + extra : ''}`); if (!cond) pass = false }

console.log(`TZ = ${process.env.TZ || '(system default — rerun with TZ=America/New_York)'}\n`)

// ── BUG 1: the $500 walk-up at 2026-07-21 00:33 UTC = 8:33pm ET on Jul 20 ──
const latePaidAt = '2026-07-21T00:33:00Z'
check('00:33 UTC timestamp buckets into the PREVIOUS local (Eastern) day', ymd(new Date(latePaidAt)) === '2026-07-20', `ymd=${ymd(new Date(latePaidAt))}`)

const s = dayStartUTC('2026-07-20'), e = dayEndUTC('2026-07-20')
check('Jul 20 local day → correct UTC-instant window', s === '2026-07-20T04:00:00.000Z' && e === '2026-07-21T03:59:59.999Z', `[${s} .. ${e}]`)
check('late $500 sale falls INSIDE the fixed Jul 20 window', new Date(latePaidAt) >= new Date(s) && new Date(latePaidAt) <= new Date(e))
check('old naive bound (…T23:59:59 compared as UTC) DROPPED it', new Date(latePaidAt) > new Date('2026-07-20T23:59:59Z'))

// ── BUG 2: todayRevenue must use the UNIFIED list (folio + online booking), by local day, net surcharge ──
// True Jul 20 figures: $625 folio (incl the $500 late walk-up) + $220 online booking = $845.
const unifiedTx = [
  { paid_at: '2026-07-20T18:00:00Z', amount: 12500, surcharge_amount: 0, is_reservation_payment: false }, // $125 folio, 2pm ET Jul 20
  { paid_at: latePaidAt,             amount: 50000, surcharge_amount: 0, is_reservation_payment: false }, // $500 late walk-up (8:33pm ET Jul 20)
  { paid_at: '2026-07-20T15:00:00Z', amount: 22000, surcharge_amount: 0, is_reservation_payment: true  }, // $220 online booking (reservations.amount_paid)
  { paid_at: '2026-07-19T20:00:00Z', amount:  9900, surcharge_amount: 0, is_reservation_payment: false }, // prior local day — must be excluded
]
const todayStr = '2026-07-20'
const inToday = unifiedTx.filter(t => t.paid_at && ymd(new Date(t.paid_at)) === todayStr)
const todayRevenue = inToday.reduce((sum, t) => sum + (t.amount || 0) - (t.surcharge_amount || 0), 0) / 100

check('todayRevenue = $845.00 ($625 folio + $220 booking)', todayRevenue === 845, `got $${todayRevenue.toFixed(2)}`)
check('todayRevenue INCLUDES an online-booking payment', inToday.some(t => t.is_reservation_payment))
check('todayRevenue EXCLUDES the prior local day', !inToday.some(t => t.paid_at === '2026-07-19T20:00:00Z'))

console.log(pass ? '\nALL PASS' : '\nFAILED')
process.exit(pass ? 0 : 1)
