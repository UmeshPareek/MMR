import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, fmtMonth, lastNMonths } from '@/utils/helpers'
import { logDelete } from '@/utils/deleteLog'
import { Modal, Badge, EmptyState, Spinner, ConfirmDialog } from '@/components/ui'
import { UserCog, Plus, Edit2, Wallet, CreditCard, AlertCircle, CheckCircle2, TrendingDown, Users, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

const MONTHS = lastNMonths(6)
const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'other']
const defaultStaffForm = () => ({ full_name: '', phone: '', email: '', role: '', assigned_building_id: '', monthly_salary: '', join_date: '', id_type: '', id_number: '', bank_name: '', bank_account: '', bank_ifsc: '', status: 'active', notes: '' })

export default function Staff() {
  const { profile, isAdmin } = useAuth()
  const [staff, setStaff] = useState([])
  const [buildings, setBuildings] = useState([])
  const [salaries, setSalaries] = useState([])
  const [advances, setAdvances] = useState([])
  const [monthAdvances, setMonthAdvances] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('staff')
  const [selectedStaff, setSelectedStaff] = useState(null)
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[MONTHS.length - 1])

  const [staffModal, setStaffModal] = useState(false)
  const [editStaff, setEditStaff] = useState(null)
  const [staffForm, setStaffForm] = useState(defaultStaffForm())

  const [salaryModal, setSalaryModal] = useState(false)
  const [salaryForm, setSalaryForm] = useState({ staff_id: '', for_month: MONTHS[MONTHS.length-1], gross_salary: '', advance_deduction: 0, other_deduction: 0, net_salary: '', payment_mode: 'bank_transfer', payment_date: new Date().toISOString().split('T')[0], transaction_ref: '', notes: '' })

  const [advanceModal, setAdvanceModal] = useState(false)
  const [advanceForm, setAdvanceForm] = useState({ staff_id: '', amount: '', payment_mode: 'cash', advance_date: new Date().toISOString().split('T')[0], reason: '', notes: '' })

  const [saving, setSaving] = useState(false)
  const [deleteStaffId, setDeleteStaffId] = useState(null)
  const [editSalaryRecord, setEditSalaryRecord] = useState(null)
  const [editSalaryModal, setEditSalaryModal] = useState(false)
  const [editSalaryForm, setEditSalaryForm] = useState({})
  const [editAdvanceRecord, setEditAdvanceRecord] = useState(null)
  const [editAdvanceModal, setEditAdvanceModal] = useState(false)
  const [editAdvanceForm, setEditAdvanceForm] = useState({})
  const [incentives, setIncentives] = useState([])
  const [reimbursements, setReimbursements] = useState([])
  const [reimbModal, setReimbModal] = useState(false)
  const [rForm, setRForm] = useState({ staff_id:'', amount:'', description:'', date: new Date().toISOString().slice(0,10), payment_mode:'cash' })
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [quickModal, setQuickModal] = useState(false)
  const [quickForm, setQuickForm] = useState({full_name:'',phone:'',role:'',monthly_salary:'',assigned_building_id:''})
  const channelRef = useRef(null)

  useEffect(() => {
    loadAll()
    // Realtime — refresh when data changes from other pages
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('staff-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_salaries' }, () => { loadSalaries() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_advances' }, () => { loadAdvances(); loadIncentives(); loadReimbursements() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, () => { loadStaff() })
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [])
  useEffect(() => { if (tab === 'salaries' || tab === 'summary') loadSalaries(); if (tab === 'advances' || tab === 'summary') loadAdvances(); if (tab === 'incentives') loadIncentives(); if (tab === 'reimbursements') loadReimbursements() }, [tab, selectedMonth])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadStaff(), loadBuildings(), loadSalaries(), loadAdvances()])
    setLoading(false)
  }

  async function loadStaff() {
    const { data } = await supabase.from('staff').select('*, building:buildings(name)').order('full_name')
    setStaff(data || [])
  }

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name')
    setBuildings(data || [])
  }

  async function loadSalaries() {
    const { data } = await supabase.from('staff_salaries')
      .select('*, staff:staff(full_name, role, monthly_salary)')
      .eq('for_month', selectedMonth)
      .order('created_at', { ascending: false })
    setSalaries(data || [])
  }

  async function loadIncentives() {
    const { data } = await supabase.from('staff_advances')
      .select('*, staff:staff(full_name)')
      .eq('advance_type', 'incentive')
      .order('advance_date', { ascending: false })
    setIncentives(data || [])
  }

  async function loadReimbursements() {
    const { data } = await supabase.from('staff_advances')
      .select('*, staff:staff(full_name)')
      .eq('advance_type', 'reimbursement')
      .order('advance_date', { ascending: false })
    setReimbursements(data || [])
  }

  async function saveReimbursement() {
    if (!rForm.staff_id || !rForm.amount) return toast.error('Staff and amount required')
    setSaving(true)
    const { error } = await supabase.from('staff_advances').insert({
      staff_id: rForm.staff_id, amount: parseFloat(rForm.amount),
      advance_date: rForm.date, advance_type: 'reimbursement',
      notes: rForm.description, recovered: true,
      payment_mode: rForm.payment_mode,
      org_id: profile?.org_id,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Reimbursement recorded ✓')
    setReimbModal(false)
    setRForm({ staff_id:'', amount:'', description:'', date: new Date().toISOString().slice(0,10), payment_mode:'cash' })
    loadReimbursements()
  }

  async function loadAdvances() {
    // Only REAL advances (not incentives/reimbursements) that are unrecovered
    const { data } = await supabase.from('staff_advances')
      .select('*, staff:staff(full_name)')
      .eq('advance_type', 'advance')
      .eq('recovered', false)
      .order('advance_date', { ascending: false })
    setAdvances(data || [])

    // Month advances for net payable calculation — only actual advances given this month
    const monthEnd = new Date(parseInt(selectedMonth.slice(0,4)), parseInt(selectedMonth.slice(5,7)), 0).getDate()
    const { data: mAdv } = await supabase.from('staff_advances')
      .select('*, staff:staff(full_name)')
      .eq('advance_type', 'advance')
      .gte('advance_date', `${selectedMonth}-01`)
      .lte('advance_date', `${selectedMonth}-${String(monthEnd).padStart(2,'0')}`)
      .order('advance_date', { ascending: false })
    setMonthAdvances(mAdv || [])
  }

  function openAddStaff() { setEditStaff(null); setStaffForm(defaultStaffForm()); setStaffModal(true) }
  function openEditStaff(s) {
    setEditStaff(s)
    setStaffForm({ full_name: s.full_name, phone: s.phone || '', email: s.email || '', role: s.role || '', assigned_building_id: s.assigned_building_id || '', monthly_salary: s.monthly_salary || '', join_date: s.join_date || '', id_type: s.id_type || '', id_number: s.id_number || '', bank_name: s.bank_name || '', bank_account: s.bank_account || '', bank_ifsc: s.bank_ifsc || '', status: s.status, notes: s.notes || '' })
    setStaffModal(true)
  }

  function openSalaryModal(s) {
    setSelectedStaff(s)
    // Pre-fill pending advance deduction
    const pendingAdv = advances.filter(a => a.staff_id === s.id).reduce((sum, a) => sum + Number(a.amount), 0)
    setSalaryForm(p => ({ ...p, staff_id: s.id, for_month: selectedMonth, gross_salary: s.monthly_salary || '', advance_deduction: pendingAdv, other_deduction: 0 }))
    setSalaryModal(true)
  }

  function openAdvanceModal(s) { setSelectedStaff(s); setAdvanceForm(p => ({ ...p, staff_id: s.id })); setAdvanceModal(true) }

  function netPayable(form) {
    return Math.max((parseFloat(form.gross_salary) || 0) - (parseFloat(form.advance_deduction) || 0) - (parseFloat(form.other_deduction) || 0), 0)
  }

  async function saveQuickStaff() {
    if (!quickForm.full_name || !quickForm.monthly_salary) return toast.error('Name and salary required')
    setSaving(true)
    const payload = {...quickForm, status:'active', monthly_salary: parseFloat(quickForm.monthly_salary)||0, created_by: profile?.id, org_id: profile?.org_id}
    if (!payload.assigned_building_id) delete payload.assigned_building_id
    const { error } = await supabase.from('staff').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Staff added ✓')
    setQuickModal(false)
    setQuickForm({full_name:'',phone:'',role:'',monthly_salary:'',assigned_building_id:''})
    loadStaff()
  }

  async function saveStaff() {
    if (!staffForm.full_name) return toast.error('Name is required')
    setSaving(true)
    const payload = { ...staffForm, monthly_salary: parseFloat(staffForm.monthly_salary) || 0, created_by: profile?.id, org_id: profile?.org_id }
    if (!payload.assigned_building_id) delete payload.assigned_building_id
    const { error } = editStaff ? await supabase.from('staff').update(payload).eq('id', editStaff.id) : await supabase.from('staff').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editStaff ? 'Staff updated' : 'Staff added')
    setStaffModal(false); loadStaff()
  }

  function logActivity(action, entity, entityId, summary) {
    supabase.from('team_activity_log').insert({
      org_id: profile?.org_id, user_id: profile?.id,
      action, entity, entity_id: entityId, summary,
      for_month: new Date().toISOString().slice(0, 7),
    }).then(() => {})
  }

  async function saveSalary() {
    if (!salaryForm.staff_id || !salaryForm.gross_salary) return toast.error('Fill required fields')
    const net = netPayable(salaryForm)
    const advDeduction = parseFloat(salaryForm.advance_deduction) || 0
    setSaving(true)
    const { data: salData, error } = await supabase.from('staff_salaries').insert({
      staff_id: salaryForm.staff_id,
      for_month: salaryForm.for_month,
      gross_salary: parseFloat(salaryForm.gross_salary),
      advance_deduction: advDeduction,
      other_deduction: parseFloat(salaryForm.other_deduction) || 0,
      net_salary: net,
      payment_date: salaryForm.payment_date,
      payment_mode: salaryForm.payment_mode,
      notes: salaryForm.notes || null,
      paid_by: profile?.id,
      org_id: profile?.org_id,
    }).select('id').single()
    // Mark advances as recovered
    if (!error && advDeduction > 0) {
      const staffAdvances = advances.filter(a => a.staff_id === salaryForm.staff_id)
      for (const adv of staffAdvances) {
        await supabase.from('staff_advances').update({ recovered: true }).eq('id', adv.id)
      }
    }
    setSaving(false)
    if (error) return toast.error(error.message)
    const staffMember = staff.find(s => s.id === salaryForm.staff_id)
    logActivity('created', 'salary', salData?.id, `Salary ₹${net.toLocaleString('en-IN')} paid${staffMember ? ` — ${staffMember.full_name}` : ''} (${salaryForm.for_month})`)
    toast.success('Salary paid — advances marked recovered ✓')
    setSalaryModal(false); loadSalaries(); loadAdvances(); if (tab === 'payroll') { loadSalaries() }
  }

  async function deleteStaff(id) {
    const staffMember = staffList.find(s => s.id === id)
    const { error } = await supabase.from('staff').delete().eq('id', id)
    if (error) return toast.error(error.message)
    await logDelete(profile, 'staff', id, { name: staffMember?.full_name, role: staffMember?.role, building: staffMember?.building?.name })
    toast.success('Staff permanently deleted ✓'); setDeleteStaffId(null); loadStaff()
  }

  async function updateSalary(id, field, value) {
    const { error } = await supabase.from('staff_salaries').update({ [field]: value }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Updated ✓'); setEditSalaryRecord(null); loadSalaries()
  }

  async function updateAdvance(id, field, value) {
    const { error } = await supabase.from('staff_advances').update({ [field]: value }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Updated ✓'); setEditAdvanceRecord(null); loadAdvances()
  }

  async function openEditSalary(s) {
    setEditSalaryForm({
      gross_salary: s.gross_amount || s.gross_salary || '',
      advance_deduction: s.advance_deduction || 0,
      other_deduction: s.other_deduction || 0,
      net_salary: s.net_salary || '',
      payment_mode: s.payment_mode || 'bank_transfer',
      payment_date: s.payment_date || '',
      transaction_ref: s.transaction_ref || '',
      notes: s.notes || '',
    })
    setEditSalaryRecord(s)
    setEditSalaryModal(true)
  }

  async function saveEditSalary() {
    const net = parseFloat(editSalaryForm.gross_salary||0) - parseFloat(editSalaryForm.advance_deduction||0) - parseFloat(editSalaryForm.other_deduction||0)
    const { error } = await supabase.from('staff_salaries').update({
      gross_salary: parseFloat(editSalaryForm.gross_salary),
      advance_deduction: parseFloat(editSalaryForm.advance_deduction||0),
      other_deduction: parseFloat(editSalaryForm.other_deduction||0),
      net_salary: net,
      payment_mode: editSalaryForm.payment_mode,
      payment_date: editSalaryForm.payment_date,
      transaction_ref: editSalaryForm.transaction_ref || null,
      notes: editSalaryForm.notes || null,
    }).eq('id', editSalaryRecord.id)
    if (error) return toast.error(error.message)
    toast.success('Salary updated ✓')
    setEditSalaryModal(false); setEditSalaryRecord(null); loadSalaries()
  }

  async function openEditAdvance(a) {
    setEditAdvanceForm({
      amount: a.amount || '',
      advance_date: a.advance_date || '',
      advance_type: a.advance_type || 'advance',
      payment_mode: a.payment_mode || 'cash',
      notes: a.notes || '',
      recovered: a.recovered || false,
    })
    setEditAdvanceRecord(a)
    setEditAdvanceModal(true)
  }

  async function saveEditAdvance() {
    const { error } = await supabase.from('staff_advances').update({
      amount: parseFloat(editAdvanceForm.amount),
      advance_date: editAdvanceForm.advance_date,
      advance_type: editAdvanceForm.advance_type,
      payment_mode: editAdvanceForm.payment_mode,
      notes: editAdvanceForm.notes || null,
      recovered: editAdvanceForm.recovered,
    }).eq('id', editAdvanceRecord.id)
    if (error) return toast.error(error.message)
    toast.success('Updated ✓')
    setEditAdvanceModal(false); setEditAdvanceRecord(null); loadAdvances(); loadIncentives(); loadReimbursements(); if (tab === 'payroll') loadAll()
  }

  function deleteSalary(id) {
    setConfirmDialog({
      title: 'Delete Salary Record?',
      message: 'Delete this salary record? This cannot be undone.',
      danger: true,
      onConfirm: async () => {
        const { error } = await supabase.from('staff_salaries').delete().eq('id', id)
        if (error) { toast.error(error.message); return }
        await logDelete(profile, 'staff_salaries', id, { deleted: true })
        toast.success('Salary record deleted')
        setConfirmDialog(null)
        loadSalaries()
      },
    })
  }

  function deleteAdvance(id) {
    setConfirmDialog({
      title: 'Delete Advance Record?',
      message: 'Delete this advance/reimbursement record? This cannot be undone.',
      danger: true,
      onConfirm: async () => {
        const { error } = await supabase.from('staff_advances').delete().eq('id', id)
        if (error) { toast.error(error.message); return }
        await logDelete(profile, 'staff_advances', id, { deleted: true })
        toast.success('Record deleted')
        setConfirmDialog(null)
        loadAdvances()
      },
    })
  }

  async function saveAdvance() {
    if (!advanceForm.staff_id || !advanceForm.amount) return toast.error('Fill required fields')
    setSaving(true)
    const { error } = await supabase.from('staff_advances').insert({ ...advanceForm, amount: parseFloat(advanceForm.amount), recovered: false, org_id: profile?.org_id })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Advance recorded ✓')
    setAdvanceModal(false); loadAdvances(); if (tab === 'payroll') loadAll()
  }

  // Monthly summary calculations
  const activeStaff = staff.filter(s => s.status === 'active')
  const totalMonthlySalary = activeStaff.reduce((s, st) => s + Number(st.monthly_salary || 0), 0)
  const paidThisMonth = salaries.filter(s => s.for_month === selectedMonth)
  const totalPaid = paidThisMonth.reduce((s, sal) => s + Number(sal.net_salary || 0), 0)
  const totalAdvanceDeducted = paidThisMonth.reduce((s, sal) => s + Number(sal.advance_deduction || 0), 0)
  const pendingPayment = totalMonthlySalary - totalPaid
  const paidStaffIds = new Set(paidThisMonth.map(s => s.staff_id))
  const unpaidStaff = activeStaff.filter(s => !paidStaffIds.has(s.id))
  const totalPendingAdvances = advances.reduce((s, a) => s + Number(a.amount || 0), 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Staff & Salary</h2>
          <p className="text-surface-500 text-sm mt-0.5">{activeStaff.length} active · Monthly payroll {formatCurrency(totalMonthlySalary)}</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="select w-auto py-1.5 text-sm" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="btn-secondary flex items-center gap-1.5" onClick={() => setQuickModal(true)}><Plus size={16} /> Quick Add</button>
          <button className="btn-primary flex items-center gap-1.5" onClick={openAddStaff}><Plus size={16} /> Full Profile</button>
        </div>
      </div>

      {/* Monthly KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-brand-500">
          <p className="text-xs text-surface-500 mb-1">Total Payroll</p>
          <p className="text-lg font-bold font-mono text-surface-900">{formatCurrency(totalMonthlySalary)}</p>
          <p className="text-xs text-surface-400">{activeStaff.length} staff</p>
        </div>
        <div className="card p-4 border-l-4 border-emerald-400">
          <p className="text-xs text-surface-500 mb-1">Paid ({selectedMonth})</p>
          <p className="text-lg font-bold font-mono text-emerald-700">{formatCurrency(totalPaid)}</p>
          <p className="text-xs text-surface-400">{paidThisMonth.length} payments</p>
        </div>
        <div className="card p-4 border-l-4 border-red-400">
          <p className="text-xs text-surface-500 mb-1">Pending</p>
          <p className="text-lg font-bold font-mono text-red-600">{formatCurrency(pendingPayment)}</p>
          <p className="text-xs text-surface-400">{unpaidStaff.length} staff unpaid</p>
        </div>
        <div className="card p-4 border-l-4 border-amber-400">
          <p className="text-xs text-surface-500 mb-1">Advances Outstanding</p>
          <p className="text-lg font-bold font-mono text-amber-700">{formatCurrency(totalPendingAdvances)}</p>
          <p className="text-xs text-surface-400">{advances.length} advances pending</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200 overflow-x-auto">
        {[['staff','Staff Members'],['payroll','Monthly Payroll'],['salaries','Salary History'],['advances','Advances'],['incentives','Incentives'],['reimbursements','Reimbursements']].map(([key, label]) => (
          <button key={key} className={`tab flex-shrink-0 ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {/* STAFF LIST */}
      {tab === 'staff' && (
        loading ? <div className="flex justify-center py-20"><Spinner size={32} /></div>
        : staff.length === 0 ? (
          <EmptyState icon={UserCog} title="No staff yet" description="Add staff to manage salaries and advances" action={<button className="btn-primary" onClick={openAddStaff}><Plus size={16} /> Add Staff</button>} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {staff.map(s => {
              const paid = paidStaffIds.has(s.id)
              const staffSalary = paidThisMonth.find(p => p.staff_id === s.id)
              const pendingAdv = advances.filter(a => a.staff_id === s.id).reduce((sum, a) => sum + Number(a.amount), 0)
              return (
                <div key={s.id} className={`card p-5 space-y-3 ${paid ? 'border-emerald-200' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold ${s.status === 'active' ? 'bg-brand-100 text-brand-700' : 'bg-surface-100 text-surface-500'}`}>
                        {s.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-surface-800">{s.full_name}</p>
                        <p className="text-surface-500 text-xs">{s.role || 'Staff'}{s.building ? ` · ${s.building.name}` : ''}</p>
                      </div>
                    </div>
                    <button className="btn-ghost btn-sm" onClick={() => openEditStaff(s)}><Edit2 size={13} /></button>
                                  <button onClick={() => setDeleteStaffId(s.id)} className="btn-ghost btn-sm p-1" title="Remove staff"><svg className="w-3.5 h-3.5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>
                  </div>

                  {s.phone && <p className="text-surface-500 text-sm">{s.phone}</p>}

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-surface-500 text-xs">Monthly Salary</p>
                      <p className="text-surface-800 font-semibold font-mono">{formatCurrency(s.monthly_salary)}</p>
                    </div>
                    {pendingAdv > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-amber-600">Advance Pending</p>
                        <p className="text-amber-700 font-semibold font-mono text-sm">{formatCurrency(pendingAdv)}</p>
                      </div>
                    )}
                  </div>

                  {/* Salary status for selected month */}
                  {s.status === 'active' && (
                    paid ? (
                      <div className="flex items-center gap-2 text-xs bg-emerald-50 text-emerald-700 px-3 py-2 rounded-lg border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Paid {formatCurrency(staffSalary?.net_salary)} for {selectedMonth}</span>
                        {staffSalary?.advance_deduction > 0 && <span className="ml-auto text-amber-600">-{formatCurrency(staffSalary.advance_deduction)} adv</span>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs bg-red-50 text-red-600 px-3 py-2 rounded-lg border border-red-200">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Salary pending for {selectedMonth}</span>
                      </div>
                    )
                  )}

                  <div className="flex gap-2 pt-1">
                    {s.status === 'active' && !paid && (
                      <button className="btn-primary btn-sm flex-1 flex items-center justify-center gap-1" onClick={() => openSalaryModal(s)}>
                        <Wallet size={13} /> Pay Salary
                      </button>
                    )}
                    <button className="btn-secondary btn-sm flex-1 flex items-center justify-center gap-1" onClick={() => openAdvanceModal(s)}>
                      <CreditCard size={13} /> Advance
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* MONTHLY PAYROLL TAB */}
      {tab === 'payroll' && (() => {
        // Per-staff payroll calculation for selected month
        const payrollRows = activeStaff.map(s => {
          const thisMonthAdvances = monthAdvances.filter(a => a.staff_id === s.id)
          const advThisMonth = thisMonthAdvances.reduce((sum, a) => sum + Number(a.amount), 0)
          const gross = Number(s.monthly_salary || 0)
          const net = Math.max(gross - advThisMonth, 0)
          const paid = paidStaffIds.has(s.id)
          const paidRecord = paidThisMonth.find(p => p.staff_id === s.id)
          return { ...s, advThisMonth, gross, net, paid, paidRecord, advList: thisMonthAdvances }
        })
        const totalGross = payrollRows.reduce((s, r) => s + r.gross, 0)
        const totalAdvMonth = payrollRows.reduce((s, r) => s + r.advThisMonth, 0)
        const totalNet = payrollRows.reduce((s, r) => s + r.net, 0)
        const totalNetPaid = payrollRows.filter(r => r.paid).reduce((s, r) => s + Number(r.paidRecord?.net_salary || 0), 0)
        const totalStillPending = payrollRows.filter(r => !r.paid).reduce((s, r) => s + r.net, 0)

        return (
          <div className="space-y-4">
            {/* Summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card p-4 border-l-4 border-brand-500">
                <p className="text-xs text-surface-500 mb-0.5">Total Gross</p>
                <p className="text-lg font-bold font-mono text-surface-900">{formatCurrency(totalGross)}</p>
              </div>
              <div className="card p-4 border-l-4 border-amber-400">
                <p className="text-xs text-surface-500 mb-0.5">Advances This Month</p>
                <p className="text-lg font-bold font-mono text-amber-700">{formatCurrency(totalAdvMonth)}</p>
              </div>
              <div className="card p-4 border-l-4 border-brand-600">
                <p className="text-xs text-surface-500 mb-0.5">Net Payable</p>
                <p className="text-lg font-bold font-mono text-brand-700">{formatCurrency(totalNet)}</p>
              </div>
              <div className="card p-4 border-l-4 border-red-400">
                <p className="text-xs text-surface-500 mb-0.5">Still Pending</p>
                <p className="text-lg font-bold font-mono text-red-600">{formatCurrency(totalStillPending)}</p>
                <p className="text-xs text-surface-400">{payrollRows.filter(r => !r.paid).length} staff</p>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-surface-700">Net Salary Payable — {selectedMonth}</h3>
                  <p className="text-xs text-surface-400 mt-0.5">Gross − Advances Given This Month = Net Payable</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Role</th>
                      <th className="text-right">Gross Salary</th>
                      <th className="text-right">Advances This Month</th>
                      <th className="text-right font-bold">Net Payable</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollRows.map(r => (
                      <tr key={r.id} className={r.paid ? 'bg-emerald-50/20' : r.net > 0 ? 'bg-red-50/10' : ''}>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {r.full_name.charAt(0)}
                            </div>
                            <span className="font-medium text-surface-800">{r.full_name}</span>
                          </div>
                        </td>
                        <td className="text-xs text-surface-500">{r.role || '—'}</td>
                        <td className="text-right font-mono">{formatCurrency(r.gross)}</td>
                        <td className="text-right font-mono">
                          {r.advThisMonth > 0
                            ? <span className="text-amber-600 font-semibold">−{formatCurrency(r.advThisMonth)}</span>
                            : <span className="text-surface-300">—</span>}
                          {r.advList.length > 0 && (
                            <p className="text-xs text-surface-400">{r.advList.length} advance{r.advList.length>1?'s':''}</p>
                          )}
                        </td>
                        <td className="text-right font-mono font-bold text-brand-700 text-base">
                          {formatCurrency(r.net)}
                        </td>
                        <td>
                          {r.paid
                            ? <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">
                                Paid {formatCurrency(r.paidRecord?.net_salary)}
                              </span>
                            : <span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">Pending</span>}
                        </td>
                        <td>
                          {!r.paid && r.status === 'active' && (
                            <button onClick={() => openSalaryModal(r)}
                              className="btn-primary btn-sm flex items-center gap-1">
                              <Wallet size={12}/> Pay
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-50 border-t-2 border-surface-200">
                      <td colSpan={2} className="px-4 py-2.5 text-xs font-bold text-surface-600">TOTAL</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold">{formatCurrency(totalGross)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-amber-600">
                        {totalAdvMonth > 0 ? `−${formatCurrency(totalAdvMonth)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-brand-700 text-base">
                        {formatCurrency(totalNet)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-emerald-600">{payrollRows.filter(r=>r.paid).length} paid</span>
                        {' · '}
                        <span className="text-xs text-red-600">{payrollRows.filter(r=>!r.paid).length} pending</span>
                      </td>
                      <td/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )
      })()}

      {/* SALARIES TABLE */}
      {tab === 'salaries' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-surface-700">Salary Payments — {selectedMonth}</h3>
              <p className="text-xs text-surface-400 mt-0.5">
                {paidThisMonth.length} paid · Total net: {formatCurrency(totalPaid)} · Advance deducted: {formatCurrency(totalAdvanceDeducted)}
              </p>
            </div>
            <button onClick={loadSalaries} className="btn-ghost btn-sm"><RefreshCw className="w-3.5 h-3.5" /></button>
          </div>
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
          : salaries.length === 0 ? <EmptyState icon={Wallet} title="No salaries paid this month" />
          : (
            <>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Staff</th><th>Role</th>
                      <th className="text-right">Gross</th>
                      <th className="text-right">Advance Deducted</th>
                      <th className="text-right">Other Deduction</th>
                      <th className="text-right">Net Paid</th>
                      <th>Mode</th><th>Date</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {salaries.map(s => (
                      <tr key={s.id}>
                        <td className="font-medium text-surface-800">{s.staff?.full_name || '—'}</td>
                        <td className="text-surface-500 text-xs">{s.staff?.role || '—'}</td>
                        <td className="text-right font-mono">{formatCurrency(s.gross_amount)}</td>
                        <td className="text-right font-mono text-amber-600">
                          {s.advance_deduction > 0 ? `-${formatCurrency(s.advance_deduction)}` : '—'}
                        </td>
                        <td className="text-right font-mono text-red-500">
                          {s.other_deduction > 0 ? `-${formatCurrency(s.other_deduction)}` : '—'}
                        </td>
                        <td className="text-right font-mono font-bold text-emerald-700">{formatCurrency(s.net_salary)}</td>
                        <td><span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{s.payment_mode}</span></td>
                        <td className="text-surface-500 text-xs">{fmtDate(s.payment_date)}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEditSalary(s)} className="btn-ghost p-1.5 text-surface-400 hover:text-brand-600" title="Edit">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button onClick={() => deleteSalary(s.id)} className="btn-ghost p-1.5 text-red-400 hover:text-red-600" title="Delete">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-50 border-t-2 border-surface-200">
                      <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-surface-500">TOTAL</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{formatCurrency(salaries.reduce((s,r)=>s+Number(r.gross_amount),0))}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-amber-600">{formatCurrency(totalAdvanceDeducted)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-red-500">{formatCurrency(salaries.reduce((s,r)=>s+Number(r.other_deduction||0),0))}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(totalPaid)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Unpaid staff this month */}
              {unpaidStaff.length > 0 && (
                <div className="border-t border-surface-100 px-5 py-4 bg-red-50/50">
                  <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {unpaidStaff.length} staff not yet paid for {selectedMonth}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unpaidStaff.map(s => (
                      <button key={s.id} onClick={() => openSalaryModal(s)}
                        className="text-xs bg-white border border-red-200 text-red-700 rounded-lg px-3 py-1.5 hover:bg-red-50 flex items-center gap-1.5">
                        <Wallet className="w-3 h-3" /> {s.full_name} ({formatCurrency(s.monthly_salary)})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* PENDING ADVANCES */}
      {tab === 'advances' && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-surface-200">
            <div>
              <p className="text-sm font-semibold text-surface-700">Pending Advances — Not Yet Recovered</p>
              <p className="text-xs text-surface-400">Total: {formatCurrency(totalPendingAdvances)} · {advances.length} advances</p>
            </div>
            <button className="btn-secondary btn-sm flex items-center gap-1.5" onClick={() => { setSelectedStaff(null); setAdvanceForm({ staff_id: '', amount: '', payment_mode: 'cash', advance_date: new Date().toISOString().split('T')[0], reason: '', notes: '' }); setAdvanceModal(true) }}>
              + New Advance
            </button>
          </div>
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
          : advances.length === 0 ? <EmptyState icon={CheckCircle2} title="No pending advances" description="All advances have been recovered" />
          : (
            <table className="data-table">
              <thead><tr><th>Staff</th><th>Date</th><th>Reason</th><th>Mode</th><th className="text-right">Amount</th><th></th></tr></thead>
              <tbody>
                {advances.map(a => (
                  <tr key={a.id} className="bg-amber-50/20">
                    <td className="font-medium text-surface-800">{a.staff?.full_name || '—'}</td>
                    <td className="text-surface-500 text-xs">{fmtDate(a.advance_date)}</td>
                    <td className="text-surface-500">{a.reason || a.notes || '—'}</td>
                    <td><span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">{a.payment_mode}</span></td>
                    <td className="text-right font-mono font-bold text-amber-700">{formatCurrency(a.amount)}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <button onClick={async () => { await supabase.from('staff_advances').update({recovered:true}).eq('id',a.id); toast.success('Marked recovered'); loadAdvances() }}
                          className="px-2 py-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 whitespace-nowrap">
                          ✓ Recovered
                        </button>
                        <button onClick={() => openEditAdvance(a)} className="btn-ghost p-1.5 text-surface-400 hover:text-brand-600" title="Edit">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={() => deleteAdvance(a.id)} className="btn-ghost p-1.5 text-red-400 hover:text-red-600" title="Delete">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-50 border-t border-surface-200">
                  <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-surface-500">Total Pending</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-amber-700">{formatCurrency(totalPendingAdvances)}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* QUICK ADD STAFF MODAL */}
      <Modal open={quickModal} onClose={() => setQuickModal(false)} title="Quick Add Staff" size="sm">
        <div className="p-6 space-y-4">
          <div className="form-group">
            <label className="label">Full Name *</label>
            <input className="input" value={quickForm.full_name} onChange={e => setQuickForm(p=>({...p,full_name:e.target.value}))} placeholder="Staff member name" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Phone</label>
              <input className="input" value={quickForm.phone} onChange={e => setQuickForm(p=>({...p,phone:e.target.value}))} placeholder="9876543210" />
            </div>
            <div className="form-group">
              <label className="label">Role</label>
              <select className="select" value={quickForm.role} onChange={e => setQuickForm(p=>({...p,role:e.target.value}))}>
                <option value="">— Select —</option>
                {['manager','caretaker','cleaner','security','maintenance','other'].map(r=><option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Monthly Salary (₹) *</label>
              <input type="number" className="input" value={quickForm.monthly_salary} onChange={e => setQuickForm(p=>({...p,monthly_salary:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Building</label>
              <select className="select" value={quickForm.assigned_building_id} onChange={e => setQuickForm(p=>({...p,assigned_building_id:e.target.value}))}>
                <option value="">All / General</option>
                {buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-surface-400">Bank details and ID documents can be added later via Edit.</p>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setQuickModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveQuickStaff} disabled={saving}>{saving ? <Spinner size={16}/> : 'Add Staff'}</button>
        </div>
      </Modal>

      {/* STAFF MODAL */}
      <Modal open={staffModal} onClose={() => setStaffModal(false)} title={editStaff ? 'Edit Staff' : 'Add Staff'} size="lg">
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          {[['full_name','Full Name *','text'],['phone','Phone','text'],['email','Email','email'],['join_date','Join Date','date'],['bank_name','Bank Name','text'],['bank_account','Bank Account','text'],['bank_ifsc','IFSC Code','text']].map(([key, label, type]) => (
            <div key={key} className="form-group">
              <label className="label">{label}</label>
              <input type={type} className="input" value={staffForm[key]} onChange={e => setStaffForm(p => ({ ...p, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="form-group">
            <label className="label">Role</label>
            <select className="select" value={staffForm.role} onChange={e => setStaffForm(p => ({ ...p, role: e.target.value }))}>
              <option value="">— Select —</option>
              {['manager','caretaker','cleaner','security','maintenance','other'].map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
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
            <label className="label">Status</label>
            <select className="select" value={staffForm.status} onChange={e => setStaffForm(p => ({ ...p, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setStaffModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveStaff} disabled={saving}>{saving ? <Spinner size={16} /> : (editStaff ? 'Update' : 'Add Staff')}</button>
        </div>
      </Modal>

      {/* SALARY MODAL */}
      <Modal open={salaryModal} onClose={() => setSalaryModal(false)} title={`Pay Salary — ${selectedStaff?.full_name}`} size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">For Month *</label>
              <select className="select" value={salaryForm.for_month} onChange={e => setSalaryForm(p => ({ ...p, for_month: e.target.value }))}>
                {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
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
              <label className="label flex items-center gap-1.5">Advance Deduction (₹)
                {parseFloat(salaryForm.advance_deduction) > 0 && <span className="text-xs text-amber-600 font-normal">· auto-filled from pending</span>}
              </label>
              <input type="number" className="input" value={salaryForm.advance_deduction} onChange={e => setSalaryForm(p => ({ ...p, advance_deduction: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Other Deduction (₹)</label>
              <input type="number" className="input" value={salaryForm.other_deduction} onChange={e => setSalaryForm(p => ({ ...p, other_deduction: e.target.value }))} />
            </div>
          </div>
          <div className="p-4 bg-brand-50 rounded-xl border border-brand-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-surface-500 text-sm">Net Payable</p>
                <p className="font-bold text-brand-700 text-2xl font-mono">{formatCurrency(netPayable(salaryForm))}</p>
              </div>
              <div className="text-right text-xs text-surface-500 space-y-0.5">
                <p>Gross: {formatCurrency(parseFloat(salaryForm.gross_salary)||0)}</p>
                {parseFloat(salaryForm.advance_deduction)>0&&<p className="text-amber-600">- Advance: {formatCurrency(parseFloat(salaryForm.advance_deduction))}</p>}
                {parseFloat(salaryForm.other_deduction)>0&&<p className="text-red-600">- Other: {formatCurrency(parseFloat(salaryForm.other_deduction))}</p>}
              </div>
            </div>
            {parseFloat(salaryForm.advance_deduction) > 0 && (
              <p className="text-xs text-amber-700 mt-2 bg-amber-50 rounded px-2 py-1">
                ₹{parseFloat(salaryForm.advance_deduction).toLocaleString()} advance will be marked as recovered
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="label">Payment Mode</label>
            <select className="select" value={salaryForm.payment_mode} onChange={e => setSalaryForm(p => ({ ...p, payment_mode: e.target.value }))}>
              {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_',' ')}</option>)}
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

      {/* ADVANCE MODAL */}
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
              <label className="label">Mode</label>
              <select className="select" value={advanceForm.payment_mode} onChange={e => setAdvanceForm(p => ({ ...p, payment_mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_',' ')}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Date</label>
              <input type="date" className="input" value={advanceForm.advance_date} onChange={e => setAdvanceForm(p => ({ ...p, advance_date: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Reason</label>
            <input className="input" value={advanceForm.reason} onChange={e => setAdvanceForm(p => ({ ...p, reason: e.target.value }))} placeholder="Emergency, festival advance, etc." />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setAdvanceModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveAdvance} disabled={saving}>{saving ? <Spinner size={16} /> : 'Record Advance'}</button>
        </div>
      </Modal>
      {/* INCENTIVES TAB */}
      {tab === 'incentives' && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-amber-50 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-semibold text-amber-800">Flat Filling Incentives</h3>
                <p className="text-xs text-amber-600 mt-0.5">₹1,000/flat · ₹5,000 bonus for 10+ flats</p>
              </div>
            </div>
            {incentives.length === 0 ? (
              <div className="py-10 text-center text-surface-400 text-sm">No incentives paid yet</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Staff</th><th>Date</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
                <tbody>
                  {incentives.map(i => (
                    <tr key={i.id}>
                      <td className="font-medium">{i.staff?.full_name}</td>
                      <td className="text-xs text-surface-500">{i.advance_date}</td>
                      <td className="font-mono font-bold text-amber-700">{formatCurrency(i.amount)}</td>
                      <td className="text-xs text-surface-500">{i.notes || '—'}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEditAdvance(i)} className="btn-ghost p-1.5 text-surface-400 hover:text-brand-600" title="Edit">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button onClick={() => deleteAdvance(i.id)} className="btn-ghost p-1.5 text-red-400 hover:text-red-600" title="Delete">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* REIMBURSEMENTS TAB */}
      {tab === 'reimbursements' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setReimbModal(true)} className="btn-primary flex items-center gap-2"><Plus size={16}/> Add Reimbursement</button>
          </div>
          <div className="card overflow-hidden">
            {reimbursements.length === 0 ? (
              <div className="py-10 text-center text-surface-400 text-sm">No reimbursements recorded yet</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Staff</th><th>Date</th><th>Description</th><th>Mode</th><th className="text-right">Amount</th><th></th></tr></thead>
                <tbody>
                  {reimbursements.map(r => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.staff?.full_name}</td>
                      <td className="text-xs text-surface-500">{r.advance_date}</td>
                      <td className="text-sm text-surface-600">{r.notes || '—'}</td>
                      <td className="text-xs"><span className="badge badge-surface">{r.payment_mode?.toUpperCase() || '—'}</span></td>
                      <td className="text-right font-mono font-semibold text-brand-700">{formatCurrency(r.amount)}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEditAdvance(r)} className="btn-ghost p-1.5 text-surface-400 hover:text-brand-600" title="Edit">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button onClick={() => deleteAdvance(r.id)} className="btn-ghost p-1.5 text-red-400 hover:text-red-600" title="Delete">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* REIMBURSEMENT MODAL */}
      <Modal open={reimbModal} onClose={() => setReimbModal(false)} title="Record Reimbursement" size="sm">
        <div className="p-6 space-y-4">
          <div className="form-group">
            <label className="label">Staff Member *</label>
            <select className="select" value={rForm.staff_id} onChange={e => setRForm(p=>({...p,staff_id:e.target.value}))}>
              <option value="">— Select staff —</option>
              {activeStaff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Amount (₹) *</label>
              <input type="number" className="input" value={rForm.amount} onChange={e => setRForm(p=>({...p,amount:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Date</label>
              <input type="date" className="input" value={rForm.date} onChange={e => setRForm(p=>({...p,date:e.target.value}))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Description</label>
            <input className="input" value={rForm.description} onChange={e => setRForm(p=>({...p,description:e.target.value}))} placeholder="Travel, food, tools…" />
          </div>
          <div className="form-group">
            <label className="label">Payment Mode</label>
            <select className="select" value={rForm.payment_mode} onChange={e => setRForm(p=>({...p,payment_mode:e.target.value}))}>
              {['cash','upi','bank_transfer','other'].map(m=><option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setReimbModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveReimbursement} disabled={saving}>{saving ? <Spinner size={16}/> : 'Save Reimbursement'}</button>
        </div>
      </Modal>

      {/* EDIT SALARY MODAL */}
      <Modal open={editSalaryModal} onClose={() => { setEditSalaryModal(false); setEditSalaryRecord(null) }} title="Edit Salary Record" size="sm">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Gross Salary (₹)</label>
              <input type="number" className="input" value={editSalaryForm.gross_salary||''} onChange={e => setEditSalaryForm(p=>({...p, gross_salary: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Advance Deducted (₹)</label>
              <input type="number" className="input" value={editSalaryForm.advance_deduction||0} onChange={e => setEditSalaryForm(p=>({...p, advance_deduction: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Other Deduction (₹)</label>
              <input type="number" className="input" value={editSalaryForm.other_deduction||0} onChange={e => setEditSalaryForm(p=>({...p, other_deduction: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Net Payable (₹)</label>
              <input type="number" className="input bg-surface-50" value={
                parseFloat(editSalaryForm.gross_salary||0) - parseFloat(editSalaryForm.advance_deduction||0) - parseFloat(editSalaryForm.other_deduction||0)
              } readOnly />
            </div>
            <div className="form-group">
              <label className="label">Payment Mode</label>
              <select className="select" value={editSalaryForm.payment_mode||''} onChange={e => setEditSalaryForm(p=>({...p, payment_mode: e.target.value}))}>
                {['cash','upi','bank_transfer','other'].map(m=><option key={m} value={m}>{m.replace('_',' ').toUpperCase()}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Payment Date</label>
              <input type="date" className="input" value={editSalaryForm.payment_date||''} onChange={e => setEditSalaryForm(p=>({...p, payment_date: e.target.value}))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <input className="input" value={editSalaryForm.notes||''} onChange={e => setEditSalaryForm(p=>({...p, notes: e.target.value}))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => { setEditSalaryModal(false); setEditSalaryRecord(null) }}>Cancel</button>
          <button className="btn-primary" onClick={saveEditSalary}>Save Changes</button>
        </div>
      </Modal>

      {/* EDIT ADVANCE / INCENTIVE / REIMBURSEMENT MODAL */}
      <Modal open={editAdvanceModal} onClose={() => { setEditAdvanceModal(false); setEditAdvanceRecord(null) }} title="Edit Entry" size="sm">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Amount (₹)</label>
              <input type="number" className="input" value={editAdvanceForm.amount||''} onChange={e => setEditAdvanceForm(p=>({...p, amount: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Date</label>
              <input type="date" className="input" value={editAdvanceForm.advance_date||''} onChange={e => setEditAdvanceForm(p=>({...p, advance_date: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Type</label>
              <select className="select" value={editAdvanceForm.advance_type||'advance'} onChange={e => setEditAdvanceForm(p=>({...p, advance_type: e.target.value}))}>
                <option value="advance">Advance</option>
                <option value="incentive">Incentive</option>
                <option value="reimbursement">Reimbursement</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">Payment Mode</label>
              <select className="select" value={editAdvanceForm.payment_mode||'cash'} onChange={e => setEditAdvanceForm(p=>({...p, payment_mode: e.target.value}))}>
                {['cash','upi','bank_transfer','other'].map(m=><option key={m} value={m}>{m.replace('_',' ').toUpperCase()}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <input className="input" value={editAdvanceForm.notes||''} onChange={e => setEditAdvanceForm(p=>({...p, notes: e.target.value}))} />
          </div>
          <label className="flex items-center gap-2 text-sm text-surface-600 cursor-pointer">
            <input type="checkbox" checked={editAdvanceForm.recovered||false} onChange={e => setEditAdvanceForm(p=>({...p, recovered: e.target.checked}))} className="rounded" />
            Mark as Recovered
          </label>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => { setEditAdvanceModal(false); setEditAdvanceRecord(null) }}>Cancel</button>
          <button className="btn-primary" onClick={saveEditAdvance}>Save Changes</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        onConfirm={confirmDialog?.onConfirm}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        danger={confirmDialog?.danger}
      />

      {/* DELETE STAFF CONFIRM */}
      {deleteStaffId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold mb-2 text-surface-900">Remove staff member?</h3>
            <p className="text-surface-500 text-sm mb-5">They will be marked inactive. All salary and advance records are preserved.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteStaffId(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => deleteStaff(deleteStaffId)} className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
