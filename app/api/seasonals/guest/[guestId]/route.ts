import { NextRequest, NextResponse } from 'next/server'
import { svc, isSummit } from '@/lib/contract-server'
import { sumLineTotals } from '@/lib/ledger'
import { requireAdmin } from '@/lib/require-admin'

// GET /api/seasonals/guest/[guestId]?year=YYYY — summit-gated. Everything the
// camper page needs (service-role: reads the RLS-zero-policy tables).
export async function GET(request: NextRequest, { params }: { params: Promise<{ guestId: string }> }) {
  const denied = await requireAdmin(request)
  if (denied) return denied

  if (!(await isSummit())) return NextResponse.json({ error: 'Not available on this plan.' }, { status: 403 })
  const { guestId } = await params
  const url = new URL(request.url)
  const year = parseInt(url.searchParams.get('year') || '', 10) || new Date().getFullYear()

  const { data: guest, error } = await svc.from('guests').select('*').eq('id', guestId).single()
  if (error || !guest) return NextResponse.json({ error: 'Guest not found' }, { status: 404 })

  // Contracts (all years) + linked signature statuses/snapshots.
  const { data: contractsRaw } = await svc.from('seasonal_contracts')
    .select('*').eq('guest_id', guestId).order('season_year', { ascending: false })
  const contracts = contractsRaw || []
  const sigIds = contracts.flatMap(c => [c.contract_signature_id, c.waiver_signature_id]).filter(Boolean)
  const sigById = new Map<string, any>()
  if (sigIds.length) {
    const { data: sigs } = await svc.from('signatures')
      .select('id, status, signed_at, signed_name, sign_token').in('id', sigIds)
    for (const s of sigs || []) sigById.set(s.id, s)
  }
  const contractsOut = contracts.map(c => ({
    ...c,
    contract_signature: c.contract_signature_id ? sigById.get(c.contract_signature_id) || null : null,
    waiver_signature: c.waiver_signature_id ? sigById.get(c.waiver_signature_id) || null : null,
  }))
  const currentContract = contractsOut.find(c => c.season_year === year) || null

  // Notes (append-only).
  const { data: notes } = await svc.from('guest_notes')
    .select('id, created_at, author, body').eq('guest_id', guestId).order('created_at', { ascending: false })

  // Electric readings (recent).
  const { data: electric } = await svc.from('electric_readings')
    .select('*').eq('guest_id', guestId).order('created_at', { ascending: false }).limit(6)

  // Balance + last payment from the guest_account folio.
  const { data: folio } = await svc.from('folios')
    .select('id').eq('folio_type', 'guest_account').eq('guest_id', guestId).limit(1).maybeSingle()
  let balance_cents = 0
  let lastPayment: any = null
  const folioId = folio?.id || ''
  if (folioId) {
    const [{ data: items }, { data: pmts }] = await Promise.all([
      svc.from('folio_line_items').select('line_total, voided').eq('folio_id', folioId),
      svc.from('folio_payments').select('amount, surcharge_amount, method, paid_at, status').eq('folio_id', folioId).eq('status', 'completed').order('paid_at', { ascending: false }),
    ])
    const itemsTotal = sumLineTotals(items)
    const paymentsTotal = (pmts || []).reduce((s, p) => s + p.amount - (p.surcharge_amount || 0), 0)
    balance_cents = itemsTotal - paymentsTotal
    lastPayment = (pmts || [])[0] || null
  }

  return NextResponse.json({
    year,
    guest,
    contracts: contractsOut,
    currentContract,
    notes: notes || [],
    electric: electric || [],
    balance_cents,
    folioId,
    lastPayment,
  })
}
