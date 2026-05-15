import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, lastNMonths } from '@/utils/helpers'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'
import { Modal, Spinner, EmptyState } from '@/components/ui'
import {
  Shield, Plus, Building2, Users, CreditCard, CheckCircle2,
  AlertTriangle, XCircle, Edit2, RefreshCw, TrendingUp, Eye,
  Send, Globe, Star
} from 'lucide-react'

const PLAN_COLORS = { starter: 'bg-surface-100 text-surface-600 border-surface-200', growth: 'bg-brand-50 text-brand-700 border-brand-200', pro: 'bg-amber-50 text-amber-700 border-amber-200' }
const STATUS_COLORS = { active: 'bg-emerald-50 text-emerald-700 border-emerald-200', trial: 'bg-blue-50 text-blue-700 border-blue-200', suspended: 'bg-red-50 text-red-700 border-red-200', cancelled: 'bg-surface-100 text-surface-500 border-surface-200' }

export default function SuperAdmin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('orgs')
  const [orgs, setOrgs] = useState([])
  const [plans, setPlans] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const [orgModal, setOrgModal] = useState(false)
  const [editOrg, setEditOrg] = useState(null)
  const [orgForm, setOrgForm] = useState({ name: '', email: '', phone: '', city: '', plan_id: '', status: 'trial', buildings_count: 0 })
  const [saving, setSaving] = useState(false)

  const [inviteModal, setInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', org_id: '', role: 'admin' })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadOrgs(), loadPlans(), loadStats()])
    setLoading(false)
  }

  async function loadOrgs() {
    const { data } = await supabase.from('organizations').select('*, plan:plans(display_name, name, price_monthly)').order('created_at', { ascending: false })
    setOrgs(data || [])
  }

  async function loadPlans() {
    const { data } = await supabase.from('plans').select('*').eq('is_active', true).order('sort_order')
    setPlans(data || [])
  }

  async function loadStats() {
    const [{ count: totalOrgs }, { count: activeOrgs }, { count: trialOrgs }] = await Promise.all([
      supabase.from('organizations').select('*', { count: 'exact', head: true }),
      supabase.from('organizations').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('organizations').select('*', { count: 'exact', head: true }).eq('status', 'trial'),
    ])
    setStats({ totalOrgs: totalOrgs || 0, activeOrgs: activeOrgs || 0, trialOrgs: trialOrgs || 0 })
  }

  async function saveOrg() {
    if (!orgForm.name || !orgForm.email) return toast.error('Name and email required')
    setSaving(true)
    const slug = orgForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const payload = { ...orgForm, slug: editOrg ? editOrg.slug : slug + '-' + Date.now().toString(36) }
    if (!payload.plan_id) delete payload.plan_id
    const { error } = editOrg
      ? await supabase.from('organizations').update(payload).eq('id', editOrg.id)
      : await supabase.from('organizations').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editOrg ? 'Client updated' : 'Client created ✓')
    setOrgModal(false); loadOrgs(); loadStats()
  }

  async function updateOrgStatus(id, status) {
    const { error } = await supabase.from('organizations').update({ status }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success(`Status updated to ${status}`)
    loadOrgs()
  }

  async function sendInvite() {
    if (!inviteForm.email || !inviteForm.org_id) return toast.error('Fill all fields')
    setSaving(true)
    try {
      // Create user via Supabase admin (simplified — in prod use edge function)
      const tempPassword = 'CMR@' + Math.random().toString(36).slice(2, 8).toUpperCase()
      const { data, error } = await supabase.auth.admin.createUser({
        email: inviteForm.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: inviteForm.full_name, role: inviteForm.role }
      })
      if (error) throw error
      // Update profile with org
      await supabase.from('profiles').update({ org_id: inviteForm.org_id, role: inviteForm.role }).eq('id', data.user.id)
      toast.success(`User created! Share credentials: ${inviteForm.email} / ${tempPassword}`)
      setInviteModal(false)
    } catch(e) {
      // Fallback: just create profile record
      toast.error('Could not create user automatically. Please use Supabase Auth to invite manually.')
    }
    setSaving(false)
  }

  const totalMRR = orgs.filter(o => o.status === 'active').reduce((s, o) => s + Number(o.plan?.price_monthly || 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-surface-900">Platform Admin</h2>
            <p className="text-xs text-surface-500">CashMyRent Super Admin — visible only to you</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setEditOrg(null); setOrgForm({ name:'', email:'', phone:'', city:'', plan_id:'', status:'trial', buildings_count:0 }); setOrgModal(true) }}
            className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4"/> Add Client</button>
          <button onClick={() => setInviteModal(true)} className="btn-secondary flex items-center gap-2">
            <Send className="w-4 h-4"/> Invite User
          </button>
        </div>
      </div>

      {/* MRR + stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-4 border-l-4 border-emerald-400">
            <p className="text-xs text-surface-500 mb-1">Monthly Recurring Revenue</p>
            <p className="text-2xl font-bold font-mono text-emerald-700">{formatCurrency(totalMRR)}</p>
            <p className="text-xs text-surface-400">{orgs.filter(o=>o.status==='active').length} paying clients</p>
          </div>
          <div className="card p-4 border-l-4 border-brand-500">
            <p className="text-xs text-surface-500 mb-1">Total Clients</p>
            <p className="text-2xl font-bold text-surface-900">{stats.totalOrgs}</p>
          </div>
          <div className="card p-4 border-l-4 border-blue-400">
            <p className="text-xs text-surface-500 mb-1">On Trial</p>
            <p className="text-2xl font-bold text-blue-600">{stats.trialOrgs}</p>
          </div>
          <div className="card p-4 border-l-4 border-amber-400">
            <p className="text-xs text-surface-500 mb-1">ARR Potential</p>
            <p className="text-2xl font-bold font-mono text-amber-700">{formatCurrency(totalMRR * 12)}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-surface-200">
        {[['orgs','Clients'],['plans','Plans']].map(([key, label]) => (
          <button key={key} className={`tab ${tab===key?'active':''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {/* CLIENTS */}
      {tab === 'orgs' && (
        <div className="card overflow-hidden">
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
          : orgs.length === 0 ? <EmptyState icon={Building2} title="No clients yet" description="Add your first client to get started" />
          : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Client</th><th>Plan</th><th>Status</th><th className="text-center">Buildings</th><th>MRR</th><th>Since</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {orgs.map(o => (
                    <tr key={o.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-brand-100 text-brand-700 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0">
                            {o.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-surface-800">{o.name}
                              {o.slug === 'rent-n-stay' && <span className="ml-2 badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">Client #1</span>}
                            </p>
                            <p className="text-xs text-surface-400">{o.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        {o.plan
                          ? <span className={`badge border text-xs ${PLAN_COLORS[o.plan.name]}`}>{o.plan.display_name}</span>
                          : <span className="text-surface-300 text-xs">—</span>}
                      </td>
                      <td>
                        <span className={`badge border text-xs ${STATUS_COLORS[o.status]}`}>{o.status}</span>
                      </td>
                      <td className="text-center font-semibold text-surface-700">{o.buildings_count || 0}</td>
                      <td className="font-mono font-semibold text-emerald-700">{o.plan ? formatCurrency(o.plan.price_monthly) : '—'}</td>
                      <td className="text-xs text-surface-500">{fmtDate(o.created_at)}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setEditOrg(o); setOrgForm({ name:o.name, email:o.email||'', phone:o.phone||'', city:o.city||'', plan_id:o.plan_id||'', status:o.status, buildings_count:o.buildings_count||0 }); setOrgModal(true) }}
                            className="btn-ghost btn-sm p-1.5"><Edit2 className="w-3.5 h-3.5"/></button>
                          {o.status === 'trial' && (
                            <button onClick={() => updateOrgStatus(o.id, 'active')}
                              className="btn-ghost btn-sm p-1.5 text-emerald-600 hover:text-emerald-700" title="Activate">
                              <CheckCircle2 className="w-3.5 h-3.5"/>
                            </button>
                          )}
                          {o.status === 'active' && (
                            <button onClick={() => updateOrgStatus(o.id, 'suspended')}
                              className="btn-ghost btn-sm p-1.5 text-amber-500 hover:text-amber-700" title="Suspend">
                              <AlertTriangle className="w-3.5 h-3.5"/>
                            </button>
                          )}
                          {o.status === 'suspended' && (
                            <button onClick={() => updateOrgStatus(o.id, 'active')}
                              className="btn-ghost btn-sm p-1.5 text-emerald-600" title="Reactivate">
                              <CheckCircle2 className="w-3.5 h-3.5"/>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PLANS */}
      {tab === 'plans' && (
        <div className="grid sm:grid-cols-3 gap-4">
          {plans.map(p => (
            <div key={p.id} className={`card p-6 ${p.name==='growth'?'border-brand-300 bg-brand-50/30':''}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-surface-800 text-lg">{p.display_name}</h3>
                {p.name==='growth'&&<span className="badge bg-brand-100 text-brand-700 border border-brand-200 text-xs">Most Popular</span>}
              </div>
              <div className="mb-4">
                <span className="text-3xl font-bold font-mono text-surface-900">{formatCurrency(p.price_monthly)}</span>
                <span className="text-surface-500 text-sm">/mo</span>
              </div>
              <div className="space-y-2 text-sm text-surface-600">
                <p>🏢 {p.max_buildings ? `Up to ${p.max_buildings} buildings` : 'Unlimited buildings'}</p>
                <p>👥 {p.max_users ? `Up to ${p.max_users} users` : 'Unlimited users'}</p>
                <p>🏠 {p.max_tenants ? `Up to ${p.max_tenants} tenants` : 'Unlimited tenants'}</p>
                <p>🔍 Audit add-on: ₹{p.audit_per_building?.toLocaleString()}/building</p>
              </div>
              <div className="mt-4 pt-4 border-t border-surface-200">
                <p className="text-xs text-surface-500 font-medium mb-2">Features</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(p.features || {}).filter(([,v])=>v).map(([k]) => (
                    <span key={k} className="text-xs bg-surface-100 text-surface-600 px-2 py-0.5 rounded">{k.replace(/_/g,' ')}</span>
                  ))}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-surface-100 flex justify-between text-xs text-surface-400">
                <span>{orgs.filter(o=>o.plan_id===p.id).length} clients on this plan</span>
                <span>{formatCurrency(orgs.filter(o=>o.plan_id===p.id&&o.status==='active').reduce((s,o)=>s+Number(p.price_monthly),0))} MRR</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADD/EDIT CLIENT MODAL */}
      <Modal open={orgModal} onClose={() => setOrgModal(false)} title={editOrg ? 'Edit Client' : 'Add New Client'} size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group col-span-2">
              <label className="label">Business Name *</label>
              <input className="input" value={orgForm.name} onChange={e => setOrgForm(p => ({ ...p, name: e.target.value }))} placeholder="Rent N Stay Pvt Ltd" />
            </div>
            <div className="form-group">
              <label className="label">Email *</label>
              <input type="email" className="input" value={orgForm.email} onChange={e => setOrgForm(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Phone</label>
              <input className="input" value={orgForm.phone} onChange={e => setOrgForm(p => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">City</label>
              <input className="input" value={orgForm.city} onChange={e => setOrgForm(p => ({ ...p, city: e.target.value }))} placeholder="Bengaluru" />
            </div>
            <div className="form-group">
              <label className="label">No. of Buildings</label>
              <input type="number" className="input" value={orgForm.buildings_count} onChange={e => setOrgForm(p => ({ ...p, buildings_count: parseInt(e.target.value)||0 }))} />
            </div>
            <div className="form-group">
              <label className="label">Plan</label>
              <select className="select" value={orgForm.plan_id} onChange={e => setOrgForm(p => ({ ...p, plan_id: e.target.value }))}>
                <option value="">— Select plan —</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.display_name} — {formatCurrency(p.price_monthly)}/mo</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Status</label>
              <select className="select" value={orgForm.status} onChange={e => setOrgForm(p => ({ ...p, status: e.target.value }))}>
                <option value="trial">Trial</option>
                <option value="active">Active (Paying)</option>
                <option value="suspended">Suspended</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setOrgModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveOrg} disabled={saving}>{saving ? <Spinner size={16}/> : (editOrg ? 'Update' : 'Create Client')}</button>
        </div>
      </Modal>

      {/* INVITE USER MODAL */}
      <Modal open={inviteModal} onClose={() => setInviteModal(false)} title="Invite User to Client" size="sm">
        <div className="p-6 space-y-4">
          <div className="form-group">
            <label className="label">Client *</label>
            <select className="select" value={inviteForm.org_id} onChange={e => setInviteForm(p => ({ ...p, org_id: e.target.value }))}>
              <option value="">— Select client —</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Full Name</label>
            <input className="input" value={inviteForm.full_name} onChange={e => setInviteForm(p => ({ ...p, full_name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Email *</label>
            <input type="email" className="input" value={inviteForm.email} onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Role</label>
            <select className="select" value={inviteForm.role} onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}>
              <option value="super_admin">Super Admin (full access)</option>
              <option value="admin">Admin</option>
              <option value="team">Team (collection only)</option>
            </select>
          </div>
          <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-700 border border-amber-200">
            ⚠️ A temporary password will be generated. Share it with the user and ask them to change it on first login.
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setInviteModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={sendInvite} disabled={saving}>{saving ? <Spinner size={16}/> : 'Create & Invite'}</button>
        </div>
      </Modal>
    </div>
  )
}
