import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtMonth, lastNMonths, currentMonth } from '@/utils/helpers'
import { format, parseISO, endOfMonth } from 'date-fns'

const PIE_COLORS = ['#0d9488', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b']

function KpiCard({ label, value, sub, accent = '#0d9488' }) {
  return (
    <div className="card p-5" style={{ borderTop: `3px solid ${accent}` }}>
      <p className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold text-surface-900 font-mono leading-none">{value}</p>
      {sub && <p className="text-xs text-surface-400 mt-1.5">{sub}</p>}
    </div>
  )
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-surface-200 rounded-lg px-3 py-2.5 text-xs shadow-card-hover">
      <p className="font-semibold text-surface-700 mb-1.5">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-surface-500">{p.name}</span>
          </span>
          <span className="font-semibold text-surface-800">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [cashFlow, setCashFlow] = useState([])
  const [modeData, setModeData] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([loadStats(), loadCashFlow(), loadRecent(), loadModes()])
      .finally(() => setLoading(false))
  }, [])

  async function loadStats() {
    const m = currentMonth()
    const [
      { count: buildings },
      { count: tenants },
      { data: rent },
      { data: exp },
      { data: ub },
      { data: op },
      { count: vacant },
    ] = await Promise.all([
      supabase.from('buildings').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('tenants').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('rent_collections').select('amount').eq('for_month', m),
      supabase.from('expenses').select('amount').gte('expense_date', `${m}-01`).lte('expense_date', format(endOfMonth(parseISO(`${m}-01`)), 'yyyy-MM-dd')),
      supabase.from('utility_bills').select('amount').eq('for_month', m),
      supabase.from('owner_payments').select('amount').eq('for_month', m),
      supabase.from('flats').select('*', { count: 'exact', head: true }).eq('status', 'vacant'),
    ])
    const income = (rent || []).reduce((s, r) => s + Number(r.amount), 0)
    const expenses = [...(exp || []), ...(ub || []), ...(op || [])].reduce((s, r) => s + Number(r.amount), 0)
    setStats({ buildings: buildings || 0, tenants: tenants || 0, income, expenses, net: income - expenses, vacant: vacant || 0 })
  }

  async function loadCashFlow() {
    const months = lastNMonths(6)
    const rows = []
    for (const m of months) {
      const [{ data: rc }, { data: ex }, { data: ub }, { data: op }] = await Promise.all([
        supabase.from('rent_collections').select('amount').eq('for_month', m),
        supabase.from('expenses').select('amount').gte('expense_date', `${m}-01`).lte('expense_date', format(endOfMonth(parseISO(`${m}-01`)), 'yyyy-MM-dd')),
        supabase.from('utility_bills').select('amount').eq('for_month', m),
        supabase.from('owner_payments').select('amount').eq('for_month', m),
      ])
      const income = (rc || []).reduce((s, r) => s + Number(r.amount), 0)
      const expense = [...(ex || []), ...(ub || []), ...(op || [])].reduce((s, r) => s + Number(r.amount), 0)
      rows.push({ month: fmtMonth(m), income, expense })
    }
    setCashFlow(rows)
  }

  async function loadRecent() {
    const { data } = await supabase
      .from('rent_collections')
      .select('id, amount, payment_mode, payment_date, for_month, tenant:tenants(full_name), flat:flats(door_number), building:buildings(name)')
      .order('payment_date', { ascending: false })
      .limit(8)
    setRecent(data || [])
  }

  async function loadModes() {
    const { data } = await supabase.from('rent_collections').select('payment_mode, amount').eq('for_month', currentMonth())
    const map = {}
    ;(data || []).forEach(r => { map[r.payment_mode] = (map[r.payment_mode] || 0) + Number(r.amount) })
    setModeData(Object.entries(map).map(([name, value]) => ({ name: name.toUpperCase().replace('_', ' '), value })))
  }

  const sk = loading ? '—' : null

  return (
    <div className="space-y-5">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-surface-500">{format(new Date(), 'MMMM yyyy')} Overview</p>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Live
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Buildings" value={sk ?? stats?.buildings} accent="#0d9488" />
        <KpiCard label="Active Tenants" value={sk ?? stats?.tenants} accent="#3b82f6" />
        <KpiCard label="Income MTD" value={sk ?? formatCurrency(stats?.income, true)} accent="#16a34a" />
        <KpiCard label="Expenses MTD" value={sk ?? formatCurrency(stats?.expenses, true)} accent="#dc2626" />
        <KpiCard
          label="Net Cash Flow"
          value={sk ?? formatCurrency(stats?.net, true)}
          accent={!stats || stats.net >= 0 ? '#16a34a' : '#dc2626'}
        />
        <KpiCard label="Vacant Flats" value={sk ?? stats?.vacant} accent="#f59e0b" />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-surface-800 text-sm">6-Month Cash Flow</h3>
            <div className="flex items-center gap-3 text-xs text-surface-400">
              <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-emerald-500 rounded inline-block" /> Income</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-red-400 rounded inline-block" /> Expense</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={cashFlow} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ig" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dc2626" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} width={48} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="income" name="Income" stroke="#16a34a" fill="url(#ig)" strokeWidth={2} dot={{ fill: '#16a34a', r: 3, strokeWidth: 0 }} />
              <Area type="monotone" dataKey="expense" name="Expense" stroke="#dc2626" fill="url(#eg)" strokeWidth={2} dot={{ fill: '#dc2626', r: 3, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-surface-800 text-sm mb-4">Collections by Mode</h3>
          {modeData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-surface-400">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={modeData} cx="50%" cy="45%" innerRadius={52} outerRadius={75} paddingAngle={2} dataKey="value">
                  {modeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => formatCurrency(v)}
                  contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                <Legend iconType="circle" iconSize={7}
                  formatter={v => <span style={{ color: '#64748b', fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent payments */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-100">
          <h3 className="font-semibold text-surface-800 text-sm">Recent Rent Collections</h3>
          <a href="/payments" className="text-xs font-medium text-brand-600 hover:text-brand-700">View all →</a>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-surface-400 text-center py-10">No collections recorded yet</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Flat</th>
                <th>Building</th>
                <th>Month</th>
                <th>Mode</th>
                <th className="text-right">Amount</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(p => (
                <tr key={p.id}>
                  <td className="font-medium text-surface-800">{p.tenant?.full_name || '—'}</td>
                  <td className="font-mono text-xs">{p.flat?.door_number || '—'}</td>
                  <td>{p.building?.name || '—'}</td>
                  <td className="text-surface-500">{fmtMonth(p.for_month)}</td>
                  <td>
                    <span className="badge bg-brand-50 text-brand-700 border border-brand-100">
                      {p.payment_mode?.toUpperCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td className="text-right font-mono font-semibold text-emerald-700">{formatCurrency(p.amount)}</td>
                  <td className="text-surface-400 text-xs">{p.payment_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
