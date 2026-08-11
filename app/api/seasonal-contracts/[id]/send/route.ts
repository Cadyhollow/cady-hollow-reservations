import { NextRequest, NextResponse } from 'next/server'
import { isSummit, getResend, originOf, packetEmailHtml, freezePacket } from '@/lib/contract-server'
import { requireRole } from '@/lib/require-role'

// POST /api/seasonal-contracts/[id]/send  — THE REMOTE FLOW
// Freezes the draft into a packet via freezePacket() (which owns the empty-doc
// guard, the rig/site snapshot, the two signature rows, and compensation-on-
// failure), then emails the sign-invite. requireEmail:true reproduces the original
// "no email on file → 400 before anything is frozen" behavior. The EMAIL is NOT
// compensated: once the packet is committed it's real, so a failed email returns
// { ok:true, emailed:false } and leaves everything intact for a resend.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(request, 'staff')
  if (denied) return denied

  try {
    if (!(await isSummit())) {
      return NextResponse.json({ error: 'Not available on this plan.' }, { status: 403 })
    }
    const { id } = await params

    const result = await freezePacket(id, { requireEmail: true })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const { packet_id, guest, contract, settings } = result

    // Email last — NOT compensated. The packet is committed and real.
    const origin = originOf(request)
    const packetUrl = `${origin}/packet/${packet_id}`
    const campgroundName = settings?.park_name || 'Campground'
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'reservations@example.com'
    const replyToEmail = settings?.park_email || process.env.RESEND_FROM_EMAIL || 'info@example.com'
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
