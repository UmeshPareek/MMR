import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate } from '@/utils/helpers'
import { Modal, Spinner, EmptyState } from '@/components/ui'
import { LogOut, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import jsPDF from 'jspdf'

export default function CheckOut() {
  const { profile } = useAuth()
  const [tenants, setTenants] = useState([])
  const [recentExits, setRecentExits] = useState([])
  const [tab, setTab] = useState('active')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [selected, setSelected] = useState(null)
  const [coType, setCoType] = useState('good')
  const [form, setForm] = useState({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })
  const [saving, setSaving] = useState(false)
  const [filterBuilding, setFilterBuilding] = useState('')
  const [buildings, setBuildings] = useState([])

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      // Use same pattern as working Tenants page — select * then join manually
      const [{ data: b }, { data: t }, { data: ex }, { data: allFlats }, { data: allBuildings }] = await Promise.all([
        supabase.from('buildings').select('id,name').eq('is_active', true).order('name'),
        supabase.from('tenants').select('*').eq('status','active').order('full_name'),
        supabase.from('tenants').select('*').eq('status','inactive').order('move_out_date', { ascending: false }).limit(50),
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
      setRecentExits(enrich(ex))
    } catch(e) {
      console.error('CheckOut loadAll error:', e)
      toast.error('Failed to load tenants')
    }
    setLoading(false)
  }

  function openCheckout(t) {
    setSelected(t)
    setCoType('good')
    setForm({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })
    setModal(true)
  }

  async function saveCheckout() {
    if (!selected) return
    setSaving(true)
    const deductions = ['cleaning','painting','repair','other','outstanding_rent'].reduce((s,k)=>s+(parseFloat(form[k])||0),0)
    const deposit = parseFloat(selected.security_deposit_paid)||0
    const netRefund = deposit - deductions
    const exitNotes = `TYPE:${coType==='bad'?'RUNAWAY':'Normal'}|Date:${form.exit_date}|Deposit:${deposit}|Deductions:${deductions}|Net:${netRefund}|Collected:${form.collected_at_exit}|${form.notes}`
    
    const { error } = await supabase.from('tenants').update({ status:'inactive', move_out_date: form.exit_date, notes: exitNotes }).eq('id', selected.id)
    if (error) { setSaving(false); return toast.error(error.message) }
    await supabase.from('flats').update({ status:'vacant', current_tenant_id: null }).eq('id', selected.flat_id)
    setSaving(false)
    toast.success('Checkout done — flat is now vacant ✓')
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
2. Civil suit for recovery of dues with interest
3. Public disclosure of your name, photo and dues on social media platforms
4. Blacklisting from all rental and housing platforms

This notice is issued without prejudice to all legal rights and remedies available.

CashMyRent Property Management
Phone: 8217716904 | Email: cashmyrent@gmail.com | cashmyrent.com`
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

      {tab === 'active' && (
        <div className="card overflow-hidden">
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
          : filtered.length === 0
            ? <EmptyState icon={LogOut} title="No active tenants" />
            : (
              <table className="data-table">
                <thead><tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Move In</th><th>Monthly Rent</th><th>Deposit Held</th><th>Action</th></tr></thead>
                <tbody>
                  {filtered.map(t=>(
                    <tr key={t.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 text-sm">{t.full_name.charAt(0)}</div>
                          <div><p className="font-medium text-surface-800">{t.full_name}</p><p className="text-xs text-surface-400">{t.phone}</p></div>
                        </div>
                      </td>
                      <td className="text-sm text-surface-600">{t.building?.name||'—'}</td>
                      <td className="font-mono font-semibold">{t.flat?.door_number||'—'}</td>
                      <td className="text-xs text-surface-500">{fmtDate(t.move_in_date)}</td>
                      <td className="font-mono">{formatCurrency(t.monthly_rent)}</td>
                      <td className="font-mono text-emerald-700">{formatCurrency(t.security_deposit_paid||0)}</td>
                      <td>
                        <button onClick={()=>openCheckout(t)} className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 flex items-center gap-1">
                          <LogOut className="w-3.5 h-3.5"/> Check Out
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      {tab === 'exits' && (
        <div className="card overflow-hidden">
          {recentExits.length === 0 ? <EmptyState icon={LogOut} title="No exits yet" />
          : (
            <table className="data-table">
              <thead><tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Exit Date</th><th>Exit Type</th></tr></thead>
              <tbody>
                {recentExits.map(t=>(
                  <tr key={t.id}>
                    <td><p className="font-medium">{t.full_name}</p><p className="text-xs text-surface-400">{t.phone}</p></td>
                    <td className="text-sm text-surface-500">{t.building?.name||'—'}</td>
                    <td className="font-mono">{t.flat?.door_number||'—'}</td>
                    <td className="text-xs text-surface-500">{fmtDate(t.move_out_date)}</td>
                    <td><span className={`badge border text-xs ${t.notes?.includes('RUNAWAY')?'bg-red-50 text-red-700 border-red-200':'bg-surface-100 text-surface-600 border-surface-200'}`}>{t.notes?.includes('RUNAWAY')?'Runaway':'Normal'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

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
