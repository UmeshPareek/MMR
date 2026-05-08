import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { initials } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  Settings as SettingsIcon, Users, UserPlus, Pencil, Trash2,
  Key, User, Shield, Eye, EyeOff, RefreshCw, CheckCircle2
} from 'lucide-react';

const ROLES = [
  { value: 'super_admin', label: 'Super Admin', desc: 'Full access including Audit', color: 'text-brand-500' },
  { value: 'admin', label: 'Admin', desc: 'All features except Audit', color: 'text-blue-400' },
  { value: 'team', label: 'Team', desc: 'Data entry only', color: 'text-green-400' },
];

function RoleBadge({ role }) {
  const map = {
    super_admin: 'bg-brand-500/20 text-brand-500 border border-brand-500/30',
    admin: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    team: 'bg-green-500/20 text-green-400 border border-green-500/30',
  };
  const labels = { super_admin: 'Super Admin', admin: 'Admin', team: 'Team' };
  return <span className={`badge ${map[role] || 'badge'}`}>{labels[role] || role}</span>;
}

export default function Settings() {
  const { profile, isSuperAdmin, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  // Add user form
  const [showAddUser, setShowAddUser] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', full_name: '', role: 'team', password: '' });

  // Edit user
  const [editingId, setEditingId] = useState(null);
  const [editRole, setEditRole] = useState('team');

  // Password change
  const [pwdForm, setPwdForm] = useState({ newPwd: '', confirm: '' });

  useEffect(() => {
    if (isSuperAdmin || isAdmin) fetchUsers();
  }, [isSuperAdmin, isAdmin]);

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active, created_at')
      .order('created_at', { ascending: false });
    if (error) toast.error('Failed to load users: ' + error.message);
    else setUsers(data || []);
    setLoading(false);
  }

  async function handleAddUser(e) {
    e.preventDefault();
    if (!addForm.email || !addForm.full_name || !addForm.password) return toast.error('All fields required');
    if (addForm.password.length < 6) return toast.error('Password must be at least 6 characters');
    setSaving(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: addForm.email,
        password: addForm.password,
        options: { data: { full_name: addForm.full_name, role: addForm.role } },
      });
      if (error) throw error;
      if (data.user) {
        // Upsert profile directly
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: data.user.id,
          email: addForm.email,
          full_name: addForm.full_name,
          role: addForm.role,
          is_active: true,
        });
        if (profileError) console.warn('Profile upsert warning:', profileError.message);
      }
      toast.success('User created successfully');
      setShowAddUser(false);
      setAddForm({ email: '', full_name: '', role: 'team', password: '' });
      setTimeout(fetchUsers, 1000);
    } catch (err) {
      toast.error(err.message || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(userId, newRole) {
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);
    if (error) toast.error('Failed to update role: ' + error.message);
    else {
      toast.success('Role updated');
      setEditingId(null);
      fetchUsers();
    }
  }

  async function handleToggleActive(user) {
    const newStatus = !user.is_active;
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: newStatus })
      .eq('id', user.id);
    if (error) toast.error('Failed: ' + error.message);
    else {
      toast.success(newStatus ? 'User reactivated' : 'User deactivated');
      fetchUsers();
    }
  }

  async function handleChangePwd(e) {
    e.preventDefault();
    if (pwdForm.newPwd !== pwdForm.confirm) return toast.error('Passwords do not match');
    if (pwdForm.newPwd.length < 6) return toast.error('Minimum 6 characters');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwdForm.newPwd });
    if (error) toast.error(error.message);
    else {
      toast.success('Password updated');
      setPwdForm({ newPwd: '', confirm: '' });
    }
    setSaving(false);
  }

  async function handleProfileUpdate(e) {
    e.preventDefault();
    const full_name = e.target.full_name.value.trim();
    if (!full_name) return toast.error('Name required');
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name }).eq('id', profile.id);
    if (error) toast.error(error.message);
    else toast.success('Profile updated');
    setSaving(false);
  }

  const tabs = [
    ...(isSuperAdmin || isAdmin ? [{ id: 'users', label: 'Users', icon: Users }] : []),
    { id: 'profile', label: 'My Profile', icon: User },
    { id: 'security', label: 'Password', icon: Key },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-surface-900 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-brand-500" /> Settings
        </h1>
        <p className="text-surface-400 text-sm mt-0.5">Manage users, roles and your account</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`tab flex items-center gap-2 ${activeTab === t.id ? 'active' : ''}`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ── USERS TAB ── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-surface-400">{users.length} team members</p>
            <div className="flex gap-2">
              <button onClick={fetchUsers} className="btn-ghost flex items-center gap-1.5 text-sm">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
              {isSuperAdmin && (
                <button onClick={() => setShowAddUser(true)} className="btn-primary flex items-center gap-2">
                  <UserPlus className="w-4 h-4" /> Add User
                </button>
              )}
            </div>
          </div>

          {/* Add User Form */}
          {showAddUser && (
            <div className="card p-5 border border-brand-500/30">
              <h3 className="font-semibold text-surface-800 mb-4 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-brand-500" /> New Team Member
              </h3>
              <form onSubmit={handleAddUser} className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Full Name *</label>
                  <input className="input" placeholder="e.g. Rahul Sharma"
                    value={addForm.full_name}
                    onChange={e => setAddForm(p => ({ ...p, full_name: e.target.value }))} required />
                </div>
                <div>
                  <label className="label">Email *</label>
                  <input type="email" className="input" placeholder="email@example.com"
                    value={addForm.email}
                    onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} required />
                </div>
                <div>
                  <label className="label">Role *</label>
                  <select className="select" value={addForm.role}
                    onChange={e => setAddForm(p => ({ ...p, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Password *</label>
                  <div className="relative">
                    <input type={showPass ? 'text' : 'password'} className="input pr-10"
                      placeholder="Min. 6 characters"
                      value={addForm.password}
                      onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))} required />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400">
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="sm:col-span-2 flex justify-end gap-3">
                  <button type="button" onClick={() => setShowAddUser(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                    {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Create User
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Users List */}
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    {isSuperAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className={!u.is_active ? 'opacity-40' : ''}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-500 font-bold text-xs flex-shrink-0">
                            {initials(u.full_name || u.email)}
                          </div>
                          <div>
                            <div className="font-medium text-surface-800 flex items-center gap-2">
                              {u.full_name || '—'}
                              {u.id === profile?.id && <span className="badge bg-brand-500/10 text-brand-500 text-xs">You</span>}
                            </div>
                            <div className="text-xs text-surface-500">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {isSuperAdmin && editingId === u.id ? (
                          <div className="flex items-center gap-2">
                            <select className="select text-xs py-1" value={editRole}
                              onChange={e => setEditRole(e.target.value)}>
                              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                            <button onClick={() => handleRoleChange(u.id, editRole)}
                              className="btn-primary text-xs px-2 py-1">Save</button>
                            <button onClick={() => setEditingId(null)}
                              className="btn-ghost text-xs px-2 py-1">Cancel</button>
                          </div>
                        ) : (
                          <RoleBadge role={u.role} />
                        )}
                      </td>
                      <td>
                        <span className={`badge ${u.is_active ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-surface-700 text-surface-400'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {isSuperAdmin && (
                        <td>
                          {u.id !== profile?.id && (
                            <div className="flex items-center gap-2">
                              <button onClick={() => { setEditingId(u.id); setEditRole(u.role); }}
                                className="btn-ghost p-1.5 text-surface-400 hover:text-brand-500" title="Change role">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleToggleActive(u)}
                                className={`btn-ghost p-1.5 ${u.is_active ? 'text-surface-400 hover:text-red-400' : 'text-surface-400 hover:text-green-400'}`}
                                title={u.is_active ? 'Deactivate' : 'Reactivate'}>
                                {u.is_active ? <Trash2 className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Role Legend */}
          <div className="card p-4">
            <h4 className="text-sm font-semibold text-surface-300 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-brand-500" /> Role Permissions
            </h4>
            <div className="space-y-2">
              {ROLES.map(r => (
                <div key={r.value} className="flex items-start gap-3">
                  <span className={`text-sm font-semibold w-28 flex-shrink-0 ${r.color}`}>{r.label}</span>
                  <span className="text-sm text-surface-400">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── PROFILE TAB ── */}
      {activeTab === 'profile' && (
        <div className="max-w-md">
          <div className="card p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-brand-500/20 flex items-center justify-center text-brand-500 font-bold text-xl">
                {initials(profile?.full_name || profile?.email || 'U')}
              </div>
              <div>
                <p className="font-semibold text-surface-800">{profile?.full_name}</p>
                <p className="text-sm text-surface-400">{profile?.email}</p>
                <div className="mt-1"><RoleBadge role={profile?.role} /></div>
              </div>
            </div>
            <form onSubmit={handleProfileUpdate} className="space-y-4">
              <div>
                <label className="label">Full Name</label>
                <input name="full_name" defaultValue={profile?.full_name} className="input" required />
              </div>
              <div>
                <label className="label">Email</label>
                <input value={profile?.email || ''} className="input opacity-50 cursor-not-allowed" readOnly />
                <p className="text-xs text-surface-500 mt-1">Email cannot be changed here</p>
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── PASSWORD TAB ── */}
      {activeTab === 'security' && (
        <div className="max-w-md">
          <div className="card p-6 space-y-4">
            <h3 className="font-semibold text-surface-700">Change Password</h3>
            <form onSubmit={handleChangePwd} className="space-y-4">
              <div>
                <label className="label">New Password</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} className="input pr-10"
                    placeholder="Minimum 6 characters"
                    value={pwdForm.newPwd}
                    onChange={e => setPwdForm(p => ({ ...p, newPwd: e.target.value }))} required />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirm Password</label>
                <input type={showPass ? 'text' : 'password'} className="input"
                  placeholder="Repeat new password"
                  value={pwdForm.confirm}
                  onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))} required />
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full">
                {saving ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
