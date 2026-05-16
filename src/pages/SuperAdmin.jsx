import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, lastNMonths } from '@/utils/helpers'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'
import { Modal, Spinner, EmptyState } from '@/components/ui'
import {
  Shield, Plus, Building2, Users, CreditCard, CheckCircle2,
  AlertTriangle, Edit2, RefreshCw, TrendingUp, Send, Eye, EyeOff,
  Copy, ChevronDown, ChevronRight, Activity
} from 'lucide-react'

export default function SuperAdmin() {
  const { profile, isPlatformAdmin } = useAuth()
  const [tab, setTab] = useState('dashboard')
  const [orgs, setOrgs] = useState([])
  const [plans, setPlans] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedOrg, setExpandedOrg] = useState(null)
  const [orgDetails, setOrgDetails] = useState({})

  // Modals
  const [orgModal, setOrgModal] = useState(false)
  const [editOrg, setEditOrg] = useState(null)
  const [orgForm, setOrgForm] = useState({ name:'', email:'', phone:'', city:'', plan_id:'', status:'trial' })

  const [userModal, setUserModal] = useState(false)
  const [userForm, setUserForm] = useState({ email:'', full_name:'', password:'', org_id:'', role:'admin' })
  const [showPassword, setShowPassword] = useState(false)
  const [generatedCreds, setGeneratedCreds] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadOrgs(), loadPlans(), loadStats()])
    setLoading(false)
  }

  async function loadOrgs() {
    const { data } = await supabase
      .from('organizations')
      .select('*, plan:plans(display_name, name, price_monthly)')
      .order('created_at', { ascending: false })
    setOrgs(data || [])
  }

  async function loadPlans() {
    const { data } = await supabase.from('plans').select('*').eq('is_active', true).order('sort_order')
    setPlans(data || [])
  }

  async function loadStats() {
    const [
      { count: totalOrgs },
      { count: activeOrgs },
      { count: trialOrgs },
      { data: recentOrgs }
    ] = await Promise.all([
      supabase.from('organizations').select('*', { count:'exact', head:true }),
      supabase.from('organizations').select('*', { count:'exact', head:true }).eq('status', 'active'),
      supabase.from('organizations').select('*', { count:'exact', head:true }).eq('status', 'trial'),
      supabase.from('organizations').select('id, name, created_at, status').order('created_at', { ascending:false }).limit(5),
    ])
    setStats({ totalOrgs:totalOrgs||0, activeOrgs:activeOrgs||0, trialOrgs:trialOrgs||0, recentOrgs:recentOrgs||[] })
  }

  async function loadOrgDetails(orgId) {
    if (orgDetails[orgId]) { setExpandedOrg(orgId); return }
    const [
      { count: buildings },
      { count: tenants },
      { count: flats },
      { data: users },
      { data: collections },
    ] = await Promise.all([
      supabase.from('buildings').select('*', { count:'exact', head:true }).eq('org_id', orgId),
      supabase.from('tenants').select('*', { count:'exact', head:true }).eq('org_id', orgId).eq('status', 'active'),
      supabase.from('flats').select('*', { count:'exact', head:true }).eq('org_id', orgId),
      supabase.from('profiles').select('full_name, email, role, created_at').eq('org_id', orgId),
      supabase.from('rent_collections').select('amount, for_month').eq('org_id', orgId)
        .gte('for_month', new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,7)),
    ])
    const monthRevenue = (collections||[]).reduce((s,c)=>s+Number(c.amount),0)
    setOrgDetails(prev => ({
      ...prev,
      [orgId]: { buildings:buildings||0, tenants:tenants||0, flats:flats||0, users:users||[], monthRevenue }
    }))
    setExpandedOrg(orgId)
  }

  async function saveOrg() {
    if (!orgForm.name || !orgForm.email) return toast.error('Name and email required')
    setSaving(true)
    const slug = orgForm.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now().toString(36)
    const payload = { ...orgForm }
    if (!payload.plan_id) delete payload.plan_id
    const { error } = editOrg
      ? await supabase.from('organizations').update(payload).eq('id', editOrg.id)
      : await supabase.from('organizations').insert({ ...payload, slug })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editOrg ? 'Client updated' : 'Client created')
    setOrgModal(false); loadOrgs(); loadStats()
  }

  async function createUser() {
    if (!userForm.email || !userForm.org_id || !userForm.password) return toast.error('Fill all required fields')
    if (userForm.password.length < 8) return toast.error('Password must be at least 8 characters')
    setSaving(true)
    try {
      // Use Supabase Admin API via Edge Function or direct
      const { data, error } = await supabase.auth.admin.createUser({
        email: userForm.email,
        password: userForm.password,
        email_confirm: true,
        user_metadata: { full_name: userForm.full_name }
      })
      if (error) throw error

      // Update profile
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: userForm.email,
        full_name: userForm.full_name,
        org_id: userForm.org_id,
        role: userForm.role,
        is_platform_admin: false,
      })

      setGeneratedCreds({ email: userForm.email, password: userForm.password, role: userForm.role })
      toast.success('User created successfully!')
      setUserForm({ email:'', full_name:'', password:'', org_id:'', role:'admin' })
    } catch(e) {
      toast.error(e.message)
    }
    setSaving(false)
  }

  function generatePassword() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!'
    const pwd = Array.from({length:12}, ()=>chars[Math.floor(Math.random()*chars.length)]).join('')
    setUserForm(p=>({...p, password:pwd}))
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
    toast.success('Copied!')
  }

  async function updateStatus(id, status) {
    await supabase.from('organizations').update({ status }).eq('id', id)
    toast.success(`Status → ${status}`)
    loadOrgs()
  }

  if (!isPlatformAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="card p-8 text-center max-w-sm">
          <Shield className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-surface-800 mb-2">Platform Admin Only</h2>
          <p className="text-surface-500 text-sm">This section is restricted to the platform owner.</p>
        </div>
      </div>
    )
  }

  const totalMRR = orgs.filter(o=>o.status==='active').reduce((s,o)=>s+Number(o.plan?.price_monthly||0),0)
  const STATUS_C = { active:'bg-emerald-50 text-emerald-700 border-emerald-200', trial:'bg-blue-50 text-blue-700 border-blue-200', suspended:'bg-red-50 text-red-700 border-red-200', cancelled:'bg-surface-100 text-surface-500 border-surface-200' }
  const PLAN_C = { starter:'bg-surface-100 text-surface-600 border-surface-200', growth:'bg-brand-50 text-brand-700 border-brand-200', pro:'bg-amber-50 text-amber-700 border-amber-200' }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-surface-900">Platform Admin</h2>
            <p className="text-xs text-surface-500">CashMyRent Super Admin · {profile?.email}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setUserModal(true); setGeneratedCreds(null) }} className="btn-secondary flex items-center gap-2">
            <Users className="w-4 h-4" /> Create User
          </button>
          <button onClick={() => { setEditOrg(null); setOrgForm({name:'',email:'',phone:'',city:'',plan_id:'',status:'trial'}); setOrgModal(true) }} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Client
          </button>
          <button onClick={loadAll} className="btn-ghost p-2"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200">
        {[['dashboard','Dashboard'],['clients','Clients'],['plans','Plans']].map(([k,l])=>(
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* DASHBOARD TAB */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          {/* MRR cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label:'Monthly Revenue', value:formatCurrency(totalMRR), sub:`${orgs.filter(o=>o.status==='active').length} paying clients`, color:'border-emerald-400' },
              { label:'Annual Run Rate', value:formatCurrency(totalMRR*12), sub:'If all stay active', color:'border-brand-500' },
              { label:'Total Clients', value:stats?.totalOrgs||0, sub:`${stats?.trialOrgs||0} on trial`, color:'border-surface-300' },
              { label:'Active Clients', value:stats?.activeOrgs||0, sub:'Paying subscribers', color:'border-emerald-400' },
            ].map(({label,value,sub,color})=>(
              <div key={label} className={`card p-4 border-l-4 ${color}`}>
                <p className="text-xs text-surface-500 mb-1">{label}</p>
                <p className="text-xl font-bold font-mono text-surface-900">{value}</p>
                <p className="text-xs text-surface-400 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* Recent signups */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center gap-2">
              <Activity className="w-4 h-4 text-surface-400" />
              <h3 className="text-sm font-semibold text-surface-700">Recent Signups</h3>
            </div>
            {(stats?.recentOrgs||[]).map(o=>(
              <div key={o.id} className="flex items-center gap-4 px-5 py-3 border-b border-surface-100 last:border-0">
                <div className="w-8 h-8 bg-brand-100 text-brand-700 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {o.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-surface-800 text-sm">{o.name}</p>
                  <p className="text-xs text-surface-400">{fmtDate(o.created_at)}</p>
                </div>
                <span className={`badge border text-xs ${STATUS_C[o.status]}`}>{o.status}</span>
              </div>
            ))}
          </div>

          {/* Plan breakdown */}
          <div className="grid grid-cols-3 gap-3">
            {plans.map(p=>{
              const clients = orgs.filter(o=>o.plan_id===p.id)
              const mrr = clients.filter(o=>o.status==='active').reduce((s,o)=>s+Number(p.price_monthly),0)
              return (
                <div key={p.id} className="card p-4">
                  <p className="text-xs text-surface-500 mb-1 uppercase tracking-wider">{p.display_name}</p>
                  <p className="text-2xl font-bold text-surface-900">{clients.length}</p>
                  <p className="text-xs text-surface-400 mt-0.5">clients · {formatCurrency(mrr)}/mo</p>
                  <div className="mt-3 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full" style={{width:`${orgs.length>0?(clients.length/orgs.length)*100:0}%`}} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* CLIENTS TAB */}
      {tab === 'clients' && (
        <div className="space-y-3">
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
          : orgs.length === 0 ? <EmptyState icon={Building2} title="No clients yet" />
          : orgs.map(o => (
            <div key={o.id} className="card overflow-hidden">
              {/* Client row */}
              <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-surface-50 transition-colors"
                onClick={() => expandedOrg===o.id ? setExpandedOrg(null) : loadOrgDetails(o.id)}>
                <div className="w-9 h-9 bg-brand-100 text-brand-700 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {o.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-surface-800">{o.name}</p>
                    {o.slug==='rent-n-stay' && <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">Client #1</span>}
                  </div>
                  <p className="text-xs text-surface-400">{o.email} {o.city && `· ${o.city}`}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {o.plan && <span className={`badge border text-xs ${PLAN_C[o.plan.name]}`}>{o.plan.display_name}</span>}
                  <span className={`badge border text-xs ${STATUS_C[o.status]}`}>{o.status}</span>
                  {o.plan && <span className="font-mono text-sm text-emerald-700 font-semibold">{formatCurrency(o.plan.price_monthly)}</span>}
                  {expandedOrg===o.id ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
                </div>
              </div>

              {/* Expanded details */}
              {expandedOrg===o.id && orgDetails[o.id] && (
                <div className="border-t border-surface-100 bg-surface-50/50 px-5 py-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      {l:'Buildings',v:orgDetails[o.id].buildings},
                      {l:'Active Tenants',v:orgDetails[o.id].tenants},
                      {l:'Total Flats',v:orgDetails[o.id].flats},
                      {l:'Last Month Rev',v:formatCurrency(orgDetails[o.id].monthRevenue)},
                    ].map(({l,v})=>(
                      <div key={l} className="bg-white rounded-lg border border-surface-200 p-3">
                        <p className="text-xs text-surface-400">{l}</p>
                        <p className="font-bold text-surface-800 mt-0.5">{v}</p>
                      </div>
                    ))}
                  </div>

                  {/* Users */}
                  {orgDetails[o.id].users.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Users</p>
                      <div className="flex flex-wrap gap-2">
                        {orgDetails[o.id].users.map(u=>(
                          <div key={u.email} className="flex items-center gap-1.5 bg-white border border-surface-200 rounded-lg px-3 py-1.5 text-xs">
                            <div className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs">
                              {(u.full_name||u.email).charAt(0).toUpperCase()}
                            </div>
                            <span className="text-surface-700 font-medium">{u.full_name||u.email}</span>
                            <span className="text-surface-400">{u.role}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={()=>{setEditOrg(o);setOrgForm({name:o.name,email:o.email||'',phone:o.phone||'',city:o.city||'',plan_id:o.plan_id||'',status:o.status});setOrgModal(true)}}
                      className="btn-secondary btn-sm flex items-center gap-1.5"><Edit2 className="w-3.5 h-3.5"/>Edit Client</button>
                    <button onClick={()=>{setUserForm(p=>({...p,org_id:o.id}));setUserModal(true);setGeneratedCreds(null)}}
                      className="btn-secondary btn-sm flex items-center gap-1.5"><Users className="w-3.5 h-3.5"/>Add User</button>
                    {o.status==='trial' && <button onClick={()=>updateStatus(o.id,'active')} className="btn-primary btn-sm flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5"/>Activate</button>}
                    {o.status==='active' && <button onClick={()=>updateStatus(o.id,'suspended')} className="btn-secondary btn-sm flex items-center gap-1.5 text-amber-600"><AlertTriangle className="w-3.5 h-3.5"/>Suspend</button>}
                    {o.status==='suspended' && <button onClick={()=>updateStatus(o.id,'active')} className="btn-primary btn-sm flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5"/>Reactivate</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* PLANS TAB */}
      {tab === 'plans' && (
        <div className="grid sm:grid-cols-3 gap-4">
          {plans.map(p=>{
            const clients=orgs.filter(o=>o.plan_id===p.id)
            const activeMRR=clients.filter(o=>o.status==='active').reduce((s)=>s+Number(p.price_monthly),0)
            return (
              <div key={p.id} className={`card p-6 ${p.name==='growth'?'border-brand-300':''}`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-surface-800 text-lg">{p.display_name}</h3>
                  {p.name==='growth'&&<span className="badge bg-brand-100 text-brand-700 border border-brand-200 text-xs">Popular</span>}
                </div>
                <p className="text-3xl font-bold font-mono text-surface-900 mb-4">{formatCurrency(p.price_monthly)}<span className="text-sm text-surface-400 font-normal">/mo</span></p>
                <div className="space-y-2 text-sm text-surface-600 mb-4">
                  <p>🏢 {p.max_buildings?`Up to ${p.max_buildings} buildings`:'Unlimited buildings'}</p>
                  <p>👥 {p.max_users?`Up to ${p.max_users} users`:'Unlimited users'}</p>
                  <p>🏠 {p.max_tenants?`Up to ${p.max_tenants} tenants`:'Unlimited tenants'}</p>
                  <p>🔍 Audit: {formatCurrency(p.audit_per_building)}/building</p>
                </div>
                <div className="pt-4 border-t border-surface-100 space-y-1 text-xs text-surface-500">
                  <div className="flex justify-between"><span>{clients.length} total clients</span><span>{clients.filter(o=>o.status==='active').length} active</span></div>
                  <div className="flex justify-between"><span>MRR from this plan</span><span className="font-mono text-emerald-700 font-semibold">{formatCurrency(activeMRR)}</span></div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ADD/EDIT ORG MODAL */}
      <Modal open={orgModal} onClose={()=>setOrgModal(false)} title={editOrg?'Edit Client':'Add New Client'} size="md">
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          <div className="form-group col-span-2">
            <label className="label">Business Name *</label>
            <input className="input" value={orgForm.name} onChange={e=>setOrgForm(p=>({...p,name:e.target.value}))} placeholder="ABC Property Management" />
          </div>
          <div className="form-group">
            <label className="label">Email *</label>
            <input type="email" className="input" value={orgForm.email} onChange={e=>setOrgForm(p=>({...p,email:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">Phone</label>
            <input className="input" value={orgForm.phone} onChange={e=>setOrgForm(p=>({...p,phone:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">City</label>
            <input className="input" value={orgForm.city} onChange={e=>setOrgForm(p=>({...p,city:e.target.value}))} placeholder="Bengaluru" />
          </div>
          <div className="form-group">
            <label className="label">Plan</label>
            <select className="select" value={orgForm.plan_id} onChange={e=>setOrgForm(p=>({...p,plan_id:e.target.value}))}>
              <option value="">— Select plan —</option>
              {plans.map(p=><option key={p.id} value={p.id}>{p.display_name} — {formatCurrency(p.price_monthly)}/mo</option>)}
            </select>
          </div>
          <div className="form-group col-span-2">
            <label className="label">Status</label>
            <select className="select" value={orgForm.status} onChange={e=>setOrgForm(p=>({...p,status:e.target.value}))}>
              <option value="trial">Trial</option>
              <option value="active">Active (Paying)</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={()=>setOrgModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveOrg} disabled={saving}>{saving?<Spinner size={16}/>:(editOrg?'Update':'Create Client')}</button>
        </div>
      </Modal>

      {/* CREATE USER MODAL */}
      <Modal open={userModal} onClose={()=>setUserModal(false)} title="Create User Account" size="md">
        <div className="p-6 space-y-4">
          {generatedCreds ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="font-semibold text-emerald-800 mb-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/>User created successfully!</p>
                <p className="text-xs text-emerald-600 mb-3">Share these credentials with the user. Ask them to change their password on first login.</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-emerald-200">
                    <div><p className="text-xs text-surface-400">Email</p><p className="font-mono text-sm text-surface-800">{generatedCreds.email}</p></div>
                    <button onClick={()=>copyToClipboard(generatedCreds.email)} className="btn-ghost p-1.5"><Copy className="w-3.5 h-3.5"/></button>
                  </div>
                  <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-emerald-200">
                    <div><p className="text-xs text-surface-400">Password</p><p className="font-mono text-sm text-surface-800">{generatedCreds.password}</p></div>
                    <button onClick={()=>copyToClipboard(generatedCreds.password)} className="btn-ghost p-1.5"><Copy className="w-3.5 h-3.5"/></button>
                  </div>
                  <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-emerald-200">
                    <div><p className="text-xs text-surface-400">App URL</p><p className="font-mono text-sm text-brand-600">app.cashmyrent.com</p></div>
                    <button onClick={()=>copyToClipboard('https://app.cashmyrent.com')} className="btn-ghost p-1.5"><Copy className="w-3.5 h-3.5"/></button>
                  </div>
                </div>
                <button onClick={()=>copyToClipboard(`CashMyRent Login\nURL: https://app.cashmyrent.com\nEmail: ${generatedCreds.email}\nPassword: ${generatedCreds.password}\nRole: ${generatedCreds.role}`)}
                  className="btn-secondary w-full mt-3 flex items-center justify-center gap-2 text-sm">
                  <Copy className="w-3.5 h-3.5"/> Copy All Credentials
                </button>
              </div>
              <button onClick={()=>{setGeneratedCreds(null);setUserForm({email:'',full_name:'',password:'',org_id:userForm.org_id,role:'admin'})}} className="btn-primary w-full">Create Another User</button>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label className="label">Client / Organization *</label>
                <select className="select" value={userForm.org_id} onChange={e=>setUserForm(p=>({...p,org_id:e.target.value}))}>
                  <option value="">— Select client —</option>
                  {orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="label">Full Name</label>
                  <input className="input" value={userForm.full_name} onChange={e=>setUserForm(p=>({...p,full_name:e.target.value}))} placeholder="Ravi Kumar" />
                </div>
                <div className="form-group">
                  <label className="label">Role</label>
                  <select className="select" value={userForm.role} onChange={e=>setUserForm(p=>({...p,role:e.target.value}))}>
                    <option value="super_admin">Super Admin</option>
                    <option value="admin">Admin</option>
                    <option value="team">Team (collection only)</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="label">Email *</label>
                <input type="email" className="input" value={userForm.email} onChange={e=>setUserForm(p=>({...p,email:e.target.value}))} placeholder="user@company.com" />
              </div>
              <div className="form-group">
                <label className="label">Password *</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input type={showPassword?'text':'password'} className="input pr-10" value={userForm.password}
                      onChange={e=>setUserForm(p=>({...p,password:e.target.value}))} placeholder="Min. 8 characters" />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400"
                      onClick={()=>setShowPassword(s=>!s)}>
                      {showPassword?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
                    </button>
                  </div>
                  <button onClick={generatePassword} className="btn-secondary btn-sm whitespace-nowrap">Generate</button>
                </div>
              </div>
              <div className="p-3 bg-surface-50 rounded-lg text-xs text-surface-500 border border-surface-200">
                The user will be able to log in at <strong>app.cashmyrent.com</strong> with these credentials immediately.
              </div>
              <div className="flex gap-3">
                <button className="btn-secondary flex-1" onClick={()=>setUserModal(false)}>Cancel</button>
                <button className="btn-primary flex-1" onClick={createUser} disabled={saving}>
                  {saving?<Spinner size={16}/>:<><Send className="w-4 h-4 mr-1.5"/>Create User</>}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
