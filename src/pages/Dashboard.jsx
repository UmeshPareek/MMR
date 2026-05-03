import { useEffect, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtMonth, lastNMonths, currentMonth } from '@/utils/helpers'
import { StatCard, Spinner, Badge } from '@/components/ui'
import { Building2, Users, TrendingUp, TrendingDown, AlertCircle, CreditCard, CheckCircle2 } from 'lucide-react'
import { format, parseISO, endOfMonth } from 'date-fns'

const CHART_COLORS = {
  income: '#10b981',
  expense: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-100 border border-surface-200 rounded-lg px-4 py-3 text-sm">
      <p className="text-surface-400 mb-2 font-medium">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-surface-300">{p.name}:</span>
          <span className="font-semibold" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [cashFlow, setCashFlow] = useState([])
  const [paymentModeData, setPaymentModeData] = useState([])
  const [recentPayments, setRecentPayments] = useState([])
  const [pendingRent, setPendingRent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      await Promise.all([loadStats(), loadCashFlow(), loadRecentPayments(), loadPaymentModes()])
    } finally {
      setLoading(false)
    }
  }

  async function loadStats() {
    const thisMonth = currentMonth()

    const [
      { count: buildings },
      { count: tenants },
      { data: rentThisMonth },
      { data: expensesThisMonth },
      { data: utilityBillsThisMonth },
      { data: ownerPaymentsThisMonth },
      { count: vacantFlats },
    ] = await Promise.all([
      supabase.from('buildings').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('tenants').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('rent_collections').select('amount').eq('for_month', thisMonth),
      supabase.from('expenses').select('amount').gte('expense_date', `${thisMonth}-01`).lte('expense_date', format(endOfMonth(parseISO(`${thisMonth}-01`)), 'yyyy-MM-dd')),
      supabase.from('utility_bills').select('amount').eq('for_month', thisMonth),
      supabase.from('owner_payments').select('amount').eq('for_month', thisMonth),
      supabase.from('flats').select('*', { count: 'exact', head: true }).eq('status', 'vacant'),
    ])

    const income = (rentThisMonth || []).reduce((s, r) => s + r.amount, 0)
    const expenses = [
      ...(expensesThisMonth || []),
      ...(utilityBillsThisMonth || []),
      ...(ownerPaymentsThisMonth || []),
    ].reduce((s, r) => s + r.amount, 0)

    setStats({
      buildings: buildings || 0,
      tenants: tenants || 0,
      income,
      expenses,
      netCashFlow: income - expenses,
      vacantFlats: vacantFlats || 0,
    })
  }

  async function loadCashFlow() {
    const months = lastNMonths(6)
    const data = []
    for (const m of months) {
      const [{ data: rc }, { data: exp }, { data: ub }, { data: op }] = await Promise.all([
        supabase.from('rent_collections').select('amount').eq('for_month', m),
        supabase.from('expenses').select('amount').gte('expense_date', `${m}-01`).lte('expense_date', format(endOfMonth(parseISO(`${m}-01`)), 'yyyy-MM-dd')),
        supabase.from('utility_bills').select('amount').eq('for_month', m),
        supabase.from('owner_payments').select('amount').eq('for_month', m),
      ])
      const income = (rc || []).reduce((s, r) => s + r.amount, 0)
      const expense = [...(exp || []), ...(ub || []), ...(op || [])].reduce((s, r) => s + r.amount, 0)
      data.push({ month: fmtMonth(m), income, expense, net: income - expense })
    }
    setCashFlow(data)
  }

  async function loadRecentPayments() {
    const { data } = await supabase
      .from('rent_collections')
      .select(`
        id, amount, payment_mode, payment_date, for_month,
        tenant:tenants(full_name),
        flat:flats(door_number),
        building:buildings(name)
      `)
      .order('payment_date', { ascending: false })
      .limit(8)

    setRecentPayments(data || [])
  }

  async function loadPaymentModes() {
    const thisMonth = currentMonth()
    const { data } = await supabase
      .from('rent_collections')
      .select('payment_mode, amount')
      .eq('for_month', thisMonth)

    const modeMap = {}
    ;(data || []).forEach(r => {
      modeMap[r.payment_mode] = (modeMap[r.payment_mode] || 0) + r.amount
    })

    const PIE_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f97316']
    const modes = Object.entries(modeMap).map(([name, value], i) => ({
      name: name.toUpperCase().replace('_', ' '),
      value,
      color: PIE_COLORS[i % PIE_COLORS.length]
    }))
    setPaymentModeData(modes)
  }

  return (
    <div className="space-y-6">
      {/* Welcome strip */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-surface-500 text-sm">
            {format(new Date(), 'MMMM yyyy')} Overview
          </p>
        </div>
        <span className="badge bg-income/10 text-income border border-income/20 animate-pulse-soft">
          <span className="w-1.5 h-1.5 rounded-full bg-income"></span> Live
        </span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Buildings" value={stats?.buildings ?? '—'} icon={Building2} color="amber" loading={loading} />
        <StatCard label="Active Tenants" value={stats?.tenants ?? '—'} icon={Users} color="blue" loading={loading} />
        <StatCard label="Income (MTD)" value={loading ? '—' : formatCurrency(stats?.income, true)} icon={TrendingUp} color="green" loading={loading} />
        <StatCard label="Expenses (MTD)" value={loading ? '—' : formatCurrency(stats?.expenses, true)} icon={TrendingDown} color="red" loading={loading} />
        <StatCard
          label="Net Cash Flow"
          value={loading ? '—' : formatCurrency(stats?.netCashFlow, true)}
          icon={CreditCard}
          color={stats?.netCashFlow >= 0 ? 'green' : 'red'}
          loading={loading}
        />
        <StatCard label="Vacant Flats" value={stats?.vacantFlats ?? '—'} icon={AlertCircle} color="purple" loading={loading} />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Cash Flow Chart */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-display font-semibold text-surface-800">6-Month Cash Flow</h3>
            <div className="flex items-center gap-4 text-xs text-surface-500">
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-income inline-block" /> Income</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-expense inline-block" /> Expense</span>
            </div>
          </div>
          {loading ? (
            <div className="h-52 flex items-center justify-center"><Spinner /></div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={cashFlow} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}K`} width={50} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="income" name="Income" stroke="#10b981" fill="url(#incomeGrad)" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
                <Area type="monotone" dataKey="expense" name="Expense" stroke="#ef4444" fill="url(#expenseGrad)" strokeWidth={2} dot={{ fill: '#ef4444', r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Payment Mode Pie */}
        <div className="card p-5">
          <h3 className="font-display font-semibold text-surface-800 mb-5">Collections by Mode</h3>
          {loading || paymentModeData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-surface-500 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie data={paymentModeData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {paymentModeData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={v => formatCurrency(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }} />
                <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ color: '#94a3b8', fontSize: '11px' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent Payments */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-surface-800">Recent Rent Collections</h3>
          <a href="/payments" className="text-brand-500 hover:text-brand-300 text-xs font-medium">View all →</a>
        </div>
        <div className="table-container">
          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10 rounded" />)}
            </div>
          ) : recentPayments.length === 0 ? (
            <p className="text-surface-500 text-sm py-8 text-center">No collections recorded yet</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Flat</th>
                  <th>Building</th>
                  <th>For Month</th>
                  <th>Mode</th>
                  <th className="text-right">Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map(p => (
                  <tr key={p.id}>
                    <td className="text-surface-700 font-medium">{p.tenant?.full_name || '—'}</td>
                    <td>{p.flat?.door_number || '—'}</td>
                    <td>{p.building?.name || '—'}</td>
                    <td>{fmtMonth(p.for_month)}</td>
                    <td>
                      <Badge variant={p.payment_mode === 'cash' ? 'warning' : p.payment_mode === 'upi' ? 'info' : 'success'}>
                        {p.payment_mode?.toUpperCase().replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="text-right amount-positive">{formatCurrency(p.amount)}</td>
                    <td className="text-surface-500">{p.payment_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
