import { NextRequest, NextResponse } from 'next/server'
import { svc, isSummit } from '@/lib/contract-server'
import { requireRole } from '@/lib/require-role'
import { currentSeasonYear } from '@/lib/season'
import { laneBalances } from '@/lib/ledger-lanes'
import { campFromAccount } from '@/lib/account-buckets'
import {
  buildCommandCenter,
  type CamperInput,
  type ContractInput,
  type WaiverState,
} from '@/lib/command-center'

// GET /api/seasonal-command-center?season_id=…  — the Seasonal Command Center's whole payload.
//
// ⚠ READ-ONLY. Every call below is a SELECT. This route inserts nothing, updates nothing, deletes
// nothing and sends no email — v1 of the page reads and navigates, and the reminder buttons in the
// mockup are deliberately links rather than sends.
//
// WHY IT IS A SERVER ROUTE AT ALL. `seasonal_contracts` has no RLS policy, so the admin browser
// client cannot read a single row of it — the same reason /api/seasonals/list exists. The service
// client here can, so all the reading and all the arithmetic happen on the server and the page
// receives a finished model.
//
// WHY THE SELECTS ARE `select('*')`. A park that has not run one of the seasonal migrations is
// missing a column, and PostgREST fails the WHOLE query when it is asked for a column that does
// not exist — one absent column would blank the entire page. So nothing names an optional column:
// the rows come back whole and the filtering happens in JS, where a missing field is simply
// `undefined` and reads as "this park does not track that".

/** A row of unknown shape from a `select('*')`. Fields are read defensively, never assumed. */
type Row = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const isTrue = (v: unknown): boolean => v === true

/** Today as a local calendar date. The rules compare calendar days, never instants. */
function todayLocalIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function GET(request: NextRequest) {
  const denied = await requireRole(request, 'staff')
  if (denied) return denied
  if (!(await isSummit())) {
    return NextResponse.json({ error: 'Not available on this plan.' }, { status: 403 })
  }

  const url = new URL(request.url)
  const seasonId = url.searchParams.get('season_id') || ''

  // ── The reads. All SELECT, all whole-row. ───────────────────────────────────────────────────
  const [
    { data: guestRows },
    { data: siteRows },
    { data: contractRows },
    { data: seasonRows },
    { data: settingsRows },
  ] = await Promise.all([
    svc.from('guests').select('*'),
    svc.from('sites').select('*'),
    svc.from('seasonal_contracts').select('*'),
    svc.from('seasons').select('*'),
    svc.from('settings').select('*').limit(1),
  ])

  const seasons = (seasonRows || []) as Row[]
  const selectedSeason = seasonId ? seasons.find(s => str(s.id) === seasonId) : undefined
  // A season row wins; otherwise fall back to the park's current season year, the same way
  // /api/seasonals/unsigned-count resolves it, so the two never disagree.
  const year = selectedSeason ? num(selectedSeason.year) : currentSeasonYear()

  // ── The roster ──────────────────────────────────────────────────────────────────────────────
  // Seasonal campers are the park's is_seasonal guests, not only the enrolled ones. That is the
  // headline figure the owner reads ("49 campers"), and it is also the denominator for squared
  // away — a camper nobody has enrolled has nothing outstanding, which is the calm answer.
  const campersRaw = ((guestRows || []) as Row[]).filter(g => isTrue(g.is_seasonal))
  const camperIds = campersRaw.map(g => str(g.id)).filter(Boolean)
  const seasonalSites = ((siteRows || []) as Row[]).filter(s => isTrue(s.is_seasonal_site)).length

  // ── This season's contracts ─────────────────────────────────────────────────────────────────
  // Scoped in JS: by season_id when a season is named, else by season_year. A contract belongs to
  // exactly one season, and the roster's paperwork must not bleed between them.
  const contracts: ContractInput[] = ((contractRows || []) as Row[])
    .filter(c => (seasonId ? str(c.season_id) === seasonId : num(c.season_year) === year))
    .map(c => ({
      id: str(c.id),
      guest_id: str(c.guest_id),
      status: str(c.status) || null,
      sent_at: str(c.sent_at) || null,
      signed_at: str(c.signed_at) || null,
      waiver_signature_id: str(c.waiver_signature_id) || null,
      deposit_due_cents: num(c.deposit_due_cents),
      deposit_due_by: str(c.deposit_due_by) || null,
      total_due_cents: num(c.total_due_cents),
      total_due_by: str(c.total_due_by) || null,
      payment_schedule: c.payment_schedule,
    }))

  // ── Waivers ─────────────────────────────────────────────────────────────────────────────────
  // ⚠ ONLY CONTRACTS THAT HAVE A WAIVER RECORD APPEAR HERE. A contract with no
  // `waiver_signature_id` has had no waiver asked of it, so it is absent from this map and reads
  // as "no obligation" rather than "outstanding" — the page must not invent a waiver nobody
  // requested. `.in('id', …)` names only `id`, which every table has.
  const waiverIds = contracts.map(c => c.waiver_signature_id).filter((v): v is string => !!v)
  const waiverByContractId: Record<string, WaiverState> = {}
  if (waiverIds.length) {
    const { data: sigRows } = await svc.from('signatures').select('*').in('id', waiverIds)
    const signedById = new Map<string, boolean>()
    for (const s of (sigRows || []) as Row[]) signedById.set(str(s.id), !!str(s.signed_at))
    for (const c of contracts) {
      if (!c.waiver_signature_id) continue
      if (!signedById.has(c.waiver_signature_id)) continue
      waiverByContractId[c.id] = signedById.get(c.waiver_signature_id) ? 'signed' : 'unsigned'
    }
  }

  // ── Money ───────────────────────────────────────────────────────────────────────────────────
  // One guest_account folio per camper — the same folio the guest folio page and the electric
  // billing screen use, so all three agree on a balance.
  const camperIdSet = new Set(camperIds)
  const folios = ((await svc.from('folios').select('*')).data || []) as Row[]
  const folioByGuest = new Map<string, string>()
  for (const f of folios) {
    const gid = str(f.guest_id)
    if (str(f.folio_type) !== 'guest_account' || !camperIdSet.has(gid)) continue
    if (!folioByGuest.has(gid)) folioByGuest.set(gid, str(f.id))
  }
  const folioIds = [...folioByGuest.values()]

  const itemsByFolio = new Map<string, Row[]>()
  const pmtsByFolio = new Map<string, Row[]>()
  if (folioIds.length) {
    const [{ data: liRows }, { data: pmtRows }] = await Promise.all([
      svc.from('folio_line_items').select('*').in('folio_id', folioIds),
      svc.from('folio_payments').select('*').in('folio_id', folioIds),
    ])
    for (const li of (liRows || []) as Row[]) {
      const k = str(li.folio_id)
      if (!itemsByFolio.has(k)) itemsByFolio.set(k, [])
      itemsByFolio.get(k)!.push(li)
    }
    for (const p of (pmtRows || []) as Row[]) {
      // Completed only — the same filter /api/guests/balances applies, so the directory and this
      // page can never state different balances for the same camper.
      if (str(p.status) !== 'completed') continue
      const k = str(p.folio_id)
      if (!pmtsByFolio.has(k)) pmtsByFolio.set(k, [])
      pmtsByFolio.get(k)!.push(p)
    }
  }

  const campers: CamperInput[] = campersRaw.map(g => {
    const id = str(g.id)
    const folioId = folioByGuest.get(id)
    const items = folioId ? itemsByFolio.get(folioId) || [] : []
    const payments = folioId ? pmtsByFolio.get(folioId) || [] : []

    // ⚠ THE MONEY IS THE EXISTING LIBRARY'S, NOT THIS ROUTE'S.
    //
    // The empty electric context is deliberate and safe: the three figures read below are all
    // context-free. `accountBalance` is charges minus payments; the SEASONAL lane is DECLARED on
    // the row (`lane = 'seasonal'`), so classifyLineItem returns it without consulting the
    // context; and Camp is taken as the account remainder via campFromAccount rather than by
    // classifying items. Nothing here reads byLane.electric or byLane.store, which are the only
    // values the context would change — so no electric_readings lookup is needed, and the page
    // costs two queries instead of three.
    const lanes = laneBalances(
      items as never[],
      payments as never[],
      { electricLineItemIds: new Set<string>() },
    )
    const accountBalance = lanes.accountBalance
    const seasonalBalance = lanes.byLane.seasonal.balance

    return {
      id,
      name: str(g.name),
      site_number: str(g.site_number) || null,
      accountBalance,
      seasonalBalance,
      seasonalPaid: lanes.byLane.seasonal.payments,
      campBalance: campFromAccount(accountBalance, seasonalBalance),
    }
  })

  const today = todayLocalIso()
  const model = buildCommandCenter({
    today,
    campers,
    seasonalSites,
    contracts,
    waiverByContractId,
  })

  const settings = ((settingsRows || []) as Row[])[0] || {}

  return NextResponse.json({
    today,
    parkName: str(settings.park_name) || '',
    season: {
      id: selectedSeason ? str(selectedSeason.id) : '',
      name: selectedSeason ? str(selectedSeason.name) : '',
      year,
    },
    ...model,
  })
}
