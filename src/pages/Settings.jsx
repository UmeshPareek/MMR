import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/utils/helpers'
import { Modal, Spinner } from '@/components/ui'
import { Settings as SettingsIcon, Plus, Edit2, Trash2, Save, Zap, Droplets, Users, Building2, Star, AlertTriangle, Phone, Mail, Globe } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

export default function Settings() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const [tab, setTab] = useState('rates')
  const [users, setUsers] = useState([])
  const [userModal, setUserModal] = useState(false)
  const [uForm, setUForm] = useState({ email:'', full_name:'', role:'admin', password:'' })
  const [settings, setSettings] = useState({})
  const [buildings, setBuildings] = useState([])
  const [expGroups, setExpGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Danger zone confirm modal
  const [dangerModal, setDangerModal] = useState(null) // { title, table, color }
  const [dangerConfirmText, setDangerConfirmText] = useState('')
  const [dangerRunning, setDangerRunning] = useState(false)

  // Expense group modals
  const [groupModal, setGroupModal] = useState(false)
  const [groupForm, setGroupForm] = useState({ name: '', icon: '📌', color: '#94a3b8' })
  const [editGroup, setEditGroup] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => { if (profile) loadAll() }, [profile?.id])

  async function loadAll() {
    setLoading(true)
    const [{ data: s }, { data: b }, { data: g }, { data: u }] = await Promise.all([
      supabase.from('master_settings').select('*'),
      supabase.from('buildings').select('id, name, is_active, electricity_reading_enabled, water_reading_enabled').order('name'),
      supabase.from('expense_groups').select('*').eq('is_active', true).order('name'),
      profile?.org_id
        ? supabase.from('profiles').select('id, full_name, email, role, created_at').eq('org_id', profile.org_id).order('created_at', { ascending: false })
        : supabase.from('profiles').select('id, full_name, email, role, created_at').order('created_at', { ascending: false }),
    ])
    const settingsMap = {}
    ;(s || []).forEach(r => { settingsMap[r.setting_key] = r.setting_value })
    setSettings(settingsMap)
    setBuildings(b || [])
    setExpGroups(g || [])
    setUsers(u || [])
    setLoading(false)
  }

  async function createUser() {
    if (!uForm.email || !uForm.password) return toast.error('Email and password required')
    if (uForm.password.length < 8) return toast.error('Password must be at least 8 characters')
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          email: uForm.email,
          password: uForm.password,
          full_name: uForm.full_name,
          role: uForm.role,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to create user')
      toast.success('User created ✓ — share credentials via secure channel (not chat/email)')
      setUForm({ email:'', full_name:'', role:'admin', password:'' })
      setUserModal(false)
      loadAll()
    } catch(e) { toast.error(e.message) }
    setSaving(false)
  }

  function generatePassword() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrs23456789@#!'
    setUForm(p=>({...p, password: Array.from({length:12}, ()=>chars[Math.floor(Math.random()*chars.length)]).join('')}))
  }

  async function updateUserRole(id, currentRole, newRole) {
    if (currentRole === 'super_admin' && !profile?.is_platform_admin) {
      return toast.error('Only Platform Admin can modify Super Admin accounts')
    }
    if (newRole === 'super_admin' && !profile?.is_platform_admin) {
      return toast.error('Only Platform Admin can grant Super Admin role')
    }
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success(`Role updated to ${newRole} ✓`); loadAll()
  }

  async function saveSetting(key, value) {
    const { error } = await supabase.from('master_settings')
      .upsert({ setting_key: key, setting_value: String(value), updated_by: profile?.id, updated_at: new Date().toISOString() }, { onConflict: 'setting_key' })
    if (error) return toast.error(error.message)
    toast.success('Setting saved ✓')
    setSettings(p => ({ ...p, [key]: String(value) }))
  }

  async function toggleBuildingReading(buildingId, type, current) {
    const field = type === 'electricity' ? 'electricity_reading_enabled' : 'water_reading_enabled'
    const { error } = await supabase.from('buildings').update({ [field]: !current }).eq('id', buildingId)
    if (error) return toast.error(error.message)
    toast.success(`${type} readings ${!current ? 'enabled' : 'disabled'}`)
    loadAll()
  }

  async function saveGroup() {
    if (!groupForm.name) return toast.error('Name required')
    setSaving(true)
    const payload = { ...groupForm, created_by: profile?.id }
    const { error } = editGroup
      ? await supabase.from('expense_groups').update(payload).eq('id', editGroup.id)
      : await supabase.from('expense_groups').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editGroup ? 'Group updated' : 'Group added ✓')
    setGroupModal(false); setEditGroup(null)
    setGroupForm({ name: '', icon: '📌', color: '#94a3b8' })
    loadAll()
  }

  async function deleteGroup(id) {
    await supabase.from('expense_groups').update({ is_active: false }).eq('id', id)
    toast.success('Group removed')
    setDeleteConfirm(null); loadAll()
  }

  async function executeDangerReset() {
    if (dangerConfirmText !== 'RESET') return toast.error('Type RESET exactly to confirm')
    setDangerRunning(true)
    try {
      if (dangerModal.table === 'ALL') {
        await Promise.all([
          supabase.from('rent_collections').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
          supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
          supabase.from('staff_advances').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
          supabase.from('staff_salaries').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
          supabase.from('utility_bills').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
          supabase.from('meter_readings').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
          supabase.from('owner_payments').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        ])
        toast.success('Full data reset complete')
      } else {
        const { error } = await supabase.from(dangerModal.table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
        if (error) throw error
        toast.success(`${dangerModal.title} complete`)
      }
      setDangerModal(null); setDangerConfirmText('')
    } catch(e) { toast.error('Reset failed: ' + e.message) }
    setDangerRunning(false)
  }

  const RATE_SETTINGS = [
    { key: 'electricity_rate', label: 'Electricity Rate', unit: '₹ per unit', icon: <Zap className="w-4 h-4 text-amber-500" />, desc: 'Used to calculate electricity charges from meter readings' },
    { key: 'water_rate', label: 'Water Rate', unit: '₹ per litre', icon: <Droplets className="w-4 h-4 text-blue-500" />, desc: 'Used to calculate water charges from meter readings' },
    { key: 'incentive_per_flat', label: 'Incentive Per Flat', unit: '₹ per flat filled', icon: <Star className="w-4 h-4 text-emerald-500" />, desc: 'Paid to staff for filling a vacant flat' },
    { key: 'incentive_bonus_threshold', label: 'Bonus Threshold', unit: 'flats', icon: <Star className="w-4 h-4 text-amber-500" />, desc: 'Number of flats to trigger bonus incentive' },
    { key: 'incentive_bonus_amount', label: 'Bonus Amount', unit: '₹ flat bonus', icon: <Star className="w-4 h-4 text-amber-600" />, desc: 'Extra bonus when threshold is crossed' },
  ]

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Master Settings</h2>
          <p className="text-surface-500 text-sm mt-1">Platform-wide configuration — rates, buildings, expense groups</p>
        </div>
      </div>

      <div className="flex border-b border-surface-200 overflow-x-auto">
        {[['rates','Rates & Incentives'],['contact','Org Contact'],['buildings','Building Config'],['groups','Expense Groups'],['users','User Management'],...(isSuperAdmin ? [['danger','⚠️ Danger Zone']] : [])].map(([k,l]) => (
          <button key={k} className={`tab whitespace-nowrap ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {/* RATES */}
      {tab === 'rates' && (
        <div className="space-y-3 max-w-2xl">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            ⚠️ Rate changes apply to future records only — historical entries are not affected.
          </div>
          {RATE_SETTINGS.map(({ key, label, unit, icon, desc }) => (
            <div key={key} className="card p-5 flex items-center gap-4">
              <div className="w-10 h-10 bg-surface-100 rounded-xl flex items-center justify-center flex-shrink-0">{icon}</div>
              <div className="flex-1">
                <p className="font-medium text-surface-800">{label}</p>
                <p className="text-xs text-surface-400 mt-0.5">{desc}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <input type="number" min="0" className="input w-24 py-1.5 text-right font-mono"
                  defaultValue={settings[key] || ''}
                  onBlur={e => { if (Number(e.target.value) >= 0) saveSetting(key, e.target.value) }}
                />
                <span className="text-xs text-surface-400 whitespace-nowrap">{unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ORG CONTACT */}
      {tab === 'contact' && (
        <div className="space-y-3 max-w-2xl">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            These details appear on legal notices, PDF receipts, and other documents generated by the system.
          </div>
          {[
            { key: 'org_phone', label: 'Contact Phone', unit: 'e.g. 9876543210', icon: <Phone className="w-4 h-4 text-brand-500" />, desc: 'Shown on legal notices and PDFs', type: 'text' },
            { key: 'org_email', label: 'Contact Email', unit: 'e.g. info@company.com', icon: <Mail className="w-4 h-4 text-brand-500" />, desc: 'Shown on legal notices and PDFs', type: 'email' },
            { key: 'org_website', label: 'Website / Brand Name', unit: 'e.g. cashmyrent.com', icon: <Globe className="w-4 h-4 text-brand-500" />, desc: 'Shown on legal notices and PDFs', type: 'text' },
          ].map(({ key, label, unit, icon, desc, type }) => (
            <div key={key} className="card p-5 flex items-center gap-4">
              <div className="w-10 h-10 bg-surface-100 rounded-xl flex items-center justify-center flex-shrink-0">{icon}</div>
              <div className="flex-1">
                <p className="font-medium text-surface-800">{label}</p>
                <p className="text-xs text-surface-400 mt-0.5">{desc}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <input type={type} className="input w-52 py-1.5 text-sm"
                  defaultValue={settings[key] || ''}
                  placeholder={unit}
                  onBlur={e => { if (e.target.value.trim()) saveSetting(key, e.target.value.trim()) }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* BUILDINGS CONFIG */}
      {tab === 'buildings' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
            <h3 className="text-sm font-semibold text-surface-700">Enable Meter Readings per Building</h3>
            <p className="text-xs text-surface-400 mt-0.5">Toggle to enable electricity/water reading entry for each building</p>
          </div>
          <table className="data-table">
            <thead><tr><th>Building</th><th className="text-center">Electricity Readings</th><th className="text-center">Water Readings</th></tr></thead>
            <tbody>
              {buildings.map(b => (
                <tr key={b.id}>
                  <td className="font-medium text-surface-800">{b.name}</td>
                  <td className="text-center">
                    <button onClick={() => toggleBuildingReading(b.id, 'electricity', b.electricity_reading_enabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${b.electricity_reading_enabled ? 'bg-brand-500' : 'bg-surface-200'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${b.electricity_reading_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </td>
                  <td className="text-center">
                    <button onClick={() => toggleBuildingReading(b.id, 'water', b.water_reading_enabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${b.water_reading_enabled ? 'bg-blue-500' : 'bg-surface-200'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${b.water_reading_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* EXPENSE GROUPS */}
      {tab === 'groups' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => { setEditGroup(null); setGroupForm({ name:'', icon:'📌', color:'#94a3b8' }); setGroupModal(true) }}
              className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4"/> Add Group</button>
          </div>
          <div className="card overflow-hidden">
            {expGroups.length === 0 ? (
              <div className="p-10 text-center text-surface-400 text-sm">No custom groups yet</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Icon</th><th>Group Name</th><th>Color</th><th></th></tr></thead>
                <tbody>
                  {expGroups.map(g => (
                    <tr key={g.id}>
                      <td className="text-xl">{g.icon}</td>
                      <td className="font-medium text-surface-800">{g.name}</td>
                      <td><div className="w-6 h-6 rounded-full border border-surface-200" style={{ background: g.color }} /></td>
                      <td>
                        <div className="flex gap-1">
                          <button onClick={() => { setEditGroup(g); setGroupForm({ name:g.name, icon:g.icon, color:g.color }); setGroupModal(true) }} className="btn-ghost btn-sm p-1.5"><Edit2 className="w-3.5 h-3.5"/></button>
                          <button onClick={() => setDeleteConfirm(g.id)} className="btn-ghost btn-sm p-1.5 text-red-400"><Trash2 className="w-3.5 h-3.5"/></button>
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

      {/* USERS TAB */}
      {tab === 'users' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => { setUserModal(true) }} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4"/> Add User
            </button>
          </div>
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th><th>Change Role</th></tr></thead>
              <tbody>
                {users
                  .filter(u => {
                    if (u.role === 'super_admin' && !profile?.is_platform_admin) return false
                    return true
                  })
                  .map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold text-xs">{(u.full_name||u.email||'U').charAt(0).toUpperCase()}</div>
                        <span className="font-medium text-surface-800">{u.full_name || '—'}</span>
                      </div>
                    </td>
                    <td className="text-sm text-surface-500">{u.email}</td>
                    <td>
                      <span className={`badge border text-xs ${u.role==='super_admin'?'bg-amber-50 text-amber-700 border-amber-200':u.role==='admin'?'bg-brand-50 text-brand-700 border-brand-200':u.role==='inactive'?'bg-surface-100 text-surface-400 border-surface-200':'bg-surface-100 text-surface-600 border-surface-200'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="text-xs text-surface-400">{u.created_at?.slice(0,10)}</td>
                    <td>
                      {u.id !== profile?.id && (
                        <select className="select py-0.5 text-xs w-32"
                          value={u.role}
                          onChange={e => updateUserRole(u.id, u.role, e.target.value)}>
                          {profile?.is_platform_admin && <option value="super_admin">Super Admin</option>}
                          <option value="admin">Admin</option>
                          <option value="team">Team</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* User creation modal */}
          <Modal open={userModal} onClose={() => setUserModal(false)} title="Create New User" size="sm">
            <div className="p-6 space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                After creation, share credentials via WhatsApp or in-person — not over email or chat.
              </div>
              <div className="form-group"><label className="label">Full Name</label><input className="input" value={uForm.full_name} onChange={e=>setUForm(p=>({...p,full_name:e.target.value}))} placeholder="Ravi Kumar" autoFocus /></div>
              <div className="form-group"><label className="label">Email *</label><input type="email" className="input" value={uForm.email} onChange={e=>setUForm(p=>({...p,email:e.target.value}))} /></div>
              <div className="form-group">
                <label className="label">Role</label>
                <select className="select" value={uForm.role} onChange={e=>setUForm(p=>({...p,role:e.target.value}))}>
                  {profile?.is_platform_admin && <option value="super_admin">Super Admin (full access)</option>}
                  <option value="admin">Admin</option>
                  <option value="team">Team (collection only)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Temporary Password *</label>
                <div className="flex gap-2">
                  <input className="input flex-1 font-mono" value={uForm.password} onChange={e=>setUForm(p=>({...p,password:e.target.value}))} placeholder="Min 8 chars" />
                  <button onClick={generatePassword} className="btn-secondary btn-sm whitespace-nowrap">Generate</button>
                </div>
                <p className="text-xs text-surface-400 mt-1">User should change password after first login.</p>
              </div>
              <div className="flex gap-3">
                <button className="btn-secondary flex-1" onClick={() => setUserModal(false)}>Cancel</button>
                <button className="btn-primary flex-1" onClick={createUser} disabled={saving}>{saving ? <Spinner size={16}/> : 'Create User'}</button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* DANGER ZONE TAB — super_admin only */}
      {tab === 'danger' && isSuperAdmin && (
        <div className="space-y-4 max-w-2xl">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <p className="font-bold mb-1">⚠️ Irreversible Actions</p>
            <p>These actions permanently delete data and cannot be undone. Use with extreme caution.</p>
          </div>

          {[
            { title:'Reset Rent Collections', desc:'Delete all rent collection records. Tenant and flat data is preserved.', table:'rent_collections', color:'amber' },
            { title:'Reset Expenses', desc:'Delete all expense records across all buildings and months.', table:'expenses', color:'amber' },
            { title:'Reset Staff Advances', desc:'Delete all advance, incentive and reimbursement records.', table:'staff_advances', color:'amber' },
            { title:'Reset Salary History', desc:'Delete all salary payment records. Staff profiles are preserved.', table:'staff_salaries', color:'amber' },
            { title:'Reset Utility Bills', desc:'Delete all utility bill payment records.', table:'utility_bills', color:'red' },
            { title:'Reset Meter Readings', desc:'Delete all electricity and water meter readings.', table:'meter_readings', color:'red' },
            { title:'Reset Owner Payments', desc:'Delete all owner rent payment records.', table:'owner_payments', color:'red' },
            { title:'FULL DATA RESET', desc:'⚠️ Deletes ALL records: collections, expenses, salaries, bills, readings, owner payments. Tenants and buildings are preserved.', table:'ALL', color:'red' },
          ].map(({ title, desc, table, color }) => (
            <div key={table} className={`card p-5 border-l-4 ${color==='red'?'border-red-500':'border-amber-400'}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className={`font-semibold ${color==='red'?'text-red-700':'text-surface-800'}`}>{title}</p>
                  <p className="text-xs text-surface-500 mt-1">{desc}</p>
                </div>
                <button
                  onClick={() => { setDangerModal({ title, table, color }); setDangerConfirmText('') }}
                  className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${color==='red'?'border-red-300 text-red-600 hover:bg-red-600 hover:text-white':'border-amber-300 text-amber-700 hover:bg-amber-500 hover:text-white'}`}>
                  Reset
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GROUP MODAL */}
      <Modal open={groupModal} onClose={() => setGroupModal(false)} title={editGroup ? 'Edit Group' : 'Add Expense Group'} size="sm">
        <div className="p-6 space-y-4">
          <div className="form-group">
            <label className="label">Group Name *</label>
            <input className="input" value={groupForm.name} onChange={e => setGroupForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Festival Expenses" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Icon (emoji)</label>
              <input className="input text-center text-2xl" value={groupForm.icon} onChange={e => setGroupForm(p=>({...p,icon:e.target.value}))} maxLength={2} />
            </div>
            <div className="form-group">
              <label className="label">Color</label>
              <input type="color" className="input h-10 p-1 cursor-pointer" value={groupForm.color} onChange={e => setGroupForm(p=>({...p,color:e.target.value}))} />
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setGroupModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveGroup} disabled={saving}>{saving ? <Spinner size={16}/> : 'Save'}</button>
        </div>
      </Modal>

      {/* DELETE GROUP CONFIRM */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold mb-2">Delete group?</h3>
            <p className="text-surface-500 text-sm mb-5">Existing expenses in this group are not affected.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => deleteGroup(deleteConfirm)} className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* DANGER ZONE CONFIRM MODAL */}
      {dangerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-red-700">{dangerModal.title}</h3>
                <p className="text-xs text-surface-500">This action is irreversible</p>
              </div>
            </div>
            <p className="text-sm text-surface-600 mb-4">
              To confirm, type <strong>RESET</strong> in the field below:
            </p>
            <input
              className="input w-full font-mono mb-4"
              placeholder="Type RESET here"
              value={dangerConfirmText}
              onChange={e => setDangerConfirmText(e.target.value)}
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => { setDangerModal(null); setDangerConfirmText('') }} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={executeDangerReset}
                disabled={dangerRunning || dangerConfirmText !== 'RESET'}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
                {dangerRunning ? <Spinner size={16}/> : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
