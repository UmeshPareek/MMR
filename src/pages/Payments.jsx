import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, fmtMonth, currentMonth, exportToExcel } from '@/utils/helpers'
import { Modal, Badge, EmptyState, Spinner, PaymentModeBadge, SearchInput, Alert } from '@/components/ui'
import { CreditCard, Plus, Download, Filter, CheckCircle2, AlertCircle, BarChart3 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'rentok', 'crib', 'cheque', 'other']

const defaultForm = () => ({
  tenant_id: '', flat_id: '', building_id: '', amount: '', payment_mode: 'upi',
  payment_date: new Date().toISOString().split('T')[0], for_month: currentMonth(),
  transaction_ref: '', notes: ''
})

export default function Payments() {
  const { profile } = useAuth()
  const [payments, setPayments] = useState([])
  const [buildings, setBuildings] = useState([])
  const [tenants, setTenants] = useState([])
  const [flats, setFlats] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterBuilding, setFilterBuilding] = useState('')
  const [filterMonth, setFilterMonth] = useState(currentMonth())
  const [filterMode, setFilterMode] = useState('')

  // Stats
  const [monthStats, setMonthStats] = useState({ collected: 0, pending: 0, count: 0 })

  // Modal
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(defaultForm())
  const [saving, setSaving] = useState(false)

  // Utility charges modal
  const [utilityModal, setUtilityModal] = useState(false)
  const [uForm, setUForm] = useState({ tenant_id: '', flat_id: '', building_id: '', utility_type: 'electricity', amount: '', payment_mode: 'cash', charge_date: new Date().toISOString().split('T')[0], for_month: currentMonth(), notes: '' })

  useEffect(() => { loadPayments(); loadBuildings(); loadActiveTenants() }, [filterBuilding, filterMonth, filterMode])

  async function loadPayments() {
    setLoading(true)
    let q = supabase.from('rent_collections').select(`*, tenant:tenants(full_name, phone), flat:flats(door_number), building:buildings(name), collector:profiles(full_name)`).order('payment_date', { ascending: false })
    if (filterBuilding) q = q.eq('building_id', filterBuilding)
    if (filterMonth) q = q.eq('for_month', filterMonth)
    if (filterMode) q = q.eq('payment_mode', filterMode)
    const { data } = await q
    setPayments(data || [])

    // Compute month stats
    if (filterMonth) {
      const { data: allTenants } = await supabase.from('tenants').select('id, monthly_rent').eq('status', 'active')
      const totalExpected = (allTenants || []).reduce((s, t) => s + t.monthly_rent, 0)
      const collected = (data || []).reduce((s, p) => s + p.amount, 0)
      setMonthStats({ collected, pending: Math.max(totalExpected - collected, 0), count: data?.length || 0, total: allTenants?.length || 0 })
    }
    setLoading(false)
  }

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name')
    setBuildings(data || [])
  }

  async function loadActiveTenants() {
    const { data } = await supabase.from('tenants').select('id, full_name, phone, flat_id, building_id, monthly_rent, flat:flats(door_number), building:buildings(name)').eq('status', 'active').order('full_name')
    setTenants(data || [])
  }

  function openAdd() {
    setForm(defaultForm())
    setModal(true)
  }

  function handleTenantSelect(tenantId) {
    const t = tenants.find(x => x.id === tenantId)
    setForm(p => ({ ...p, tenant_id: tenantId, flat_id: t?.flat_id || '', building_id: t?.building_id || '', amount: t?.monthly_rent || '' }))
  }

  async function save() {
    if (!form.tenant_id || !form.amount || !form.payment_mode) return toast.error('Tenant, amount and payment mode are required')
    setSaving(true)
    const payload = { ...form, amount: parseFloat(form.amount), collected_by: profile?.id }
    const { error } = await supabase.from('rent_collections').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Payment recorded ✓')
    setModal(false); loadPayments()
  }

  async function saveUtility() {
    if (!uForm.building_id || !uForm.amount) return toast.error('Building and amount are required')
    setSaving(true)
    const payload = { ...uForm, amount: parseFloat(uForm.amount), collected_by: profile?.id }
    const { error } = await supabase.from('utility_charges').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Utility charge recorded ✓')
    setUtilityModal(false)
  }

  async function handleExport() {
    const rows = payments.map(p => ({
      'Date': p.payment_date,
      'Tenant': p.tenant?.full_name || '',
      'Phone': p.tenant?.phone || '',
      'Building': p.building?.name || '',
      'Flat': p.flat?.door_number || '',
      'For Month': fmtMonth(p.for_month),
      'Mode': p.payment_mode,
      'Ref': p.transaction_ref || '',
      'Amount': p.amount,
      'Collected By': p.collector?.full_name || '',
    }))
    exportToExcel(rows, 'Rent Collections', `rent-collections-${filterMonth || 'all'}.xlsx`)
    toast.success('Excel exported!')
  }

  const filtered = payments.filter(p =>
    !search ||
    (p.tenant?.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.flat?.door_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.transaction_ref || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Rent Collection</h2>
          <p className="text-surface-500 text-sm mt-1">
            {fmtMonth(filterMonth)} · {monthStats.count} payments collected
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-secondary" onClick={() => setUtilityModal(true)}>+ Utility Charge</button>
          <button className="btn-secondary" onClick={handleExport}><Download size={15} /> Export</button>
          <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Record Payment</button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-income shrink-0" />
          <div>
            <p className="text-surface-500 text-xs">Collected</p>
            <p className="font-display font-bold text-income text-lg">{formatCurrency(monthStats.collected, true)}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-expense shrink-0" />
          <div>
            <p className="text-surface-500 text-xs">Pending</p>
            <p className="font-display font-bold text-expense text-lg">{formatCurrency(monthStats.pending, true)}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <BarChart3 size={20} className="text-brand-500 shrink-0" />
          <div>
            <p className="text-surface-500 text-xs">Tenants Paid</p>
            <p className="font-display font-bold text-surface-800 text-lg">{monthStats.count} / {monthStats.total}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <Filter size={14} className="text-surface-500 shrink-0" />
        <input type="month" className="input w-40" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
        <select className="select w-48" value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)}>
          <option value="">All Buildings</option>
          {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="select w-36" value={filterMode} onChange={e => setFilterMode(e.target.value)}>
          <option value="">All Modes</option>
          {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_', ' ')}</option>)}
        </select>
        <SearchInput value={search} onChange={setSearch} placeholder="Search tenant / ref…" />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="table-container">
          {loading ? (
            <div className="py-20 flex justify-center"><Spinner size={32} /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={CreditCard} title="No payments found" description="Try adjusting the filters or record a new payment" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Tenant</th>
                  <th>Building</th>
                  <th>Flat</th>
                  <th>For Month</th>
                  <th>Mode</th>
                  <th>Ref</th>
                  <th className="text-right">Amount</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td className="text-surface-500 text-xs">{fmtDate(p.payment_date)}</td>
                    <td>
                      <p className="text-surface-800 font-medium">{p.tenant?.full_name || '—'}</p>
                      <p className="text-surface-500 text-xs">{p.tenant?.phone}</p>
                    </td>
                    <td className="text-surface-400">{p.building?.name || '—'}</td>
                    <td><span className="text-brand-500 font-mono text-sm">{p.flat?.door_number || '—'}</span></td>
                    <td className="text-surface-400">{fmtMonth(p.for_month)}</td>
                    <td><PaymentModeBadge mode={p.payment_mode} /></td>
                    <td className="font-mono text-xs text-surface-500">{p.transaction_ref || '—'}</td>
                    <td className="text-right amount-positive">{formatCurrency(p.amount)}</td>
                    <td className="text-surface-500 text-xs">{p.collector?.full_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-surface-200">
                  <td colSpan="7" className="px-4 py-3 text-surface-400 text-sm font-medium">Total ({filtered.length} entries)</td>
                  <td className="px-4 py-3 text-right amount-positive font-bold">{formatCurrency(filtered.reduce((s, p) => s + p.amount, 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* Record Payment Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Record Rent Payment" size="md">
        <div className="p-6 space-y-4">
          <Alert type="info">Select the tenant — rent amount auto-fills. Update if partial payment.</Alert>
          <div className="form-group">
            <label className="label">Tenant *</label>
            <select className="select" value={form.tenant_id} onChange={e => handleTenantSelect(e.target.value)}>
              <option value="">— Select tenant —</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.full_name} · {t.flat?.door_number} · {t.building?.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">For Month *</label>
              <input type="month" className="input" value={form.for_month} onChange={e => setForm(p => ({ ...p, for_month: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Payment Date *</label>
              <input type="date" className="input" value={form.payment_date} onChange={e => setForm(p => ({ ...p, payment_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Amount (₹) *</label>
              <input type="number" className="input" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Payment Mode *</label>
              <select className="select" value={form.payment_mode} onChange={e => setForm(p => ({ ...p, payment_mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Transaction Reference (UTR, UPI ID, etc.)</label>
            <input className="input" value={form.transaction_ref} onChange={e => setForm(p => ({ ...p, transaction_ref: e.target.value }))} placeholder="Optional but recommended" />
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <input className="input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner size={16} /> : 'Record Payment'}</button>
        </div>
      </Modal>

      {/* Utility Charge Modal */}
      <Modal open={utilityModal} onClose={() => setUtilityModal(false)} title="Record Utility Charge" size="md">
        <div className="p-6 space-y-4">
          <Alert type="warning">Water / Electricity charges collected from tenants.</Alert>
          <div className="form-group">
            <label className="label">Building *</label>
            <select className="select" value={uForm.building_id} onChange={e => setUForm(p => ({ ...p, building_id: e.target.value }))}>
              <option value="">— Select building —</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Tenant (optional)</label>
            <select className="select" value={uForm.tenant_id} onChange={e => { const t = tenants.find(x => x.id === e.target.value); setUForm(p => ({ ...p, tenant_id: e.target.value, flat_id: t?.flat_id || '' })) }}>
              <option value="">— All tenants / building level —</option>
              {tenants.filter(t => !uForm.building_id || t.building_id === uForm.building_id).map(t => <option key={t.id} value={t.id}>{t.full_name} · {t.flat?.door_number}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Utility Type *</label>
              <select className="select" value={uForm.utility_type} onChange={e => setUForm(p => ({ ...p, utility_type: e.target.value }))}>
                <option value="electricity">Electricity</option>
                <option value="water">Water</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">Amount (₹) *</label>
              <input type="number" className="input" value={uForm.amount} onChange={e => setUForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Payment Mode</label>
              <select className="select" value={uForm.payment_mode} onChange={e => setUForm(p => ({ ...p, payment_mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">For Month</label>
              <input type="month" className="input" value={uForm.for_month} onChange={e => setUForm(p => ({ ...p, for_month: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <input className="input" value={uForm.notes} onChange={e => setUForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setUtilityModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveUtility} disabled={saving}>{saving ? <Spinner size={16} /> : 'Record Charge'}</button>
        </div>
      </Modal>
    </div>
  )
}
