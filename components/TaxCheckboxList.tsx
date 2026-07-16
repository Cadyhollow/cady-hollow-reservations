'use client'

// Item-side tax picker: renders one checkbox per configured tax. Used on the Add-on,
// Fee, and Settings-singleton forms. Purely presentational — the parent owns the
// selected tax_ids and persists them via syncItemTaxes() on save.

import type { TaxRow } from '@/lib/tax-applications'

export default function TaxCheckboxList({
  taxes, selected, onToggle, emptyHint,
}: {
  taxes: TaxRow[]
  selected: string[]
  onToggle: (taxId: string) => void
  emptyHint?: string
}) {
  if (taxes.length === 0) {
    return <p className="text-xs text-gray-400">{emptyHint ?? 'No taxes configured yet. Add one under Taxes & Fees.'}</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {taxes.map(t => (
        <label key={t.id} className="flex items-center gap-2 text-sm text-gray-700" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={selected.includes(t.id)}
            onChange={() => onToggle(t.id)}
            style={{ width: 16, height: 16, flexShrink: 0, appearance: 'auto' as any }}
          />
          <span>{t.name} <span className="text-gray-400">({t.rate}%{t.is_active ? '' : ', inactive'})</span></span>
        </label>
      ))}
    </div>
  )
}
