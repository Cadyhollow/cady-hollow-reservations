import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, randomUUID } from 'crypto'
import { svc, isSummit, getResend, originOf } from '@/lib/contract-server'
import { renderTemplate, buildContractVars } from '@/lib/contracts'

// POST /api/seasonal-contracts/[id]/send  — THE FREEZE
// Renders both documents from the template NOW, snapshots them onto two signatures
// rows (a shared packet_id), snapshots guest fields onto the contract, marks it
// 'sent', and emails one packet link. supabase-js has no multi-statement
// transaction, so this uses compensation-on-failure to avoid orphaned rows:
// any failure deletes what was written and leaves the contract as a clean draft.
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

    // Render NOW — these bytes are what the camper will see and what we freeze.
    const vars = buildContractVars(guest, contract, settings as any)
    const contractText = renderTemplate((settings as any)?.contract_text || '', vars)
    const waiverText = (settings as any)?.waiver_text || '' // no merge fields today; rendered as-is
    const contractTitle = `${contract.season_year} Seasonal Admission Agreement`

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

    // Snapshot guest-sourced fields onto the contract + link + mark sent.
    const { error: eC } = await svc.from('seasonal_contracts').update({
      status: 'sent',
      packet_id,
      contract_signature_id: rowA.id,
      waiver_signature_id: rowB.id,
      site_number: guest.site_number || contract.site_number || '',
      camper_make: guest.camper_make ?? contract.camper_make ?? null,
      camper_model: guest.camper_model ?? contract.camper_model ?? null,
      camper_year: guest.camper_year ?? contract.camper_year ?? null,
      sent_at: new Date().toISOString(),
    }).eq('id', id).eq('status', 'draft')
    if (eC) {
      await svc.from('signatures').delete().in('id', [rowA.id, rowB.id])
      return NextResponse.json({ error: eC.message }, { status: 500 })
    }

    // Email last. On failure, fully compensate → clean draft, so retry is safe.
    const origin = originOf(request)
    const packetUrl = `${origin}/packet/${packet_id}`
    const campgroundName = (settings as any)?.park_name || 'Campground'
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'reservations@example.com'
    const replyToEmail = (settings as any)?.park_email || process.env.RESEND_FROM_EMAIL || 'info@example.com'
    try {
      const { error: sendErr } = await getResend().emails.send({
        from: `${campgroundName} <${fromEmail}>`,
        replyTo: replyToEmail,
        to: guest.email,
        subject: `Your ${contract.season_year} seasonal packet — ${campgroundName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #374151;">
            <h2 style="color:#15803d; margin-bottom: 8px;">${campgroundName}</h2>
            <p>Hi ${guest.name || 'there'},</p>
            <p>Your ${contract.season_year} seasonal packet is ready. There are <strong>two documents</strong> to review and sign — your seasonal admission agreement and the liability waiver. You can do both from your phone in a couple of minutes.</p>
            <p style="text-align:center; margin: 28px 0;">
              <a href="${packetUrl}" style="background:#15803d; color:#fff; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:700; display:inline-block;">Review &amp; Sign Packet</a>
            </p>
            <p style="font-size:13px; color:#6b7280;">Or paste this link into your browser:<br><span style="color:#2E6B8A;">${packetUrl}</span></p>
            <p style="font-size:13px; color:#6b7280;">Thank you!<br>${campgroundName}</p>
          </div>
        `,
      })
      if (sendErr) throw new Error((sendErr as any)?.message || 'Email failed to send')
    } catch (e: any) {
      await svc.from('signatures').delete().in('id', [rowA.id, rowB.id])
      await svc.from('seasonal_contracts').update({
        status: 'draft', packet_id: null, contract_signature_id: null, waiver_signature_id: null, sent_at: null,
      }).eq('id', id)
      return NextResponse.json({ error: 'Could not send the packet email — nothing was changed. Please try again.' }, { status: 502 })
    }

    return NextResponse.json({ success: true, packet_id, packetUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Something went wrong' }, { status: 500 })
  }
}
