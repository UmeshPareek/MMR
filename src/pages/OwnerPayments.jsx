import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, fmtMonth, currentMonth } from '@/utils/helpers'
import { Modal, Badge, EmptyState, Spinner, PaymentModeBadge } from '@/components/ui'
import { Banknote, Plus, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { exportToExcel } from '@/utils/helpers'

const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'other']
const PAYMENT_TYPES = [
  { value: 'rent', label: 'Monthly Rent' },
  { value: 'security_deposit', label: 'Security Deposit' },
  { value: 'advance', label: 'Advance' },
  { value: 'other', label: 'Other' },
]

const defaultForm = () => ({
  owner_id: '', building_id: '', payment_type: 'rent', payment_mode: 'bank_transfer',
  amount: '', payment_date: new Date().toISOString().split('T')[0], for_month: currentMonth(),
  transaction_ref: '', notes: ''
})

export default function OwnerPayments() {
  const { profile } = useAuth()
  const channelRef = useRef(null)
  const [payments, setPayments] = useState([])
  const [owners, setOwners] = useState([])
  const [buildings, setBuildings] = useState([])
  const [filteredBuildings, setFilteredBuildings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterMonth, setFilterMonth] = useState(currentMonth())
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(defaultForm())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    load(); loadOwners(); loadBuildings()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('owner-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'owner_payments' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, () => loadBuildings())
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [filterMonth])

  async function load() {
    setLoading(true)
    let q = supabase.from('owner_payments').select(`*, owner:owners(name), building:buildings(name), paidBy:profiles(full_name)`).order('payment_date', { ascending: false })
    if (filterMonth) q = q.eq('for_month', filterMonth)
    const { data } = await q
    setPayments(data || [])
    setLoading(false)
  }

  async function loadOwners() {
    const { data } = await supabase.from('owners').select('id, name').eq('is_active', true).order('name')
    setOwners(data || [])
  }

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name, owner_id, monthly_rent_to_owner').eq('is_active', true).order('name')
    setBuildings(data || [])
  }

  function handleOwnerSelect(ownerId) {
    const fb = buildings.filter(b => b.owner_id === ownerId)
    setFilteredBuildings(fb)
    setForm(p => ({ ...p, owner_id: ownerId, building_id: '', amount: '' }))
  }

  function handleBuildingSelect(buildingId) {
    const b = buildings.find(x => x.id === buildingId)
    setForm(p => ({ ...p, building_id: buildingId, amount: form.payment_type === 'rent' ? (b?.monthly_rent_to_owner || '') : '' }))
  }

  async function save() {
    if (!form.building_id || !form.amount) return toast.error('Building and amount are required')
    setSaving(true)
    const payload = { ...form, amount: parseFloat(form.amount), paid_by: profile?.id }
    if (!payload.owner_id) delete payload.owner_id
    const { error } = await supabase.from('owner_payments').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Owner payment recorded ✓')
    setModal(false); load()
  }

  function handleExport() {
    const rows = payments.map(p => ({
      'Date': p.payment_date, 'Owner': p.owner?.name || '', 'Building': p.building?.name || '',
      'Type': p.payment_type, 'Mode': p.payment_mode, 'For Month': fmtMonth(p.for_month),
      'Ref': p.transaction_ref || '', 'Amount': p.amount, 'Paid By': p.paidBy?.full_name || ''
    }))
    exportToExcel(rows, 'Owner Payments', `owner-payments-${filterMonth}.xlsx`)
    toast.success('Exported!')
  }

  const total = payments.reduce((s, p) => s + p.amount, 0)

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Owner Payments</h2>
          <p className="text-surface-500 text-sm mt-1">Rent + deposits paid to building owners</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" className="input w-40" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
          <button className="btn-secondary" onClick={handleExport}><Download size={15} /> Export</button>
          <button className="btn-primary" onClick={() => { setForm(defaultForm()); setFilteredBuildings([]); setModal(true) }}>
            <Plus size={16} /> Record Payment
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="table-container">
          {loading ? <div className="py-20 flex justify-center"><Spinner size={32} /></div> : payments.length === 0 ? (
            <EmptyState icon={Banknote} title="No owner payments found" description="Record payments made to building owners" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th><th>Owner</th><th>Building</th><th>Type</th>
                  <th>For Month</th><th>Mode</th><th>Ref</th>
                  <th className="text-right">Amount</th><th>Paid By</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td className="text-surface-500 text-xs">{fmtDate(p.payment_date)}</td>
                    <td className="text-surface-800 font-medium">{p.owner?.name || '—'}</td>
                    <td className="text-surface-400">{p.building?.name || '—'}</td>
                    <td><Badge variant={p.payment_type === 'rent' ? 'info' : 'brand'}>{p.payment_type.replace('_', ' ')}</Badge></td>
                    <td className="text-surface-500">{fmtMonth(p.for_month)}</td>
                    <td><PaymentModeBadge mode={p.payment_mode} /></td>
                    <td className="font-mono text-xs text-surface-500">{p.transaction_ref || '—'}</td>
                    <td className="text-right amount-negative">{formatCurrency(p.amount)}</td>
                    <td className="text-surface-500 text-xs">{p.paidBy?.full_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-surface-200">
                  <td colSpan="7" className="px-4 py-3 text-surface-400 text-sm font-medium">Total</td>
                  <td className="px-4 py-3 text-right amount-negative font-bold">{formatCurrency(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Record Owner Payment" size="md">
        <div className="p-6 space-y-4">
          <div className="form-group">
            <label className="label">Owner *</label>
            <select className="select" value={form.owner_id} onChange={e => handleOwnerSelect(e.target.value)}>
              <option value="">— Select owner —</option>
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Building *</label>
            <select className="select" value={form.building_id} onChange={e => handleBuildingSelect(e.target.value)}>
              <option value="">— Select building —</option>
              {(form.owner_id ? filteredBuildings : buildings).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Payment Type *</label>
              <select className="select" value={form.payment_type} onChange={e => setForm(p => ({ ...p, payment_type: e.target.value }))}>
                {PAYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Payment Mode *</label>
              <select className="select" value={form.payment_mode} onChange={e => setForm(p => ({ ...p, payment_mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Amount (₹) *</label>
              <input type="number" className="input" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">For Month</label>
              <input type="month" className="input" value={form.for_month} onChange={e => setForm(p => ({ ...p, for_month: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Payment Date *</label>
            <input type="date" className="input" value={form.payment_date} onChange={e => setForm(p => ({ ...p, payment_date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Transaction Reference</label>
            <input className="input" value={form.transaction_ref} onChange={e => setForm(p => ({ ...p, transaction_ref: e.target.value }))} placeholder="UTR / cheque number" />
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
    </div>
  )
}
