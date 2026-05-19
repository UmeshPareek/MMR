import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, debounce } from '@/utils/helpers'
import { Spinner } from '@/components/ui'
import { Download, RefreshCw, Building2, AlertTriangle, CheckCircle2, LogIn, LogOut, TrendingUp, TrendingDown, Users, Wallet, BarChart3, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth())
  const [pnl, setPnl] = useState(null)
  const [buildingPnl, setBuildingPnl] = useState([])
  const [trend, setTrend] = useState([])
  const [outstanding, setOutstanding] = useState({ count: 0, amount: 0 })
  const [rentExpected, setRentExpected] = useState({ expected: 0, collected: 0 })
  const [movement, setMovement] = useState({ checkIns: 0, checkOuts: 0, depositIn: 0, runaways: 0 })
  const [activeTenantCount, setActiveTenantCount] = useState(0)
  const [viewMode, setViewMode] = useState('consolidated')
  const [loading, setLoading] = useState(true)
  const [appStart, setAppStart] = useState('2024-01')
  const channelRef = useRef(null)

  // Generate available months dynamically — fetched from DB on mount
  const availableMonths = []
  const start = new Date(appStart + '-01')
  const now = new Date()
  for (let d = new Date(start); d <= now; d.setMonth(d.getMonth() + 1)) {
    availableMonths.push(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 7))
  }
  availableMonths.reverse()

  // Debounced loader — prevents 25 queries on every rapid real-time event
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedLoad = useCallback(debounce(() => load(), 800), [month])

  useEffect(() => {
    // Derive app start from the earliest rent_collection record
    supabase.from('rent_collections').select('for_month').order('for_month', { ascending: true }).limit(1)
      .then(({ data }) => {
        if (data?.[0]?.for_month) setAppStart(data[0].for_month.slice(0, 7))
      })
  }, [])

  useEffect(() => {
    load()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rent_collections' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_salaries' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_advances' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'utility_bills' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meter_readings' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'owner_payments' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, debouncedLoad)
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') console.error('Dashboard channel error:', err)
      })
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    try {
      const prevMonthDate = new Date(parseInt(month.slice(0,4)), parseInt(month.slice(5,7))-2, 1)
      const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth()+1).padStart(2,'0')}`
      const monthEnd = new Date(parseInt(month.slice(0,4)), parseInt(month.slice(5,7)), 0).getDate()
      const monthEndStr = `${month}-${String(monthEnd).padStart(2,'0')}`

      const [
        { data: collections, error: e1 },
        { data: expenses, error: e2 },
        { data: prevSalaries, error: e3 },
        { data: ownerRents, error: e4 },
        { data: utilityBills, error: e5 },
        { data: meterReadings, error: e6 },
        { data: buildings, error: e7 },
        { data: allTenants, error: e8 },
        { data: prevCollections, error: e9 },
        { data: checkIns, error: e10 },
        { data: checkOuts, error: e11 },
        { data: currentSalaries, error: e12 },
      ] = await Promise.all([
        supabase.from('rent_collections').select('amount,building_id,tenant_id,payment_mode').eq('for_month', month),
        supabase.from('expenses').select('amount,category,building_id,expense_date').gte('expense_date',`${month}-01`).lte('expense_date', monthEndStr),
        supabase.from('staff_salaries').select('net_salary,for_month').eq('for_month', prevMonth),
        supabase.from('staff_salaries').select('net_salary,for_month').eq('for_month', month),
        supabase.from('owner_payments').select('amount,building_id').eq('for_month', month),
        supabase.from('utility_bills').select('amount,building_id').eq('for_month', month),
        supabase.from('meter_readings').select('amount_charged,building_id').eq('for_month', month),
        supabase.from('buildings').select('id,name').neq('is_active', false),
        supabase.from('tenants').select('id,monthly_rent,building_id,move_in_date').eq('status','active'),
        supabase.from('rent_collections').select('tenant_id').eq('for_month', prevMonth),
        supabase.from('tenants').select('security_deposit_paid,move_in_date').eq('status','active').gte('move_in_date',`${month}-01`).lte('move_in_date', monthEndStr),
        supabase.from('tenants').select('move_out_date,notes').eq('status','vacated').gte('move_out_date',`${month}-01`).lte('move_out_date', monthEndStr),
      ])

      const errors = [e1,e2,e3,e4,e5,e6,e7,e8,e9,e10,e11,e12].filter(Boolean)
      if (errors.length > 0) {
        console.error('Dashboard load errors:', errors)
        toast.error('Some data failed to load — refresh to retry')
      }

      const income = (collections||[]).reduce((s,r)=>s+Number(r.amount),0)
      const expTotal = (expenses||[]).reduce((s,r)=>s+Number(r.amount),0)
      // Salary: use the month being viewed's salary if paid, otherwise previous month (accrual)
      const prevMonthSalaryTotal = (prevSalaries||[]).reduce((s,r)=>s+Number(r.net_salary||r.net_amount||0),0)
      const currentMonthSalaryPaid = (currentSalaries||[]).reduce((s,r)=>s+Number(r.net_salary||r.net_amount||0),0)
      // Use current month salary if paid; otherwise show previous month as the accrued expense
      const salaryTotal = currentMonthSalaryPaid > 0 ? currentMonthSalaryPaid : prevMonthSalaryTotal
      const ownerRentTotal = (ownerRents||[]).reduce((s,r)=>s+Number(r.amount),0)
      const utilPaid = (utilityBills||[]).reduce((s,r)=>s+Number(r.amount),0)
      const utilCharged = (meterReadings||[]).reduce((s,r)=>s+Number(r.amount_charged||0),0)
      const totalExpenses = expTotal + salaryTotal + ownerRentTotal + utilPaid
      const grossProfit = income + utilCharged - totalExpenses
      const margin = income > 0 ? Math.round(grossProfit/income*100) : 0

      const totalExpected = (allTenants||[]).reduce((s,t)=>s+Number(t.monthly_rent||0),0)
      const prevPaidIds = new Set((prevCollections||[]).map(c=>c.tenant_id))
      const unpaidPrev = (allTenants||[]).filter(t => {
        if (t.move_in_date && t.move_in_date >= `${month}-01`) return false
        if (t.move_in_date && t.move_in_date >= `${prevMonth}-01`) return false
        return !prevPaidIds.has(t.id)
      })

      setRentExpected({ expected: totalExpected, collected: income })
      setOutstanding({ count: unpaidPrev.length, amount: unpaidPrev.reduce((s,t)=>s+Number(t.monthly_rent),0) })
      setActiveTenantCount((allTenants||[]).length)
      setMovement({
        checkIns: (checkIns||[]).length,
        checkOuts: (checkOuts||[]).length,
        depositIn: (checkIns||[]).reduce((s,t)=>s+(parseFloat(t.security_deposit_paid)||0),0),
        runaways: (checkOuts||[]).filter(t=>t.notes?.includes('RUNAWAY')).length,
      })

      const bMap = {}
      ;(buildings||[]).forEach(b=>{ bMap[b.id]={ name:b.name, income:0, expenses:0, ownerRent:0, util:0 } })
      ;(collections||[]).forEach(c=>{ if(bMap[c.building_id]) bMap[c.building_id].income+=Number(c.amount) })
      ;(expenses||[]).forEach(e=>{ if(bMap[e.building_id]) bMap[e.building_id].expenses+=Number(e.amount) })
      ;(ownerRents||[]).forEach(o=>{ if(bMap[o.building_id]) bMap[o.building_id].ownerRent+=Number(o.amount) })
      ;(utilityBills||[]).forEach(u=>{ if(bMap[u.building_id]) bMap[u.building_id].util+=Number(u.amount) })
      setBuildingPnl(Object.values(bMap).map(b=>({...b, net:b.income-b.expenses-b.ownerRent-b.util})))

      setPnl({ income, expTotal, salaryTotal, ownerRentTotal, utilPaid, utilCharged, totalExpenses, grossProfit, margin })

      // Trend — last 6 available months, using 2 queries per month max
      const trendMonths = availableMonths.slice(0, 6).reverse()
      const trendData = await Promise.all(trendMonths.map(async m => {
        const me = new Date(parseInt(m.slice(0,4)), parseInt(m.slice(5,7)), 0).getDate()
        const [{ data: mc }, { data: me2 }] = await Promise.all([
          supabase.from('rent_collections').select('amount').eq('for_month', m),
          supabase.from('expenses').select('amount').gte('expense_date',`${m}-01`).lte('expense_date',`${m}-${String(me).padStart(2,'0')}`),
        ])
        return {
          month: new Date(parseInt(m.slice(0,4)), parseInt(m.slice(5,7))-1, 1).toLocaleString('en-IN',{month:'short'}),
          revenue: (mc||[]).reduce((s,r)=>s+Number(r.amount),0),
          expenses: (me2||[]).reduce((s,r)=>s+Number(r.amount),0),
        }
      }))
      setTrend(trendData)
    } catch(e) {
      console.error('Dashboard load failed:', e)
      toast.error('Dashboard failed to load: ' + (e.message || 'Unknown error'))
    }
    setLoading(false)
  }

  async function downloadMasterExcel() {
    const tid = toast.loading('Preparing…')
    try {
      const monthEnd = new Date(parseInt(month.slice(0,4)), parseInt(month.slice(5,7)), 0).getDate()
      const monthEndStr = `${month}-${String(monthEnd).padStart(2,'0')}`
      const wb = XLSX.utils.book_new()
      const [
        { data: collections }, { data: expenses }, { data: salaries },
        { data: ownerRents }, { data: utilityBills }, { data: buildings },
        { data: ciData }, { data: coData }
      ] = await Promise.all([
        supabase.from('rent_collections').select('*, tenant:tenants(full_name,phone), building:buildings(name)').eq('for_month', month),
        supabase.from('expenses').select('*, building:buildings(name)').gte('expense_date',`${month}-01`).lte('expense_date', monthEndStr),
        supabase.from('staff_salaries').select('*, staff:staff(full_name)').eq('for_month', month),
        supabase.from('owner_payments').select('*, building:buildings(name)').eq('for_month', month),
        supabase.from('utility_bills').select('*, building:buildings(name)').eq('for_month', month),
        supabase.from('buildings').select('id,name').eq('is_active', true),
        supabase.from('tenants').select('full_name,phone,monthly_rent,security_deposit_paid,move_in_date,building_id').gte('move_in_date',`${month}-01`).lte('move_in_date', monthEndStr),
        supabase.from('tenants').select('full_name,phone,move_out_date,notes,building_id').eq('status','inactive').gte('move_out_date',`${month}-01`).lte('move_out_date', monthEndStr),
      ])
      const bMap = {}; (buildings||[]).forEach(b=>{ bMap[b.id]=b.name })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((collections||[]).map(c=>({ Building:c.building?.name, Tenant:c.tenant?.full_name, Phone:c.tenant?.phone, Amount:c.amount, Mode:c.payment_mode, Month:month }))), 'Rent Collections')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((expenses||[]).map(e=>({ Date:e.expense_date, Category:e.category, Description:e.description, Building:e.building?.name||'General', Amount:e.amount }))), 'Expenses')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((salaries||[]).map(s=>({ Staff:s.staff?.full_name, Gross:s.gross_salary, Net:s.net_salary||s.net_amount, Date:s.payment_date }))), 'Staff Salary')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((utilityBills||[]).map(u=>({ Building:u.building?.name, Type:u.utility_type, Amount:u.amount, Month:u.for_month }))), 'Utility Bills')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildingPnl.map(b=>({ Building:b.name, Rent:b.income, 'Owner Rent':b.ownerRent, Expenses:b.expenses, Utility:b.util, Net:b.net }))), 'Building P&L')
      if (pnl) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CashMyRent P&L',month],[''],['Rent Collected',pnl.income],['Utility Billed',pnl.utilCharged],['TOTAL INCOME',pnl.income+pnl.utilCharged],[''],['Owner Rent',pnl.ownerRentTotal],['Expenses',pnl.expTotal],['Utility Paid',pnl.utilPaid],['Staff Salary',pnl.salaryTotal],['TOTAL EXPENSES',pnl.totalExpenses],[''],['NET PROFIT',pnl.grossProfit],['MARGIN',pnl.margin+'%']]), 'P&L Summary')
      if (ciData?.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ciData.map(t=>({ Building:bMap[t.building_id]||'—', Tenant:t.full_name, Phone:t.phone, 'Move In':t.move_in_date, Rent:t.monthly_rent, Deposit:t.security_deposit_paid||0 }))), 'Check-Ins')
      if (coData?.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coData.map(t=>({ Building:bMap[t.building_id]||'—', Tenant:t.full_name, 'Exit Date':t.move_out_date, Type:t.notes?.includes('RUNAWAY')?'Runaway':'Normal' }))), 'Check-Outs')
      XLSX.writeFile(wb, `CashMyRent_${month}.xlsx`)
      toast.dismiss(tid); toast.success('Downloaded ✓')
    } catch(e) {
      toast.dismiss(tid)
      toast.error('Export failed: ' + (e.message || 'Unknown error'))
    }
  }

  const collRate = rentExpected.expected > 0 ? Math.round(rentExpected.collected/rentExpected.expected*100) : 0
  const expenseBreakdown = pnl ? [
    { name:'Owner Rent', value: pnl.ownerRentTotal, color:'#f87171' },
    { name:'Expenses', value: pnl.expTotal, color:'#fb923c' },
    { name:'Utility', value: pnl.utilPaid, color:'#fbbf24' },
    { name:'Salaries', value: pnl.salaryTotal, color:'#a78bfa' },
  ].filter(e=>e.value>0) : []

  return (
    <div className="space-y-6">
      {/* ── Hero header ── */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-teal-500 p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{backgroundImage:'radial-gradient(circle at 70% 50%, white 1px, transparent 1px)', backgroundSize:'24px 24px'}}/>
        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-brand-100 text-sm font-medium mb-1">CashMyRent · Portfolio Overview</p>
            <h1 className="text-3xl font-bold tracking-tight">
              {loading ? '—' : formatCurrency(pnl?.income || 0)}
            </h1>
            <p className="text-brand-100 text-sm mt-1">Rent collected · {new Date(parseInt(month.slice(0,4)), parseInt(month.slice(5,7))-1, 1).toLocaleString('en-IN',{month:'long',year:'numeric'})}</p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5 text-sm">
                <Users className="w-4 h-4 text-brand-200"/>
                <span className="text-white font-semibold">{activeTenantCount}</span>
                <span className="text-brand-200">active tenants</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <Building2 className="w-4 h-4 text-brand-200"/>
                <span className="text-white font-semibold">{buildingPnl.length}</span>
                <span className="text-brand-200">buildings</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none backdrop-blur-sm"
              value={month} onChange={e => setMonth(e.target.value)}>
              {availableMonths.map(m => (
                <option key={m} value={m} style={{color:'#0C0C0C'}}>
                  {new Date(parseInt(m.slice(0,4)), parseInt(m.slice(5,7))-1, 1).toLocaleString('en-IN',{month:'long',year:'numeric'})}
                </option>
              ))}
            </select>
            <div className="flex bg-white/10 border border-white/20 rounded-lg overflow-hidden">
              <button onClick={()=>setViewMode('consolidated')} className={`px-3 py-1.5 text-xs font-medium transition-all ${viewMode==='consolidated'?'bg-white text-brand-700':'text-white hover:bg-white/10'}`}>Consolidated</button>
              <button onClick={()=>setViewMode('building')} className={`px-3 py-1.5 text-xs font-medium transition-all ${viewMode==='building'?'bg-white text-brand-700':'text-white hover:bg-white/10'}`}>By Building</button>
            </div>
            <button onClick={downloadMasterExcel} className="flex items-center gap-2 bg-white text-brand-700 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-brand-50 transition-colors">
              <Download className="w-4 h-4"/> Excel
            </button>
            <button onClick={load} className="p-2 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors">
              <RefreshCw className="w-4 h-4 text-white"/>
            </button>
          </div>
        </div>

        {!loading && pnl && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {[
              { label:'Net Profit', value: formatCurrency(pnl.grossProfit), sub: `${pnl.margin}% margin`, up: pnl.grossProfit >= 0 },
              { label:'Total Expenses', value: formatCurrency(pnl.totalExpenses), sub:'all costs', up: false },
              { label:'Collection Rate', value: `${collRate}%`, sub:`of ₹${(rentExpected.expected/100000).toFixed(1)}L expected`, up: collRate >= 80 },
              { label:'Outstanding', value: formatCurrency(outstanding.amount), sub:`${outstanding.count} tenants`, up: outstanding.amount === 0 },
            ].map(({label,value,sub,up}) => (
              <div key={label} className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3">
                <p className="text-brand-100 text-xs mb-1">{label}</p>
                <p className="text-white font-bold text-lg leading-tight">{value}</p>
                <p className="text-brand-200 text-xs mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="py-16 flex justify-center"><Spinner /></div>}

      {!loading && pnl && (<>

        {outstanding.amount > 0 && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"/>
            <div>
              <p className="font-semibold text-amber-800 text-sm">{outstanding.count} tenants with outstanding dues from previous month — {formatCurrency(outstanding.amount)}</p>
              <p className="text-xs text-amber-600 mt-0.5">Ensure collection team follows up before closing this month.</p>
            </div>
          </div>
        )}

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-surface-800">Rent Collection</h3>
              <p className="text-xs text-surface-400 mt-0.5">{month} · {collRate}% collected</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold font-mono text-brand-700">{formatCurrency(rentExpected.collected)}</p>
              <p className="text-xs text-surface-400">of {formatCurrency(rentExpected.expected)}</p>
            </div>
          </div>
          <div className="relative h-3 bg-surface-100 rounded-full overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
              style={{ width:`${Math.min(collRate,100)}%`, background: collRate>=90?'linear-gradient(90deg,#0D9488,#14b8a6)':collRate>=70?'linear-gradient(90deg,#f59e0b,#fbbf24)':'linear-gradient(90deg,#dc2626,#f87171)' }}/>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-center">
            <div className="p-2 bg-emerald-50 rounded-lg"><p className="text-xs text-emerald-600">Collected</p><p className="font-mono font-bold text-emerald-700">{formatCurrency(rentExpected.collected)}</p></div>
            <div className="p-2 bg-red-50 rounded-lg"><p className="text-xs text-red-600">Pending</p><p className="font-mono font-bold text-red-600">{formatCurrency(Math.max(0,rentExpected.expected-rentExpected.collected))}</p></div>
            <div className="p-2 bg-amber-50 rounded-lg"><p className="text-xs text-amber-600">Prev. Outstanding</p><p className="font-mono font-bold text-amber-600">{formatCurrency(outstanding.amount)}</p></div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: <LogIn className="w-5 h-5 text-emerald-600"/>, bg:'bg-emerald-100', label:'Check-Ins', value: movement.checkIns, sub:`${formatCurrency(movement.depositIn)} deposit`, color:'text-emerald-700' },
            { icon: <LogOut className="w-5 h-5 text-red-500"/>, bg:'bg-red-100', label:'Check-Outs', value: movement.checkOuts, sub: movement.runaways > 0 ? `${movement.runaways} runaway ⚠️` : 'all normal', color:'text-red-600' },
            { icon: <Users className="w-5 h-5 text-brand-600"/>, bg:'bg-brand-100', label:'Active Tenants', value: activeTenantCount, sub:'total occupied', color:'text-brand-700' },
            { icon: <Building2 className="w-5 h-5 text-surface-500"/>, bg:'bg-surface-100', label:'Net Movement',
              value: (movement.checkIns-movement.checkOuts >= 0 ? '+' : '') + (movement.checkIns-movement.checkOuts),
              sub:'this month', color: movement.checkIns-movement.checkOuts >= 0 ? 'text-emerald-700':'text-red-600' },
          ].map(({icon,bg,label,value,sub,color}) => (
            <div key={label} className="card p-4 flex items-center gap-3">
              <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center flex-shrink-0`}>{icon}</div>
              <div>
                <p className="text-xs text-surface-400">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-surface-400">{sub}</p>
              </div>
            </div>
          ))}
        </div>

        {viewMode === 'consolidated' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="card p-5 lg:col-span-1">
              <h3 className="font-semibold text-surface-800 mb-4">P&L — {month}</h3>
              <div className="space-y-2">
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Income</span>
                    <span className="font-mono font-bold text-emerald-700">{formatCurrency(pnl.income+pnl.utilCharged)}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-emerald-600"><span>Rent</span><span className="font-mono">{formatCurrency(pnl.income)}</span></div>
                    <div className="flex justify-between text-emerald-600"><span>Utility Billed</span><span className="font-mono">{formatCurrency(pnl.utilCharged)}</span></div>
                  </div>
                </div>
                <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold text-red-700 uppercase tracking-wider">Expenses</span>
                    <span className="font-mono font-bold text-red-600">{formatCurrency(pnl.totalExpenses)}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    {[['Owner Rent',pnl.ownerRentTotal],['General Expenses',pnl.expTotal],['Utility Paid',pnl.utilPaid],['Staff Salary',pnl.salaryTotal]].map(([l,v])=>
                      v>0 && <div key={l} className="flex justify-between text-red-600"><span>{l}</span><span className="font-mono">{formatCurrency(v)}</span></div>
                    )}
                  </div>
                </div>
                <div className={`p-3 rounded-xl border ${pnl.grossProfit>=0?'bg-brand-50 border-brand-200':'bg-red-100 border-red-300'}`}>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-surface-800">Net Profit</span>
                    <div className="text-right">
                      <p className={`font-mono font-bold text-xl ${pnl.grossProfit>=0?'text-brand-700':'text-red-600'}`}>{formatCurrency(pnl.grossProfit)}</p>
                      <p className="text-xs text-surface-400">{pnl.margin}% margin</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card p-5 lg:col-span-2">
              <h3 className="font-semibold text-surface-800 mb-4">Revenue vs Expenses</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend} barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                  <XAxis dataKey="month" tick={{fontSize:11, fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:11, fill:'#94a3b8'}} tickFormatter={v=>`₹${(v/100000).toFixed(0)}L`} axisLine={false} tickLine={false}/>
                  <Tooltip formatter={v=>formatCurrency(v)} contentStyle={{borderRadius:8,border:'1px solid #e2e8f0',boxShadow:'0 4px 12px rgba(0,0,0,.08)'}}/>
                  <Legend wrapperStyle={{fontSize:12}}/>
                  <Bar dataKey="revenue" name="Revenue" fill="#0D9488" radius={[4,4,0,0]}/>
                  <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[4,4,0,0]}/>
                </BarChart>
              </ResponsiveContainer>

              {expenseBreakdown.length > 0 && (
                <div className="mt-4 pt-4 border-t border-surface-100 grid grid-cols-2 gap-4 items-center">
                  <div>
                    <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">Expense Breakdown</p>
                    <div className="space-y-2">
                      {expenseBreakdown.map(e=>(
                        <div key={e.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{background:e.color}}/>
                            <span className="text-surface-600">{e.name}</span>
                          </div>
                          <span className="font-mono font-semibold text-surface-700">{formatCurrency(e.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={100}>
                    <PieChart>
                      <Pie data={expenseBreakdown} cx="50%" cy="50%" innerRadius={28} outerRadius={46} dataKey="value" paddingAngle={3}>
                        {expenseBreakdown.map((e,i)=><Cell key={i} fill={e.color}/>)}
                      </Pie>
                      <Tooltip formatter={v=>formatCurrency(v)} contentStyle={{borderRadius:8,fontSize:11}}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
              <h3 className="font-semibold text-surface-700">Building P&L — {month}</h3>
              <span className="text-xs text-surface-400">{buildingPnl.length} buildings</span>
            </div>
            <table className="data-table">
              <thead><tr><th>Building</th><th className="text-right">Rent</th><th className="text-right">Owner Rent</th><th className="text-right">Expenses</th><th className="text-right">Utility</th><th className="text-right">Net Profit</th><th>Status</th></tr></thead>
              <tbody>
                {buildingPnl.sort((a,b)=>b.net-a.net).map(b=>(
                  <tr key={b.name}>
                    <td className="font-medium text-surface-800">{b.name}</td>
                    <td className="text-right font-mono text-emerald-700">{formatCurrency(b.income)}</td>
                    <td className="text-right font-mono text-red-400 text-sm">{b.ownerRent>0?formatCurrency(b.ownerRent):'—'}</td>
                    <td className="text-right font-mono text-red-400 text-sm">{b.expenses>0?formatCurrency(b.expenses):'—'}</td>
                    <td className="text-right font-mono text-amber-600 text-sm">{b.util>0?formatCurrency(b.util):'—'}</td>
                    <td className={`text-right font-mono font-bold ${b.net>=0?'text-emerald-700':'text-red-600'}`}>{formatCurrency(b.net)}</td>
                    <td>
                      <span className={`badge border text-xs ${b.net>=0?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-red-50 text-red-700 border-red-200'}`}>
                        {b.net>=0 ? <span className="flex items-center gap-1"><ArrowUpRight className="w-3 h-3"/>Profit</span> : <span className="flex items-center gap-1"><ArrowDownRight className="w-3 h-3"/>Loss</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-50 border-t-2 border-surface-200 font-bold">
                  <td className="px-4 py-3 text-xs text-surface-600 uppercase tracking-wider">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-700">{formatCurrency(buildingPnl.reduce((s,b)=>s+b.income,0))}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-500">{formatCurrency(buildingPnl.reduce((s,b)=>s+b.ownerRent,0))}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-500">{formatCurrency(buildingPnl.reduce((s,b)=>s+b.expenses,0))}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-600">{formatCurrency(buildingPnl.reduce((s,b)=>s+b.util,0))}</td>
                  <td className={`px-4 py-3 text-right font-mono text-lg ${buildingPnl.reduce((s,b)=>s+b.net,0)>=0?'text-brand-700':'text-red-600'}`}>{formatCurrency(buildingPnl.reduce((s,b)=>s+b.net,0))}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </>)}
    </div>
  )
}
