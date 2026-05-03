import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, currentMonth, EXPENSE_CATEGORIES, exportToExcel } from '@/utils/helpers'
import { Modal, Badge, EmptyState, Spinner, PaymentModeBadge, SearchInput } from '@/components/ui'
import { TrendingDown, Plus, Download, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'other']
const CAT_COLORS = { marketing: '#f59e0b', wifi: '#3b82f6', maintenance: '#8b5cf6', cleaning: '#10b981', transport: '#f97316', office: '#06b6d4', legal: '#ec4899', misc: '#94a3b8' }

const defaultForm = () => ({
  category: 'misc', description: '', amount: '', payment_mode: 'upi',
  expense_date: new Date().toISOString().split('T')[0],
  building_id: '', vendor: '', transaction_ref: '', notes: ''
})

export default function Expenses() {
  const { profile } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [utilityBills, setUtilityBills] = useState([])
  const [buildings, setBuildings] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('general')
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState(currentMonth())
  const [filterCategory, setFilterCategory] = useState('')
  const [modal, setModal] = useState(false)
  const [utilityModal, setUtilityModal] = useState(false)
  const [form, setForm] = useState(defaultForm())
  const [uForm, setUForm] = useState({ building_id: '', utility_type: 'electricity', vendor: '', bill_number: '', amount: '', payment_mode: 'online', bill_date: '', payment_date: new Date().toISOString().split('T')[0], for_month: currentMonth(), transaction_ref: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [chartData, setChartData] = useState([])

  useEffect(() => { loadExpenses(); loadBuildings() }, [filterMonth, filterCategory, tab])

  async function loadExpenses() {
    setLoading(true)
    let q = supabase.from('expenses').select(`*, building:buildings(name), paidBy:profiles(full_name)`).order('expense_date', { ascending: false })
    if (filterMonth) q = q.gte('expense_date', `${filterMonth}-01`).lte('expense_date', `${filterMonth}-31`)
    if (filterCategory) q = q.eq('category', filterCategory)
    const { data } = await q
    setExpenses(data || [])

    // Build chart data
    const cats = {}
    ;(data || []).forEach(e => { cats[e.category] = (cats[e.category] || 0) + e.amount })
    setChartData(Object.entries(cats).map(([name, value]) => ({ name, value, color: CAT_COLORS[name] || '#94a3b8' })))

    // Load utility bills too
    let uq = supabase.from('utility_bills').select(`*, building:buildings(name), paidBy:profiles(full_name)`).order('payment_date', { ascending: false })
    if (filterMonth) uq = uq.eq('for_month', filterMonth)
    const { data: ub } = await uq
    setUtilityBills(ub || [])

    setLoading(false)
  }

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name')
    setBuildings(data || [])
  }

  async function save() {
    if (!form.description || !form.amount) return toast.error('Description and amount required')
    setSaving(true)
    const payload = { ...form, amount: parseFloat(form.amount), paid_by: profile?.id }
    if (!payload.building_id) delete payload.building_id
    const { error } = await supabase.from('expenses').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Expense recorded ✓')
    setModal(false); loadExpenses()
  }

  async function saveUtility() {
    if (!uForm.building_id || !uForm.amount) return toast.error('Building and amount required')
    setSaving(true)
    const { error } = await supabase.from('utility_bills').insert({ ...uForm, amount: parseFloat(uForm.amount), paid_by: profile?.id })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Utility bill recorded ✓')
    setUtilityModal(false); loadExpenses()
  }

  function handleExport() {
    const rows = expenses.map(e => ({ 'Date': e.expense_date, 'Category': e.category, 'Description': e.description, 'Vendor': e.vendor || '', 'Building': e.building?.name || '', 'Mode': e.payment_mode, 'Ref': e.transaction_ref || '', 'Amount': e.amount }))
    exportToExcel(rows, 'Expenses', `expenses-${filterMonth}.xlsx`)
  }

  const displayData = tab === 'general' ? expenses : utilityBills
  const filtered = displayData.filter(e => !search || JSON.stringify(e).toLowerCase().includes(search.toLowerCase()))
  const total = filtered.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Expenses</h2>
          <p className="text-surface-500 text-sm mt-1">Total this month: {formatCurrency(expenses.reduce((s, e) => s + e.amount, 0) + utilityBills.reduce((s, e) => s + e.amount, 0))}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-secondary" onClick={() => setUtilityModal(true)}>+ Utility Bill</button>
          <button className="btn-secondary" onClick={handleExport}><Download size={15} /> Export</button>
          <button className="btn-primary" onClick={() => { setForm(defaultForm()); setModal(true) }}><Plus size={16} /> Add Expense</button>
        </div>
      </div>

      {/* Charts + filters row */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <Filter size={14} className="text-surface-500" />
            <input type="month" className="input w-40" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
            <select className="select w-44" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="">All Categories</option>
              {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
            <SearchInput value={search} onChange={setSearch} placeholder="Search…" />
          </div>
          {/* Tab */}
          <div className="flex border-b border-surface-200 mt-4 mb-4">
            <button className={`tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>General Expenses ({expenses.length})</button>
            <button className={`tab ${tab === 'utility' ? 'active' : ''}`} onClick={() => setTab('utility')}>Utility Bills ({utilityBills.length})</button>
          </div>

          {/* Table */}
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div> : filtered.length === 0 ? (
            <EmptyState icon={TrendingDown} title="No expenses found" />
          ) : tab === 'general' ? (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Building</th><th>Mode</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {filtered.map(e => (
                    <tr key={e.id}>
                      <td className="text-surface-500 text-xs">{fmtDate(e.expense_date)}</td>
                      <td><span className="text-xs">{EXPENSE_CATEGORIES.find(c => c.value === e.category)?.icon}</span> <Badge variant="default">{e.category}</Badge></td>
                      <td><p className="text-surface-700">{e.description}</p>{e.vendor && <p className="text-surface-500 text-xs">{e.vendor}</p>}</td>
                      <td className="text-surface-500">{e.building?.name || 'General'}</td>
                      <td><PaymentModeBadge mode={e.payment_mode} /></td>
                      <td className="text-right amount-negative">{formatCurrency(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-surface-200"><td colSpan="5" className="px-4 py-3 text-surface-400 text-sm">Total</td><td className="px-4 py-3 text-right amount-negative font-bold">{formatCurrency(total)}</td></tr></tfoot>
              </table>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Building</th><th>Utility</th><th>Bill No.</th><th>Mode</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {filtered.map(e => (
                    <tr key={e.id}>
                      <td className="text-surface-500 text-xs">{fmtDate(e.payment_date)}</td>
                      <td className="text-surface-700">{e.building?.name || '—'}</td>
                      <td><Badge variant={e.utility_type === 'electricity' ? 'warning' : 'info'}>{e.utility_type}</Badge></td>
                      <td className="font-mono text-xs text-surface-500">{e.bill_number || '—'}</td>
                      <td><PaymentModeBadge mode={e.payment_mode} /></td>
                      <td className="text-right amount-negative">{formatCurrency(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-surface-200"><td colSpan="5" className="px-4 py-3 text-surface-400 text-sm">Total</td><td className="px-4 py-3 text-right amount-negative font-bold">{formatCurrency(total)}</td></tr></tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Category pie chart */}
        <div className="card p-5">
          <h3 className="font-display font-semibold text-surface-800 mb-4">By Category</h3>
          {chartData.length === 0 ? <p className="text-surface-500 text-sm text-center py-12">No data</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {chartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={v => formatCurrency(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }} />
                <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ color: '#94a3b8', fontSize: '11px' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="mt-3 space-y-1.5">
            {chartData.map(c => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <span className="text-surface-500 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.name}</span>
                <span className="font-mono text-surface-300">{formatCurrency(c.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add Expense Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Add Expense" size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Category *</label>
              <select className="select" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Amount (₹) *</label>
              <input type="number" className="input" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Description *</label>
            <input className="input" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What was this expense for?" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Payment Mode</label>
              <select className="select" value={form.payment_mode} onChange={e => setForm(p => ({ ...p, payment_mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase().replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Date</label>
              <input type="date" className="input" value={form.expense_date} onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Building (optional)</label>
              <select className="select" value={form.building_id} onChange={e => setForm(p => ({ ...p, building_id: e.target.value }))}>
                <option value="">General</option>
                {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Vendor</label>
              <input className="input" value={form.vendor} onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} placeholder="Vendor name" />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Transaction Reference</label>
            <input className="input" value={form.transaction_ref} onChange={e => setForm(p => ({ ...p, transaction_ref: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner size={16} /> : 'Add Expense'}</button>
        </div>
      </Modal>

      {/* Utility Bill Modal */}
      <Modal open={utilityModal} onClose={() => setUtilityModal(false)} title="Record Utility Bill" size="md">
        <div className="p-6 space-y-4">
          <div className="form-group">
            <label className="label">Building *</label>
            <select className="select" value={uForm.building_id} onChange={e => setUForm(p => ({ ...p, building_id: e.target.value }))}>
              <option value="">— Select building —</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
              <label className="label">Vendor</label>
              <input className="input" value={uForm.vendor} onChange={e => setUForm(p => ({ ...p, vendor: e.target.value }))} placeholder="BESCOM, BWSSB…" />
            </div>
            <div className="form-group">
              <label className="label">Bill Number</label>
              <input className="input" value={uForm.bill_number} onChange={e => setUForm(p => ({ ...p, bill_number: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">For Month</label>
              <input type="month" className="input" value={uForm.for_month} onChange={e => setUForm(p => ({ ...p, for_month: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Payment Mode</label>
              <select className="select" value={uForm.payment_mode} onChange={e => setUForm(p => ({ ...p, payment_mode: e.target.value }))}>
                {['cash', 'upi', 'bank_transfer', 'online', 'other'].map(m => <option key={m} value={m}>{m.toUpperCase().replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Transaction Reference</label>
            <input className="input" value={uForm.transaction_ref} onChange={e => setUForm(p => ({ ...p, transaction_ref: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setUtilityModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveUtility} disabled={saving}>{saving ? <Spinner size={16} /> : 'Record Bill'}</button>
        </div>
      </Modal>
    </div>
  )
}
