// lib/applies-to.ts
// Shared site-type / applies-to vocabulary. Promoted verbatim from
// app/admin/fees/page.tsx (T0 finding: the eight-value list was hand-copied across
// ~6 files) so the Fees "Applies To" control and the Taxes "Applies to → Site types"
// control render from ONE list instead of two.
//
// IMPORTANT: these are LABELS ONLY. The canonical set of site types is whatever
// DISTINCT values exist in sites.site_type — that column is unconstrained free text,
// so a client can have a type outside this list. Callers that enumerate site types
// (the tax UI) must query the DB for the values and use labelForAppliesTo() purely to
// prettify; unknown values fall back to the raw string so nothing is ever hidden.

export const APPLIES_TO_OPTIONS: { value: string; label: string }[] = [
  { value: 'rv_site', label: 'RV Sites' },
  { value: 'cabin', label: 'Cabins' },
  { value: 'tent', label: 'Tent Sites' },
  { value: 'yurt', label: 'Yurts' },
  { value: 'tiny_home', label: 'Tiny Homes' },
  { value: 'lodge', label: 'Lodge Rooms' },
  { value: 'glamping', label: 'Glamping' },
  { value: 'treehouse', label: 'Treehouses' },
  { value: 'addons', label: 'Add-On Items' },
]

export function labelForAppliesTo(value: string): string {
  const opt = APPLIES_TO_OPTIONS.find(o => o.value === value.trim())
  return opt ? opt.label : value.trim()
}
