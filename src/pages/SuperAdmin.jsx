import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate } from '@/utils/helpers'
import { Modal, Spinner } from '@/components/ui'
import { Building2, Users, CreditCard, TrendingUp, Plus, CheckCircle2, Circle, Copy, Eye, EyeOff, ChevronDown, ChevronRight, Zap, Globe, Phone, Mail } from 'lucide-react'
import toast from 'react-hot-toast'

const PLANS = [
  { id: 'starter', name: 'Starter', price: 1999, buildings: 2, tenants: 50, users: 3, features: ['Rent collection', 'Expenses', 'Staff salary', 'Excel exports'] },
  { id: 'growth', name: 'Growth', price: 4999, buildings: 5, tenants: 200, users: 10, features: ['Everything in Starter', 'Audit module', 'Utility bills', 'Priority support'] },
  { id: 'pro', name: 'Pro', price: 9999, buildings: 999, tenants: 9999, users: 999, features: ['Everything in Growth', 'Unlimited buildings', 'API access', 'Custom branding', 'Dedicated support'] },
]

const ONBOARD_STEPS = ['Company Details', 'Select Plan', 'Create Admin User', 'Confirm & Launch']

export default function SuperAdmin() {
  const [clients, setClients] = useState([])
  const [revenue, setRevenue] = useState({ mrr: 0, arr: 0, total: 0, byPlan: {} })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  // Onboarding wizard
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [wizardData, setWizardData] = useState({
    company_name: '', contact_name: '', email: '', phone: '', city: '', website: '',
    plan_id: 'growth', custom_price: '',
    admin_email: '', admin_password: '', admin_name: '',
  })
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [expandedClient, setExpandedClient] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const { data: orgs } = await supabase.from('organizations').select('*').order('created_at', { ascending: false })
    const { data: plans } = await supabase.from('plans').select('*')
    setClients(orgs || [])

    // Revenue calc
    const planMap = {}; (plans||[]).forEach(p => { planMap[p.slug] = p })
    let mrr = 0
    const byPlan = {}
    ;(orgs||[]).filter(o=>o.status==='active').forEach(o => {
      const plan = PLANS.find(p=>p.id===o.plan_id) || PLANS[1]
      const price = o.custom_price || plan.price
      mrr += price
      byPlan[plan.name] = (byPlan[plan.name] || 0) + 1
    })
    setRevenue({ mrr, arr: mrr * 12, total: mrr, byPlan })
    setLoading(false)
  }

  function generatePassword() {
    const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrs23456789@#!'
    setWizardData(p => ({ ...p, admin_password: Array.from({length:12},()=>c[Math.floor(Math.random()*c.length)]).join('') }))
  }

  async function launchClient() {
    if (!wizardData.company_name || !wizardData.admin_email || !wizardData.admin_password) return toast.error('Fill all required fields')
    setSaving(true)
    try {
      // Create org
      const slug = wizardData.company_name.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-')
      const { data: org, error: orgErr } = await supabase.from('organizations').insert({
        name: wizardData.company_name, slug,
        contact_name: wizardData.contact_name, contact_email: wizardData.email,
        contact_phone: wizardData.phone, city: wizardData.city,
        plan_id: wizardData.plan_id,
        custom_price: wizardData.custom_price ? parseInt(wizardData.custom_price) : null,
        status: 'active', onboarded_at: new Date().toISOString(),
      }).select().single()
      if (orgErr) throw orgErr

      // Create admin user
      const { data: user, error: userErr } = await supabase.auth.admin.createUser({
        email: wizardData.admin_email, password: wizardData.admin_password,
        email_confirm: true, user_metadata: { full_name: wizardData.admin_name }
      })
      if (userErr) throw userErr

      await supabase.from('profiles').upsert({
        id: user.user.id, email: wizardData.admin_email,
        full_name: wizardData.admin_name, role: 'super_admin',
        org_id: org.id,
      })

      toast.success(`✓ ${wizardData.company_name} is live on CashMyRent!`)
      setWizardOpen(false)
      setStep(0)
      setWizardData({ company_name:'', contact_name:'', email:'', phone:'', city:'', website:'', plan_id:'growth', custom_price:'', admin_email:'', admin_password:'', admin_name:'' })
      loadAll()
    } catch(e) { toast.error(e.message) }
    setSaving(false)
  }

  async function toggleClientStatus(id, currentStatus) {
    await supabase.from('organizations').update({ status: currentStatus==='active'?'suspended':'active' }).eq('id', id)
    toast.success(currentStatus==='active'?'Client suspended':'Client reactivated')
    loadAll()
  }

  const activeClients = clients.filter(c=>c.status==='active')
  const suspendedClients = clients.filter(c=>c.status==='suspended')

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-800 via-slate-700 to-slate-600 p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-5" style={{backgroundImage:'radial-gradient(circle at 30% 70%, white 1px, transparent 1px)', backgroundSize:'20px 20px'}}/>
        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">Platform Admin · CashMyRent</p>
            <h1 className="text-3xl font-bold">₹{(revenue.mrr/1000).toFixed(1)}K <span className="text-slate-300 text-lg font-normal">MRR</span></h1>
            <p className="text-slate-300 text-sm mt-1">₹{(revenue.arr/100000).toFixed(1)}L ARR · {activeClients.length} active clients</p>
          </div>
          <button onClick={() => { setWizardOpen(true); setStep(0) }}
            className="flex items-center gap-2 bg-white text-slate-800 px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-colors shadow-lg">
            <Plus className="w-4 h-4"/> Onboard New Client
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {[
            { label:'Active Clients', value: activeClients.length, icon:'🟢' },
            { label:'Suspended', value: suspendedClients.length, icon:'🔴' },
            { label:'MRR', value: `₹${(revenue.mrr/1000).toFixed(1)}K`, icon:'💰' },
            { label:'ARR', value: `₹${(revenue.arr/100000).toFixed(2)}L`, icon:'📈' },
          ].map(({label,value,icon}) => (
            <div key={label} className="bg-white/10 border border-white/10 rounded-xl p-3">
              <p className="text-slate-300 text-xs mb-1">{icon} {label}</p>
              <p className="text-white font-bold text-xl">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-surface-200">
        {[['overview','Overview'],['clients','All Clients'],['revenue','Revenue']].map(([k,l]) => (
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Plan breakdown */}
          <div className="grid grid-cols-3 gap-4">
            {PLANS.map(plan => {
              const count = clients.filter(c=>c.plan_id===plan.id&&c.status==='active').length
              return (
                <div key={plan.id} className="card p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-bold text-surface-800">{plan.name}</p>
                      <p className="text-xs text-surface-400">₹{plan.price.toLocaleString('en-IN')}/mo</p>
                    </div>
                    <span className="badge bg-brand-50 text-brand-700 border border-brand-200 text-xs font-bold">{count} clients</span>
                  </div>
                  <p className="font-mono font-bold text-brand-700">{formatCurrency(count * plan.price)}<span className="text-xs text-surface-400 font-normal">/mo</span></p>
                  <div className="mt-3 space-y-1">
                    {plan.features.slice(0,3).map(f => <p key={f} className="text-xs text-surface-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500"/>{f}</p>)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Recent clients */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
              <h3 className="font-semibold text-surface-700">Recent Clients</h3>
            </div>
            <table className="data-table">
              <thead><tr><th>Company</th><th>Plan</th><th>MRR</th><th>Onboarded</th><th>Status</th></tr></thead>
              <tbody>
                {clients.slice(0,5).map(c => {
                  const plan = PLANS.find(p=>p.id===c.plan_id)||PLANS[1]
                  return (
                    <tr key={c.id}>
                      <td>
                        <p className="font-medium text-surface-800">{c.name}</p>
                        <p className="text-xs text-surface-400">{c.contact_email||'—'}</p>
                      </td>
                      <td><span className="badge bg-brand-50 text-brand-700 border border-brand-200 text-xs">{plan.name}</span></td>
                      <td className="font-mono font-semibold text-brand-700">{formatCurrency(c.custom_price||plan.price)}</td>
                      <td className="text-xs text-surface-500">{fmtDate(c.onboarded_at||c.created_at)}</td>
                      <td><span className={`badge border text-xs ${c.status==='active'?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-red-50 text-red-700 border-red-200'}`}>{c.status}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ALL CLIENTS */}
      {tab === 'clients' && (
        <div className="space-y-3">
          {clients.map(c => {
            const plan = PLANS.find(p=>p.id===c.plan_id)||PLANS[1]
            const isExpanded = expandedClient === c.id
            return (
              <div key={c.id} className={`card overflow-hidden border ${c.status==='suspended'?'border-red-200 opacity-70':''}`}>
                <div className="p-4 flex items-center gap-4 cursor-pointer" onClick={()=>setExpandedClient(isExpanded?null:c.id)}>
                  <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-teal-500 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {c.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-surface-800">{c.name}</p>
                      <span className={`badge border text-xs ${c.status==='active'?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-red-50 text-red-700 border-red-200'}`}>{c.status}</span>
                    </div>
                    <p className="text-xs text-surface-400">{c.contact_email} · {c.city||'—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono font-bold text-brand-700">{formatCurrency(c.custom_price||plan.price)}/mo</p>
                    <p className="text-xs text-surface-400">{plan.name} plan</p>
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-surface-400"/> : <ChevronRight className="w-4 h-4 text-surface-400"/>}
                </div>

                {isExpanded && (
                  <div className="border-t border-surface-100 p-4 bg-surface-50 space-y-4">
                    <div className="grid sm:grid-cols-3 gap-4 text-sm">
                      <div><p className="text-xs text-surface-400 mb-1">Contact</p><p className="font-medium">{c.contact_name||'—'}</p></div>
                      <div><p className="text-xs text-surface-400 mb-1">Phone</p><p className="font-medium">{c.contact_phone||'—'}</p></div>
                      <div><p className="text-xs text-surface-400 mb-1">Onboarded</p><p className="font-medium">{fmtDate(c.onboarded_at||c.created_at)}</p></div>
                    </div>
                    {/* Plan change */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-surface-500">Plan:</span>
                        <select className="select py-1 text-sm w-32" value={c.plan_id||'growth'}
                          onChange={async e => {
                            await supabase.from('organizations').update({ plan_id: e.target.value }).eq('id', c.id)
                            toast.success('Plan updated'); loadAll()
                          }}>
                          {PLANS.map(p=><option key={p.id} value={p.id}>{p.name} — ₹{p.price.toLocaleString('en-IN')}/mo</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-surface-500">Custom price:</span>
                        <input type="number" className="input py-1 text-sm w-28" placeholder="Override"
                          defaultValue={c.custom_price||''}
                          onBlur={async e => {
                            const val = e.target.value ? parseInt(e.target.value) : null
                            await supabase.from('organizations').update({ custom_price: val }).eq('id', c.id)
                            toast.success('Price updated'); loadAll()
                          }} />
                      </div>
                      <button onClick={() => toggleClientStatus(c.id, c.status)}
                        className={`btn-sm px-3 py-1.5 rounded-lg text-xs font-medium border ${c.status==='active'?'border-red-200 text-red-600 hover:bg-red-50':'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}>
                        {c.status==='active'?'Suspend':'Reactivate'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* REVENUE */}
      {tab === 'revenue' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label:'Monthly Recurring Revenue', value: formatCurrency(revenue.mrr), sub:'from active clients', color:'text-brand-700' },
              { label:'Annual Recurring Revenue', value: formatCurrency(revenue.arr), sub:`₹${(revenue.arr/100000).toFixed(2)}L/year`, color:'text-emerald-700' },
              { label:'Active Clients', value: activeClients.length, sub:`${suspendedClients.length} suspended`, color:'text-surface-800' },
            ].map(({label,value,sub,color}) => (
              <div key={label} className="card p-5">
                <p className="text-xs text-surface-400 mb-2">{label}</p>
                <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
                <p className="text-xs text-surface-400 mt-1">{sub}</p>
              </div>
            ))}
          </div>
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50"><h3 className="font-semibold text-surface-700">Revenue by Client</h3></div>
            <table className="data-table">
              <thead><tr><th>Client</th><th>Plan</th><th>Custom Price</th><th className="text-right">MRR</th><th className="text-right">ARR</th></tr></thead>
              <tbody>
                {clients.filter(c=>c.status==='active').map(c => {
                  const plan = PLANS.find(p=>p.id===c.plan_id)||PLANS[1]
                  const price = c.custom_price || plan.price
                  return (
                    <tr key={c.id}>
                      <td className="font-medium">{c.name}</td>
                      <td><span className="badge bg-brand-50 text-brand-700 border border-brand-200 text-xs">{plan.name}</span></td>
                      <td className="text-xs text-surface-400">{c.custom_price ? formatCurrency(c.custom_price) : '—'}</td>
                      <td className="text-right font-mono font-bold text-brand-700">{formatCurrency(price)}</td>
                      <td className="text-right font-mono text-surface-600">{formatCurrency(price*12)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-50 border-t-2 border-surface-200">
                  <td colSpan={3} className="px-4 py-3 font-bold text-xs text-surface-500 uppercase">Total</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-brand-700">{formatCurrency(revenue.mrr)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">{formatCurrency(revenue.arr)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── ONBOARDING WIZARD ── */}
      <Modal open={wizardOpen} onClose={() => setWizardOpen(false)} title="Onboard New Client" size="lg">
        {/* Step indicator */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center gap-2">
            {ONBOARD_STEPS.map((s,i) => (
              <div key={i} className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-brand-600 text-white ring-4 ring-brand-100' : 'bg-surface-100 text-surface-400'}`}>
                  {i < step ? '✓' : i+1}
                </div>
                <p className={`text-xs font-medium hidden sm:block ${i===step?'text-brand-700':i<step?'text-emerald-600':'text-surface-400'}`}>{s}</p>
                {i < ONBOARD_STEPS.length-1 && <div className={`flex-1 h-0.5 ${i < step ? 'bg-emerald-400' : 'bg-surface-200'}`}/>}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4">
          {/* Step 0: Company details */}
          {step === 0 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="col-span-2 form-group"><label className="label">Company Name *</label><input className="input" value={wizardData.company_name} onChange={e=>setWizardData(p=>({...p,company_name:e.target.value}))} placeholder="Rent N Stay Pvt Ltd" autoFocus /></div>
              <div className="form-group"><label className="label">Contact Person</label><input className="input" value={wizardData.contact_name} onChange={e=>setWizardData(p=>({...p,contact_name:e.target.value}))} /></div>
              <div className="form-group"><label className="label">Phone</label><input className="input" value={wizardData.phone} onChange={e=>setWizardData(p=>({...p,phone:e.target.value}))} /></div>
              <div className="form-group"><label className="label">Email</label><input type="email" className="input" value={wizardData.email} onChange={e=>setWizardData(p=>({...p,email:e.target.value}))} /></div>
              <div className="form-group"><label className="label">City</label><input className="input" value={wizardData.city} onChange={e=>setWizardData(p=>({...p,city:e.target.value}))} placeholder="Bengaluru" /></div>
            </div>
          )}

          {/* Step 1: Plan */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {PLANS.map(plan => (
                  <button key={plan.id} type="button" onClick={()=>setWizardData(p=>({...p,plan_id:plan.id}))}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${wizardData.plan_id===plan.id?'border-brand-500 bg-brand-50':'border-surface-200 hover:border-brand-300'}`}>
                    <p className="font-bold text-surface-800">{plan.name}</p>
                    <p className="text-xl font-mono font-bold text-brand-700 mt-1">₹{plan.price.toLocaleString('en-IN')}<span className="text-xs text-surface-400 font-normal">/mo</span></p>
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-surface-500">🏢 {plan.buildings===999?'Unlimited':plan.buildings} buildings</p>
                      <p className="text-xs text-surface-500">👤 {plan.tenants===9999?'Unlimited':plan.tenants} tenants</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="form-group"><label className="label">Custom Price (optional — overrides plan price)</label>
                <div className="flex items-center gap-2">
                  <span className="text-surface-500">₹</span>
                  <input type="number" className="input" value={wizardData.custom_price} onChange={e=>setWizardData(p=>({...p,custom_price:e.target.value}))} placeholder={PLANS.find(p=>p.id===wizardData.plan_id)?.price.toString()} />
                  <span className="text-xs text-surface-400">/month</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Admin user */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="p-3 bg-brand-50 border border-brand-200 rounded-lg text-xs text-brand-700">
                Creating the admin login for <strong>{wizardData.company_name}</strong>. Share these credentials with the client.
              </div>
              <div className="form-group"><label className="label">Admin Name</label><input className="input" value={wizardData.admin_name} onChange={e=>setWizardData(p=>({...p,admin_name:e.target.value}))} placeholder="Ravi Kumar" autoFocus /></div>
              <div className="form-group"><label className="label">Admin Email *</label><input type="email" className="input" value={wizardData.admin_email} onChange={e=>setWizardData(p=>({...p,admin_email:e.target.value}))} /></div>
              <div className="form-group">
                <label className="label">Password *</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input type={showPassword?'text':'password'} className="input pr-10 font-mono" value={wizardData.admin_password} onChange={e=>setWizardData(p=>({...p,admin_password:e.target.value}))} />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}</button>
                  </div>
                  <button onClick={generatePassword} className="btn-secondary btn-sm whitespace-nowrap">Generate</button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="p-4 bg-surface-50 rounded-xl border border-surface-200 space-y-3 text-sm">
                <h4 className="font-semibold text-surface-800">Confirm Client Details</h4>
                {[
                  ['Company', wizardData.company_name],
                  ['Contact', `${wizardData.contact_name} · ${wizardData.phone}`],
                  ['Email', wizardData.email],
                  ['Plan', `${PLANS.find(p=>p.id===wizardData.plan_id)?.name} — ₹${(wizardData.custom_price||PLANS.find(p=>p.id===wizardData.plan_id)?.price).toLocaleString('en-IN')}/mo`],
                  ['Admin Login', wizardData.admin_email],
                ].map(([k,v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-surface-400">{k}</span>
                    <span className="font-medium text-surface-800">{v}</span>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-sm font-semibold text-emerald-800 mb-2">Credentials to share with client:</p>
                <div className="font-mono text-sm space-y-1 text-emerald-700">
                  <p>URL: https://app.cashmyrent.com</p>
                  <p>Email: {wizardData.admin_email}</p>
                  <p>Password: {wizardData.admin_password}</p>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(`URL: https://app.cashmyrent.com\nEmail: ${wizardData.admin_email}\nPassword: ${wizardData.admin_password}`); toast.success('Copied!') }}
                  className="flex items-center gap-1.5 text-xs text-emerald-700 mt-2 hover:underline">
                  <Copy className="w-3 h-3"/> Copy credentials
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex justify-between">
          <button className="btn-secondary" onClick={() => step === 0 ? setWizardOpen(false) : setStep(s=>s-1)}>
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          {step < 3 ? (
            <button className="btn-primary" onClick={() => {
              if (step===0 && !wizardData.company_name) return toast.error('Company name required')
              if (step===2 && (!wizardData.admin_email || !wizardData.admin_password)) return toast.error('Email and password required')
              setStep(s=>s+1)
            }}>Next →</button>
          ) : (
            <button className="btn-primary flex items-center gap-2" onClick={launchClient} disabled={saving}>
              {saving ? <Spinner size={16}/> : <><Zap className="w-4 h-4"/> Launch Client</>}
            </button>
          )}
        </div>
      </Modal>
    </div>
  )
}
