import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { initials } from '../utils/helpers';
import { Modal, Spinner, EmptyState, Badge } from '../components/ui/index';
import toast from 'react-hot-toast';
import { Settings as SettingsIcon, Users, UserPlus, Pencil, Trash2, Key, User, Shield, Eye, EyeOff, Building2, RefreshCw } from 'lucide-react';

const ROLES = [
  { value: 'super_admin', label: 'Super Admin', desc: 'Full access including Audit', color: 'text-brand-400' },
  { value: 'admin', label: 'Admin', desc: 'All access except Audit', color: 'text-blue-400' },
  { value: 'team', label: 'Team', desc: 'Data entry — payments, expenses, staff', color: 'text-income-400' },
];

const roleBadge = (role) => {
  const map = {
    super_admin: 'bg-brand-400/20 text-brand-400 border border-brand-400/30',
    admin: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    team: 'bg-income-500/20 text-income-400 border border-income-500/30',
  };
  const labels = { super_admin: 'Super Admin', admin: 'Admin', team: 'Team' };
  return <span className={`badge ${map[role] || ''}`}>{labels[role] || role}</span>;
};

export default function Settings() {
  const { profile, isSuperAdmin, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('users');

  // Modals
  const [showInvite, setShowInvite] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [editUser, setEditUser] = useState(null);

  // Forms
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', role: 'team', password: '' });
  const [editForm, setEditForm] = useState({ full_name: '', role: 'team' });
  const [pwdForm, setPwdForm] = useState({ current: '', newPwd: '', confirm: '' });
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (isSuperAdmin() || isAdmin()) fetchUsers(); }, []);

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setUsers(data || []);
    setLoading(false);
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteForm.email || !inviteForm.full_name || !inviteForm.password) {
      return toast.error('Fill all fields');
    }
    if (inviteForm.password.length < 8) return toast.error('Password must be 8+ characters');
    setSaving(true);
    try {
      // Create user via Supabase Admin (uses service role in production)
      // In this flow, super admin creates user via signUp then updates profile
      const { data, error } = await supabase.auth.signUp({
        email: inviteForm.email,
        password: inviteForm.password,
        options: {
          data: { full_name: inviteForm.full_name, role: inviteForm.role },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      // Update profile role (trigger creates the profile row)
      if (data.user) {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          email: inviteForm.email,
          full_name: inviteForm.full_name,
          role: inviteForm.role,
        });
      }
      toast.success('User created — they can now log in');
      setShowInvite(false);
      setInviteForm({ email: '', full_name: '', role: 'team', password: '' });
      fetchUsers();
    } catch (err) {
      toast.error(err.message || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(user) {
    setEditUser(user);
    setEditForm({ full_name: user.full_name || '', role: user.role || 'team' });
    setShowEdit(true);
  }

  async function handleEditUser(e) {
    e.preventDefault();
    if (!editForm.full_name) return toast.error('Name is required');
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: editForm.full_name, role: editForm.role })
      .eq('id', editUser.id);
    if (error) toast.error(error.message);
    else {
      toast.success('User updated');
      setShowEdit(false);
      fetchUsers();
    }
    setSaving(false);
  }

  async function handleDeactivate(user) {
    if (!confirm(`Deactivate ${user.full_name}? They will lose access.`)) return;
    const { error } = await supabase
      .from('profiles').update({ is_active: false }).eq('id', user.id);
    if (error) toast.error(error.message);
    else { toast.success('User deactivated'); fetchUsers(); }
  }

  async function handleReactivate(user) {
    const { error } = await supabase
      .from('profiles').update({ is_active: true }).eq('id', user.id);
    if (error) toast.error(error.message);
    else { toast.success('User reactivated'); fetchUsers(); }
  }

  async function handleChangePwd(e) {
    e.preventDefault();
    if (pwdForm.newPwd !== pwdForm.confirm) return toast.error('Passwords do not match');
    if (pwdForm.newPwd.length < 8) return toast.error('Password must be 8+ characters');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwdForm.newPwd });
    if (error) toast.error(error.message);
    else {
      toast.success('Password updated');
      setShowPwd(false);
      setPwdForm({ current: '', newPwd: '', confirm: '' });
    }
    setSaving(false);
  }

  async function handleProfileUpdate(e) {
    e.preventDefault();
    const name = e.target.full_name.value.trim();
    if (!name) return toast.error('Name required');
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name: name }).eq('id', profile.id);
    if (error) toast.error(error.message);
    else toast.success('Profile updated');
    setSaving(false);
  }

  const tabs = [
    ...(isSuperAdmin() || isAdmin() ? [{ id: 'users', label: 'User Management', icon: Users }] : []),
    { id: 'profile', label: 'My Profile', icon: User },
    { id: 'security', label: 'Security', icon: Key },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-surface-50 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-brand-400" /> Settings
        </h1>
        <p className="text-surface-400 text-sm mt-0.5">Manage users, roles, and your account</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-700">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`tab flex items-center gap-2 ${activeTab === t.id ? 'active' : ''}`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-surface-400">{users.length} team members</p>
            <div className="flex gap-2">
              <button onClick={fetchUsers} className="btn-ghost flex items-center gap-1.5 text-sm">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
              {isSuperAdmin() && (
                <button onClick={() => setShowInvite(true)} className="btn-primary flex items-center gap-2">
                  <UserPlus className="w-4 h-4" /> Add User
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Spinner size="lg" /></div>
          ) : users.length === 0 ? (
            <EmptyState icon={<Users className="w-8 h-8" />}
              title="No users found" description="Add team members to get started" />
          ) : (
            <div className="grid gap-3">
              {users.map(u => (
                <div key={u.id} className={`card p-4 flex items-center gap-4 ${!u.is_active ? 'opacity-50' : ''}`}>
                  <div className="w-10 h-10 rounded-full bg-brand-400/20 flex items-center justify-center
                    text-brand-400 font-bold text-sm flex-shrink-0">
                    {initials(u.full_name || u.email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-surface-100">{u.full_name || '—'}</span>
                      {roleBadge(u.role)}
                      {!u.is_active && (
                        <span className="badge bg-surface-700 text-surface-400">Inactive</span>
                      )}
                      {u.id === profile?.id && (
                        <span className="badge bg-brand-400/10 text-brand-400">You</span>
                      )}
                    </div>
                    <p className="text-xs text-surface-500 mt-0.5 truncate">{u.email}</p>
                  </div>
                  {isSuperAdmin() && u.id !== profile?.id && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => openEdit(u)}
                        className="btn-ghost p-2 text-surface-400 hover:text-brand-400">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {u.is_active ? (
                        <button onClick={() => handleDeactivate(u)}
                          className="btn-ghost p-2 text-surface-400 hover:text-expense-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <button onClick={() => handleReactivate(u)}
                          className="btn-ghost p-2 text-surface-400 hover:text-income-400 text-xs">
                          Reactivate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Role legend */}
          <div className="card p-4">
            <h4 className="text-sm font-semibold text-surface-300 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-brand-400" /> Role Permissions
            </h4>
            <div className="space-y-2">
              {ROLES.map(r => (
                <div key={r.value} className="flex items-start gap-3">
                  <span className={`text-sm font-semibold w-24 flex-shrink-0 ${r.color}`}>{r.label}</span>
                  <span className="text-sm text-surface-400">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="max-w-md space-y-6">
          <div className="card p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-brand-400/20 flex items-center justify-center
                text-brand-400 font-bold text-xl">
                {initials(profile?.full_name || profile?.email)}
              </div>
              <div>
                <p className="font-semibold text-surface-100">{profile?.full_name}</p>
                <p className="text-sm text-surface-400">{profile?.email}</p>
                <div className="mt-1">{roleBadge(profile?.role)}</div>
              </div>
            </div>
            <form onSubmit={handleProfileUpdate} className="space-y-4">
              <div>
                <label className="label">Full Name</label>
                <input name="full_name" defaultValue={profile?.full_name} className="input" required />
              </div>
              <div>
                <label className="label">Email</label>
                <input value={profile?.email} className="input opacity-50 cursor-not-allowed" readOnly />
                <p className="text-xs text-surface-500 mt-1">Email cannot be changed</p>
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full">
                {saving ? <Spinner size="sm" /> : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="max-w-md">
          <div className="card p-6 space-y-4">
            <h3 className="font-semibold text-surface-200">Change Password</h3>
            <form onSubmit={handleChangePwd} className="space-y-4">
              <div>
                <label className="label">New Password</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'}
                    value={pwdForm.newPwd}
                    onChange={e => setPwdForm(p => ({ ...p, newPwd: e.target.value }))}
                    className="input pr-10" placeholder="Minimum 8 characters" required />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirm New Password</label>
                <input type={showPass ? 'text' : 'password'}
                  value={pwdForm.confirm}
                  onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))}
                  className="input" placeholder="Repeat new password" required />
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full">
                {saving ? <Spinner size="sm" /> : 'Update Password'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      <Modal open={showInvite} onClose={() => setShowInvite(false)} title="Add Team Member" size="md">
        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <label className="label">Full Name *</label>
            <input className="input" placeholder="e.g. Rahul Sharma"
              value={inviteForm.full_name}
              onChange={e => setInviteForm(p => ({ ...p, full_name: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Email *</label>
            <input type="email" className="input" placeholder="email@example.com"
              value={inviteForm.email}
              onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Role *</label>
            <select className="select" value={inviteForm.role}
              onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}>
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Temporary Password *</label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} className="input pr-10"
                placeholder="Min. 8 characters"
                value={inviteForm.password}
                onChange={e => setInviteForm(p => ({ ...p, password: e.target.value }))} required />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-surface-500 mt-1">Share this password securely. They can change it after login.</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowInvite(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
              {saving ? <Spinner size="sm" /> : <UserPlus className="w-4 h-4" />}
              Create User
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit User" size="sm">
        <form onSubmit={handleEditUser} className="space-y-4">
          <div>
            <label className="label">Full Name *</label>
            <input className="input" value={editForm.full_name}
              onChange={e => setEditForm(p => ({ ...p, full_name: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Role *</label>
            <select className="select" value={editForm.role}
              onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}>
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowEdit(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" /> : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
