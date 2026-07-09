import { NextRequest, NextResponse } from 'next/server'
import { svc, clientIp } from '@/lib/contract-server'

// POST /api/packet/[packetId]/sign — public. body: { signedName, agreed: true }
// One submit signs ALL pending rows in the packet. Each row's signed_text_snapshot
// is a copy of ITS OWN document_text (never re-fetched), plus IP + user-agent.
export async function POST(request: NextRequest, { params }: { params: Promise<{ packetId: string }> }) {
  try {
    const { packetId } = await params
    if (!packetId) return NextResponse.json({ error: 'Missing packet' }, { status: 400 })

    const body = await request.json()
    const signedName: string = (body.signedName || '').trim()
    const agreed: boolean = body.agreed === true
    if (!signedName || !agreed) {
      return NextResponse.json({ error: 'Please type your name and check the agreement box.' }, { status: 400 })
    }

    const { data: rows, error } = await svc
      .from('signatures')
      .select('id, status, document_text')
      .eq('packet_id', packetId)
    if (error || !rows || rows.length === 0) {
      return NextResponse.json({ error: 'This signing link is no longer valid.' }, { status: 404 })
    }

    const pending = rows.filter(r => r.status !== 'signed')
    if (pending.length === 0) {
      return NextResponse.json({ error: 'This packet has already been signed.' }, { status: 409 })
    }

    const ip = clientIp(request)
    const userAgent = request.headers.get('user-agent') || ''
    const now = new Date().toISOString()

    for (const r of pending) {
      const { error: upErr } = await svc.from('signatures').update({
        status: 'signed',
        agreed: true,
        signed_name: signedName,
        signed_at: now,
        ip_address: ip,
        user_agent: userAgent,
        signed_text_snapshot: r.document_text || '', // this row's OWN bytes, copied
      }).eq('id', r.id).neq('status', 'signed')
      if (upErr) return NextResponse.json({ error: 'Could not record your signature. Please try again.' }, { status: 500 })
    }

    // Reflect on the contract (by packet).
    await svc.from('seasonal_contracts')
      .update({ status: 'signed', signed_at: now })
      .eq('packet_id', packetId)
      .neq('status', 'signed')

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Something went wrong' }, { status: 500 })
  }
}
