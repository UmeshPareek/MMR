import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, currentMonth } from '@/utils/helpers'
import { Modal, Spinner, EmptyState, Badge } from '@/components/ui'
import { LogIn, LogOut, Home, Phone, Calendar, AlertTriangle, CheckCircle2, Download, FileText, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function CheckInOut() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const [tab, setTab] = useState('checkin')
  const [buildings, setBuildings] = useState([])
  const [tenants, setTenants] = useState([])
  const [recentCheckouts, setRecentCheckouts] = useState([])
  const [loading, setLoading] = useState(true)

  // Check-in form
  const [checkinModal, setCheckinModal] = useState(false)
  const [ciForm, setCiForm] = useState({
    full_name: '', phone: '', email: '', id_type: 'aadhar', id_number: '',
    building_id: '', flat_id: '', monthly_rent: '', move_in_date: new Date().toISOString().slice(0,10),
    security_deposit_paid: '', advance_paid: '0', payment_mode: 'upi', notes: ''
  })
  const [ciFlats, setCiFlats] = useState([])

  // Check-out form
  const [checkoutModal, setCheckoutModal] = useState(false)
  const [selectedTenant, setSelectedTenant] = useState(null)
  const [coType, setCoType] = useState('good') // 'good' | 'bad'
  const [coForm, setCoForm] = useState({
    cleaning_charges: '0', painting_charges: '0', repair_charges: '0',
    other_deductions: '0', outstanding_rent: '0', refund_amount: '',
    settlement_notes: '', exit_date: new Date().toISOString().slice(0,10),
    payment_mode: 'upi', collected_at_exit: '0'
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: b }, { data: t }, { data: co }] = await Promise.all([
      supabase.from('buildings').select('id, name').eq('is_active', true).order('name'),
      supabase.from('tenants').select('*, flat:flats(door_number, monthly_rent), building:buildings(name)')
        .eq('status', 'active').order('full_name'),
      supabase.from('tenants').select('*, flat:flats(door_number), building:buildings(name)')
        .eq('status', 'inactive').order('move_out_date', { ascending: false }).limit(20),
    ])
    setBuildings(b || [])
    setTenants(t || [])
    setRecentCheckouts(co || [])
    setLoading(false)
  }

  async function loadFlats(buildingId) {
    const { data } = await supabase.from('flats').select('id, door_number, monthly_rent, status')
      .eq('building_id', buildingId).eq('status', 'vacant').order('door_number')
    setCiFlats(data || [])
  }

  async function saveCheckin() {
    if (!ciForm.full_name || !ciForm.phone || !ciForm.flat_id) return toast.error('Name, phone and flat are required')
    setSaving(true)
    // Insert tenant
    const { data: newTenant, error } = await supabase.from('tenants').insert({
      full_name: ciForm.full_name, phone: ciForm.phone, email: ciForm.email,
      id_type: ciForm.id_type, id_number: ciForm.id_number,
      building_id: ciForm.building_id, flat_id: ciForm.flat_id,
      monthly_rent: parseFloat(ciForm.monthly_rent) || 0,
      move_in_date: ciForm.move_in_date,
      security_deposit_paid: parseFloat(ciForm.security_deposit_paid) || 0,
      security_deposit_months: 2, status: 'active',
      notes: ciForm.notes, created_by: profile?.id
    }).select().single()

    if (error) { setSaving(false); return toast.error(error.message) }

    // Mark flat occupied
    await supabase.from('flats').update({ status: 'occupied', current_tenant_id: newTenant.id }).eq('id', ciForm.flat_id)

    // Create security deposit record
    if (parseFloat(ciForm.security_deposit_paid) > 0) {
      await supabase.from('security_deposits').insert({
        tenant_id: newTenant.id, flat_id: ciForm.flat_id, building_id: ciForm.building_id,
        amount_expected: parseFloat(ciForm.security_deposit_paid),
        amount_paid: parseFloat(ciForm.security_deposit_paid),
        payment_date: ciForm.move_in_date, status: 'collected',
        notes: `Check-in ${ciForm.move_in_date}`
      })
    }

    setSaving(false)
    toast.success(`${ciForm.full_name} checked in successfully ✓`)
    setCheckinModal(false)
    setCiForm({ full_name:'', phone:'', email:'', id_type:'aadhar', id_number:'', building_id:'', flat_id:'', monthly_rent:'', move_in_date: new Date().toISOString().slice(0,10), security_deposit_paid:'', advance_paid:'0', payment_mode:'upi', notes:'' })
    loadAll()
  }

  async function saveCheckout() {
    if (!selectedTenant) return
    setSaving(true)

    const charges = (parseFloat(coForm.cleaning_charges)||0) + (parseFloat(coForm.painting_charges)||0) +
      (parseFloat(coForm.repair_charges)||0) + (parseFloat(coForm.other_deductions)||0) + (parseFloat(coForm.outstanding_rent)||0)
    const deposit = selectedTenant.security_deposit_paid || 0
    const netRefund = deposit - charges
    const finalCollected = parseFloat(coForm.collected_at_exit) || 0

    const checkoutNotes = `
EXIT TYPE: ${coType === 'good' ? 'Normal Exit' : 'RUNAWAY / BAD TENANT'}
Exit Date: ${coForm.exit_date}
Security Deposit Held: ₹${deposit.toLocaleString('en-IN')}
Cleaning: ₹${coForm.cleaning_charges} | Painting: ₹${coForm.painting_charges} | Repair: ₹${coForm.repair_charges}
Outstanding Rent: ₹${coForm.outstanding_rent} | Other: ₹${coForm.other_deductions}
Total Deductions: ₹${charges.toLocaleString('en-IN')}
Net Refundable: ₹${netRefund.toLocaleString('en-IN')}
Collected at Exit: ₹${finalCollected.toLocaleString('en-IN')}
${coForm.settlement_notes}`.trim()

    // Mark tenant inactive
    await supabase.from('tenants').update({
      status: 'inactive', move_out_date: coForm.exit_date, notes: checkoutNotes
    }).eq('id', selectedTenant.id)

    // Free the flat
    await supabase.from('flats').update({ status: 'vacant', current_tenant_id: null }).eq('id', selectedTenant.flat_id)

    setSaving(false)
    toast.success('Checkout completed ✓')
    setCheckoutModal(false)
    if (coType === 'bad') generateLegalNotice(selectedTenant, charges, netRefund, coForm)
    loadAll()
  }

  function generateLegalNotice(tenant, totalDue, netRefund, form) {
    const doc = new jsPDF()
    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
    doc.setFontSize(16); doc.setFont('helvetica','bold')
    doc.text('LEGAL NOTICE', 105, 30, { align:'center' })
    doc.setFontSize(10); doc.setFont('helvetica','normal')
    doc.text(`Date: ${today}`, 14, 45)
    doc.text(`To,`, 14, 55)
    doc.text(`${tenant.full_name}`, 14, 62)
    doc.text(`(Former tenant of Flat ${tenant.flat?.door_number}, ${tenant.building?.name})`, 14, 69)
    doc.text(`Phone: ${tenant.phone}`, 14, 76)

    doc.text(`Subject: Legal Notice for Unpaid Dues & Vacation of Premises`, 14, 90)

    const body = `This notice is being issued to you on behalf of CashMyRent (Property Manager).

You were a tenant at Flat ${tenant.flat?.door_number}, ${tenant.building?.name}.
You have vacated the premises without settling your dues amounting to ₹${Math.abs(netRefund).toLocaleString('en-IN')} (Net).

BREAKDOWN OF DUES:
- Cleaning Charges: ₹${form.cleaning_charges}
- Painting Charges: ₹${form.painting_charges}  
- Repair Charges: ₹${form.repair_charges}
- Outstanding Rent: ₹${form.outstanding_rent}
- Other Charges: ₹${form.other_deductions}
TOTAL DUES: ₹${totalDue.toLocaleString('en-IN')}
Security Deposit Held: ₹${(tenant.security_deposit_paid||0).toLocaleString('en-IN')}
NET AMOUNT PAYABLE BY YOU: ₹${Math.abs(netRefund).toLocaleString('en-IN')}

You are hereby notified to clear all outstanding dues within 15 (FIFTEEN) days of receiving this notice.

FAILURE TO PAY WITHIN 15 DAYS WILL RESULT IN:
1. Filing of a police complaint for cheating/fraud
2. Legal proceedings under applicable law
3. Public disclosure of dues on social media platforms tagging your profile
4. Blacklisting on rental platforms

This notice is issued without prejudice to any other rights or remedies available.

Property Manager
CashMyRent
Contact: cashmyrent@gmail.com | 8217716904`

    const lines = doc.splitTextToSize(body, 180)
    doc.text(lines, 14, 100)
    doc.save(`Legal_Notice_${tenant.full_name.replace(/ /g,'_')}.pdf`)
    toast.success('Legal notice downloaded')
  }

  // Computed checkout values
  const totalDeductions = selectedTenant ? (
    (parseFloat(coForm.cleaning_charges)||0) + (parseFloat(coForm.painting_charges)||0) +
    (parseFloat(coForm.repair_charges)||0) + (parseFloat(coForm.other_deductions)||0) +
    (parseFloat(coForm.outstanding_rent)||0)
  ) : 0
  const netRefund = selectedTenant ? ((selectedTenant.security_deposit_paid||0) - totalDeductions) : 0

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Check In / Check Out</h2>
          <p className="text-surface-500 text-sm mt-1">Manage tenant move-ins and move-outs</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCheckinModal(true)} className="btn-primary flex items-center gap-2">
            <LogIn className="w-4 h-4" /> Check In
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200">
        {[['checkin','Active Tenants'],['checkout','Recent Exits']].map(([k,l]) => (
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {/* ACTIVE TENANTS */}
      {tab === 'checkin' && (
        <div className="card overflow-hidden">
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
          : tenants.length === 0 ? <EmptyState icon={Home} title="No active tenants" />
          : (
            <table className="data-table">
              <thead><tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Move In</th><th>Monthly Rent</th><th>Security Dep.</th><th>Action</th></tr></thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 text-sm">{t.full_name.charAt(0)}</div>
                        <div>
                          <p className="font-medium text-surface-800">{t.full_name}</p>
                          <p className="text-xs text-surface-400">{t.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-surface-600">{t.building?.name || '—'}</td>
                    <td className="font-mono font-semibold">{t.flat?.door_number || '—'}</td>
                    <td className="text-xs text-surface-500">{fmtDate(t.move_in_date)}</td>
                    <td className="font-mono">{formatCurrency(t.monthly_rent)}</td>
                    <td className="font-mono text-emerald-700">{formatCurrency(t.security_deposit_paid)}</td>
                    <td>
                      <button onClick={() => { setSelectedTenant(t); setCoType('good'); setCoForm({cleaning_charges:'0',painting_charges:'0',repair_charges:'0',other_deductions:'0',outstanding_rent:'0',refund_amount:'',settlement_notes:'',exit_date:new Date().toISOString().slice(0,10),payment_mode:'upi',collected_at_exit:'0'}); setCheckoutModal(true) }}
                        className="btn-secondary btn-sm flex items-center gap-1 text-red-600 border-red-200 hover:bg-red-50">
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
      {tab === 'checkout' && (
        <div className="card overflow-hidden">
          {recentCheckouts.length === 0 ? <EmptyState icon={LogOut} title="No recent exits" /> : (
            <table className="data-table">
              <thead><tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Move Out</th><th>Notes</th></tr></thead>
              <tbody>
                {recentCheckouts.map(t => (
                  <tr key={t.id}>
                    <td>
                      <p className="font-medium text-surface-800">{t.full_name}</p>
                      <p className="text-xs text-surface-400">{t.phone}</p>
                    </td>
                    <td className="text-surface-600">{t.building?.name || '—'}</td>
                    <td className="font-mono">{t.flat?.door_number || '—'}</td>
                    <td className="text-xs text-surface-500">{fmtDate(t.move_out_date)}</td>
                    <td className="text-xs text-surface-500 max-w-xs truncate">{t.notes?.split('\n')[0] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* CHECK-IN MODAL */}
      <Modal open={checkinModal} onClose={() => setCheckinModal(false)} title="New Tenant Check In" size="lg">
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          <div className="form-group col-span-2 sm:col-span-1">
            <label className="label">Full Name *</label>
            <input className="input" value={ciForm.full_name} onChange={e => setCiForm(p=>({...p,full_name:e.target.value}))} placeholder="Tenant full name" autoFocus />
          </div>
          <div className="form-group">
            <label className="label">Phone *</label>
            <input className="input" value={ciForm.phone} onChange={e => setCiForm(p=>({...p,phone:e.target.value}))} placeholder="9876543210" />
          </div>
          <div className="form-group">
            <label className="label">Building *</label>
            <select className="select" value={ciForm.building_id} onChange={e => { setCiForm(p=>({...p,building_id:e.target.value,flat_id:'',monthly_rent:''})); loadFlats(e.target.value) }}>
              <option value="">— Select building —</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Flat * {ciFlats.length === 0 && ciForm.building_id ? <span className="text-red-500 text-xs">(no vacant flats)</span> : ''}</label>
            <select className="select" value={ciForm.flat_id} onChange={e => { const f = ciFlats.find(fl=>fl.id===e.target.value); setCiForm(p=>({...p,flat_id:e.target.value,monthly_rent:f?.monthly_rent||'',security_deposit_paid:f?String(Number(f.monthly_rent||0)*2):''})) }}>
              <option value="">— Select flat —</option>
              {ciFlats.map(f => <option key={f.id} value={f.id}>{f.door_number} — ₹{Number(f.monthly_rent).toLocaleString('en-IN')}/mo</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Monthly Rent (₹) *</label>
            <input type="number" className="input" value={ciForm.monthly_rent} onChange={e => setCiForm(p=>({...p,monthly_rent:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">Move In Date</label>
            <input type="date" className="input" value={ciForm.move_in_date} onChange={e => setCiForm(p=>({...p,move_in_date:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">Security Deposit Collected (₹)</label>
            <input type="number" className="input" value={ciForm.security_deposit_paid} onChange={e => setCiForm(p=>({...p,security_deposit_paid:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">Advance Paid (₹)</label>
            <input type="number" className="input" value={ciForm.advance_paid} onChange={e => setCiForm(p=>({...p,advance_paid:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">ID Type</label>
            <select className="select" value={ciForm.id_type} onChange={e => setCiForm(p=>({...p,id_type:e.target.value}))}>
              {['aadhar','pan','passport','driving_license','voter_id','other'].map(t => <option key={t} value={t}>{t.replace('_',' ').toUpperCase()}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">ID Number</label>
            <input className="input" value={ciForm.id_number} onChange={e => setCiForm(p=>({...p,id_number:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">Payment Mode</label>
            <select className="select" value={ciForm.payment_mode} onChange={e => setCiForm(p=>({...p,payment_mode:e.target.value}))}>
              {['upi','cash','bank_transfer','other'].map(m => <option key={m} value={m}>{m.replace('_',' ').toUpperCase()}</option>)}
            </select>
          </div>
          <div className="form-group col-span-2">
            <label className="label">Notes</label>
            <input className="input" value={ciForm.notes} onChange={e => setCiForm(p=>({...p,notes:e.target.value}))} placeholder="Any additional notes" />
          </div>
          {/* Summary card */}
          {ciForm.flat_id && (
            <div className="col-span-2 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
              <p className="text-sm font-semibold text-emerald-800 mb-2">Check-in Summary</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-emerald-600">Monthly Rent:</span> <span className="font-mono font-bold">{formatCurrency(parseFloat(ciForm.monthly_rent)||0)}</span></div>
                <div><span className="text-emerald-600">Security Deposit:</span> <span className="font-mono font-bold">{formatCurrency(parseFloat(ciForm.security_deposit_paid)||0)}</span></div>
                <div><span className="text-emerald-600">Advance:</span> <span className="font-mono font-bold">{formatCurrency(parseFloat(ciForm.advance_paid)||0)}</span></div>
              </div>
            </div>
          )}
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setCheckinModal(false)}>Cancel</button>
          <button className="btn-primary flex items-center gap-2" onClick={saveCheckin} disabled={saving}>
            {saving ? <Spinner size={16}/> : <><LogIn className="w-4 h-4"/>Confirm Check In</>}
          </button>
        </div>
      </Modal>

      {/* CHECK-OUT MODAL */}
      <Modal open={checkoutModal} onClose={() => setCheckoutModal(false)} title={`Check Out — ${selectedTenant?.full_name}`} size="lg">
        {selectedTenant && (
          <>
            <div className="px-6 pt-4">
              {/* Tenant info */}
              <div className="p-3 bg-surface-50 rounded-xl border border-surface-200 mb-4 flex items-center gap-4 text-sm">
                <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700">{selectedTenant.full_name.charAt(0)}</div>
                <div className="flex-1">
                  <p className="font-semibold">{selectedTenant.full_name}</p>
                  <p className="text-surface-500 text-xs">{selectedTenant.flat?.door_number} · {selectedTenant.building?.name} · {selectedTenant.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-surface-400">Security Deposit Held</p>
                  <p className="font-mono font-bold text-emerald-700">{formatCurrency(selectedTenant.security_deposit_paid||0)}</p>
                </div>
              </div>

              {/* Exit type */}
              <div className="flex gap-3 mb-4">
                <button onClick={() => setCoType('good')} className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium flex items-center justify-center gap-2 transition-all ${coType==='good'?'border-emerald-400 bg-emerald-50 text-emerald-700':'border-surface-200 text-surface-500'}`}>
                  <CheckCircle2 className="w-4 h-4"/> Normal Exit
                </button>
                <button onClick={() => setCoType('bad')} className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium flex items-center justify-center gap-2 transition-all ${coType==='bad'?'border-red-400 bg-red-50 text-red-700':'border-surface-200 text-surface-500'}`}>
                  <AlertTriangle className="w-4 h-4"/> Runaway / Bad Tenant
                </button>
              </div>
              {coType === 'bad' && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 mb-4">
                  ⚠️ A legal notice PDF will be auto-generated with all dues and police complaint warning.
                </div>
              )}
            </div>

            <div className="px-6 grid sm:grid-cols-2 gap-4 pb-2">
              <div className="form-group">
                <label className="label">Exit Date</label>
                <input type="date" className="input" value={coForm.exit_date} onChange={e => setCoForm(p=>({...p,exit_date:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="label">Outstanding Rent (₹)</label>
                <input type="number" className="input" value={coForm.outstanding_rent} onChange={e => setCoForm(p=>({...p,outstanding_rent:e.target.value}))} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="label">Cleaning Charges (₹)</label>
                <input type="number" className="input" value={coForm.cleaning_charges} onChange={e => setCoForm(p=>({...p,cleaning_charges:e.target.value}))} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="label">Painting Charges (₹)</label>
                <input type="number" className="input" value={coForm.painting_charges} onChange={e => setCoForm(p=>({...p,painting_charges:e.target.value}))} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="label">Repair Charges (₹)</label>
                <input type="number" className="input" value={coForm.repair_charges} onChange={e => setCoForm(p=>({...p,repair_charges:e.target.value}))} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="label">Other Deductions (₹)</label>
                <input type="number" className="input" value={coForm.other_deductions} onChange={e => setCoForm(p=>({...p,other_deductions:e.target.value}))} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="label">Collected at Exit (₹)</label>
                <input type="number" className="input" value={coForm.collected_at_exit} onChange={e => setCoForm(p=>({...p,collected_at_exit:e.target.value}))} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="label">Payment Mode</label>
                <select className="select" value={coForm.payment_mode} onChange={e => setCoForm(p=>({...p,payment_mode:e.target.value}))}>
                  {['upi','cash','bank_transfer','other'].map(m => <option key={m} value={m}>{m.replace('_',' ').toUpperCase()}</option>)}
                </select>
              </div>
              <div className="form-group col-span-2">
                <label className="label">Settlement Notes</label>
                <textarea className="input" rows={2} value={coForm.settlement_notes} onChange={e => setCoForm(p=>({...p,settlement_notes:e.target.value}))} placeholder="Room condition, agreed terms…" />
              </div>

              {/* Settlement summary */}
              <div className="col-span-2 p-4 rounded-xl border-2 bg-surface-50 border-surface-200">
                <p className="text-sm font-semibold text-surface-700 mb-3">Settlement Summary</p>
                <div className="space-y-1.5 text-sm">
                  {[
                    ['Security Deposit Held', formatCurrency(selectedTenant.security_deposit_paid||0), 'text-emerald-700'],
                    ['Total Deductions', `−${formatCurrency(totalDeductions)}`, 'text-red-600'],
                  ].map(([l,v,c]) => (
                    <div key={l} className="flex justify-between"><span className="text-surface-500">{l}</span><span className={`font-mono font-semibold ${c}`}>{v}</span></div>
                  ))}
                  <div className="border-t border-surface-200 pt-2 mt-2 flex justify-between">
                    <span className="font-semibold text-surface-700">{netRefund >= 0 ? 'Refund to Tenant' : 'Amount to Collect'}</span>
                    <span className={`font-mono font-bold text-base ${netRefund>=0?'text-emerald-700':'text-red-600'}`}>{formatCurrency(Math.abs(netRefund))}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3 justify-end mt-2">
              <button className="btn-secondary" onClick={() => setCheckoutModal(false)}>Cancel</button>
              <button onClick={saveCheckout} disabled={saving}
                className={`btn-sm px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${coType==='bad'?'bg-red-600 text-white hover:bg-red-700':'btn-primary'}`}>
                {saving ? <Spinner size={16}/> : <><LogOut className="w-4 h-4"/>{coType==='bad'?'Checkout + Legal Notice':'Confirm Checkout'}</>}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
