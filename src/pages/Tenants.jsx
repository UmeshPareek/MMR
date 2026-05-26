import { useEffect, useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, currentMonth } from '@/utils/helpers'
import { Modal, Badge, EmptyState, Spinner, ConfirmDialog, SearchInput } from '@/components/ui'
import { Users, Plus, Edit2, Trash2, Phone, Home, TrendingUp, AlertCircle, UserCheck, UserX, Calendar } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

const STATUS_MAP = { active: 'success', vacated: 'default', notice: 'warning' }

function tenureLabel(moveIn) {
  if (!moveIn) return '—'
  const days = Math.floor((Date.now() - new Date(moveIn)) / 86400000)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`
}

function avatarColor(name = '') {
  const h = (name.charCodeAt(0) * 7 + (name.charCodeAt(1) || 0) * 13) % 360
  return `hsl(${h}, 50%, 45%)`
}

const defaultForm = () => ({
  full_name: '', phone: '', email: '', id_type: '', id_number: '',
  flat_id: '', building_id: '', move_in_date: new Date().toISOString().slice(0, 10), monthly_rent: '',
  security_deposit_paid: '', security_deposit_months: 2,
  emergency_contact: '', emergency_phone: '', status: 'active', notes: ''
})

export default function Tenants() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const channelRef = useRef(null)
  const location = useLocation()
  const [tenants, setTenants] = useState([])
  const [buildings, setBuildings] = useState([])
  const [flats, setFlats] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [modal, setModal] = useState(false)
  const [editTenant, setEditTenant] = useState(null)
  const [form, setForm] = useState(defaultForm())
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    load(); loadBuildings()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('tenants-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flats' }, () => load())
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [statusFilter])

  async function load() {
    setLoading(true)
    let q = supabase.from('tenants').select('*').order('full_name')
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const { data, error } = await q
    if (error) { toast.error('Failed to load tenants'); setLoading(false); return }

    const flatIds = [...new Set((data || []).map(t => t.flat_id).filter(Boolean))]
    const buildingIds = [...new Set((data || []).map(t => t.building_id).filter(Boolean))]

    const [{ data: flatsData }, { data: buildingsData }] = await Promise.all([
      flatIds.length ? supabase.from('flats').select('id, door_number').in('id', flatIds) : { data: [] },
      buildingIds.length ? supabase.from('buildings').select('id, name').in('id', buildingIds) : { data: [] },
    ])

    const flatMap = {}
    ;(flatsData || []).forEach(f => { flatMap[f.id] = f })
    const buildingMap = {}
    ;(buildingsData || []).forEach(b => { buildingMap[b.id] = b })

    setTenants((data || []).map(t => ({
      ...t,
      flat: t.flat_id ? flatMap[t.flat_id] : null,
      building: t.building_id ? buildingMap[t.building_id] : null,
    })))
    setLoading(false)
  }

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name')
    setBuildings(data || [])
  }

  async function loadFlats(buildingId) {
    const { data } = await supabase.from('flats').select('id, door_number, monthly_rent').eq('building_id', buildingId).in('status', ['vacant', 'occupied']).order('door_number')
    setFlats(data || [])
  }

  function openAdd() { setEditTenant(null); setForm(defaultForm()); setFlats([]); setModal(true) }

  function openEdit(t) {
    setEditTenant(t)
    setForm({ full_name: t.full_name, phone: t.phone, email: t.email || '', id_type: t.id_type || '', id_number: t.id_number || '', flat_id: t.flat_id || '', building_id: t.building_id || '', move_in_date: t.move_in_date || '', monthly_rent: t.monthly_rent || '', security_deposit_paid: t.security_deposit_paid || '', security_deposit_months: t.security_deposit_months || 2, emergency_contact: t.emergency_contact || '', emergency_phone: t.emergency_phone || '', status: t.status, notes: t.notes || '' })
    if (t.building_id) loadFlats(t.building_id)
    setModal(true)
  }

  async function save() {
    if (!form.full_name || !form.phone) return toast.error('Name and phone are required')
    setSaving(true)
    const payload = { ...form, monthly_rent: parseFloat(form.monthly_rent) || 0, security_deposit_paid: parseFloat(form.security_deposit_paid) || 0, security_deposit_months: parseInt(form.security_deposit_months) || 2, created_by: profile?.id, org_id: profile?.org_id }
    if (!payload.flat_id) delete payload.flat_id
    if (!payload.building_id) delete payload.building_id

    let error
    if (editTenant) {
      ({ error } = await supabase.from('tenants').update(payload).eq('id', editTenant.id))
      if (!error && form.flat_id) {
        await supabase.from('flats').update({ status: form.status === 'active' ? 'occupied' : 'vacant', current_tenant_id: form.status === 'active' ? editTenant.id : null }).eq('id', form.flat_id)
      }
    } else {
      const { data: newTenant, error: e } = await supabase.from('tenants').insert(payload).select().single()
      error = e
      if (!error && form.flat_id && newTenant) {
        await supabase.from('flats').update({ status: 'occupied', current_tenant_id: newTenant.id }).eq('id', form.flat_id)
        if (parseFloat(form.security_deposit_paid) > 0) {
          await supabase.from('security_deposits').insert({
            tenant_id: newTenant.id, flat_id: form.flat_id, building_id: form.building_id,
            amount_expected: parseFloat(form.security_deposit_paid), amount_paid: parseFloat(form.security_deposit_paid),
            payment_date: form.move_in_date || new Date().toISOString().slice(0, 10),
            status: 'collected', notes: 'Auto-created from tenant onboarding',
            org_id: profile?.org_id,
          }).then(({ error: de }) => { if (!de) toast.success('Security deposit record created automatically') })
        }
      }
    }

    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editTenant ? 'Tenant updated' : 'Tenant added')
    setModal(false); load()
  }

  async function doDelete(id) {
    const { data: tenant } = await supabase.from('tenants').select('flat_id').eq('id', id).single()
    const { error } = await supabase.from('tenants').update({ status: 'vacated', move_out_date: new Date().toISOString().slice(0, 10) }).eq('id', id)
    if (error) return toast.error(error.message)
    if (tenant?.flat_id) {
      await supabase.from('flats').update({ status: 'vacant' }).eq('id', tenant.flat_id)
    }
    toast.success('Tenant vacated — flat marked vacant'); setDeleteConfirm(null); load()
  }

  const filtered = tenants.filter(t =>
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (t.phone || '').includes(search) ||
    (t.flat?.door_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (t.building?.name || '').toLowerCase().includes(search.toLowerCase())
  )

  const activeCount = tenants.filter(t => t.status === 'active').length
  const noticeCount = tenants.filter(t => t.status === 'notice').length
  const vacatedCount = tenants.filter(t => t.status === 'vacated').length
  const totalRent = tenants.filter(t => t.status === 'active').reduce((s, t) => s + (parseFloat(t.monthly_rent) || 0), 0)

  const STATUS_TABS = [
    { v: 'active', label: 'Active', count: activeCount, icon: <UserCheck size={13} />, color: 'text-emerald-600' },
    { v: 'notice', label: 'Notice', count: noticeCount, icon: <AlertCircle size={13} />, color: 'text-amber-600' },
    { v: 'vacated', label: 'Vacated', count: vacatedCount, icon: <UserX size={13} />, color: 'text-surface-400' },
    { v: 'all', label: 'All', count: tenants.length, icon: <Users size={13} />, color: 'text-brand-600' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Tenants</h2>
          <p className="text-surface-500 text-sm mt-1">{activeCount} active · {formatCurrency(totalRent)}/mo income</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Search tenants…" />
          <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Tenant</button>
        </div>
      </div>

      {/* Stat pills + status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_TABS.map(({ v, label, count, icon, color }) => (
          <button
            key={v}
            onClick={() => setStatusFilter(v)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium border transition-all ${statusFilter === v ? 'bg-brand-600 text-white border-brand-600 shadow-sm' : 'bg-white text-surface-600 border-surface-200 hover:border-surface-300'}`}
          >
            <span className={statusFilter === v ? 'text-white' : color}>{icon}</span>
            {label}
            <span className={`ml-0.5 text-xs font-semibold ${statusFilter === v ? 'text-brand-100' : 'text-surface-400'}`}>{count}</span>
          </button>
        ))}
        {statusFilter === 'active' && totalRent > 0 && (
          <div className="ml-auto flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
            <TrendingUp size={14} className="text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-700 font-mono">{formatCurrency(totalRent)}<span className="font-normal text-emerald-500">/mo</span></span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No tenants found" description="Add a tenant to start tracking rent" action={<button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Tenant</button>} />
      ) : (
        <div className="card overflow-hidden">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Building / Flat</th>
                  <th className="text-right">Monthly Rent</th>
                  <th className="text-right">Deposit</th>
                  <th>Move In</th>
                  <th>Tenure</th>
                  <th>Status</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="group">
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0"
                          style={{ background: avatarColor(t.full_name) }}
                        >
                          {t.full_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-surface-800 leading-tight">{t.full_name}</p>
                          <p className="text-xs text-surface-400 font-mono">{t.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      {t.building?.name
                        ? <div>
                            <p className="text-surface-700 text-sm">{t.building.name}</p>
                            {t.flat?.door_number && <p className="text-xs text-surface-400 font-mono">{t.flat.door_number}</p>}
                          </div>
                        : <span className="text-surface-300">—</span>}
                    </td>
                    <td className="text-right amount-neutral">{formatCurrency(t.monthly_rent)}</td>
                    <td className="text-right amount-positive">{formatCurrency(t.security_deposit_paid)}</td>
                    <td>
                      <div className="flex items-center gap-1 text-surface-500 text-xs">
                        <Calendar size={11} className="flex-shrink-0" />
                        {fmtDate(t.move_in_date)}
                      </div>
                    </td>
                    <td>
                      <span className="text-xs font-mono text-surface-500 bg-surface-100 px-2 py-0.5 rounded-full">
                        {tenureLabel(t.move_in_date)}
                      </span>
                    </td>
                    <td><Badge variant={STATUS_MAP[t.status] || 'default'}>{t.status}</Badge></td>
                    <td>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="p-1.5 text-surface-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                          onClick={() => openEdit(t)} title="Edit"
                        ><Edit2 size={13} /></button>
                        <button
                          className="p-1.5 text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          onClick={() => setDeleteConfirm({ id: t.id, name: t.full_name })} title="Mark vacated"
                        ><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editTenant ? 'Edit Tenant' : 'Add Tenant'} size="xl">
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group sm:col-span-2 border-b border-surface-200 pb-3 mb-1">
            <p className="text-xs text-surface-500 uppercase tracking-wider font-semibold">Personal Details</p>
          </div>
          <div className="form-group">
            <label className="label">Full Name *</label>
            <input className="input" value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder="Tenant full name" />
          </div>
          <div className="form-group">
            <label className="label">Phone *</label>
            <input className="input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="9876543210" />
          </div>
          <div className="form-group">
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">ID Type</label>
            <select className="select" value={form.id_type} onChange={e => setForm(p => ({ ...p, id_type: e.target.value }))}>
              <option value="">— Select —</option>
              {['Aadhaar', 'PAN', 'Passport', 'Voter ID', 'Driving License'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">ID Number</label>
            <input className="input" value={form.id_number} onChange={e => setForm(p => ({ ...p, id_number: e.target.value }))} placeholder="Document number" />
          </div>
          <div className="form-group">
            <label className="label">Emergency Contact</label>
            <input className="input" value={form.emergency_contact} onChange={e => setForm(p => ({ ...p, emergency_contact: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Emergency Phone</label>
            <input className="input" value={form.emergency_phone} onChange={e => setForm(p => ({ ...p, emergency_phone: e.target.value }))} />
          </div>

          <div className="form-group sm:col-span-2 border-b border-t border-surface-200 py-3 mt-1 mb-1">
            <p className="text-xs text-surface-500 uppercase tracking-wider font-semibold">Property & Rent Details</p>
          </div>
          <div className="form-group">
            <label className="label">Building</label>
            <select className="select" value={form.building_id} onChange={e => { setForm(p => ({ ...p, building_id: e.target.value, flat_id: '' })); loadFlats(e.target.value) }}>
              <option value="">— Select building —</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Flat</label>
            <select className="select" value={form.flat_id} onChange={e => { const f = flats.find(fl => fl.id === e.target.value); setForm(p => ({ ...p, flat_id: e.target.value, monthly_rent: f?.monthly_rent || p.monthly_rent, security_deposit_paid: f ? String(Number(f.monthly_rent || 0) * 2) : p.security_deposit_paid })) }}>
              <option value="">— Select flat —</option>
              {flats.map(f => <option key={f.id} value={f.id}>{f.door_number} (₹{f.monthly_rent?.toLocaleString('en-IN')})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Monthly Rent (₹) *</label>
            <input type="number" className="input" value={form.monthly_rent} onChange={e => setForm(p => ({ ...p, monthly_rent: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Security Deposit Paid (₹)</label>
            <input type="number" className="input" value={form.security_deposit_paid} onChange={e => setForm(p => ({ ...p, security_deposit_paid: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Deposit Months</label>
            <input type="number" className="input" value={form.security_deposit_months} onChange={e => setForm(p => ({ ...p, security_deposit_months: e.target.value }))} min="1" max="12" />
          </div>
          <div className="form-group">
            <label className="label">Move In Date</label>
            <input type="date" className="input" value={form.move_in_date} onChange={e => setForm(p => ({ ...p, move_in_date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Status</label>
            <select className="select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="notice">Notice Period</option>
              <option value="vacated">Vacated</option>
            </select>
          </div>
          <div className="form-group sm:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input min-h-[70px] resize-none" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner size={16} /> : (editTenant ? 'Update Tenant' : 'Add Tenant')}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} onConfirm={() => doDelete(deleteConfirm?.id)} title="Mark as Vacated" message={`Mark "${deleteConfirm?.name}" as vacated?`} danger />
    </div>
  )
}
