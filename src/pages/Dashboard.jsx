import { useEffect, useState, useRef } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtMonth, lastNMonths } from '@/utils/helpers'
import { format, parseISO, endOfMonth } from 'date-fns'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

const MONTHS = lastNMonths(6)
const MODE_COLORS = {
  rentok: '#8b5cf6', crib: '#ec4899', upi: '#3b82f6',
  bank_transfer: '#0d9488', cash: '#f59e0b', cheque: '#64748b', other: '#94a3b8'
}
const MODE_LABELS = {
  rentok: 'RentOK', crib: 'Crib', upi: 'UPI',
  bank_transfer: 'Bank', cash: 'Cash', cheque: 'Cheque', other: 'Other'
}

function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1
  const w = 64, h = 24
  const pts = data.map((v, i) => `${(i / (data.length-1)) * w},${h - ((v-min)/range) * (h-4) - 2}`).join(' ')
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function PnLRow({ label, value, indent = 0, bold = false, accent, sub }) {
  return (
    <div className={`flex items-center justify-between py-2 ${indent ? 'pl-6' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {indent > 0 && <span className="w-px h-3.5 bg-surface-200 flex-shrink-0" />}
        <div>
          <p className={`text-sm ${bold ? 'font-semibold text-surface-800' : 'text-surface-600'}`}>{label}</p>
          {sub && <p className="text-xs text-surface-400">{sub}</p>}
        </div>
      </div>
      <p className={`font-mono text-sm flex-shrink-0 ml-4 ${bold ? 'font-bold' : 'font-medium'} ${
        accent === 'green' ? 'text-emerald-700' : accent === 'red' ? 'text-red-600' : 'text-surface-700'
      }`}>{value}</p>
    </div>
  )
}

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-surface-200 rounded-lg shadow-card-hover px-3 py-2.5 text-xs">
      <p className="font-semibold text-surface-600 mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 mb-1">
          <span className="flex items-center gap-1.5 text-surface-500">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.name}
          </span>
          <span className="font-semibold font-mono">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[MONTHS.length - 1])
  const [stats, setStats] = useState(null)
  const [pnl, setPnl] = useState(null)
  const [trend, setTrend] = useState([])
  const [modeData, setModeData] = useState([])
  const [buildingPnl, setBuildingPnl] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [prevStats, setPrevStats] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const channelRef = useRef(null)
  const initialized = useRef(false)

  // On first mount — detect latest month with data
  useEffect(() => {
    supabase.from('rent_collections')
      .select('for_month').order('for_month', { ascending: false }).limit(1)
      .then(({ data }) => {
        const best = data?.[0]?.for_month
        if (best && MONTHS.includes(best)) {
          setSelectedMonth(best)
        }
        initialized.current = true
      })

    loadTrend()

    // Real-time subscription
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    const channel = supabase.channel('dashboard-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rent_collections' },
        () => { setLastUpdated(new Date()) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' },
        () => { setLastUpdated(new Date()) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'owner_payments' },
        () => { setLastUpdated(new Date()) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_salaries' },
        () => { setLastUpdated(new Date()) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_advances' },
        () => { setLastUpdated(new Date()) })
      .subscribe()
    channelRef.current = channel

    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [])

  // Load data whenever selectedMonth changes
  useEffect(() => {
    setLoading(true)
    loadAll(selectedMonth).finally(() => setLoading(false))
  }, [selectedMonth])

  // Re-load on real-time update
  useEffect(() => {
    if (!lastUpdated) return
    loadAll(selectedMonth)
    loadTrend()
  }, [lastUpdated])

  async function loadAll(m) {
    if (!m) return
    const prevM = MONTHS[MONTHS.indexOf(m) - 1] || m

    const [
      { count: buildings }, { count: tenants }, { count: vacant },
      { data: rent }, { data: ownerPmt }, { data: exp }, { data: ub }, { data: salaries },
      { data: prevRent }, { data: prevExp }, { data: prevOwner },
      { data: modes }, { data: bData }, { data: recentPay }
    ] = await Promise.all([
      supabase.from('buildings').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('tenants').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('flats').select('*', { count: 'exact', head: true }).eq('status', 'vacant'),
      supabase.from('rent_collections').select('amount, building_id').eq('for_month', m),
      supabase.from('owner_payments').select('amount, building_id, payment_type').eq('for_month', m),
      supabase.from('expenses').select('amount, category, building_id')
        .gte('expense_date', `${m}-01`)
        .lte('expense_date', format(endOfMonth(parseISO(`${m}-01`)), 'yyyy-MM-dd')),
      supabase.from('utility_bills').select('amount, building_id').eq('for_month', m),
      supabase.from('staff_salaries').select('net_amount').eq('for_month', m),
      supabase.from('rent_collections').select('amount').eq('for_month', prevM),
      supabase.from('expenses').select('amount')
        .gte('expense_date', `${prevM}-01`)
        .lte('expense_date', format(endOfMonth(parseISO(`${prevM}-01`)), 'yyyy-MM-dd')),
      supabase.from('owner_payments').select('amount').eq('for_month', prevM),
      supabase.from('rent_collections').select('payment_mode, amount').eq('for_month', m),
      supabase.from('buildings').select('id, name'),
      supabase.from('rent_collections')
        .select('id, amount, payment_mode, payment_date, for_month, flat_id, building_id, tenant_id')
        .order('created_at', { ascending: false }).limit(6),
    ])

    const income = (rent || []).reduce((s, r) => s + Number(r.amount), 0)
    const ownerRent = (ownerPmt || []).filter(p => p.payment_type !== 'security_deposit').reduce((s, r) => s + Number(r.amount), 0)
    const expTotal = (exp || []).reduce((s, r) => s + Number(r.amount), 0)
    const utilTotal = (ub || []).reduce((s, r) => s + Number(r.amount), 0)
    const salaryTotal = (salaries || []).reduce((s, r) => s + Number(r.net_amount), 0)
    const totalExpenses = ownerRent + expTotal + utilTotal + salaryTotal
    const grossProfit = income - ownerRent
    const netProfit = income - totalExpenses
    const margin = income > 0 ? Math.round((netProfit / income) * 100) : 0

    const prevIncome = (prevRent || []).reduce((s, r) => s + Number(r.amount), 0)
    const prevNet = prevIncome
      - (prevExp || []).reduce((s, r) => s + Number(r.amount), 0)
      - (prevOwner || []).reduce((s, r) => s + Number(r.amount), 0)

    setPrevStats({ income: prevIncome, net: prevNet })
    setStats({ buildings: buildings || 0, tenants: tenants || 0, vacant: vacant || 0, income, totalExpenses, netProfit, margin })
    setPnl({
      income, ownerRent, expTotal, utilTotal, salaryTotal, totalExpenses, grossProfit, netProfit, margin,
      expByCategory: (exp || []).reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + Number(e.amount); return acc
      }, {}),
    })

    const modeMap = {}
    ;(modes || []).forEach(r => { modeMap[r.payment_mode] = (modeMap[r.payment_mode] || 0) + Number(r.amount) })
    setModeData(Object.entries(modeMap).map(([mode, amount]) => ({ mode, amount })).sort((a, b) => b.amount - a.amount))

    const bMap = {}
    ;(bData || []).forEach(b => { bMap[b.id] = { name: b.name, income: 0, expenses: 0 } })
    ;(rent || []).forEach(r => { if (bMap[r.building_id]) bMap[r.building_id].income += Number(r.amount) })
    ;(ownerPmt || []).forEach(r => { if (bMap[r.building_id]) bMap[r.building_id].expenses += Number(r.amount) })
    ;(exp || []).forEach(r => { if (bMap[r.building_id]) bMap[r.building_id].expenses += Number(r.amount) })
    setBuildingPnl(Object.values(bMap).filter(b => b.income > 0 || b.expenses > 0).sort((a, b) => (b.income - b.expenses) - (a.income - a.expenses)))

    // Enrich recent payments
    if (recentPay?.length) {
      const tIds = [...new Set(recentPay.map(p => p.tenant_id).filter(Boolean))]
      const fIds = [...new Set(recentPay.map(p => p.flat_id).filter(Boolean))]
      const bIds = [...new Set(recentPay.map(p => p.building_id).filter(Boolean))]
      const [{ data: tData }, { data: fData }, { data: bDataR }] = await Promise.all([
        tIds.length ? supabase.from('tenants').select('id, full_name').in('id', tIds) : { data: [] },
        fIds.length ? supabase.from('flats').select('id, door_number').in('id', fIds) : { data: [] },
        bIds.length ? supabase.from('buildings').select('id, name').in('id', bIds) : { data: [] },
      ])
      const tMap = {}, fMap = {}, bMapR = {}
      ;(tData || []).forEach(t => { tMap[t.id] = t })
      ;(fData || []).forEach(f => { fMap[f.id] = f })
      ;(bDataR || []).forEach(b => { bMapR[b.id] = b })
      setRecent(recentPay.map(p => ({ ...p, tenant: tMap[p.tenant_id], flat: fMap[p.flat_id], building: bMapR[p.building_id] })))
    }
  }

  async function loadTrend() {
    const rows = []
    for (const m of MONTHS) {
      const [{ data: rc }, { data: op }, { data: ex }, { data: sal }] = await Promise.all([
        supabase.from('rent_collections').select('amount').eq('for_month', m),
        supabase.from('owner_payments').select('amount').eq('for_month', m),
        supabase.from('expenses').select('amount')
          .gte('expense_date', `${m}-01`)
          .lte('expense_date', format(endOfMonth(parseISO(`${m}-01`)), 'yyyy-MM-dd')),
        supabase.from('staff_salaries').select('net_amount').eq('for_month', m),
      ])
      const income = (rc || []).reduce((s, r) => s + Number(r.amount), 0)
      const expenses = [...(op || []), ...(ex || [])].reduce((s, r) => s + Number(r.amount), 0) + (sal || []).reduce((s, r) => s + Number(r.net_amount), 0)
      rows.push({ month: fmtMonth(m), income, expenses, profit: income - expenses })
    }
    setTrend(rows)
  }

  const delta = (cur, prev) => {
    if (!prev || prev === 0) return null
    return Math.round(((cur - prev) / prev) * 100)
  }
  const incomeDelta = delta(stats?.income, prevStats?.income)
  const netDelta = delta(stats?.netProfit, prevStats?.net)
  const sk = loading ? '—' : null

  const MetricCard = ({ label, value, d, sub, accent }) => {
    const pos = d > 0, neutral = d === 0 || d === null
    return (
      <div className="card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-widest">{label}</p>
          {!neutral && (
            <span className={`flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${pos ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
              {pos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(d)}%
            </span>
          )}
        </div>
        <p className={`text-2xl font-bold font-mono leading-none ${accent}`}>{value}</p>
        {sub && <p className="text-xs text-surface-400">{sub}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-surface-800">Financial Overview</h2>
          <select className="select w-auto py-1.5 text-sm" value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-400 hidden sm:block">
            {stats?.tenants} tenants · {stats?.buildings} buildings · {stats?.vacant} vacant
          </span>
          {lastUpdated && <span className="text-xs text-surface-400 hidden sm:block">Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
          </span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Total Revenue" value={sk ?? formatCurrency(stats?.income)} d={incomeDelta} sub="vs last month" accent="text-surface-900" />
        <MetricCard label="Total Expenses" value={sk ?? formatCurrency(stats?.totalExpenses)} accent="text-red-600" />
        <MetricCard label="Net Profit" value={sk ?? formatCurrency(stats?.netProfit)} d={netDelta} sub="vs last month" accent={!stats || stats.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'} />
        <div className="card p-5 flex flex-col gap-3">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-widest">Profit Margin</p>
          <p className={`text-2xl font-bold font-mono leading-none ${!stats || stats.margin >= 0 ? 'text-brand-700' : 'text-red-600'}`}>
            {sk ?? (stats?.margin + '%')}
          </p>
          {stats && <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden"><div className="h-full bg-brand-500 rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, stats.margin))}%` }} /></div>}
        </div>
      </div>

      {/* P&L + Charts */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* P&L */}
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-surface-800 text-sm">P&L Statement</h3>
            <span className="text-xs text-surface-400">{selectedMonth}</span>
          </div>
          <div>
            <div className="border-b border-surface-100 pb-1 mb-1">
              <PnLRow label="Rent Collected" value={sk ?? formatCurrency(pnl?.income)} bold accent="green" />
            </div>
            <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider pt-1 pb-0.5">Cost of Revenue</p>
            <PnLRow label="Owner Rent Payments" value={sk ?? formatCurrency(pnl?.ownerRent)} indent={1} accent="red" />
            <div className="border-b border-surface-100 pb-1 mb-1">
              <PnLRow label="Gross Profit" value={sk ?? formatCurrency(pnl?.grossProfit)} bold accent={pnl?.grossProfit >= 0 ? 'green' : 'red'} />
            </div>
            <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider pt-1 pb-0.5">Operating Expenses</p>
            <PnLRow label="Utility Bills" value={sk ?? formatCurrency(pnl?.utilTotal)} indent={1} accent="red" />
            <PnLRow label="Staff Salaries" value={sk ?? formatCurrency(pnl?.salaryTotal)} indent={1} accent="red" />
            <PnLRow label="Staff Salaries" value={sk ?? formatCurrency(pnl?.salaryTotal)} indent={1} accent="red" />
            {pnl?.expByCategory && Object.entries(pnl.expByCategory).map(([cat, amt]) => (
              <PnLRow key={cat} label={cat} value={formatCurrency(amt)} indent={1} accent="red" />
            ))}
            {(!pnl?.expByCategory || Object.keys(pnl.expByCategory).length === 0) && (
              <PnLRow label="General Expenses" value={sk ?? formatCurrency(pnl?.expTotal)} indent={1} accent="red" />
            )}
            <div className="border-t-2 border-surface-200 pt-2 mt-2">
              <PnLRow label="Net Profit / Loss" value={sk ?? formatCurrency(pnl?.netProfit)} bold
                accent={pnl?.netProfit >= 0 ? 'green' : 'red'} sub={pnl ? `${pnl.margin}% margin` : ''} />
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="lg:col-span-3 space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-surface-800 text-sm">6-Month Trend</h3>
              <div className="flex items-center gap-3 text-xs text-surface-400">
                <span className="flex items-center gap-1"><span className="w-5 h-0.5 bg-emerald-500 rounded inline-block" />Revenue</span>
                <span className="flex items-center gap-1"><span className="w-5 h-0.5 bg-red-400 rounded inline-block" />Expenses</span>
                <span className="flex items-center gap-1"><span className="w-5 h-0.5 bg-brand-500 rounded inline-block" />Profit</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  {[['ig','#16a34a'],['eg','#dc2626'],['pg','#0d9488']].map(([id, color]) => (
                    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.1} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `₹${(v/100000).toFixed(0)}L`} width={36} />
                <Tooltip content={<ChartTip />} />
                <ReferenceLine y={0} stroke="#e2e8f0" />
                <Area type="monotone" dataKey="income" name="Revenue" stroke="#16a34a" fill="url(#ig)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#dc2626" fill="url(#eg)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="profit" name="Profit" stroke="#0d9488" fill="url(#pg)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-surface-800 text-sm mb-3">Revenue by Collection Mode</h3>
            {modeData.length === 0 ? (
              <p className="text-sm text-surface-400 text-center py-4">No collections for {selectedMonth}</p>
            ) : (
              <div className="space-y-2.5">
                {modeData.map(({ mode, amount }) => {
                  const pct = stats?.income > 0 ? Math.round((amount / stats.income) * 100) : 0
                  return (
                    <div key={mode} className="flex items-center gap-3">
                      <div className="w-16 text-xs font-medium text-surface-600">{MODE_LABELS[mode] || mode}</div>
                      <div className="flex-1 h-2 bg-surface-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: MODE_COLORS[mode] || '#94a3b8' }} />
                      </div>
                      <span className="text-xs font-mono text-surface-600 w-24 text-right">{formatCurrency(amount)}</span>
                      <span className="text-xs text-surface-400 w-8 text-right">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Building P&L */}
      {buildingPnl.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-surface-100 flex items-center justify-between">
            <h3 className="font-semibold text-surface-800 text-sm">Building-wise Performance</h3>
            <span className="text-xs text-surface-400">{selectedMonth}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">Profit</th>
                  <th>Margin</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {buildingPnl.map((b, i) => {
                  const profit = b.income - b.expenses
                  const margin = b.income > 0 ? Math.round((profit / b.income) * 100) : 0
                  return (
                    <tr key={i}>
                      <td className="font-medium text-surface-800">{b.name}</td>
                      <td className="text-right font-mono text-emerald-700">{formatCurrency(b.income)}</td>
                      <td className="text-right font-mono text-red-600">{formatCurrency(b.expenses)}</td>
                      <td className={`text-right font-mono font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(profit)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(0, margin)}%`, backgroundColor: profit >= 0 ? '#0d9488' : '#dc2626' }} />
                          </div>
                          <span className="text-xs font-mono text-surface-500">{margin}%</span>
                        </div>
                      </td>
                      <td><Sparkline data={[b.income * 0.7, b.income * 0.85, b.income]} color={profit >= 0 ? '#0d9488' : '#dc2626'} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent payments */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-100">
          <h3 className="font-semibold text-surface-800 text-sm">Recent Payments</h3>
          <a href="/payments" className="text-xs font-medium text-brand-600 hover:text-brand-700">View all →</a>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-surface-400 text-center py-8">No payments recorded yet</p>
        ) : (
          <div className="divide-y divide-surface-100">
            {recent.map(p => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: (MODE_COLORS[p.payment_mode] || '#94a3b8') + '20', color: MODE_COLORS[p.payment_mode] || '#94a3b8' }}>
                  {(p.tenant?.full_name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-800 truncate">{p.tenant?.full_name || '—'}</p>
                  <p className="text-xs text-surface-400">{p.building?.name} · Room {p.flat?.door_number}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono font-semibold text-sm text-emerald-700">{formatCurrency(p.amount)}</p>
                  <p className="text-xs text-surface-400">{p.payment_date}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                  style={{ background: (MODE_COLORS[p.payment_mode] || '#94a3b8') + '20', color: MODE_COLORS[p.payment_mode] || '#94a3b8' }}>
                  {MODE_LABELS[p.payment_mode] || p.payment_mode}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
