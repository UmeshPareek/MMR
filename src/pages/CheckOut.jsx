import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate } from '@/utils/helpers'
import { Modal, Spinner, EmptyState, ConfirmDialog } from '@/components/ui'
import { LogOut, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import jsPDF from 'jspdf'

function getFloor(doorNumber) {
  if (!doorNumber) return 'Ground / Other'
  const num = doorNumber.toString().replace(/[^0-9]/g, '')
  if (!num) return doorNumber.toString().charAt(0).toUpperCase() + ' Block'
  const floorNum = Math.floor(parseInt(num) / 100)
  if (floorNum === 0) return 'Ground Floor'
  return 'Floor ' + floorNum
}

export default function CheckOut() {
  const { profile } = useAuth()
  const channelRef = useRef(null)
  const [tenants, setTenants] = useState([])
  const [recentExits, setRecentExits] = useState([])
  const [tab, setTab] = useState('active')
  const [loading, setLoading] = useState(true)
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0,7))
  const [stats, setStats] = useState({ totalExits:0, normalExits:0, runaways:0, depositHeld:0, deductions:0, refunds:0 })
  const [modal, setModal] = useState(false)
  const [selected, setSelected] = useState(null)
  const [coType, setCoType] = useState('good')
  const [form, setForm] = useState({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })
  const [saving, setSaving] = useState(false)
  const [outstandingRent, setOutstandingRent] = useState(0)
  const [loadingOutstanding, setLoadingOutstanding] = useState(false)
  const [filterBuilding, setFilterBuilding] = useState('')
  const [buildings, setBuildings] = useState([])
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [orgContact, setOrgContact] = useState({ phone: '—', email: '—', website: '—' })

  useEffect(() => {
    supabase.from('master_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['org_phone', 'org_email', 'org_website'])
      .then(({ data }) => {
        if (data?.length) {
          const m = {}
          data.forEach(r => { m[r.setting_key] = r.setting_value })
          setOrgContact({ phone: m.org_phone || '—', email: m.org_email || '—', website: m.org_website || '—' })
        }
      })
  }, [])

  useEffect(() => {
    loadAll()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('checkout-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flats' }, () => loadAll())
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [filterMonth])

  async function loadAll() {
    setLoading(true)
    try {
      // Use same pattern as working Tenants page — select * then join manually
      const [{ data: b }, { data: t }, { data: ex }, { data: allFlats }, { data: allBuildings }] = await Promise.all([
        supabase.from('buildings').select('id,name').eq('is_active', true).order('name'),
        supabase.from('tenants').select('*').eq('status','active').order('building_id').order('full_name'),
        supabase.from('tenants').select('*').eq('status','vacated').order('move_out_date', { ascending: false }).limit(50),
        supabase.from('flats').select('id,door_number'),
        supabase.from('buildings').select('id,name'),
      ])

      const flatMap = {}
      ;(allFlats||[]).forEach(f => { flatMap[f.id] = f })
      const buildingMap = {}
      ;(allBuildings||[]).forEach(b => { buildingMap[b.id] = b })

      const enrich = arr => (arr||[]).map(t => ({
        ...t,
        flat: flatMap[t.flat_id] || null,
        building: buildingMap[t.building_id] || null,
      }))

      setBuildings(b || [])
      setTenants(enrich(t))
      const enrichedExits = enrich(ex)
      setRecentExits(enrichedExits)

      // Compute monthly stats from exits
      const monthExits = enrichedExits.filter(t => t.move_out_date?.slice(0,7) === filterMonth)
      const runaways = monthExits.filter(t => t.notes?.includes('RUNAWAY'))
      const depositTotal = monthExits.reduce((s,t) => s + (parseFloat(t.security_deposit_paid)||0), 0)
      setStats({
        totalExits: monthExits.length,
        normalExits: monthExits.length - runaways.length,
        runaways: runaways.length,
        depositHeld: depositTotal,
      })
    } catch(e) {
      console.error('CheckOut loadAll error:', e)
      toast.error('Failed to load tenants')
    }
    setLoading(false)
  }

  function deleteExit(t) {
    setConfirmDialog({
      title: 'Undo Exit?',
      message: `Restore ${t.full_name} as active tenant? Their flat will be marked occupied again.`,
      danger: false,
      onConfirm: async () => {
        const { error } = await supabase.from('tenants').update({ status:'active', move_out_date: null, notes: null }).eq('id', t.id)
        if (error) { toast.error(error.message); return }
        if (t.flat_id) {
          const { data: currentFlat } = await supabase.from('flats').select('current_tenant_id, status').eq('id', t.flat_id).single()
          if (currentFlat && (currentFlat.status === 'vacant' || currentFlat.current_tenant_id === null)) {
            await supabase.from('flats').update({ status:'occupied', current_tenant_id: t.id }).eq('id', t.flat_id)
          } else {
            toast.error('Flat has already been re-assigned — please update manually')
          }
        }
        toast.success('Exit reversed — tenant restored as active ✓')
        setConfirmDialog(null)
        loadAll()
      }
    })
  }

  function deleteCheckin(t) {
    setConfirmDialog({
      title: 'Delete Record?',
      message: `Permanently delete ${t.full_name}'s record? Their flat will be restored to vacant. This cannot be undone.`,
      danger: true,
      onConfirm: async () => {
        const { error } = await supabase.from('tenants').delete().eq('id', t.id)
        if (error) { toast.error(error.message); return }
        if (t.flat_id) await supabase.from('flats').update({ status:'vacant', current_tenant_id: null }).eq('id', t.flat_id)
        toast.success('Tenant record deleted ✓')
        setConfirmDialog(null)
        loadAll()
      }
    })
  }

  async function fetchOutstandingRent(tenantId) {
    setLoadingOutstanding(true)
    const currentMonth = new Date().toISOString().slice(0,7)
    const prevMonth = new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,7)
    // Check if rent collected for current and previous month
    const { data: paid } = await supabase.from('rent_collections')
      .select('amount, for_month')
      .eq('tenant_id', tenantId)
      .in('for_month', [currentMonth, prevMonth])
    const { data: tenant } = await supabase.from('tenants').select('monthly_rent').eq('id', tenantId).single()
    const monthlyRent = parseFloat(tenant?.monthly_rent || 0)
    // Calculate unpaid months
    const paidMonths = new Set((paid||[]).map(p => p.for_month))
    let unpaid = 0
    if (!paidMonths.has(currentMonth)) unpaid += monthlyRent
    if (!paidMonths.has(prevMonth)) unpaid += monthlyRent
    setOutstandingRent(unpaid)
    setLoadingOutstanding(false)
    return unpaid
  }

  function openCheckout(t) {
    setSelected(t)
    setCoType('good')
    setOutstandingRent(0)
    setModal(true)
    // Async fetch outstanding rent and auto-fill
    fetchOutstandingRent(t.id).then(unpaid => {
      setForm(p => ({ ...p, outstanding_rent: String(unpaid) }))
    })
    setForm({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })
  }

  async function saveCheckout() {
    if (!selected) return
    setSaving(true)
    const deductions = ['cleaning','painting','repair','other','outstanding_rent'].reduce((s,k)=>s+(parseFloat(form[k])||0),0)
    const deposit = parseFloat(selected.security_deposit_paid)||0
    const netRefund = deposit - deductions
    const exitNotes = `TYPE:${coType==='bad'?'RUNAWAY':'Normal'}|Date:${form.exit_date}|Deposit:${deposit}|Deductions:${deductions}|Net:${netRefund}|Collected:${form.collected_at_exit}|${form.notes}`
    
    const { error } = await supabase.from('tenants').update({ status:'vacated', move_out_date: form.exit_date, notes: exitNotes }).eq('id', selected.id)
    if (error) { setSaving(false); return toast.error(error.message) }

    // Free the flat
    await supabase.from('flats').update({ status:'vacant', current_tenant_id: null }).eq('id', selected.flat_id)

    // Insert a refund/settlement record in security_deposits page
    await supabase.from('security_deposits').insert({
      tenant_id: selected.id,
      flat_id: selected.flat_id || null,
      building_id: selected.building_id,
      amount: Math.abs(netRefund),
      payment_mode: 'adjustment',
      deposit_date: form.exit_date,
      deposit_type: 'refund',
      notes: `EXIT SETTLEMENT | Deposit held: ₹${(selected.security_deposit_paid||0).toLocaleString('en-IN')} | Deductions: ₹${deductions.toLocaleString('en-IN')} | Net: ${netRefund >= 0 ? 'Refund' : 'Loss'} ₹${Math.abs(netRefund).toLocaleString('en-IN')} | ${form.notes || ''}`.trim(),
      collected_by: null,
    })

    setSaving(false)
    const msg = netRefund >= 0
      ? `Checkout done ✓ — Refund ₹${netRefund.toLocaleString('en-IN')} to tenant`
      : `Checkout done ✓ — Net loss ₹${Math.abs(netRefund).toLocaleString('en-IN')} (deposit forfeited)`
    toast.success(msg)
    if (coType === 'bad') generateLegalNotice(selected, deductions, netRefund)
    setModal(false); setSelected(null); loadAll()
  }

  function generateLegalNotice(t, totalDue, netRefund) {
    const doc = new jsPDF()
    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
    doc.setFillColor(13,148,136); doc.rect(0,0,210,18,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont('helvetica','bold')
    doc.text('LEGAL NOTICE', 105, 12, { align:'center' })
    doc.setTextColor(0,0,0); doc.setFontSize(10); doc.setFont('helvetica','normal')
    doc.text(`Date: ${today}`, 14, 30)
    doc.text(`To,\n${t.full_name}\nFlat ${t.flat?.door_number||'—'}, ${t.building?.name||'—'}\nPhone: ${t.phone}`, 14, 40)
    const body = `Subject: Legal Notice — Outstanding Dues & Unauthorized Vacation

This legal notice is issued on behalf of CashMyRent Property Management.

You have vacated the premises at Flat ${t.flat?.door_number}, ${t.building?.name} WITHOUT clearing your dues.

FINANCIAL STATEMENT:
Security Deposit Held : ₹${(t.security_deposit_paid||0).toLocaleString('en-IN')}
Total Dues Pending    : ₹${totalDue.toLocaleString('en-IN')}
Net Amount Payable    : ₹${Math.abs(netRefund).toLocaleString('en-IN')}

NOTICE:
You are hereby directed to pay ₹${Math.abs(netRefund).toLocaleString('en-IN')} within FIFTEEN (15) DAYS of receiving this notice.

FAILURE TO COMPLY WILL RESULT IN:
1. Filing of an FIR/police complaint for cheating, fraud and breach of contract
2. Civil suit for recovery of dues with interest and legal costs
3. Reporting to credit bureaus and rental property networks
4. Further legal action as deemed appropriate under Indian law

This notice is issued without prejudice to all legal rights and remedies available.

CashMyRent Property Management
Phone: ${orgContact.phone} | Email: ${orgContact.email} | ${orgContact.website}`
    doc.text(doc.splitTextToSize(body, 182), 14, 70)
    doc.save(`LegalNotice_${t.full_name.replace(/ /g,'_')}.pdf`)
    toast.success('Legal notice PDF downloaded')
  }

  const totalDed = ['cleaning','painting','repair','other','outstanding_rent'].reduce((s,k)=>s+(parseFloat(form[k])||0),0)
  const netRefund = selected ? ((parseFloat(selected.security_deposit_paid)||0) - totalDed) : 0
  const filtered = filterBuilding ? tenants.filter(t=>t.building_id===filterBuilding) : tenants

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Check Out</h2>
          <p className="text-surface-500 text-sm mt-1">{tenants.length} active tenants · {recentExits.length} past exits</p>
        </div>
        <select className="select py-1.5 text-sm w-48" value={filterBuilding} onChange={e=>setFilterBuilding(e.target.value)}>
          <option value="">All Buildings</option>
          {buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="flex border-b border-surface-200">
        {[['active',`Active (${tenants.length})`],['exits',`Exits (${recentExits.length})`]].map(([k,l])=>(
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'active' && (() => {
        // Group by building
        const byBuilding = {}
        filtered.forEach(t => {
          const bName = t.building?.name || 'Unknown'
          if (!byBuilding[bName]) byBuilding[bName] = []
          byBuilding[bName].push(t)
        })
        return (
          <div className="space-y-4">
            {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
            : filtered.length === 0 ? <div className="card py-12 text-center text-surface-400">No active tenants</div>
            : Object.entries(byBuilding).map(([bName, bTenants]) => {
              // Group by floor within each building
              const byFloor = {}
              bTenants.forEach(t => {
                const floor = getFloor(t.flat?.door_number)
                if (!byFloor[floor]) byFloor[floor] = []
                byFloor[floor].push(t)
              })
              // Sort floors
              const sortedFloors = Object.keys(byFloor).sort((a,b) => {
                const na = parseInt(a.replace(/\D/g,'')) || 0
                const nb = parseInt(b.replace(/\D/g,'')) || 0
                return na - nb
              })

              return (
                <div key={bName} className="card overflow-hidden border border-brand-100">
                  {/* Building header */}
                  <div className="px-5 py-3 bg-brand-600 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-white opacity-70"></div>
                      <h3 className="font-bold text-white">{bName}</h3>
                      <span className="text-xs text-brand-100 bg-brand-500 px-2 py-0.5 rounded-full">{bTenants.length} tenants</span>
                    </div>
                    <span className="text-xs text-brand-100 font-mono">
                      Total Deposit: {formatCurrency(bTenants.reduce((s,t)=>s+(parseFloat(t.security_deposit_paid)||0),0))}
                    </span>
                  </div>

                  {/* Floor-wise sections */}
                  {sortedFloors.map(floor => (
                    <div key={floor}>
                      {/* Floor sub-header */}
                      <div className="px-5 py-2 bg-surface-50 border-y border-surface-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">{floor}</span>
                          <span className="text-xs text-surface-400">— {byFloor[floor].length} unit{byFloor[floor].length > 1 ? 's' : ''}</span>
                        </div>
                        <span className="text-xs font-mono text-surface-400">
                          {formatCurrency(byFloor[floor].reduce((s,t)=>s+(parseFloat(t.monthly_rent)||0),0))}/mo
                        </span>
                      </div>
                      <table className="data-table">
                        <tbody>
                          {byFloor[floor].map(t => (
                            <tr key={t.id}>
                              <td style={{width:32}} className="pl-4 pr-0">
                                <div className="w-7 h-7 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 text-xs flex-shrink-0">{t.full_name.charAt(0)}</div>
                              </td>
                              <td>
                                <p className="font-medium text-surface-800 text-sm">{t.full_name}</p>
                                <p className="text-xs text-surface-400">{t.phone}</p>
                              </td>
                              <td className="font-mono font-bold text-surface-700">{t.flat?.door_number||'—'}</td>
                              <td className="text-xs text-surface-500">{fmtDate(t.move_in_date)}</td>
                              <td className="font-mono text-sm">{formatCurrency(t.monthly_rent)}</td>
                              <td className="font-mono text-sm text-emerald-700">{formatCurrency(t.security_deposit_paid||0)}</td>
                              <td>
                                <div className="flex items-center gap-2">
                                  <button onClick={()=>openCheckout(t)} className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 flex items-center gap-1">
                                    <LogOut className="w-3.5 h-3.5"/> Check Out
                                  </button>
                                  <button onClick={() => deleteCheckin(t)} title="Delete wrong entry"
                                    className="p-1.5 text-surface-300 hover:text-red-500 transition-colors rounded">
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )
      })()}

      {tab === 'exits' && (
        <div className="space-y-4">
          {/* Month filter + stats */}
          <div className="flex items-center gap-3 flex-wrap">
            <input type="month" className="input py-1.5 text-sm w-40"
              value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
            <div className="flex gap-3 flex-wrap">
              {[
                { label:'Total Exits', value: stats.totalExits, color:'text-surface-800' },
                { label:'Normal', value: stats.normalExits, color:'text-emerald-700' },
                { label:'Runaway', value: stats.runaways, color:'text-red-600' },
              ].map(({label,value,color}) => (
                <div key={label} className="card px-4 py-2 flex items-center gap-3">
                  <span className="text-xs text-surface-400">{label}</span>
                  <span className={`font-bold text-lg font-mono ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden">
          {recentExits.filter(t => t.move_out_date?.slice(0,7) === filterMonth).length === 0
            ? <EmptyState icon={LogOut} title="No exits this month" description="Change the month filter to see past exits" />
          : (
            <table className="data-table">
              <thead><tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Exit Date</th><th>Exit Type</th></tr></thead>
              <tbody>
                {recentExits.filter(t => t.move_out_date?.slice(0,7) === filterMonth).map(t=>(
                  <tr key={t.id}>
                    <td><p className="font-medium">{t.full_name}</p><p className="text-xs text-surface-400">{t.phone}</p></td>
                    <td className="text-sm text-surface-500">{t.building?.name||'—'}</td>
                    <td className="font-mono">{t.flat?.door_number||'—'}</td>
                    <td className="text-xs text-surface-500">{fmtDate(t.move_out_date)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={`badge border text-xs ${t.notes?.includes('RUNAWAY')?'bg-red-50 text-red-700 border-red-200':'bg-surface-100 text-surface-600 border-surface-200'}`}>{t.notes?.includes('RUNAWAY')?'Runaway':'Normal'}</span>
                        <button onClick={() => deleteExit(t)} title="Undo exit / delete record"
                          className="btn-ghost p-1 text-red-400 hover:text-red-600">
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

      <ConfirmDialog
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        onConfirm={confirmDialog?.onConfirm}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        danger={confirmDialog?.danger}
      />

      {/* CHECKOUT MODAL */}
      <Modal open={modal} onClose={()=>setModal(false)} title={`Check Out — ${selected?.full_name}`} size="lg">
        {selected && (
          <>
            <div className="px-6 pt-5 space-y-4">
              <div className="p-3 bg-surface-50 border border-surface-200 rounded-xl flex items-center gap-4">
                <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 flex-shrink-0">{selected.full_name.charAt(0)}</div>
                <div className="flex-1">
                  <p className="font-semibold">{selected.full_name}</p>
                  <p className="text-xs text-surface-400">{selected.flat?.door_number} · {selected.building?.name} · {selected.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-surface-400">Deposit Held</p>
                  <p className="font-mono font-bold text-emerald-700">{formatCurrency(selected.security_deposit_paid||0)}</p>
                </div>
              </div>
              <div className="flex gap-3">
                {[['good',<><CheckCircle2 className="w-4 h-4"/> Normal Exit</>,'emerald'],['bad',<><AlertTriangle className="w-4 h-4"/> Runaway / Bad</>,'red']].map(([v,l,col])=>(
                  <button key={v} onClick={()=>setCoType(v)} className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium flex items-center justify-center gap-2 transition-all ${coType===v?`border-${col}-400 bg-${col}-50 text-${col}-700`:'border-surface-200 text-surface-500'}`}>{l}</button>
                ))}
              </div>
              {coType==='bad'&&<div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">⚠️ Legal notice PDF auto-generated with 15-day deadline + police complaint warning.</div>}
              {/* Outstanding rent auto-detected banner */}
              {loadingOutstanding && <div className="p-3 bg-surface-50 rounded-lg text-xs text-surface-500 animate-pulse">Checking outstanding rent...</div>}
              {!loadingOutstanding && outstandingRent > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Auto-detected <strong>{formatCurrency(outstandingRent)}</strong> outstanding rent (last 2 months) — pre-filled below</span>
                </div>
              )}
              {!loadingOutstanding && outstandingRent === 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">✓ No outstanding rent detected</div>
              )}
            </div>
            <div className="px-6 pt-4 grid sm:grid-cols-2 gap-4">
              {[['exit_date','Exit Date','date'],['outstanding_rent','Outstanding Rent (₹)','number'],['cleaning','Cleaning Charges (₹)','number'],['painting','Painting Charges (₹)','number'],['repair','Repair Charges (₹)','number'],['other','Other Deductions (₹)','number'],['collected_at_exit','Collected at Exit (₹)','number']].map(([k,l,type])=>(
                <div key={k} className="form-group">
                  <label className="label">{l}</label>
                  <input type={type} className="input" value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={type==='number'?'0':''} />
                </div>
              ))}
              <div className="form-group"><label className="label">Notes</label><input className="input" value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} /></div>
              <div className="col-span-2 p-4 rounded-xl bg-surface-50 border-2 border-surface-200">
                <p className="text-sm font-semibold text-surface-700 mb-3">Settlement Summary</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-surface-500">Deposit Held</span><span className="font-mono text-emerald-700">{formatCurrency(selected.security_deposit_paid||0)}</span></div>
                  <div className="flex justify-between"><span className="text-surface-500">Total Deductions</span><span className="font-mono text-red-600">−{formatCurrency(totalDed)}</span></div>
                  <div className="border-t border-surface-200 pt-2 flex justify-between">
                    <span className="font-bold">{netRefund>=0?'Refund to Tenant':'Amount to Collect'}</span>
                    <span className={`font-mono font-bold text-lg ${netRefund>=0?'text-emerald-700':'text-red-600'}`}>{formatCurrency(Math.abs(netRefund))}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3 justify-end mt-2">
              <button className="btn-secondary" onClick={()=>setModal(false)}>Cancel</button>
              <button onClick={saveCheckout} disabled={saving}
                className={`px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 text-white ${coType==='bad'?'bg-red-600 hover:bg-red-700':'bg-brand-600 hover:bg-brand-700'}`}>
                {saving?<Spinner size={16}/>:<><LogOut className="w-4 h-4"/>{coType==='bad'?'Checkout + Legal Notice':'Confirm Checkout'}</>}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
