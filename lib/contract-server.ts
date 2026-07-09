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
