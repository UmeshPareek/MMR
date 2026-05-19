import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate } from '@/utils/helpers'
import { Modal, Spinner, EmptyState } from '@/components/ui'
import { LogIn, Home } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { checkTenantLimit } from '@/utils/orgLimits'

const EMPTY = () => ({ full_name:'', phone:'', email:'', building_id:'', flat_id:'', monthly_rent:'', move_in_date: new Date().toISOString().slice(0,10), security_deposit_paid:'', advance_paid:'0', rent_type:'prepaid', id_type:'aadhar', id_number:'', notes:'' })

function getFloor(doorNumber) {
  if (!doorNumber) return 'Ground / Other'
  const num = doorNumber.toString().replace(/[^0-9]/g, '')
  if (!num) return doorNumber.toString().charAt(0).toUpperCase() + ' Block'
  const floorNum = Math.floor(parseInt(num) / 100)
  if (floorNum === 0) return 'Ground Floor'
  return 'Floor ' + floorNum
}

export default function CheckIn() {
  const { profile } = useAuth()
  const channelRef = useRef(null)
  const [buildings, setBuildings] = useState([])
  const [activeTenants, setActiveTenants] = useState([])
  const [vacantFlats, setVacantFlats] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY())
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAll()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('checkin-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flats' }, () => loadAll())
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [{ data: b }, { data: t }, { data: allFlats }, { data: allBuildings }] = await Promise.all([
        supabase.from('buildings').select('id,name').eq('is_active', true).order('name'),
        supabase.from('tenants').select('*').eq('status','active').order('full_name'),
        supabase.from('flats').select('id,door_number'),
        supabase.from('buildings').select('id,name'),
      ])
      const flatMap = {}
      ;(allFlats||[]).forEach(f => { flatMap[f.id] = f })
      const buildingMap = {}
      ;(allBuildings||[]).forEach(b => { buildingMap[b.id] = b })
      setBuildings(b || [])
      setActiveTenants((t||[]).map(t => ({ ...t, flat: flatMap[t.flat_id]||null, building: buildingMap[t.building_id]||null })))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  async function deleteCheckin(t) {
    if (!window.confirm(`Delete check-in for ${t.full_name}? Flat will be restored to vacant.`)) return
    const { error } = await supabase.from('tenants').delete().eq('id', t.id)
    if (error) return toast.error(error.message)
    if (t.flat_id) await supabase.from('flats').update({ status:'vacant', current_tenant_id: null }).eq('id', t.flat_id)
    toast.success('Check-in deleted ✓')
    loadAll()
  }

  async function loadVacantFlats(buildingId) {
    const { data } = await supabase.from('flats')
      .select('id,door_number,monthly_rent')
      .eq('building_id', buildingId).eq('status','vacant').order('door_number')
    setVacantFlats(data || [])
  }

  async function save() {
    if (!form.full_name || !form.phone || !form.flat_id || !form.building_id)
      return toast.error('Name, phone, building and flat are required')
    const { allowed, reason } = await checkTenantLimit(profile?.id)
    if (!allowed) return toast.error(reason)
    setSaving(true)
    // Use exact same payload structure as Tenants.jsx which works
    const payload = {
      full_name: form.full_name,
      phone: form.phone,
      building_id: form.building_id,
      flat_id: form.flat_id,
      monthly_rent: parseFloat(form.monthly_rent) || 0,
      move_in_date: form.move_in_date,
      security_deposit_paid: parseFloat(form.security_deposit_paid) || 0,
      security_deposit_months: 2,
      status: 'active',
    }
    if (form.email) payload.email = form.email
    if (form.id_type) payload.id_type = form.id_type
    if (form.id_number) payload.id_number = form.id_number
    if (form.notes) payload.notes = form.notes

    const { data: t, error } = await supabase.from('tenants').insert(payload).select().single()
    if (error) { setSaving(false); return toast.error(error.message) }
    await supabase.from('flats').update({ status:'occupied', current_tenant_id: t.id }).eq('id', form.flat_id)
    if (parseFloat(form.security_deposit_paid) > 0) {
      const { error: sdError } = await supabase.from('security_deposits').insert({
        tenant_id: t.id, flat_id: form.flat_id, building_id: form.building_id,
        amount: parseFloat(form.security_deposit_paid),
        deposit_type: 'collection',
        deposit_date: form.move_in_date,
        notes: `Check-in ${form.move_in_date}`
      })
      if (sdError) console.error('Security deposit record failed:', sdError.message)
    }
    setSaving(false)
    toast.success(`${form.full_name} checked in ✓`)
    setModal(false); setForm(EMPTY()); setVacantFlats([]); loadAll()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Check In</h2>
          <p className="text-surface-500 text-sm mt-1">{activeTenants.length} active tenants</p>
        </div>
        <button onClick={() => { setForm(EMPTY()); setVacantFlats([]); setModal(true) }} className="btn-primary flex items-center gap-2">
          <LogIn className="w-4 h-4"/> New Check In
        </button>
      </div>

      <div className="card overflow-hidden">
        {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
        : activeTenants.length === 0
          ? <EmptyState icon={Home} title="No active tenants" description="Check in your first tenant to get started" />
          : (
            <table className="data-table">
              <thead><tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Move In</th><th>Rent</th><th>Deposit</th><th>Type</th><th></th></tr></thead>
              <tbody>
                {activeTenants.map(t => (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 text-sm">{t.full_name.charAt(0)}</div>
                        <div><p className="font-medium text-surface-800">{t.full_name}</p><p className="text-xs text-surface-400">{t.phone}</p></div>
                      </div>
                    </td>
                    <td className="text-sm text-surface-600">{t.building?.name||'—'}</td>
                    <td className="font-mono font-semibold">{t.flat?.door_number||'—'}</td>
                    <td className="text-xs text-surface-500">{fmtDate(t.move_in_date)}</td>
                    <td className="font-mono">{formatCurrency(t.monthly_rent)}</td>
                    <td className="font-mono text-emerald-700">{formatCurrency(t.security_deposit_paid||0)}</td>
                    <td><span className={`badge border text-xs ${t.rent_type==='postpaid'?'bg-amber-50 text-amber-700 border-amber-200':'bg-brand-50 text-brand-700 border-brand-200'}`}>{t.rent_type==='postpaid'?'Postpaid':'Prepaid'}</span></td>
                    <td>
                      <button onClick={() => deleteCheckin(t)} title="Delete wrong check-in"
                        className="btn-ghost p-1.5 text-surface-300 hover:text-red-500 transition-colors">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <Modal open={modal} onClose={() => { setModal(false); setForm(EMPTY()); setVacantFlats([]) }} title="New Tenant Check In" size="lg">
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label mb-2">Rent Type</label>
            <div className="flex gap-3">
              {[['prepaid','Prepaid (advance)'],['postpaid','Postpaid (arrears)']].map(([v,l])=>(
                <button key={v} type="button" onClick={()=>setForm(p=>({...p,rent_type:v}))}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${form.rent_type===v?'border-brand-500 bg-brand-50 text-brand-700':'border-surface-200 text-surface-500'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="form-group"><label className="label">Full Name *</label><input className="input" value={form.full_name} onChange={e=>setForm(p=>({...p,full_name:e.target.value}))} autoFocus /></div>
          <div className="form-group"><label className="label">Phone *</label><input className="input" value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} /></div>
          <div className="form-group">
            <label className="label">Building *</label>
            <select className="select" value={form.building_id} onChange={e=>{setForm(p=>({...p,building_id:e.target.value,flat_id:'',monthly_rent:'',security_deposit_paid:''}));loadVacantFlats(e.target.value)}}>
              <option value="">— Select —</option>
              {buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Flat (Vacant only) *</label>
            <select className="select" value={form.flat_id} onChange={e=>{const f=vacantFlats.find(fl=>fl.id===e.target.value);setForm(p=>({...p,flat_id:e.target.value,monthly_rent:f?.monthly_rent||'',security_deposit_paid:f?String(Number(f.monthly_rent||0)*2):p.security_deposit_paid}))}}>
              <option value="">— Select flat —</option>
              {vacantFlats.length===0&&form.building_id?<option disabled>No vacant flats</option>:vacantFlats.map(f=><option key={f.id} value={f.id}>{f.door_number} — ₹{Number(f.monthly_rent).toLocaleString('en-IN')}/mo</option>)}
            </select>
            {form.building_id&&vacantFlats.length===0&&<p className="text-xs text-red-500 mt-1">No vacant flats</p>}
          </div>
          <div className="form-group"><label className="label">Monthly Rent (₹)</label><input type="number" className="input" value={form.monthly_rent} onChange={e=>setForm(p=>({...p,monthly_rent:e.target.value}))} /></div>
          <div className="form-group"><label className="label">Move In Date</label><input type="date" className="input" value={form.move_in_date} onChange={e=>setForm(p=>({...p,move_in_date:e.target.value}))} /></div>
          <div className="form-group"><label className="label">Security Deposit (₹)</label><input type="number" className="input" value={form.security_deposit_paid} onChange={e=>setForm(p=>({...p,security_deposit_paid:e.target.value}))} placeholder="Auto: 2× rent" /></div>
          <div className="form-group"><label className="label">Advance Paid (₹)</label><input type="number" className="input" value={form.advance_paid} onChange={e=>setForm(p=>({...p,advance_paid:e.target.value}))} /></div>
          <div className="form-group">
            <label className="label">ID Type</label>
            <select className="select" value={form.id_type} onChange={e=>setForm(p=>({...p,id_type:e.target.value}))}>
              {['aadhar','pan','passport','driving_license','voter_id','other'].map(t=><option key={t} value={t}>{t.replace('_',' ').toUpperCase()}</option>)}
            </select>
          </div>
          <div className="form-group"><label className="label">ID Number</label><input className="input" value={form.id_number} onChange={e=>setForm(p=>({...p,id_number:e.target.value}))} /></div>
          <div className="form-group col-span-2"><label className="label">Notes</label><input className="input" value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} /></div>
          {form.flat_id && (
            <div className="col-span-2 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
              <p className="text-sm font-semibold text-emerald-800 mb-2">Check-in Summary</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-emerald-600">Rent</p><p className="font-mono font-bold">{formatCurrency(parseFloat(form.monthly_rent)||0)}</p></div>
                <div><p className="text-xs text-emerald-600">Deposit</p><p className="font-mono font-bold">{formatCurrency(parseFloat(form.security_deposit_paid)||0)}</p></div>
                <div><p className="text-xs text-emerald-600">Type</p><p className="font-medium capitalize">{form.rent_type}</p></div>
              </div>
            </div>
          )}
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => { setModal(false); setForm(EMPTY()); setVacantFlats([]) }}>Cancel</button>
          <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving}>
            {saving ? <Spinner size={16}/> : <><LogIn className="w-4 h-4"/>Confirm Check In</>}
          </button>
        </div>
      </Modal>
    </div>
  )
}
