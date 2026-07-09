// Server-only helpers for the Seasonal Contracts routes. These routes are the
// trusted boundary: the admin UI and the public packet page never touch the
// signatures / seasonal_contracts / guest_notes tables via the anon client.
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { planAtLeast } from '@/lib/plan'

// Service-role client (bypasses RLS). Constructed at import is fine — createClient
// doesn't throw on missing env (unlike Resend, which we keep lazy below).
export const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Lazy Resend so keyless builds (next build) don't construct — and throw — at import.
export function getResend() { return new Resend(process.env.RESEND_API_KEY) }

// Summit gate — reads settings.plan and fails CLOSED on missing/unknown plan.
export async function isSummit(): Promise<boolean> {
  const { data } = await svc.from('settings').select('plan').limit(1).single()
  return planAtLeast(data?.plan, 'summit')
}

// Client IP — identical logic to app/api/sign/[token]/route.ts:99
export function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || ''
}

// Absolute origin that works on localhost and in production.
export function originOf(request: NextRequest): string {
  return request.headers.get('origin')
    || (request.headers.get('host') ? `https://${request.headers.get('host')}` : '')
}

// The packet invitation email. Used by both /send and /resend so a resent email
// is byte-identical and always points at the same frozen packet.
export function packetEmailHtml(campgroundName: string, guestName: string, year: number, packetUrl: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #374151;">
      <h2 style="color:#15803d; margin-bottom: 8px;">${campgroundName}</h2>
      <p>Hi ${guestName},</p>
      <p>Your ${year} seasonal packet is ready. There are <strong>two documents</strong> to review and sign — your seasonal admission agreement and the liability waiver. You can do both from your phone in a couple of minutes.</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="${packetUrl}" style="background:#15803d; color:#fff; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:700; display:inline-block;">Review &amp; Sign Packet</a>
      </p>
      <p style="font-size:13px; color:#6b7280;">Or paste this link into your browser:<br><span style="color:#2E6B8A;">${packetUrl}</span></p>
      <p style="font-size:13px; color:#6b7280;">Thank you!<br>${campgroundName}</p>
    </div>
  `
}
