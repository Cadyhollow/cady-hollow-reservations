// lib/tax-applications.ts
// Shared read/write helpers for the polymorphic `tax_applications` table, used by the
// ITEM-SIDE tax config (an add-on / fee / settings singleton picking which taxes apply
// to it). The TAX-SIDE config (a tax picking what it applies to) lives inline in the
// Fees screen. Both directions write the SAME rows — two lenses on one dataset.
//
// T1 note: these helpers read/write taxes + tax_applications, but they are imported ONLY
// by admin config screens (Fees, Add-ons, Settings). No charging path (computePricing,
// POS, booking, folios, calendar, API routes) may import this yet — that wiring is T2+.

import { supabase } from '@/lib/supabase'

// Mirrors the CHECK constraint in 2026-07-16-tax-model-tables.sql. Note 'late_checkout'
// (the real settings charge), not the spec's original 'late_checkin'.
export type AppliesToType =
  | 'site_type' | 'product' | 'addon' | 'fee'
  | 'early_checkin' | 'late_checkout' | 'extra_guest'

export type TaxRow = { id: string; name: string; rate: number; is_active: boolean; display_order: number }

export async function fetchTaxes(): Promise<TaxRow[]> {
  const { data } = await supabase.from('taxes').select('*').order('display_order').order('created_at')
  return (data as TaxRow[]) ?? []
}

// The tax_ids currently applied to one target — an item id, or null for a singleton.
export async function fetchAppliedTaxIds(type: AppliesToType, key: string | null): Promise<string[]> {
  let q = supabase.from('tax_applications').select('tax_id').eq('applies_to_type', type)
  q = key == null ? q.is('applies_to_key', null) : q.eq('applies_to_key', key)
  const { data } = await q
  return (data ?? []).map((r: any) => r.tax_id as string)
}

// Replace the taxes applied to one target: clear this target's rows, reinsert the
// selection. The item-side mirror of the tax-side delete-by-tax_id sync; the unique
// index (tax_id, type, coalesce(key,'')) keeps both from creating duplicates.
export async function syncItemTaxes(type: AppliesToType, key: string | null, taxIds: string[]): Promise<{ error: boolean }> {
  let del = supabase.from('tax_applications').delete().eq('applies_to_type', type)
  del = key == null ? del.is('applies_to_key', null) : del.eq('applies_to_key', key)
  const { error: delErr } = await del
  if (delErr) return { error: true }
  if (taxIds.length > 0) {
    const { error } = await supabase.from('tax_applications')
      .insert(taxIds.map(tax_id => ({ tax_id, applies_to_type: type, applies_to_key: key })))
    if (error) return { error: true }
  }
  return { error: false }
}
