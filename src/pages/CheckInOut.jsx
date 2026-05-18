import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate } from '@/utils/helpers'
import { Modal, Spinner, EmptyState } from '@/components/ui'
import { LogIn, LogOut, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function CheckInOut() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('active')
  const [buildings, setBuildings] = useState([])
  const [activeTenants, setActiveTenants] = useState([])
  const [recentExits, setRecentExits] = useState([])
  const [loading, setLoading] = useState(true)

  // Check-in
  const [checkinModal, setCheckinModal] = useState(false)
  const [ciForm, setCiForm] = useState({ full_name:'', phone:'', email:'', building_id:'', flat_id:'', monthly_rent:'', move_in_date: new Date().toISOString().slice(0,10), security_deposit_paid:'', advance_paid:'0', rent_type:'prepaid', id_type:'aadhar', id_number:'', notes:'' })
  const [vacantFlats, setVacantFlats] = useState([])
  const [saving, setSaving] = useState(false)

  // Check-out
  const [checkoutModal, setCheckoutModal] = useState(false)
  const [tenant, setTenant] = useState(null)
  const [coType, setCoType] = useState('good')
  const [coForm, setCoForm] = useState({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: b }, { data: t }, { data: ex }] = await Promise.all([
      supabase.from('buildings').select('id,name').eq('is_active', true).order('name'),
      supabase.from('tenants')
        .select('id,full_name,phone,monthly_rent,security_deposit_paid,move_in_date,rent_type,flat_id,building_id, flat:flats(door_number), building:buildings(name)')
        .eq('status', 'active').order('full_name'),
      supabase.from('tenants')
        .select('id,full_name,phone,move_out_date,flat_id,building_id, flat:flats(door_number), building:buildings(name)')
        .eq('status', 'inactive').order('move_out_date', { ascending: false }).limit(30),
    ])
    setBuildings(b || [])
    setActiveTenants(t || [])
    setRecentExits(ex || [])
    setLoading(false)
  }

  async function loadVacantFlats(buildingId) {
    const { data } = await supabase.from('flats')
      .select('id, door_number, monthly_rent')
      .eq('building_id', buildingId)
      .eq('status', 'vacant')
      .order('door_number')
    setVacantFlats(data || [])
  }

  async function saveCheckin() {
    if (!ciForm.full_name || !ciForm.phone || !ciForm.flat_id || !ciForm.building_id)
      return toast.error('Name, phone, building and flat are required')
    setSaving(true)
    const { data: newTenant, error } = await supabase.from('tenants').insert({
      full_name: ciForm.full_name, phone: ciForm.phone, email: ciForm.email || null,
      building_id: ciForm.building_id, flat_id: ciForm.flat_id,
      monthly_rent: parseFloat(ciForm.monthly_rent) || 0,
      move_in_date: ciForm.move_in_date,
      security_deposit_paid: parseFloat(ciForm.security_deposit_paid) || 0,
      rent_type: ciForm.rent_type,
      id_type: ciForm.id_type, id_number: ciForm.id_number || null,
      notes: ciForm.notes || null, status: 'active', created_by: profile?.id
    }).select().single()

    if (error) { setSaving(false); return toast.error(error.message) }

    // Mark flat occupied
    await supabase.from('flats').update({ status: 'occupied', current_tenant_id: newTenant.id }).eq('id', ciForm.flat_id)

    // Auto-create security deposit record
    if (parseFloat(ciForm.security_deposit_paid) > 0) {
      await supabase.from('security_deposits').insert({
        tenant_id: newTenant.id, flat_id: ciForm.flat_id, building_id: ciForm.building_id,
        amount_expected: parseFloat(ciForm.security_deposit_paid),
        amount_paid: parseFloat(ciForm.security_deposit_paid),
        payment_date: ciForm.move_in_date, status: 'collected',
        notes: `Check-in on ${ciForm.move_in_date}`
      })
    }
    setSaving(false)
    toast.success(`${ciForm.full_name} checked in ✓`)
    setCheckinModal(false)
    resetCheckin()
    loadAll()
  }

  function resetCheckin() {
    setCiForm({ full_name:'', phone:'', email:'', building_id:'', flat_id:'', monthly_rent:'', move_in_date: new Date().toISOString().slice(0,10), security_deposit_paid:'', advance_paid:'0', rent_type:'prepaid', id_type:'aadhar', id_number:'', notes:'' })
    setVacantFlats([])
  }

  async function saveCheckout() {
    if (!tenant) return
    setSaving(true)
    const deductions = ['cleaning','painting','repair','other','outstanding_rent']
      .reduce((s, k) => s + (parseFloat(coForm[k]) || 0), 0)
    const deposit = parseFloat(tenant.security_deposit_paid) || 0
    const netRefund = deposit - deductions
    const exitNotes = `EXIT: ${coType === 'bad' ? 'RUNAWAY TENANT' : 'Normal Exit'} | Date: ${coForm.exit_date} | Deposit: ₹${deposit} | Deductions: ₹${deductions} | Net: ₹${netRefund} | Collected at exit: ₹${coForm.collected_at_exit || 0} | ${coForm.notes}`

    // Update tenant
    const { error } = await supabase.from('tenants').update({
      status: 'inactive', move_out_date: coForm.exit_date, notes: exitNotes
    }).eq('id', tenant.id)
    if (error) { setSaving(false); return toast.error(error.message) }

    // Free the flat — make it VACANT again
    await supabase.from('flats').update({ status: 'vacant', current_tenant_id: null }).eq('id', tenant.flat_id)

    setSaving(false)
    toast.success('Checkout complete — flat marked vacant ✓')
    if (coType === 'bad') generateLegalNotice(tenant, deductions, netRefund)
    setCheckoutModal(false)
    setTenant(null)
    setCoForm({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })
    loadAll()
  }

  function openCheckout(t) {
    setTenant(t)
    setCoType('good')
    setCoForm({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })
    setCheckoutModal(true)
  }

  function generateLegalNotice(t, totalDue, netRefund) {
    const doc = new jsPDF()
    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
    doc.setFontSize(16); doc.setFont('helvetica','bold')
    doc.text('LEGAL NOTICE', 105, 25, { align:'center' })
    doc.setFontSize(10); doc.setFont('helvetica','normal')
    doc.text(`Date: ${today}`, 14, 40)
    doc.text(`To,\n${t.full_name}\nFormer Tenant — Flat ${t.flat?.door_number}, ${t.building?.name}\nPhone: ${t.phone}`, 14, 50)

    const body = `Subject: Legal Notice for Outstanding Dues

This notice is issued on behalf of CashMyRent (Property Management).

You vacated the premises at Flat ${t.flat?.door_number}, ${t.building?.name} without clearing your dues.

DUES BREAKDOWN:
Security Deposit Held:  ₹${(t.security_deposit_paid||0).toLocaleString('en-IN')}
Total Deductions:       ₹${totalDue.toLocaleString('en-IN')}
Net Amount Payable:     ₹${Math.abs(netRefund).toLocaleString('en-IN')}

You are required to clear all outstanding dues within 15 DAYS of this notice.

CONSEQUENCES OF NON-PAYMENT:
1. A police complaint will be filed for cheating and fraud
2. Legal proceedings will be initiated under applicable law  
3. Your details will be disclosed on social media platforms
4. You will be blacklisted on all rental platforms

This notice is issued without prejudice to all other legal rights.

CashMyRent
cashmyrent@gmail.com | 8217716904 | cashmyrent.com`

    doc.text(doc.splitTextToSize(body, 180), 14, 85)
    doc.save(`Legal_Notice_${t.full_name.replace(/ /g,'_')}_${today}.pdf`)
    toast.success('Legal notice PDF downloaded')
  }

  const totalDed = ['cleaning','painting','repair','other','outstanding_rent'].reduce((s,k) => s + (parseFloat(coForm[k])||0), 0)
  const netRefund = tenant ? ((parseFloat(tenant.security_deposit_paid)||0) - totalDed) : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Check In / Check Out</h2>
          <p className="text-surface-500 text-sm mt-1">{activeTenants.length} active tenants · {recentExits.length} recent exits</p>
        </div>
        <button onClick={() => { resetCheckin(); setCheckinModal(true) }} className="btn-primary flex items-center gap-2">
          <LogIn className="w-4 h-4" /> New Check In
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200">
        {[['active', `Active Tenants (${activeTenants.length})`], ['exits', `Recent Exits (${recentExits.length})`]].map(([k,l]) => (
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {/* ACTIVE TENANTS — CHECK OUT */}
      {tab === 'active' && (
        <div className="card overflow-hidden">
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
          : activeTenants.length === 0
            ? <EmptyState icon={LogIn} title="No active tenants" description="Check in your first tenant to get started" />
            : (
              <table className="data-table">
                <thead>
                  <tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Move In</th><th>Monthly Rent</th><th>Deposit Held</th><th>Type</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {activeTenants.map(t => (
                    <tr key={t.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 text-sm flex-shrink-0">{t.full_name.charAt(0)}</div>
                          <div>
                            <p className="font-medium text-surface-800">{t.full_name}</p>
                            <p className="text-xs text-surface-400">{t.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm text-surface-600">{t.building?.name || '—'}</td>
                      <td className="font-mono font-semibold text-surface-800">{t.flat?.door_number || '—'}</td>
                      <td className="text-xs text-surface-500">{fmtDate(t.move_in_date)}</td>
                      <td className="font-mono">{formatCurrency(t.monthly_rent)}</td>
                      <td className="font-mono text-emerald-700">{formatCurrency(t.security_deposit_paid || 0)}</td>
                      <td>
                        <span className={`badge border text-xs ${t.rent_type === 'postpaid' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-brand-50 text-brand-700 border-brand-200'}`}>
                          {t.rent_type === 'postpaid' ? 'Postpaid' : 'Prepaid'}
                        </span>
                      </td>
                      <td>
                        <button onClick={() => openCheckout(t)} className="btn-sm px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 flex items-center gap-1">
                          <LogOut className="w-3.5 h-3.5" /> Check Out
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      {/* RECENT EXITS */}
      {tab === 'exits' && (
        <div className="card overflow-hidden">
          {recentExits.length === 0
            ? <EmptyState icon={LogOut} title="No exits yet" />
            : (
              <table className="data-table">
                <thead><tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Move Out</th><th>Notes</th></tr></thead>
                <tbody>
                  {recentExits.map(t => (
                    <tr key={t.id}>
                      <td>
                        <p className="font-medium text-surface-800">{t.full_name}</p>
                        <p className="text-xs text-surface-400">{t.phone}</p>
                      </td>
                      <td className="text-sm text-surface-500">{t.building?.name || '—'}</td>
                      <td className="font-mono text-surface-600">{t.flat?.door_number || '—'}</td>
                      <td className="text-xs text-surface-500">{fmtDate(t.move_out_date)}</td>
                      <td className="text-xs text-surface-400 max-w-xs truncate">{t.notes?.split('|')[0] || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      {/* CHECK-IN MODAL */}
      <Modal open={checkinModal} onClose={() => { setCheckinModal(false); resetCheckin() }} title="New Tenant Check In" size="lg">
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          {/* Rent type */}
          <div className="col-span-2">
            <label className="label mb-2">Rent Type</label>
            <div className="flex gap-3">
              {[['prepaid','Prepaid (advance)'],['postpaid','Postpaid (arrears)']].map(([v,l]) => (
                <button key={v} type="button" onClick={() => setCiForm(p=>({...p,rent_type:v}))}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${ciForm.rent_type===v?'border-brand-500 bg-brand-50 text-brand-700':'border-surface-200 text-surface-500'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="form-group"><label className="label">Full Name *</label><input className="input" value={ciForm.full_name} onChange={e=>setCiForm(p=>({...p,full_name:e.target.value}))} placeholder="Tenant name" autoFocus /></div>
          <div className="form-group"><label className="label">Phone *</label><input className="input" value={ciForm.phone} onChange={e=>setCiForm(p=>({...p,phone:e.target.value}))} placeholder="9876543210" /></div>
          <div className="form-group">
            <label className="label">Building *</label>
            <select className="select" value={ciForm.building_id} onChange={e => { setCiForm(p=>({...p,building_id:e.target.value,flat_id:'',monthly_rent:''})); loadVacantFlats(e.target.value) }}>
              <option value="">— Select building —</option>
              {buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Flat (Vacant only) *</label>
            <select className="select" value={ciForm.flat_id} onChange={e=>{const f=vacantFlats.find(fl=>fl.id===e.target.value);setCiForm(p=>({...p,flat_id:e.target.value,monthly_rent:f?.monthly_rent||'',security_deposit_paid:f?String(Number(f.monthly_rent||0)*2):p.security_deposit_paid}))}}>
              <option value="">— Select flat —</option>
              {vacantFlats.length===0 && ciForm.building_id ? <option disabled>No vacant flats</option> : vacantFlats.map(f=><option key={f.id} value={f.id}>{f.door_number} — ₹{Number(f.monthly_rent).toLocaleString('en-IN')}/mo</option>)}
            </select>
            {ciForm.building_id && vacantFlats.length===0 && <p className="text-xs text-red-500 mt-1">No vacant flats in this building</p>}
          </div>
          <div className="form-group"><label className="label">Monthly Rent (₹) *</label><input type="number" className="input" value={ciForm.monthly_rent} onChange={e=>setCiForm(p=>({...p,monthly_rent:e.target.value}))} /></div>
          <div className="form-group"><label className="label">Move In Date</label><input type="date" className="input" value={ciForm.move_in_date} onChange={e=>setCiForm(p=>({...p,move_in_date:e.target.value}))} /></div>
          <div className="form-group"><label className="label">Security Deposit (₹)</label><input type="number" className="input" value={ciForm.security_deposit_paid} onChange={e=>setCiForm(p=>({...p,security_deposit_paid:e.target.value}))} placeholder="Auto: 2x rent" /></div>
          <div className="form-group"><label className="label">Advance Paid (₹)</label><input type="number" className="input" value={ciForm.advance_paid} onChange={e=>setCiForm(p=>({...p,advance_paid:e.target.value}))} /></div>
          <div className="form-group"><label className="label">ID Type</label>
            <select className="select" value={ciForm.id_type} onChange={e=>setCiForm(p=>({...p,id_type:e.target.value}))}>
              {['aadhar','pan','passport','driving_license','voter_id','other'].map(t=><option key={t} value={t}>{t.replace('_',' ').toUpperCase()}</option>)}
            </select>
          </div>
          <div className="form-group"><label className="label">ID Number</label><input className="input" value={ciForm.id_number} onChange={e=>setCiForm(p=>({...p,id_number:e.target.value}))} /></div>
          <div className="form-group col-span-2"><label className="label">Notes</label><input className="input" value={ciForm.notes} onChange={e=>setCiForm(p=>({...p,notes:e.target.value}))} placeholder="Any notes" /></div>
          {/* Summary */}
          {ciForm.flat_id && (
            <div className="col-span-2 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
              <p className="text-sm font-semibold text-emerald-800 mb-2">Check-in Summary</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-emerald-600 text-xs">Rent:</span><p className="font-mono font-bold">{formatCurrency(parseFloat(ciForm.monthly_rent)||0)}</p></div>
                <div><span className="text-emerald-600 text-xs">Deposit:</span><p className="font-mono font-bold">{formatCurrency(parseFloat(ciForm.security_deposit_paid)||0)}</p></div>
                <div><span className="text-emerald-600 text-xs">Type:</span><p className="font-medium capitalize">{ciForm.rent_type}</p></div>
              </div>
            </div>
          )}
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => { setCheckinModal(false); resetCheckin() }}>Cancel</button>
          <button className="btn-primary flex items-center gap-2" onClick={saveCheckin} disabled={saving}>
            {saving ? <Spinner size={16}/> : <><LogIn className="w-4 h-4"/>Confirm Check In</>}
          </button>
        </div>
      </Modal>

      {/* CHECK-OUT MODAL */}
      <Modal open={checkoutModal} onClose={() => setCheckoutModal(false)} title={`Check Out — ${tenant?.full_name}`} size="lg">
        {tenant && (
          <>
            <div className="px-6 pt-5 space-y-4">
              {/* Tenant summary */}
              <div className="p-3 bg-surface-50 border border-surface-200 rounded-xl flex items-center gap-4 text-sm">
                <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 flex-shrink-0">{tenant.full_name.charAt(0)}</div>
                <div className="flex-1">
                  <p className="font-semibold">{tenant.full_name}</p>
                  <p className="text-xs text-surface-400">{tenant.flat?.door_number} · {tenant.building?.name} · {tenant.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-surface-400">Deposit Held</p>
                  <p className="font-mono font-bold text-emerald-700">{formatCurrency(tenant.security_deposit_paid||0)}</p>
                </div>
              </div>

              {/* Exit type toggle */}
              <div className="flex gap-3">
                <button onClick={() => setCoType('good')} className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium flex items-center justify-center gap-2 transition-all ${coType==='good'?'border-emerald-400 bg-emerald-50 text-emerald-700':'border-surface-200 text-surface-500'}`}>
                  <CheckCircle2 className="w-4 h-4"/> Normal Exit
                </button>
                <button onClick={() => setCoType('bad')} className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium flex items-center justify-center gap-2 transition-all ${coType==='bad'?'border-red-400 bg-red-50 text-red-700':'border-surface-200 text-surface-500'}`}>
                  <AlertTriangle className="w-4 h-4"/> Runaway / Bad Tenant
                </button>
              </div>
              {coType === 'bad' && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">⚠️ A legal notice PDF with all dues + 15-day deadline + police complaint warning will be auto-generated.</div>}
            </div>

            <div className="px-6 pt-4 grid sm:grid-cols-2 gap-4">
              <div className="form-group"><label className="label">Exit Date</label><input type="date" className="input" value={coForm.exit_date} onChange={e=>setCoForm(p=>({...p,exit_date:e.target.value}))}/></div>
              <div className="form-group"><label className="label">Outstanding Rent (₹)</label><input type="number" className="input" value={coForm.outstanding_rent} onChange={e=>setCoForm(p=>({...p,outstanding_rent:e.target.value}))} placeholder="0"/></div>
              <div className="form-group"><label className="label">Cleaning Charges (₹)</label><input type="number" className="input" value={coForm.cleaning} onChange={e=>setCoForm(p=>({...p,cleaning:e.target.value}))} placeholder="0"/></div>
              <div className="form-group"><label className="label">Painting Charges (₹)</label><input type="number" className="input" value={coForm.painting} onChange={e=>setCoForm(p=>({...p,painting:e.target.value}))} placeholder="0"/></div>
              <div className="form-group"><label className="label">Repair Charges (₹)</label><input type="number" className="input" value={coForm.repair} onChange={e=>setCoForm(p=>({...p,repair:e.target.value}))} placeholder="0"/></div>
              <div className="form-group"><label className="label">Other Deductions (₹)</label><input type="number" className="input" value={coForm.other} onChange={e=>setCoForm(p=>({...p,other:e.target.value}))} placeholder="0"/></div>
              <div className="form-group"><label className="label">Collected at Exit (₹)</label><input type="number" className="input" value={coForm.collected_at_exit} onChange={e=>setCoForm(p=>({...p,collected_at_exit:e.target.value}))} placeholder="0"/></div>
              <div className="form-group"><label className="label">Notes</label><input className="input" value={coForm.notes} onChange={e=>setCoForm(p=>({...p,notes:e.target.value}))} placeholder="Room condition, agreed terms…"/></div>

              {/* Settlement summary */}
              <div className="col-span-2 p-4 rounded-xl border-2 bg-surface-50 border-surface-200">
                <p className="text-sm font-semibold text-surface-700 mb-3">Settlement Summary</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-surface-500">Security Deposit Held</span><span className="font-mono font-semibold text-emerald-700">{formatCurrency(tenant.security_deposit_paid||0)}</span></div>
                  <div className="flex justify-between"><span className="text-surface-500">Total Deductions</span><span className="font-mono font-semibold text-red-600">−{formatCurrency(totalDed)}</span></div>
                  <div className="border-t border-surface-200 pt-2 flex justify-between items-center">
                    <span className="font-bold text-surface-700">{netRefund >= 0 ? 'Refund to Tenant' : 'Amount to Collect'}</span>
                    <span className={`font-mono font-bold text-lg ${netRefund>=0?'text-emerald-700':'text-red-600'}`}>{formatCurrency(Math.abs(netRefund))}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3 justify-end mt-2">
              <button className="btn-secondary" onClick={() => setCheckoutModal(false)}>Cancel</button>
              <button onClick={saveCheckout} disabled={saving}
                className={`px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 ${coType==='bad'?'bg-red-600 hover:bg-red-700 text-white':'btn-primary'}`}>
                {saving ? <Spinner size={16}/> : <><LogOut className="w-4 h-4"/>{coType==='bad'?'Checkout + Legal Notice':'Confirm Checkout'}</>}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
