import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, lastNMonths, currentMonth } from '@/utils/helpers'
import { Spinner } from '@/components/ui'
import { TrendingUp, TrendingDown, Download, RefreshCw, Building2, AlertTriangle, CheckCircle2, Clock, LogIn, LogOut } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, Legend } from 'recharts'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth())
  const [pnl, setPnl] = useState(null)
  const [buildingPnl, setBuildingPnl] = useState([])
  const [trend, setTrend] = useState([])
  const [outstanding, setOutstanding] = useState({ count: 0, amount: 0, tenants: [] })
  const [rentExpected, setRentExpected] = useState({ expected: 0, collected: 0, prepaid: 0, postpaid: 0 })
  const [loading, setLoading] = useState(true)
  const [movement, setMovement] = useState({ checkIns: 0, checkOuts: 0, depositIn: 0, runaways: 0 })
  const [activeTenantCount, setActiveTenantCount] = useState(0)
  const [viewMode, setViewMode] = useState('consolidated') // 'consolidated' | 'building'
  const channelRef = useRef(null)

  useEffect(() => {
    load()
    // Realtime subscription
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rent_collections' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_salaries' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'utility_bills' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'owner_payments' }, () => load())
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [month])

  async function load() {
    setLoading(true)
    const months = lastNMonths(6)
    const prevMonth = months[1] || month

    try {
      const [
        { data: collections },
        { data: expenses },
        { data: salaries },
        { data: ownerRents },
        { data: utilityBills },
        { data: meterReadings },
        { data: buildings },
        { data: allTenants },
        { data: prevCollections },
        // Staff salary is postpaid — April salary shows in May P&L
        { data: prevSalaries },
      ] = await Promise.all([
        supabase.from('rent_collections').select('amount, building_id, tenant_id, for_month, payment_mode').eq('for_month', month),
        supabase.from('expenses').select('amount, category, building_id').eq('expense_date', month).gte('expense_date', `${month}-01`).lte('expense_date', `${month}-31`),
        // Postpaid: April salary paid in May — so for month M, show salary from M-1
        supabase.from('staff_salaries').select('net_amount, for_month').eq('for_month', prevMonth),
        supabase.from('owner_payments').select('amount, building_id').eq('for_month', month),
        supabase.from('utility_bills').select('amount, building_id, utility_type').eq('for_month', month),
        supabase.from('meter_readings').select('amount_charged, building_id').eq('for_month', month),
        supabase.from('buildings').select('id, name').eq('is_active', true),
        supabase.from('tenants').select('id, monthly_rent, rent_type, building_id').eq('status', 'active'),
        // Outstanding: unpaid from previous month
        supabase.from('rent_collections').select('tenant_id, amount').eq('for_month', prevMonth),
        supabase.from('staff_salaries').select('net_amount').eq('for_month', month), // current month salaries if any
      ])

      const income = (collections || []).reduce((s, r) => s + Number(r.amount), 0)
      const expTotal = (expenses || []).reduce((s, r) => s + Number(r.amount), 0)
      // Staff salary is postpaid — using previous month's salaries as this month's expense
      const salaryTotal = (prevSalaries || []).reduce((s, r) => s + Number(r.net_amount), 0)
      const ownerRentTotal = (ownerRents || []).reduce((s, r) => s + Number(r.amount), 0)
      const utilPaid = (utilityBills || []).reduce((s, r) => s + Number(r.amount), 0)
      const utilCharged = (meterReadings || []).reduce((s, r) => s + Number(r.amount_charged || 0), 0)
      const totalExpenses = expTotal + salaryTotal + ownerRentTotal + utilPaid
      const grossProfit = income + utilCharged - totalExpenses
      const margin = income > 0 ? Math.round(grossProfit / income * 100) : 0

      // Rent expected vs collected
      const prepaidTenants = (allTenants || []).filter(t => t.rent_type !== 'postpaid')
      const postpaidTenants = (allTenants || []).filter(t => t.rent_type === 'postpaid')
      // Check-ins / check-outs this month
      const [{ data: checkIns }, { data: checkOuts }] = await Promise.all([
        supabase.from('tenants').select('security_deposit_paid').gte('move_in_date', `${month}-01`).lte('move_in_date', `${month}-31`),
        supabase.from('tenants').select('notes').eq('status','inactive').gte('move_out_date', `${month}-01`).lte('move_out_date', `${month}-31`),
      ])
      setActiveTenantCount((allTenants||[]).length)
      setMovement({
        checkIns: (checkIns||[]).length,
        checkOuts: (checkOuts||[]).length,
        depositIn: (checkIns||[]).reduce((s,t)=>s+(parseFloat(t.security_deposit_paid)||0),0),
        runaways: (checkOuts||[]).filter(t=>t.notes?.includes('RUNAWAY')).length,
      })

      const totalExpected = (allTenants || []).reduce((s, t) => s + Number(t.monthly_rent), 0)
      setRentExpected({ expected: totalExpected, collected: income, prepaid: prepaidTenants.reduce((s,t)=>s+Number(t.monthly_rent),0), postpaid: postpaidTenants.reduce((s,t)=>s+Number(t.monthly_rent),0) })

      // Outstanding from previous month
      const prevPaidTenantIds = new Set((prevCollections || []).map(c => c.tenant_id))
      const unpaidPrev = (allTenants || []).filter(t => !prevPaidTenantIds.has(t.id))
      const outstandingAmt = unpaidPrev.reduce((s, t) => s + Number(t.monthly_rent), 0)
      setOutstanding({ count: unpaidPrev.length, amount: outstandingAmt, tenants: unpaidPrev.slice(0, 5) })

      // Building-wise P&L
      const bMap = {}
      ;(buildings || []).forEach(b => { bMap[b.id] = { name: b.name, income: 0, expenses: 0, ownerRent: 0, util: 0 } })
      ;(collections || []).forEach(c => { if (bMap[c.building_id]) bMap[c.building_id].income += Number(c.amount) })
      ;(expenses || []).forEach(e => { if (bMap[e.building_id]) bMap[e.building_id].expenses += Number(e.amount) })
      ;(ownerRents || []).forEach(o => { if (bMap[o.building_id]) bMap[o.building_id].ownerRent += Number(o.amount) })
      ;(utilityBills || []).forEach(u => { if (bMap[u.building_id]) bMap[u.building_id].util += Number(u.amount) })
      setBuildingPnl(Object.values(bMap).map(b => ({ ...b, net: b.income - b.expenses - b.ownerRent - b.util })))

      setPnl({ income, expTotal, salaryTotal, ownerRentTotal, utilPaid, utilCharged, totalExpenses, grossProfit, margin })

      // 6-month trend
      const trendData = await Promise.all(months.map(async m => {
        const [{ data: mc }, { data: me }] = await Promise.all([
          supabase.from('rent_collections').select('amount').eq('for_month', m),
          supabase.from('expenses').select('amount').gte('expense_date', `${m}-01`).lte('expense_date', `${m}-31`),
        ])
        return {
          month: m.slice(5), // 'MM'
          revenue: (mc || []).reduce((s, r) => s + Number(r.amount), 0),
          expenses: (me || []).reduce((s, r) => s + Number(r.amount), 0),
        }
      }))
      setTrend(trendData.reverse())
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  async function downloadMasterExcel() {
    toast.loading('Preparing master report...')
    const months = lastNMonths(3)
    try {
      const wb = XLSX.utils.book_new()
      const [{ data: collections }, { data: expenses }, { data: salaries }, { data: ownerRents }, { data: utilityBills }, { data: buildings }, { data: tenants }] = await Promise.all([
        supabase.from('rent_collections').select('*, tenant:tenants(full_name, phone), building:buildings(name)').eq('for_month', month),
        supabase.from('expenses').select('*, building:buildings(name)').gte('expense_date', `${month}-01`).lte('expense_date', `${month}-31`),
        supabase.from('staff_salaries').select('*, staff:staff(full_name)').eq('for_month', month),
        supabase.from('owner_payments').select('*, building:buildings(name)').eq('for_month', month),
        supabase.from('utility_bills').select('*, building:buildings(name)').eq('for_month', month),
        supabase.from('buildings').select('id, name').eq('is_active', true),
        supabase.from('tenants').select('full_name, phone, monthly_rent, rent_type, building:buildings(name), flat:flats(door_number)').eq('status', 'active'),
      ])

      // Sheet 1: Rent Collections
      const rentRows = (collections || []).map(c => ({
        Building: c.building?.name, Tenant: c.tenant?.full_name, Phone: c.tenant?.phone,
        Amount: c.amount, Mode: c.payment_mode, Month: c.for_month, Date: c.created_at?.slice(0,10)
      }))
      const rentWs = XLSX.utils.json_to_sheet(rentRows)
      rentWs['!cols'] = [{ wch: 25 }, { wch: 22 }, { wch: 13 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }]
      XLSX.utils.book_append_sheet(wb, rentWs, 'Rent Collections')

      // Sheet 2: Expenses
      const expRows = (expenses || []).map(e => ({
        Date: e.expense_date, Category: e.category, Description: e.description,
        Building: e.building?.name || 'General', Mode: e.payment_mode, Amount: e.amount
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows), 'Expenses')

      // Sheet 3: Staff Salary
      const salRows = (salaries || []).map(s => ({
        Staff: s.staff?.full_name, Month: s.for_month, Gross: s.gross_amount,
        'Advance Deduction': s.advance_deduction, 'Net Paid': s.net_amount, 'Paid Date': s.paid_date
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salRows), 'Staff Salary')

      // Sheet 4: Utility Bills
      const utilRows = (utilityBills || []).map(u => ({
        Building: u.building?.name, Type: u.utility_type, Vendor: u.vendor, Amount: u.amount,
        Mode: u.payment_mode, Month: u.for_month, 'Bill No': u.bill_number
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(utilRows), 'Utility Bills')

      // Sheet 5: Building P&L Summary
      const bSummaryRows = buildingPnl.map(b => ({
        Building: b.name, 'Rent Income': b.income, 'Owner Rent': b.ownerRent,
        Expenses: b.expenses, 'Utility Paid': b.util, 'Net Profit': b.net
      }))
      const totalRow = { Building: 'TOTAL', 'Rent Income': buildingPnl.reduce((s,b)=>s+b.income,0), 'Owner Rent': buildingPnl.reduce((s,b)=>s+b.ownerRent,0), Expenses: buildingPnl.reduce((s,b)=>s+b.expenses,0), 'Utility Paid': buildingPnl.reduce((s,b)=>s+b.util,0), 'Net Profit': buildingPnl.reduce((s,b)=>s+b.net,0) }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...bSummaryRows, totalRow]), 'Building P&L')

      // Sheet 6: Consolidated P&L
      if (pnl) {
        const plRows = [
          ['CASHMYRENT — P&L REPORT', month],
          [''],
          ['INCOME', ''],
          ['Rent Collected', pnl.income],
          ['Utility Charges Billed', pnl.utilCharged],
          ['TOTAL INCOME', pnl.income + pnl.utilCharged],
          [''],
          ['EXPENSES', ''],
          ['Owner Rent', pnl.ownerRentTotal],
          ['General Expenses', pnl.expTotal],
          ['Utility Bills Paid', pnl.utilPaid],
          ['Staff Salaries (postpaid)', pnl.salaryTotal],
          ['TOTAL EXPENSES', pnl.totalExpenses],
          [''],
          ['NET PROFIT', pnl.grossProfit],
          ['MARGIN %', `${pnl.margin}%`],
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plRows), 'P&L Summary')
      }

      // Sheet 7: Check-Ins this month
      const { data: ciData } = await supabase.from('tenants').select('full_name, phone, monthly_rent, security_deposit_paid, move_in_date, building_id').gte('move_in_date', `${month}-01`).lte('move_in_date', `${month}-31`)
      const { data: coData } = await supabase.from('tenants').select('full_name, phone, move_out_date, notes, building_id').eq('status','inactive').gte('move_out_date', `${month}-01`).lte('move_out_date', `${month}-31`)
      const bNameMap = {}; (buildings||[]).forEach(b => { bNameMap[b.id] = b.name })
      if (ciData?.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ciData.map(t=>({ Building: bNameMap[t.building_id]||'—', Tenant: t.full_name, Phone: t.phone, 'Move In': t.move_in_date, Rent: t.monthly_rent, Deposit: t.security_deposit_paid||0 }))), 'Check-Ins')
      }
      if (coData?.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coData.map(t=>({ Building: bNameMap[t.building_id]||'—', Tenant: t.full_name, Phone: t.phone, 'Exit Date': t.move_out_date, Type: t.notes?.includes('RUNAWAY')?'Runaway':'Normal' }))), 'Check-Outs')
      }

      XLSX.writeFile(wb, `CashMyRent_Master_${month}.xlsx`)
      toast.dismiss(); toast.success('Master Excel downloaded ✓')
    } catch(e) { toast.dismiss(); toast.error('Download failed') }
  }

  const PnLRow = ({ label, value, indent = 0, accent, bold }) => (
    <div className={`flex justify-between items-center py-2 ${indent ? 'pl-6 border-t border-surface-100' : 'border-t border-surface-100'}`}>
      <span className={`text-sm ${bold ? 'font-bold text-surface-900' : 'text-surface-600'} ${indent ? 'text-xs' : ''}`}>{label}</span>
      <span className={`font-mono text-sm ${bold ? 'font-bold text-base' : 'font-medium'} ${accent === 'red' ? 'text-red-600' : accent === 'green' ? 'text-emerald-700' : 'text-surface-800'}`}>{value}</span>
    </div>
  )

  const collRate = rentExpected.expected > 0 ? Math.round(rentExpected.collected / rentExpected.expected * 100) : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Dashboard</h2>
          <p className="text-sm text-surface-500 mt-0.5">P&L snapshot · {month}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="month" className="input py-1.5 text-sm" value={month} onChange={e => setMonth(e.target.value)} />
          <div className="flex rounded-lg border border-surface-200 overflow-hidden">
            <button onClick={() => setViewMode('consolidated')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode==='consolidated'?'bg-brand-600 text-white':'bg-white text-surface-600'}`}>Consolidated</button>
            <button onClick={() => setViewMode('building')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode==='building'?'bg-brand-600 text-white':'bg-white text-surface-600'}`}>Building-wise</button>
          </div>
          <button onClick={downloadMasterExcel} className="btn-primary flex items-center gap-2"><Download className="w-4 h-4"/> Master Excel</button>
          <button onClick={load} className="btn-ghost p-2"><RefreshCw className="w-4 h-4"/></button>
        </div>
      </div>

      {loading && <div className="py-16 flex justify-center"><Spinner /></div>}

      {!loading && pnl && (
        <>
          {/* Outstanding dues alert */}
          {outstanding.amount > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">{outstanding.count} tenants have outstanding dues from previous month — {formatCurrency(outstanding.amount)}</p>
                <p className="text-xs text-amber-600 mt-1">These are in addition to current month dues. Ensure collection team is aware.</p>
              </div>
            </div>
          )}

          {/* Rent expected vs collected */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-surface-800">Rent Collection — {month}</h3>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${collRate >= 90 ? 'text-emerald-700' : collRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{collRate}% collected</span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="text-center">
                <p className="text-xs text-surface-400 mb-1">Expected</p>
                <p className="font-mono font-bold text-surface-900">{formatCurrency(rentExpected.expected)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-surface-400 mb-1">Collected</p>
                <p className="font-mono font-bold text-emerald-700">{formatCurrency(rentExpected.collected)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-surface-400 mb-1">Pending</p>
                <p className="font-mono font-bold text-red-600">{formatCurrency(Math.max(0, rentExpected.expected - rentExpected.collected))}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-surface-400 mb-1">Prev. Outstanding</p>
                <p className="font-mono font-bold text-amber-600">{formatCurrency(outstanding.amount)}</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 bg-surface-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(collRate, 100)}%`, background: collRate >= 90 ? '#0D9488' : collRate >= 70 ? '#f59e0b' : '#dc2626' }} />
            </div>
            {/* Prepaid vs postpaid note */}
            <div className="flex gap-4 mt-3 text-xs text-surface-400">
              <span>Prepaid: {formatCurrency(rentExpected.prepaid)}</span>
              <span>Postpaid: {formatCurrency(rentExpected.postpaid)}</span>
              <span className="ml-auto text-surface-300">*Staff salary shown in next month's P&L (postpaid)</span>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Rent Collected', value: formatCurrency(pnl.income), color: 'border-emerald-400', vcolor: 'text-emerald-700' },
              { label: 'Total Expenses', value: formatCurrency(pnl.totalExpenses), color: 'border-red-400', vcolor: 'text-red-600' },
              { label: 'Net Profit', value: formatCurrency(pnl.grossProfit), color: pnl.grossProfit >= 0 ? 'border-brand-500' : 'border-red-500', vcolor: pnl.grossProfit >= 0 ? 'text-brand-700' : 'text-red-600' },
              { label: 'Margin', value: `${pnl.margin}%`, color: 'border-surface-300', vcolor: 'text-surface-800' },
            ].map(({ label, value, color, vcolor }) => (
              <div key={label} className={`card p-4 border-l-4 ${color}`}>
                <p className="text-xs text-surface-500 mb-1">{label}</p>
                <p className={`text-xl font-bold font-mono ${vcolor}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Check In / Check Out this month */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card p-4 border-l-4 border-emerald-400 flex items-center gap-3">
              <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <LogIn className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-surface-400">Check-Ins</p>
                <p className="text-xl font-bold text-emerald-700">{movement.checkIns}</p>
                <p className="text-xs text-surface-400">{formatCurrency(movement.depositIn)} deposit</p>
              </div>
            </div>
            <div className="card p-4 border-l-4 border-red-400 flex items-center gap-3">
              <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <LogOut className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-surface-400">Check-Outs</p>
                <p className="text-xl font-bold text-red-600">{movement.checkOuts}</p>
                <p className="text-xs text-surface-400">{movement.runaways > 0 ? `${movement.runaways} runaway` : 'all normal'}</p>
              </div>
            </div>
            <div className="card p-4 border-l-4 border-surface-300 flex items-center gap-3">
              <div className="w-9 h-9 bg-surface-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Building2 className="w-4 h-4 text-surface-500" />
              </div>
              <div>
                <p className="text-xs text-surface-400">Net Movement</p>
                <p className={`text-xl font-bold ${movement.checkIns - movement.checkOuts >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {movement.checkIns - movement.checkOuts >= 0 ? '+' : ''}{movement.checkIns - movement.checkOuts}
                </p>
                <p className="text-xs text-surface-400">tenants this month</p>
              </div>
            </div>
            <div className="card p-4 border-l-4 border-brand-400 flex items-center gap-3">
              <div className="w-9 h-9 bg-brand-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 text-brand-600" />
              </div>
              <div>
                <p className="text-xs text-surface-400">Active Tenants</p>
                <p className="text-xl font-bold text-brand-700">{activeTenantCount}</p>
                <p className="text-xs text-surface-400">across all buildings</p>
              </div>
            </div>
          </div>

          {viewMode === 'consolidated' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* P&L breakdown */}
              <div className="card p-5">
                <h3 className="font-semibold text-surface-800 mb-3">Profit & Loss — {month}</h3>
                <div className="space-y-0">
                  <PnLRow label="INCOME" value="" bold />
                  <PnLRow label="Rent Collected" value={formatCurrency(pnl.income)} indent={1} accent="green" />
                  <PnLRow label="Utility Charges Billed" value={formatCurrency(pnl.utilCharged)} indent={1} accent="green" />
                  <div className="flex justify-between items-center py-2 border-t-2 border-surface-200 mt-1">
                    <span className="text-sm font-bold text-surface-800">Total Income</span>
                    <span className="font-mono font-bold text-emerald-700">{formatCurrency(pnl.income + pnl.utilCharged)}</span>
                  </div>
                  <PnLRow label="EXPENSES" value="" bold />
                  <PnLRow label="Owner Rent (postpaid)" value={formatCurrency(pnl.ownerRentTotal)} indent={1} accent="red" />
                  <PnLRow label="General Expenses" value={formatCurrency(pnl.expTotal)} indent={1} accent="red" />
                  <PnLRow label="Utility Bills Paid" value={formatCurrency(pnl.utilPaid)} indent={1} accent="red" />
                  <PnLRow label="Staff Salaries (prev month, postpaid)" value={formatCurrency(pnl.salaryTotal)} indent={1} accent="red" />
                  <div className="flex justify-between items-center py-2 border-t-2 border-surface-200 mt-1">
                    <span className="text-sm font-bold text-surface-800">Total Expenses</span>
                    <span className="font-mono font-bold text-red-600">{formatCurrency(pnl.totalExpenses)}</span>
                  </div>
                  <div className={`flex justify-between items-center py-3 px-3 rounded-xl mt-2 ${pnl.grossProfit >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                    <span className="font-bold text-surface-800">NET PROFIT</span>
                    <span className={`font-mono font-bold text-xl ${pnl.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(pnl.grossProfit)}</span>
                  </div>
                </div>
              </div>

              {/* 6-month trend */}
              <div className="card p-5">
                <h3 className="font-semibold text-surface-800 mb-4">6-Month Trend</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/100000).toFixed(0)}L`} />
                    <Tooltip formatter={v => formatCurrency(v)} />
                    <Legend />
                    <Bar dataKey="revenue" name="Revenue" fill="#0D9488" radius={[3,3,0,0]} />
                    <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            /* Building-wise P&L */
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
                <h3 className="font-semibold text-surface-700">Building-wise P&L — {month}</h3>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Building</th><th className="text-right">Rent</th><th className="text-right">Owner Rent</th><th className="text-right">Expenses</th><th className="text-right">Utility</th><th className="text-right">Net</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {buildingPnl.map(b => (
                    <tr key={b.name}>
                      <td className="font-medium text-surface-800">{b.name}</td>
                      <td className="text-right font-mono text-emerald-700">{formatCurrency(b.income)}</td>
                      <td className="text-right font-mono text-red-500">{b.ownerRent > 0 ? formatCurrency(b.ownerRent) : '—'}</td>
                      <td className="text-right font-mono text-red-500">{b.expenses > 0 ? formatCurrency(b.expenses) : '—'}</td>
                      <td className="text-right font-mono text-amber-600">{b.util > 0 ? formatCurrency(b.util) : '—'}</td>
                      <td className={`text-right font-mono font-bold ${b.net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(b.net)}</td>
                      <td><span className={`badge border text-xs ${b.net >= 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{b.net >= 0 ? 'Profitable' : 'Loss'}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-50 border-t-2 border-surface-200">
                    <td className="px-4 py-2.5 font-bold text-xs text-surface-600">TOTAL</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700">{formatCurrency(buildingPnl.reduce((s,b)=>s+b.income,0))}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-red-500">{formatCurrency(buildingPnl.reduce((s,b)=>s+b.ownerRent,0))}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-red-500">{formatCurrency(buildingPnl.reduce((s,b)=>s+b.expenses,0))}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-amber-600">{formatCurrency(buildingPnl.reduce((s,b)=>s+b.util,0))}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold text-lg ${buildingPnl.reduce((s,b)=>s+b.net,0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(buildingPnl.reduce((s,b)=>s+b.net,0))}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
