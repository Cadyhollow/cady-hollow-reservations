'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { planAtLeast } from '@/lib/plan'

type Row = {
  guest_id: string
  name: string
  site_number: string
  contract_status: string
  contract_doc_status: string | null
  waiver_doc_status: string | null
  balance_cents: number
  last_note_at: string | null
}

const fmtMoney = (c: number) => (c < 0 ? '−$' : '$') + (Math.abs(c) / 100).toFixed(2)
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

function statusPill(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    signed: { bg: '#f0fdf4', color: '#15803d', label: 'Signed' },
    sent: { bg: '#fffbeb', color: '#b45309', label: 'Sent · unsigned' },
    draft: { bg: '#eff6ff', color: '#1d4ed8', label: 'Draft' },
    none: { bg: '#f3f4f6', color: '#6b7280', label: 'Not started' },
  }
  const s = map[status] || map.none
  return <span style={{ background: s.bg, color: s.color, fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 999 }}>{s.label}</span>
}

export default function SeasonalsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [signed, setSigned] = useState(0)
  const [total, setTotal] = useState(0)
  const [unsignedOnly, setUnsignedOnly] = useState(false)
  const [err, setErr] = useState('')

  // Batch-1 gate: decide on the freshly-loaded plan, never the state default.
  useEffect(() => {
    supabase.from('settings').select('plan').single().then(({ data }) => {
      if (!planAtLeast(data?.plan, 'summit')) router.replace('/admin')
    })
  }, [])

  async function load(y: number) {
    setLoading(true); setErr('')
    try {
      const res = await fetch(`/api/seasonals/list?year=${y}`)
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Could not load seasonals.'); setRows([]) }
      else { setRows(d.rows || []); setSigned(d.signed_count || 0); setTotal(d.total || 0) }
    } catch { setErr('Could not load seasonals.') }
    setLoading(false)
  }
  useEffect(() => { load(year) }, [year])

  const visible = unsignedOnly ? rows.filter(r => r.contract_status !== 'signed') : rows

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Seasonal Campers</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${signed} of ${total} contracts signed for ${year}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {[year + 1, year, year - 1, year - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setUnsignedOnly(v => !v)}
            className="px-3 py-2 text-xs font-medium rounded-lg border"
            style={unsignedOnly ? { background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' } : { background: '#fff', borderColor: '#e5e7eb', color: '#6b7280' }}>
            {unsignedOnly ? 'Showing unsigned' : 'Unsigned only'}
          </button>
        </div>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm mb-3">{err}</div>}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-4 py-3">Camper</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Contract</th>
                <th className="px-4 py-3">Waiver</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Last note</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.guest_id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/seasonals/${r.guest_id}`} className="font-semibold text-gray-900 hover:underline">{r.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.site_number || '—'}</td>
                  <td className="px-4 py-3">{statusPill(r.contract_status)}</td>
                  <td className="px-4 py-3">
                    {r.contract_status === 'none'
                      ? <span className="text-gray-400 text-xs">—</span>
                      : statusPill(r.waiver_doc_status === 'signed' ? 'signed' : r.contract_status === 'draft' ? 'draft' : 'sent')}
                  </td>
                  <td className="px-4 py-3 text-right font-medium" style={{ color: r.balance_cents > 0 ? '#d97706' : '#15803d' }}>
                    {r.balance_cents < 0 ? 'Credit ' + fmtMoney(-r.balance_cents) : fmtMoney(r.balance_cents)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(r.last_note_at)}</td>
                </tr>
              ))}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">{unsignedOnly ? 'All contracts signed 🎉' : 'No seasonal campers.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
