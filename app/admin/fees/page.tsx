'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast, { Toaster } from 'react-hot-toast'
import { APPLIES_TO_OPTIONS, labelForAppliesTo } from '@/lib/applies-to'
import { fetchAppliedTaxIds, syncItemTaxes } from '@/lib/tax-applications'
import TaxCheckboxList from '@/components/TaxCheckboxList'

type Fee = {
  id: string
  name: string
  type: 'percentage' | 'flat'
  amount: number
  applies_to: string
  is_active: boolean
  card_only: boolean
}

type Tax = {
  id: string
  name: string
  rate: number
  is_active: boolean
  display_order: number
}

type TaxApplication = {
  id: string
  tax_id: string
  applies_to_type: string
  applies_to_key: string | null
}

// The three settings-priced singletons, matching the real charges in `settings`
// (early_checkin_*, late_checkout_*, extra_adult_fee/extra_child_fee).
const SINGLETONS: { type: string; label: string }[] = [
  { type: 'early_checkin', label: 'Early check-in' },
  { type: 'late_checkout', label: 'Late check-out' },
  { type: 'extra_guest', label: 'Extra guest' },
]

function formatAppliesTo(applies_to: string): string {
  if (applies_to === 'all') return 'All sites + add-ons'
  return applies_to.split(',').map(v => labelForAppliesTo(v)).join(', ')
}

// tax_application <-> composite selection key.
//   site_type:rv_site | product:<id> | addon:<id> | fee:<id> | early_checkin | late_checkin | extra_guest
function appToKey(a: { applies_to_type: string; applies_to_key: string | null }): string {
  return a.applies_to_key == null ? a.applies_to_type : `${a.applies_to_type}:${a.applies_to_key}`
}
function keyToApp(key: string, taxId: string): { tax_id: string; applies_to_type: string; applies_to_key: string | null } {
  const i = key.indexOf(':')
  if (i === -1) return { tax_id: taxId, applies_to_type: key, applies_to_key: null }
  return { tax_id: taxId, applies_to_type: key.slice(0, i), applies_to_key: key.slice(i + 1) }
}

const checkboxStyle = { width: '16px', height: '16px', flexShrink: 0, appearance: 'auto' as any }

export default function FeesPage() {
  const [fees, setFees] = useState<Fee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingFee, setEditingFee] = useState<Fee | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'percentage' as 'percentage' | 'flat',
    amount: '',
    applies_to_all: true,
    applies_to_selections: [] as string[],
    is_active: true,
    card_only: false,
  })
  // Item-side: which taxes apply to the fee being edited (writes ('fee', fee.id) rows).
  const [feeTaxIds, setFeeTaxIds] = useState<string[]>([])

  // Taxes (T1: managed here; dormant — nothing outside this screen reads them yet).
  const [taxes, setTaxes] = useState<Tax[]>([])
  const [showTaxForm, setShowTaxForm] = useState(false)
  const [editingTax, setEditingTax] = useState<Tax | null>(null)
  const [taxForm, setTaxForm] = useState({ name: '', rate: '', is_active: true, selections: [] as string[] })
  const [savingTax, setSavingTax] = useState(false)
  // Sellable things a tax can apply to.
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [addons, setAddons] = useState<{ id: string; name: string }[]>([])
  const [siteTypes, setSiteTypes] = useState<string[]>([])
  // Products are a POS-only concept; the tax model itself is core (a no-POS client can
  // still owe lodging tax). Gate only the Products group, like every other POS surface.
  const [posEnabled, setPosEnabled] = useState(false)
  // Card surcharge (Model B): its own rate setting, stored on settings.card_surcharge_percent.
  const [settingsId, setSettingsId] = useState<number | null>(null)
  const [surchargePct, setSurchargePct] = useState('')
  const [savingSurcharge, setSavingSurcharge] = useState(false)

  useEffect(() => {
    fetchFees()
    fetchTaxes()
    fetchTaxTargets()
    supabase.from('settings').select('id, pos_enabled, card_surcharge_percent').single().then(({ data }) => {
      setPosEnabled(!!data?.pos_enabled)
      if (data) {
        setSettingsId(data.id)
        setSurchargePct(data.card_surcharge_percent != null ? String(data.card_surcharge_percent) : '')
      }
    })
  }, [])

  async function saveSurcharge() {
    const pct = parseFloat(surchargePct)
    if (surchargePct === '' || isNaN(pct) || pct < 0) { toast.error('Enter a surcharge rate (0 for none).'); return }
    setSavingSurcharge(true)
    const { error } = await supabase.from('settings').update({ card_surcharge_percent: pct }).eq('id', settingsId ?? 1)
    setSavingSurcharge(false)
    if (error) { toast.error('Error saving surcharge.'); return }
    toast.success('Card surcharge saved!')
  }

  async function fetchFees() {
    setLoading(true)
    const { data } = await supabase.from('fees').select('*').order('created_at')
    if (data) setFees(data)
    setLoading(false)
  }

  async function fetchTaxes() {
    const { data } = await supabase.from('taxes').select('*').order('display_order').order('created_at')
    if (data) setTaxes(data)
  }

  // Site-type options come from DISTINCT sites.site_type — NOT a hardcoded vocabulary —
  // so a client with a type outside the usual eight still gets a checkbox (T0 finding).
  async function fetchTaxTargets() {
    const [prodRes, addonRes, siteRes] = await Promise.all([
      supabase.from('products').select('id, name').order('display_order'),
      supabase.from('addons').select('id, name').order('display_order'),
      supabase.from('sites').select('site_type'),
    ])
    if (prodRes.data) setProducts(prodRes.data)
    if (addonRes.data) setAddons(addonRes.data)
    if (siteRes.data) {
      const distinct = [...new Set(siteRes.data.map((s: any) => s.site_type).filter(Boolean))].sort()
      setSiteTypes(distinct as string[])
    }
  }

  function openAddForm() {
    setEditingFee(null)
    setForm({ name: '', type: 'percentage', amount: '', applies_to_all: true, applies_to_selections: [], is_active: true, card_only: false })
    setFeeTaxIds([])
    setShowForm(true)
  }

  function openEditForm(fee: Fee) {
    setEditingFee(fee)
    const isAll = fee.applies_to === 'all'
    setForm({
      name: fee.name,
      type: fee.type,
      amount: String(fee.amount),
      applies_to_all: isAll,
      applies_to_selections: isAll ? [] : fee.applies_to.split(',').map(s => s.trim()),
      is_active: fee.is_active,
      card_only: fee.card_only || false,
    })
    setFeeTaxIds([])
    fetchAppliedTaxIds('fee', fee.id).then(setFeeTaxIds)
    setShowForm(true)
  }

  function toggleSelection(value: string) {
    setForm(prev => ({
      ...prev,
      applies_to_selections: prev.applies_to_selections.includes(value)
        ? prev.applies_to_selections.filter(v => v !== value)
        : [...prev.applies_to_selections, value]
    }))
  }

  async function saveFee() {
    if (!form.name || !form.amount) { toast.error('Please fill in all fields.'); return }
    if (!form.applies_to_all && form.applies_to_selections.length === 0) {
      toast.error('Please select at least one option for Applies To.'); return
    }
    const applies_to = form.applies_to_all ? 'all' : form.applies_to_selections.join(',')
    const payload = {
      name: form.name,
      type: form.type,
      amount: parseFloat(form.amount),
      applies_to,
      is_active: form.is_active,
      card_only: form.card_only,
    }
    let feeId = editingFee?.id
    if (editingFee) {
      const { error } = await supabase.from('fees').update(payload).eq('id', editingFee.id)
      if (error) { toast.error('Error saving fee.'); return }
    } else {
      const { data, error } = await supabase.from('fees').insert(payload).select().single()
      if (error || !data) { toast.error('Error adding fee.'); return }
      feeId = data.id
    }
    if (feeId) await syncItemTaxes('fee', feeId, feeTaxIds)
    toast.success('Fee saved!')
    setShowForm(false)
    fetchFees()
  }

  async function toggleFee(fee: Fee) {
    await supabase.from('fees').update({ is_active: !fee.is_active }).eq('id', fee.id)
    fetchFees()
  }

  async function deleteFee(id: string) {
    if (!confirm('Delete this fee?')) return
    await supabase.from('fees').delete().eq('id', id)
    toast.success('Fee deleted.')
    fetchFees()
  }

  function formatFee(fee: Fee) {
    return fee.type === 'percentage' ? `${fee.amount}%` : `$${fee.amount.toFixed(2)}`
  }

  // ---- Taxes ----

  function openAddTax() {
    setEditingTax(null)
    setTaxForm({ name: '', rate: '', is_active: true, selections: [] })
    setShowTaxForm(true)
  }

  async function openEditTax(tax: Tax) {
    setEditingTax(tax)
    setTaxForm({ name: tax.name, rate: String(tax.rate), is_active: tax.is_active, selections: [] })
    setShowTaxForm(true)
    const { data } = await supabase.from('tax_applications').select('*').eq('tax_id', tax.id)
    if (data) setTaxForm(prev => ({ ...prev, selections: (data as TaxApplication[]).map(appToKey) }))
  }

  function toggleTaxSelection(key: string) {
    setTaxForm(prev => ({
      ...prev,
      selections: prev.selections.includes(key)
        ? prev.selections.filter(k => k !== key)
        : [...prev.selections, key]
    }))
  }

  async function saveTax() {
    const rate = parseFloat(taxForm.rate)
    if (!taxForm.name.trim() || taxForm.rate === '' || isNaN(rate)) {
      toast.error('Please enter a tax name and rate.'); return
    }
    setSavingTax(true)
    let taxId = editingTax?.id
    if (editingTax) {
      const { error } = await supabase.from('taxes')
        .update({ name: taxForm.name.trim(), rate, is_active: taxForm.is_active })
        .eq('id', editingTax.id)
      if (error) { toast.error('Error saving tax.'); setSavingTax(false); return }
    } else {
      const { data, error } = await supabase.from('taxes')
        .insert({ name: taxForm.name.trim(), rate, is_active: taxForm.is_active })
        .select().single()
      if (error || !data) { toast.error('Error adding tax.'); setSavingTax(false); return }
      taxId = data.id
    }
    // Sync applications: clear this tax's rows, then reinsert the current selection.
    if (taxId) {
      await supabase.from('tax_applications').delete().eq('tax_id', taxId)
      const rows = taxForm.selections.map(k => keyToApp(k, taxId!))
      if (rows.length > 0) {
        const { error } = await supabase.from('tax_applications').insert(rows)
        if (error) { toast.error('Tax saved, but applications failed.'); setSavingTax(false); fetchTaxes(); return }
      }
    }
    toast.success('Tax saved!')
    setSavingTax(false)
    setShowTaxForm(false)
    fetchTaxes()
  }

  async function toggleTax(tax: Tax) {
    await supabase.from('taxes').update({ is_active: !tax.is_active }).eq('id', tax.id)
    fetchTaxes()
  }

  async function deleteTax(tax: Tax) {
    if (!confirm(`Delete "${tax.name}"? This also removes everything it was applied to.`)) return
    await supabase.from('tax_applications').delete().eq('tax_id', tax.id)
    await supabase.from('taxes').delete().eq('id', tax.id)
    toast.success('Tax deleted.')
    fetchTaxes()
  }

  const taxCheckbox = (key: string, label: string, disabled = false) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input type="checkbox" id={`tax-${key}`} checked={taxForm.selections.includes(key)} disabled={disabled} onChange={disabled ? undefined : () => toggleTaxSelection(key)} style={{ ...checkboxStyle, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }} />
      <label htmlFor={`tax-${key}`} className="text-sm text-gray-700" style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1 }}>{label}</label>
    </div>
  )

  const taxCheckGroup = (title: string, rows: { key: string; label: string }[], opts?: { disabled?: boolean; hint?: string }) => (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</p>
      {opts?.hint && <p className="text-xs text-gray-400 mb-2 -mt-1">{opts.hint}</p>}
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">None configured.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          {rows.map(r => taxCheckbox(r.key, r.label, opts?.disabled))}
        </div>
      )}
    </div>
  )

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Toaster />
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Taxes &amp; Fees</h1>

      {/* ── Card Surcharge ────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Card Surcharge</h2>
        <p className="text-sm text-gray-500 mb-4">A single percentage added to card payments — online booking and every in-person screen alike — on the total excluding tax. Set to 0 for no surcharge.</p>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate (%)</label>
            <input className="w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm" type="number" step="0.01" min="0" placeholder="e.g. 3.5" value={surchargePct} onChange={e => setSurchargePct(e.target.value)} />
          </div>
          <button onClick={saveSurcharge} disabled={savingSurcharge} className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60" style={{ backgroundColor: 'var(--accent-color)' }}>{savingSurcharge ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {/* ── Taxes ─────────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Taxes</h2>
        <button onClick={openAddTax} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: 'var(--accent-color)' }}>
          + Add Tax
        </button>
      </div>

      {showTaxForm && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{editingTax ? 'Edit Tax' : 'Add New Tax'}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Name</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. PA Sales Tax" value={taxForm.name} onChange={e => setTaxForm({ ...taxForm, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rate (%)</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 6" type="number" step="0.01" value={taxForm.rate} onChange={e => setTaxForm({ ...taxForm, rate: e.target.value })} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Applies To</label>
              <div style={{ display: 'grid', gap: '16px', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#f9fafb' }}>
                {taxCheckGroup('Site types', siteTypes.map(t => ({ key: `site_type:${t}`, label: labelForAppliesTo(t) })))}
                {posEnabled && taxCheckGroup('Products', products.map(p => ({ key: `product:${p.id}`, label: p.name })), { disabled: true, hint: 'Set on the Products page until the tax switchover.' })}
                {taxCheckGroup('Add-ons', addons.map(a => ({ key: `addon:${a.id}`, label: a.name })))}
                {taxCheckGroup('Fees', fees.map(f => ({ key: `fee:${f.id}`, label: f.name })))}
                {taxCheckGroup('Other charges', SINGLETONS.map(s => ({ key: s.type, label: s.label })))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" id="tax_is_active" checked={taxForm.is_active} onChange={e => setTaxForm({ ...taxForm, is_active: e.target.checked })} style={checkboxStyle} />
              <label htmlFor="tax_is_active" className="text-sm text-gray-700">Active</label>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={saveTax} disabled={savingTax} className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60" style={{ backgroundColor: 'var(--accent-color)' }}>{savingTax ? 'Saving…' : 'Save Tax'}</button>
            <button onClick={() => setShowTaxForm(false)} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {taxes.length === 0 ? (
        <div className="text-sm text-gray-500 mb-8">No taxes configured yet.</div>
      ) : (
        <div className="space-y-3 mb-8">
          {taxes.map(tax => (
            <div key={tax.id} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full ${tax.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                <div>
                  <p className="font-semibold text-gray-900">{tax.name}</p>
                  <p className="text-sm text-gray-500">{tax.rate}%{!tax.is_active && ' · Inactive'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleTax(tax)} className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700">{tax.is_active ? 'Disable' : 'Enable'}</button>
                <button onClick={() => openEditTax(tax)} className="px-3 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700">Edit</button>
                <button onClick={() => deleteTax(tax)} className="px-3 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-700">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Fees ──────────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Fees</h2>
        <button onClick={openAddForm} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: 'var(--accent-color)' }}>
          + Add Fee
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{editingFee ? 'Edit Fee' : 'Add New Fee'}</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fee Name</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Resort Fee" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'percentage' | 'flat' })}>
                <option value="percentage">Percentage (%)</option>
                <option value="flat">Flat Amount ($)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount {form.type === 'percentage' ? '(%)' : '($)'}</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder={form.type === 'percentage' ? 'e.g. 6' : 'e.g. 10.00'} type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Applies To</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  id="applies_all"
                  checked={form.applies_to_all}
                  onChange={e => setForm({ ...form, applies_to_all: e.target.checked, applies_to_selections: [] })}
                  style={checkboxStyle}
                />
                <label htmlFor="applies_all" className="text-sm font-medium text-gray-700">All sites + add-ons</label>
              </div>
              {!form.applies_to_all && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#f9fafb' }}>
                  {APPLIES_TO_OPTIONS.map(opt => (
                    <div key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        id={opt.value}
                        checked={form.applies_to_selections.includes(opt.value)}
                        onChange={() => toggleSelection(opt.value)}
                        style={checkboxStyle}
                      />
                      <label htmlFor={opt.value} className="text-sm text-gray-700" style={{ cursor: 'pointer' }}>{opt.label}</label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-1">Taxes on this fee</label>
              <p className="text-xs text-gray-400 mb-2">Which taxes are charged on this fee — separate from where the fee itself applies, above.</p>
              <TaxCheckboxList taxes={taxes} selected={feeTaxIds} onToggle={id => setFeeTaxIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={e => setForm({ ...form, is_active: e.target.checked })}
                style={checkboxStyle}
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">Active (applied to bookings)</label>
            </div>
            {/* card_only checkbox retired (Model B): the surcharge is its own rate above.
                The column is kept and form.card_only round-trips existing fees, but no new
                card-only fee can be created — one would land in neither cash nor surcharge. */}
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={saveFee} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: 'var(--accent-color)' }}>Save Fee</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading fees...</p>
      ) : fees.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">No fees configured yet</p>
          <p className="text-sm">Click Add Fee to add fees to bookings.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fees.map(fee => (
            <div key={fee.id} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full ${fee.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                <div>
                  <p className="font-semibold text-gray-900">{fee.name}</p>
                  <p className="text-sm text-gray-500">{formatFee(fee)} · {formatAppliesTo(fee.applies_to)}{fee.card_only && ' · 💳 Card only'}{!fee.is_active && ' · Inactive'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleFee(fee)} className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700">{fee.is_active ? 'Disable' : 'Enable'}</button>
                <button onClick={() => openEditForm(fee)} className="px-3 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700">Edit</button>
                <button onClick={() => deleteFee(fee.id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-700">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
