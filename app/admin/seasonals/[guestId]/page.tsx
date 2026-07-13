'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { planAtLeast } from '@/lib/plan'
import { currentSeasonYear } from '@/lib/season'
import SeasonalSections from '../SeasonalSections'
import AddressEditor from '../AddressEditor'
import RigEditor from '../RigEditor'
import PartyEditor from '../PartyEditor'
import toast, { Toaster } from 'react-hot-toast'

type Occupant = { name: string; kind: 'adult' | 'child' }

export default function SeasonalCamperPage() {
  const params = useParams()
  const router = useRouter()
  const guestId = params.guestId as string
  const cy = currentSeasonYear()
  const [year, setYear] = useState(cy)   // the season being viewed/acted on — a forced, visible choice

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Rig editor
  const [rigOpen, setRigOpen] = useState(false)
  const [rig, setRig] = useState<any>({})
  const [savingRig, setSavingRig] = useState(false)

  // Home address editor (writes to guests). Required for seasonal campers.
  const [addrOpen, setAddrOpen] = useState(false)
  const [addr, setAddr] = useState<any>({})
  const [savingAddr, setSavingAddr] = useState(false)

  // Notes
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  // Send-packet modal
  const [modal, setModal] = useState(false)
  const [draft, setDraft] = useState<any>(null)
  const [occupants, setOccupants] = useState<Occupant[]>([])
  const [totalDue, setTotalDue] = useState('')
  const [opens, setOpens] = useState('')
  const [closes, setCloses] = useState('')
  const [working, setWorking] = useState(false)
  const [sendResult, setSendResult] = useState<{ emailed: boolean; error?: string } | null>(null)

  useEffect(() => {
    supabase.from('settings').select('plan').single().then(({ data }) => {
      if (!planAtLeast(data?.plan, 'summit')) router.replace('/admin')
    })
  }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const res = await fetch(`/api/seasonals/guest/${guestId}?year=${year}`)
      const d = await res.json()
      if (!res.ok) setErr(d.error || 'Could not load camper.')
      else { setData(d); setRig({ ...d.guest }); setAddr({ ...d.guest }) }
    } catch { setErr('Could not load camper.') }
    setLoading(false)
  }
  useEffect(() => { load() }, [guestId, year])

  async function saveRig() {
    setSavingRig(true)
    const { error } = await supabase.from('guests').update({
      camper_type: rig.camper_type || null,
      camper_length: rig.camper_length ? parseInt(rig.camper_length) : null,
      camper_amperage: rig.camper_amperage || null,
      camper_make: rig.camper_make || null,
      camper_model: rig.camper_model || null,
      camper_year: rig.camper_year ? parseInt(rig.camper_year) : null,
    }).eq('id', guestId)
    setSavingRig(false)
    if (error) { toast.error('Could not save rig: ' + error.message); return } // keep the editor open
    setRigOpen(false); await load()
  }

  async function saveAddr() {
    setSavingAddr(true)
    const { error } = await supabase.from('guests').update({
      home_street: addr.home_street?.trim() || null,
      home_city: addr.home_city?.trim() || null,
      home_state: addr.home_state?.trim() || null,
      home_zip: addr.home_zip?.trim() || null,
    }).eq('id', guestId)
    setSavingAddr(false)
    if (error) { toast.error('Could not save address: ' + error.message); return } // keep the editor open
    setAddrOpen(false); await load()
  }

  async function addNote() {
    if (!note.trim()) return
    setSavingNote(true)
    const res = await fetch('/api/guest-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: guestId, body: note.trim() }),
    })
    setSavingNote(false)
    if (!res.ok) {
      let msg = 'Could not add note.'
      try { const e = await res.json(); if (e?.error) msg = 'Could not add note: ' + e.error } catch {}
      toast.error(msg + ' Your note was kept — try again.') // note text deliberately NOT cleared
      return
    }
    setNote(''); await load()
  }

  async function openSendModal() {
    // Backstop against an off-year send: the year is already visible in the picker
    // and the button, but confirm if it deviates from the computed current season.
    if (year !== cy && !window.confirm(`Creating a ${year} contract — the current season is ${cy}. Is that right?`)) return
    setWorking(true); setSendResult(null)
    const res = await fetch('/api/seasonal-contracts/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: guestId, season_year: year }),
    })
    const d = await res.json()
    setWorking(false)
    if (!res.ok) { setErr(d.error || 'Could not open packet.'); return }
    const c = d.contract
    setDraft(c)
    setOccupants(Array.isArray(c.occupants) ? c.occupants : [])
    setTotalDue(c.total_due_cents != null ? (c.total_due_cents / 100).toFixed(2) : '')
    setOpens(c.season_opens || '')
    setCloses(c.season_closes || '')
    setModal(true)
  }

  async function saveAndSend() {
    if (!draft) return
    setWorking(true); setSendResult(null)
    // 1) Persist the staff-edited fields FIRST. Send FREEZES the contract into a
    // legal document, so if this save fails we ABORT — never send on top of unsaved
    // edits (that would freeze wrong data). Editor stays open; nothing is sent.
    const saveRes = await fetch(`/api/seasonal-contracts/${draft.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        occupants,
        total_due_cents: totalDue ? Math.round(parseFloat(totalDue) * 100) : null,
        season_opens: opens || null,
        season_closes: closes || null,
      }),
    })
    if (!saveRes.ok) {
      let msg = 'Could not save the edits — packet NOT sent.'
      try { const e = await saveRes.json(); if (e?.error) msg = `Could not save the edits (${e.error}) — packet NOT sent.` } catch {}
      setWorking(false)
      toast.error(msg)
      return
    }
    // 2) Edits are confirmed saved → only now freeze + send.
    const res = await fetch(`/api/seasonal-contracts/${draft.id}/send`, { method: 'POST' })
    const d = await res.json()
    setWorking(false)
    if (!res.ok || !d.ok) { setSendResult({ emailed: false, error: d.error || 'Send failed.' }); return }
    // Packet is committed (emailed or not) → close the modal; the banner + reloaded
    // status show the outcome, and a failed email can be retried with Resend.
    setSendResult({ emailed: !!d.emailed, error: d.error || undefined })
    setModal(false)
    await load()
  }

  async function resend() {
    if (!data?.currentContract?.id) return
    setWorking(true)
    const res = await fetch(`/api/seasonal-contracts/${data.currentContract.id}/resend`, { method: 'POST' })
    const d = await res.json()
    setWorking(false)
    setSendResult({ emailed: !!d.emailed, error: d.error || undefined })
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>
  if (err && !data) return <div className="p-6 text-red-600">{err}</div>

  const current = data?.currentContract
  const status = current?.status || 'none'
  const g = data?.guest || {}
  const hasAddress = !!(g.home_street && g.home_city && g.home_state && g.home_zip)

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <Toaster />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <Link href="/admin/seasonals" className="text-sm text-gray-400 hover:text-gray-600">← Seasonals</Link>
          <h2 className="text-2xl font-bold text-gray-900">{data?.guest?.name}</h2>
          <p className="text-sm text-gray-500">Site {data?.guest?.site_number || '—'} · {year} season</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/seasonals/new?guestId=${guestId}`} className="px-3 py-2 rounded-lg text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">↗ Full form</Link>
          <label className="text-xs font-medium text-gray-500">Season</label>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-900">
            {[cy - 1, cy, cy + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {status === 'signed'
            ? <span className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: '#f0fdf4', color: '#15803d' }}>✓ Packet signed</span>
            : status === 'sent'
              ? <button onClick={resend} disabled={working} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#2E6B8A' }}>{working ? '…' : '↻ Resend email'}</button>
              : <button onClick={openSendModal} disabled={working} className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ background: '#15803d' }}>{working ? '…' : `✉ Send ${year} packet`}</button>}
        </div>
      </div>

      {sendResult && (
        <div className="rounded-lg px-3 py-2 text-sm mb-3" style={sendResult.emailed ? { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' } : { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
          {sendResult.emailed ? 'Packet emailed to the camper.' : `Packet created, but the email did not send${sendResult.error ? `: ${sendResult.error}` : ''}. Use “Resend email”.`}
        </div>
      )}

      {data && !hasAddress && (
        <div className="rounded-lg px-3 py-2 text-sm mb-3" style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
          ⚠ Home address required for seasonal campers — add it below. It prints on the contract and is the mailing fallback if email delivery fails.
        </div>
      )}

      {data && <SeasonalSections data={data} mode="admin" />}

      {/* Rig editor (writes to guests) */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide">Edit rig (saved to the camper record)</h3>
          <button onClick={() => setRigOpen(o => !o)} className="text-sm font-semibold" style={{ color: 'var(--accent-color, #2E6B8A)' }}>{rigOpen ? 'Cancel' : 'Edit'}</button>
        </div>
        {rigOpen && (
          <div className="mt-3">
            <RigEditor value={rig} onChange={setRig} />
            <div className="mt-3">
              <button onClick={saveRig} disabled={savingRig} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#15803d' }}>{savingRig ? 'Saving…' : 'Save rig'}</button>
            </div>
          </div>
        )}
      </div>

      {/* Home address editor (writes to guests) — required for seasonal campers */}
      <div className="bg-white rounded-xl border p-5 mb-4" style={{ borderColor: hasAddress ? '#f3f4f6' : '#fde68a' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: hasAddress ? '#9ca3af' : '#b45309' }}>
            Home address {hasAddress ? '(saved to the camper record)' : '· required'}
          </h3>
          <button onClick={() => setAddrOpen(o => !o)} className="text-sm font-semibold" style={{ color: 'var(--accent-color, #2E6B8A)' }}>{addrOpen ? 'Cancel' : 'Edit'}</button>
        </div>
        {!addrOpen && (
          <p className="text-sm mt-2" style={{ color: hasAddress ? '#374151' : '#9ca3af' }}>
            {hasAddress
              ? <>{g.home_street}<br />{[[g.home_city, g.home_state].filter(Boolean).join(', '), g.home_zip].filter(Boolean).join(' ')}</>
              : 'No address on file.'}
          </p>
        )}
        {addrOpen && (
          <div className="mt-3">
            <AddressEditor value={addr} onChange={setAddr} required />
            <div className="mt-3">
              <button onClick={saveAddr} disabled={savingAddr} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#15803d' }}>{savingAddr ? 'Saving…' : 'Save address'}</button>
            </div>
          </div>
        )}
      </div>

      {/* Add note (append-only) */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-2">Add a note</h3>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Add a note (append-only — can't be edited or deleted)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <div className="mt-2"><button onClick={addNote} disabled={savingNote || !note.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#2E6B8A' }}>{savingNote ? 'Adding…' : 'Add note'}</button></div>
      </div>

      {/* Send-packet modal */}
      {modal && draft && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => !working && setModal(false)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[460px] bg-white rounded-2xl shadow-2xl z-50 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Send {year} packet</h3>
              <p className="text-sm text-gray-500 mt-0.5">{data?.guest?.name} · reviewed before sending</p>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[65vh] overflow-y-auto">
              <PartyEditor value={occupants} onChange={setOccupants} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Season opens</label>
                  <input type="date" value={opens || ''} onChange={e => setOpens(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Season closes</label>
                  <input type="date" value={closes || ''} onChange={e => setCloses(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Total due (display only, $)</label>
                <input type="number" step="0.01" value={totalDue} onChange={e => setTotalDue(e.target.value)} placeholder="0.00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <p className="text-xs text-gray-400">Rig details are pulled from the camper record at send. Edit them above if needed before sending.</p>
              {sendResult && !sendResult.emailed && <div className="text-sm text-amber-700">{sendResult.error}</div>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={() => setModal(false)} disabled={working} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={saveAndSend} disabled={working} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: '#15803d' }}>{working ? 'Sending…' : 'Send packet →'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
