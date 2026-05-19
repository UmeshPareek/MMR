import { useEffect, useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, currentMonth } from '@/utils/helpers'
import { Modal, Badge, EmptyState, Spinner, ConfirmDialog, SearchInput } from '@/components/ui'
import { Users, Plus, Edit2, Trash2, Phone, Home } from 'lucide-react'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

const STATUS_MAP = { active: 'success', vacated: 'default', notice: 'warning' }

const defaultForm = () => ({
  full_name: '', phone: '', email: '', id_type: '', id_number: '',
  flat_id: '', building_id: '', move_in_date: new Date().toISOString().slice(0,10), monthly_rent: '',
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
    if (error) { console.error('Tenants error:', error); setLoading(false); return; }

    // Fetch flats and buildings separately
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

    const enriched = (data || []).map(t => ({
      ...t,
      flat: t.flat_id ? flatMap[t.flat_id] : null,
      building: t.building_id ? buildingMap[t.building_id] : null,
    }))
    setTenants(enriched)
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
    const payload = { ...form, monthly_rent: parseFloat(form.monthly_rent) || 0, security_deposit_paid: parseFloat(form.security_deposit_paid) || 0, security_deposit_months: parseInt(form.security_deposit_months) || 2, created_by: profile?.id }
    if (!payload.flat_id) delete payload.flat_id
    if (!payload.building_id) delete payload.building_id

    let error
    if (editTenant) {
      ({ error } = await supabase.from('tenants').update(payload).eq('id', editTenant.id))
      // Update flat status
      if (!error && form.flat_id) {
        await supabase.from('flats').update({ status: form.status === 'active' ? 'occupied' : 'vacant', current_tenant_id: form.status === 'active' ? editTenant.id : null }).eq('id', form.flat_id)
      }
    } else {
      const { data: newTenant, error: e } = await supabase.from('tenants').insert(payload).select().single()
      error = e
      if (!error && form.flat_id && newTenant) {
        // Mark flat occupied
        await supabase.from('flats').update({ status: 'occupied', current_tenant_id: newTenant.id }).eq('id', form.flat_id)
        // Auto-create security deposit record
        if (parseFloat(form.security_deposit_paid) > 0) {
          await supabase.from('security_deposits').insert({
            tenant_id: newTenant.id,
            flat_id: form.flat_id,
            building_id: form.building_id,
            amount_expected: parseFloat(form.security_deposit_paid),
            amount_paid: parseFloat(form.security_deposit_paid),
            payment_date: form.move_in_date || new Date().toISOString().slice(0,10),
            status: 'collected',
            notes: 'Auto-created from tenant onboarding',
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
    // Get tenant's flat_id first
    const { data: tenant } = await supabase.from('tenants').select('flat_id').eq('id', id).single()
    const { error } = await supabase.from('tenants').update({ status: 'vacated', move_out_date: new Date().toISOString().slice(0,10) }).eq('id', id)
    if (error) return toast.error(error.message)
    // Mark flat as vacant
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Tenants</h2>
          <p className="text-surface-500 text-sm mt-1">{tenants.length} {statusFilter !== 'all' ? statusFilter : ''} tenants</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Search tenants…" />
          <select className="select w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="notice">Notice</option>
            <option value="vacated">Vacated</option>
          </select>
          <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Tenant</button>
        </div>
      </div>

      {loading ? <div className="flex justify-center py-20"><Spinner size={32} /></div> : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No tenants found" description="Add a tenant to start tracking rent" action={<button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Tenant</button>} />
      ) : (
        <div className="card overflow-hidden">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Building</th>
                  <th>Flat</th>
                  <th>Monthly Rent</th>
                  <th>Security Paid</th>
                  <th>Move In</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id}>
                    <td className="font-semibold text-surface-800">{t.full_name}</td>
                    <td className="font-mono text-sm">{t.phone}</td>
                    <td>{t.building?.name || '—'}</td>
                    <td>{t.flat?.door_number || '—'}</td>
                    <td className="amount-neutral">{formatCurrency(t.monthly_rent)}</td>
                    <td className="amount-positive">{formatCurrency(t.security_deposit_paid)}</td>
                    <td className="text-surface-500">{fmtDate(t.move_in_date)}</td>
                    <td><Badge variant={STATUS_MAP[t.status] || 'default'}>{t.status}</Badge></td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button className="btn-ghost btn-sm" onClick={() => openEdit(t)}><Edit2 size={13} /></button>
                        <button className="btn-ghost btn-sm text-expense" onClick={() => setDeleteConfirm({ id: t.id, name: t.full_name })}><Trash2 size={13} /></button>
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
          <div className="form-group sm:col-span-2 border-b border-surface-200 pb-4 mb-1">
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

          <div className="form-group sm:col-span-2 border-b border-t border-surface-200 py-4 mt-1 mb-1">
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
            <select className="select" value={form.flat_id} onChange={e => { const f = flats.find(fl => fl.id === e.target.value); setForm(p => ({ ...p, flat_id: e.target.value, monthly_rent: f?.monthly_rent || p.monthly_rent, security_deposit_paid: f ? String(Number(f.monthly_rent||0) * 2) : p.security_deposit_paid })) }}>
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
