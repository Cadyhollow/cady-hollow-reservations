import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, randomUUID } from 'crypto'
import { svc, isSummit, getResend, originOf, packetEmailHtml } from '@/lib/contract-server'
import { renderTemplate, buildContractVars } from '@/lib/contracts'

// POST /api/seasonal-contracts/[id]/send  — THE FREEZE
// Renders both documents from the template NOW, snapshots them onto two signatures
// rows (a shared packet_id), snapshots the guest's current rig + site onto the
// contract, marks it 'sent', and emails one packet link.
//
// supabase-js has no multi-statement transaction, so we use compensation-on-
// failure for the DB writes: if either signatures insert or the contract update
// fails, we delete what was written and leave a clean draft. The EMAIL is
// deliberately NOT compensated — once the rows + contract are committed the packet
// is real and its tokens may already be reachable, so an email failure returns
// { ok: true, emailed: false } and leaves everything intact for a resend.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isSummit())) {
      return NextResponse.json({ error: 'Not available on this plan.' }, { status: 403 })
    }
    const { id } = await params

    const { data: contract, error: cErr } = await svc.from('seasonal_contracts').select('*').eq('id', id).single()
    if (cErr || !contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    if (contract.status !== 'draft') {
      return NextResponse.json({ error: 'This contract has already been sent.' }, { status: 409 })
    }

    const { data: guest } = await svc.from('guests').select('*').eq('id', contract.guest_id).single()
    if (!guest) return NextResponse.json({ error: 'Guest not found' }, { status: 404 })
    if (!guest.email) return NextResponse.json({ error: 'This guest has no email on file to send the packet to.' }, { status: 400 })

    const { data: settings } = await svc
      .from('settings')
      .select('park_name, park_email, contract_text, waiver_text')
      .limit(1).single()

    // The guest record is current truth; the contract is a frozen copy. Snapshot
    // ALL SIX rig fields + site_number from the guest, and render from that.
    // (Occupants, season dates, and total_due stay as the staff-edited draft.)
    const snapshot = {
      site_number: guest.site_number || contract.site_number || '',
      camper_type: guest.camper_type ?? null,
      camper_length: guest.camper_length ?? null,
      camper_amperage: guest.camper_amperage ?? null,
      camper_make: guest.camper_make ?? null,
      camper_model: guest.camper_model ?? null,
      camper_year: guest.camper_year ?? null,
    }

    // Render NOW — these bytes are what the camper sees and what we freeze.
    const vars = buildContractVars(guest, { ...contract, ...snapshot }, settings as any)
    const contractText = renderTemplate((settings as any)?.contract_text || '', vars)
    const waiverText = (settings as any)?.waiver_text || '' // no merge fields today; rendered as-is
    const contractTitle = `${contract.season_year} Seasonal Admission Agreement`

    // Never freeze an empty legal document. If either body renders empty or
    // whitespace-only, block the send BEFORE any rows are written — the draft is
    // left untouched. (This is why an early send once froze an empty contract.)
    if (!contractText.trim()) {
      return NextResponse.json({ error: 'Contract text is empty — set the seasonal contract body in Settings before sending.' }, { status: 400 })
    }
    if (!waiverText.trim()) {
      return NextResponse.json({ error: 'Waiver text is empty — set the liability waiver in Settings before sending.' }, { status: 400 })
    }

    const packet_id = randomUUID()

    // Row A — the contract (sign_order 1)
    const { data: rowA, error: eA } = await svc.from('signatures').insert({
      doc_type: 'seasonal_contract', guest_id: guest.id, packet_id, sign_order: 1,
      sign_token: randomBytes(24).toString('base64url'), status: 'pending',
      document_title: contractTitle, document_text: contractText,
      signer_name: guest.name || '', signer_email: guest.email || '',
    }).select('id').single()
    if (eA || !rowA) return NextResponse.json({ error: eA?.message || 'Could not create contract document.' }, { status: 500 })

    // Row B — the waiver (sign_order 2). Distinct doc_type from 'booking_waiver'.
    const { data: rowB, error: eB } = await svc.from('signatures').insert({
      doc_type: 'seasonal_waiver', guest_id: guest.id, packet_id, sign_order: 2,
      sign_token: randomBytes(24).toString('base64url'), status: 'pending',
      document_title: 'Liability Waiver', document_text: waiverText,
      signer_name: guest.name || '', signer_email: guest.email || '',
    }).select('id').single()
    if (eB || !rowB) {
      await svc.from('signatures').delete().eq('id', rowA.id)
      return NextResponse.json({ error: eB?.message || 'Could not create waiver document.' }, { status: 500 })
    }

    // Snapshot onto the contract + link + mark sent. On failure this is genuine
    // corruption (rows without a linked contract) → roll the rows back.
    const { error: eC } = await svc.from('seasonal_contracts').update({
      status: 'sent',
      packet_id,
      contract_signature_id: rowA.id,
      waiver_signature_id: rowB.id,
      ...snapshot,
      sent_at: new Date().toISOString(),
    }).eq('id', id).eq('status', 'draft')
    if (eC) {
      await svc.from('signatures').delete().in('id', [rowA.id, rowB.id])
      return NextResponse.json({ error: eC.message }, { status: 500 })
    }

    // Email last — NOT compensated. The packet is committed and real.
    const origin = originOf(request)
    const packetUrl = `${origin}/packet/${packet_id}`
    const campgroundName = (settings as any)?.park_name || 'Campground'
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'reservations@example.com'
    const replyToEmail = (settings as any)?.park_email || process.env.RESEND_FROM_EMAIL || 'info@example.com'
    let emailError: string | null = null
    try {
      const { error: sendErr } = await getResend().emails.send({
        from: `${campgroundName} <${fromEmail}>`,
        replyTo: replyToEmail,
        to: guest.email,
        subject: `Your ${contract.season_year} seasonal packet — ${campgroundName}`,
        html: packetEmailHtml(campgroundName, guest.name || 'there', contract.season_year, packetUrl),
      })
      if (sendErr) emailError = (sendErr as any)?.message || 'Email failed to send'
    } catch (e: any) {
      emailError = e?.message || 'Email failed to send'
    }

    return NextResponse.json({ ok: true, packet_id, packetUrl, emailed: !emailError, error: emailError })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Something went wrong' }, { status: 500 })
  }
}
