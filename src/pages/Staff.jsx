import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, fmtMonth, currentMonth } from '@/utils/helpers'
import { Modal, Badge, EmptyState, Spinner, ConfirmDialog } from '@/components/ui'
import { UserCog, Plus, Edit2, DollarSign, CreditCard, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'other']
const defaultStaffForm = () => ({ full_name: '', phone: '', email: '', role: '', assigned_building_id: '', monthly_salary: '', join_date: '', id_type: '', id_number: '', bank_name: '', bank_account: '', bank_ifsc: '', status: 'active', notes: '' })

export default function Staff() {
  const { profile } = useAuth()
  const [staff, setStaff] = useState([])
  const [buildings, setBuildings] = useState([])
  const [salaries, setSalaries] = useState([])
  const [advances, setAdvances] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('staff')
  const [selectedStaff, setSelectedStaff] = useState(null)

  // Staff Modal
  const [staffModal, setStaffModal] = useState(false)
  const [editStaff, setEditStaff] = useState(null)
  const [staffForm, setStaffForm] = useState(defaultStaffForm())

  // Salary Modal
  const [salaryModal, setSalaryModal] = useState(false)
  const [salaryForm, setSalaryForm] = useState({ staff_id: '', for_month: currentMonth(), gross_salary: '', advance_deduction: 0, other_deduction: 0, net_salary: '', payment_mode: 'bank_transfer', payment_date: new Date().toISOString().split('T')[0], transaction_ref: '', notes: '' })

  // Advance Modal
  const [advanceModal, setAdvanceModal] = useState(false)
  const [advanceForm, setAdvanceForm] = useState({ staff_id: '', amount: '', payment_mode: 'cash', advance_date: new Date().toISOString().split('T')[0], reason: '', notes: '' })

  const [saving, setSaving] = useState(false)

  useEffect(() => { loadStaff(); loadBuildings() }, [])
  useEffect(() => { if (tab === 'salaries') loadSalaries(); else if (tab === 'advances') loadAdvances() }, [tab])

  async function loadStaff() {
    setLoading(true)
    const { data } = await supabase.from('staff').select('*, building:buildings(name)').order('full_name')
    setStaff(data || [])
    setLoading(false)
  }

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name')
    setBuildings(data || [])
  }

  async function loadSalaries() {
    setLoading(true)
    const { data } = await supabase.from('staff_salaries').select('*, staff:staff(full_name, role), paidBy:profiles(full_name)').order('created_at', { ascending: false }).limit(100)
    setSalaries(data || [])
    setLoading(false)
  }

  async function loadAdvances() {
    setLoading(true)
    const { data } = await supabase.from('staff_advances').select('*, staff:staff(full_name), paidBy:profiles(full_name)').order('advance_date', { ascending: false })
    setAdvances(data || [])
    setLoading(false)
  }

  function openAddStaff() { setEditStaff(null); setStaffForm(defaultStaffForm()); setStaffModal(true) }
  function openEditStaff(s) { setEditStaff(s); setStaffForm({ full_name: s.full_name, phone: s.phone || '', email: s.email || '', role: s.role || '', assigned_building_id: s.assigned_building_id || '', monthly_salary: s.monthly_salary || '', join_date: s.join_date || '', id_type: s.id_type || '', id_number: s.id_number || '', bank_name: s.bank_name || '', bank_account: s.bank_account || '', bank_ifsc: s.bank_ifsc || '', status: s.status, notes: s.notes || '' }); setStaffModal(true) }

  function openSalaryModal(s) {
    setSelectedStaff(s)
    setSalaryForm(p => ({ ...p, staff_id: s.id, gross_salary: s.monthly_salary || '', net_salary: s.monthly_salary || '', advance_deduction: 0, other_deduction: 0 }))
    setSalaryModal(true)
  }

  function openAdvanceModal(s) {
    setSelectedStaff(s)
    setAdvanceForm(p => ({ ...p, staff_id: s.id }))
    setAdvanceModal(true)
  }

  function updateNetSalary(form) {
    const net = (parseFloat(form.gross_salary) || 0) - (parseFloat(form.advance_deduction) || 0) - (parseFloat(form.other_deduction) || 0)
    return Math.max(net, 0)
  }

  async function saveStaff() {
    if (!staffForm.full_name) return toast.error('Name is required')
    setSaving(true)
    const payload = { ...staffForm, monthly_salary: parseFloat(staffForm.monthly_salary) || 0, created_by: profile?.id }
    if (!payload.assigned_building_id) delete payload.assigned_building_id
    const { error } = editStaff
      ? await supabase.from('staff').update(payload).eq('id', editStaff.id)
      : await supabase.from('staff').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editStaff ? 'Staff updated' : 'Staff added')
    setStaffModal(false); loadStaff()
  }

  async function saveSalary() {
    if (!salaryForm.staff_id || !salaryForm.gross_salary) return toast.error('Fill required fields')
    const net = updateNetSalary(salaryForm)
    setSaving(true)
    const { error } = await supabase.from('staff_salaries').insert({ ...salaryForm, gross_salary: parseFloat(salaryForm.gross_salary), advance_deduction: parseFloat(salaryForm.advance_deduction) || 0, other_deduction: parseFloat(salaryForm.other_deduction) || 0, net_salary: net, status: 'paid', paid_by: profile?.id })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Salary recorded ✓')
    setSalaryModal(false); loadSalaries()
  }

  async function saveAdvance() {
    if (!advanceForm.staff_id || !advanceForm.amount) return toast.error('Fill required fields')
    setSaving(true)
    const { error } = await supabase.from('staff_advances').insert({ ...advanceForm, amount: parseFloat(advanceForm.amount), paid_by: profile?.id })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Advance recorded ✓')
    setAdvanceModal(false); loadAdvances()
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Staff & Salary</h2>
          <p className="text-surface-500 text-sm mt-1">{staff.filter(s => s.status === 'active').length} active staff members</p>
        </div>
        <button className="btn-primary" onClick={openAddStaff}><Plus size={16} /> Add Staff</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-800">
        {[['staff', 'Staff Members'], ['salaries', 'Salary Records'], ['advances', 'Advances']].map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'staff' && (
        loading ? <div className="flex justify-center py-20"><Spinner size={32} /></div> : staff.length === 0 ? (
          <EmptyState icon={UserCog} title="No staff yet" description="Add staff to manage salaries and advances" action={<button className="btn-primary" onClick={openAddStaff}><Plus size={16} /> Add Staff</button>} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {staff.map(s => (
              <div key={s.id} className="card p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold ${s.status === 'active' ? 'bg-income/15 text-income' : 'bg-surface-800 text-surface-500'}`}>
                      {s.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-surface-100">{s.full_name}</p>
                      <p className="text-surface-500 text-xs">{s.role || 'Staff'}</p>
                    </div>
                  </div>
                  <button className="btn-ghost btn-sm" onClick={() => openEditStaff(s)}><Edit2 size={13} /></button>
                </div>
                {s.phone && <p className="text-surface-500 text-sm">{s.phone}</p>}
                {s.building && <p className="text-surface-600 text-xs">📍 {s.building.name}</p>}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-surface-600 text-xs">Monthly Salary</p>
                    <p className="text-surface-100 font-semibold font-mono">{formatCurrency(s.monthly_salary)}</p>
                  </div>
                  <Badge variant={s.status === 'active' ? 'success' : 'default'}>{s.status}</Badge>
                </div>
                <div className="flex gap-2 pt-1">
                  <button className="btn-success btn-sm flex-1" onClick={() => openSalaryModal(s)}><DollarSign size={13} /> Pay Salary</button>
                  <button className="btn-secondary btn-sm flex-1" onClick={() => openAdvanceModal(s)}><CreditCard size={13} /> Advance</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'salaries' && (
        <div className="card overflow-hidden">
          <div className="table-container">
            {loading ? <div className="py-12 flex justify-center"><Spinner /></div> : salaries.length === 0 ? (
              <EmptyState icon={DollarSign} title="No salary records" />
            ) : (
              <table className="data-table">
                <thead><tr><th>Staff</th><th>Role</th><th>For Month</th><th>Gross</th><th>Deductions</th><th>Net Paid</th><th>Mode</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  {salaries.map(s => (
                    <tr key={s.id}>
                      <td className="text-surface-100 font-medium">{s.staff?.full_name || '—'}</td>
                      <td className="text-surface-500">{s.staff?.role || '—'}</td>
                      <td>{fmtMonth(s.for_month)}</td>
                      <td className="font-mono">{formatCurrency(s.gross_salary)}</td>
                      <td className="font-mono text-expense">{formatCurrency((s.advance_deduction || 0) + (s.other_deduction || 0))}</td>
                      <td className="amount-positive">{formatCurrency(s.net_salary)}</td>
                      <td><Badge variant="info">{s.payment_mode}</Badge></td>
                      <td><Badge variant={s.status === 'paid' ? 'success' : 'warning'}>{s.status}</Badge></td>
                      <td className="text-surface-500 text-xs">{fmtDate(s.payment_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'advances' && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-surface-800">
            <p className="text-surface-300 text-sm font-medium">Advance Payments to Staff</p>
            <button className="btn-secondary btn-sm" onClick={() => { setAdvanceForm({ staff_id: '', amount: '', payment_mode: 'cash', advance_date: new Date().toISOString().split('T')[0], reason: '', notes: '' }); setAdvanceModal(true) }}>+ New Advance</button>
          </div>
          <div className="table-container">
            {loading ? <div className="py-12 flex justify-center"><Spinner /></div> : advances.length === 0 ? (
              <EmptyState icon={AlertCircle} title="No advances recorded" />
            ) : (
              <table className="data-table">
                <thead><tr><th>Staff</th><th>Date</th><th>Reason</th><th>Mode</th><th>Deducted</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {advances.map(a => (
                    <tr key={a.id}>
                      <td className="text-surface-100 font-medium">{a.staff?.full_name || '—'}</td>
                      <td className="text-surface-500 text-xs">{fmtDate(a.advance_date)}</td>
                      <td className="text-surface-400">{a.reason || '—'}</td>
                      <td><Badge variant="warning">{a.payment_mode}</Badge></td>
                      <td><Badge variant={a.deducted ? 'success' : 'danger'}>{a.deducted ? 'Yes' : 'Pending'}</Badge></td>
                      <td className="text-right amount-negative">{formatCurrency(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Staff Modal */}
      <Modal open={staffModal} onClose={() => setStaffModal(false)} title={editStaff ? 'Edit Staff' : 'Add Staff'} size="lg">
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Full Name *</label>
            <input className="input" value={staffForm.full_name} onChange={e => setStaffForm(p => ({ ...p, full_name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Phone</label>
            <input className="input" value={staffForm.phone} onChange={e => setStaffForm(p => ({ ...p, phone: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Role</label>
            <select className="select" value={staffForm.role} onChange={e => setStaffForm(p => ({ ...p, role: e.target.value }))}>
              <option value="">— Select —</option>
              {['manager', 'caretaker', 'cleaner', 'security', 'maintenance', 'other'].map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Assigned Building</label>
            <select className="select" value={staffForm.assigned_building_id} onChange={e => setStaffForm(p => ({ ...p, assigned_building_id: e.target.value }))}>
              <option value="">All / General</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Monthly Salary (₹)</label>
            <input type="number" className="input" value={staffForm.monthly_salary} onChange={e => setStaffForm(p => ({ ...p, monthly_salary: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Join Date</label>
            <input type="date" className="input" value={staffForm.join_date} onChange={e => setStaffForm(p => ({ ...p, join_date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Bank Name</label>
            <input className="input" value={staffForm.bank_name} onChange={e => setStaffForm(p => ({ ...p, bank_name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Bank Account</label>
            <input className="input" value={staffForm.bank_account} onChange={e => setStaffForm(p => ({ ...p, bank_account: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Status</label>
            <select className="select" value={staffForm.status} onChange={e => setStaffForm(p => ({ ...p, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">Email</label>
            <input className="input" value={staffForm.email} onChange={e => setStaffForm(p => ({ ...p, email: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setStaffModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveStaff} disabled={saving}>{saving ? <Spinner size={16} /> : (editStaff ? 'Update' : 'Add Staff')}</button>
        </div>
      </Modal>

      {/* Salary Modal */}
      <Modal open={salaryModal} onClose={() => setSalaryModal(false)} title={`Pay Salary – ${selectedStaff?.full_name}`} size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">For Month *</label>
              <input type="month" className="input" value={salaryForm.for_month} onChange={e => setSalaryForm(p => ({ ...p, for_month: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Payment Date</label>
              <input type="date" className="input" value={salaryForm.payment_date} onChange={e => setSalaryForm(p => ({ ...p, payment_date: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Gross Salary (₹) *</label>
            <input type="number" className="input" value={salaryForm.gross_salary} onChange={e => setSalaryForm(p => ({ ...p, gross_salary: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Advance Deduction (₹)</label>
              <input type="number" className="input" value={salaryForm.advance_deduction} onChange={e => setSalaryForm(p => ({ ...p, advance_deduction: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Other Deduction (₹)</label>
              <input type="number" className="input" value={salaryForm.other_deduction} onChange={e => setSalaryForm(p => ({ ...p, other_deduction: e.target.value }))} />
            </div>
          </div>
          <div className="p-4 bg-surface-800 rounded-xl border border-surface-700">
            <p className="text-surface-400 text-sm">Net Payable</p>
            <p className="font-display font-bold text-income text-2xl">{formatCurrency(updateNetSalary(salaryForm))}</p>
          </div>
          <div className="form-group">
            <label className="label">Payment Mode</label>
            <select className="select" value={salaryForm.payment_mode} onChange={e => setSalaryForm(p => ({ ...p, payment_mode: e.target.value }))}>
              {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Transaction Reference</label>
            <input className="input" value={salaryForm.transaction_ref} onChange={e => setSalaryForm(p => ({ ...p, transaction_ref: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setSalaryModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveSalary} disabled={saving}>{saving ? <Spinner size={16} /> : 'Record Payment'}</button>
        </div>
      </Modal>

      {/* Advance Modal */}
      <Modal open={advanceModal} onClose={() => setAdvanceModal(false)} title="Record Advance" size="sm">
        <div className="p-6 space-y-4">
          {!selectedStaff && (
            <div className="form-group">
              <label className="label">Staff Member *</label>
              <select className="select" value={advanceForm.staff_id} onChange={e => setAdvanceForm(p => ({ ...p, staff_id: e.target.value }))}>
                <option value="">— Select staff —</option>
                {staff.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="label">Amount (₹) *</label>
            <input type="number" className="input" value={advanceForm.amount} onChange={e => setAdvanceForm(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Payment Mode</label>
              <select className="select" value={advanceForm.payment_mode} onChange={e => setAdvanceForm(p => ({ ...p, payment_mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Date</label>
              <input type="date" className="input" value={advanceForm.advance_date} onChange={e => setAdvanceForm(p => ({ ...p, advance_date: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Reason</label>
            <input className="input" value={advanceForm.reason} onChange={e => setAdvanceForm(p => ({ ...p, reason: e.target.value }))} placeholder="Emergency, festival, etc." />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setAdvanceModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveAdvance} disabled={saving}>{saving ? <Spinner size={16} /> : 'Record Advance'}</button>
        </div>
      </Modal>
    </div>
  )
}
