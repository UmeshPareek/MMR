import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Modal, EmptyState, Spinner, ConfirmDialog, SearchInput } from '@/components/ui'
import { Home, Plus, Edit2, Trash2, Phone, Mail, Building2, Banknote } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/utils/helpers'

function avatarColor(name = '') {
  const h = (name.charCodeAt(0) * 7 + (name.charCodeAt(1) || 0) * 13) % 360
  return `hsl(${h}, 50%, 44%)`
}

const defaultForm = () => ({ name: '', phone: '', email: '', address: '', bank_name: '', bank_account: '', bank_ifsc: '', notes: '' })

export default function Owners() {
  const { profile } = useAuth()
  const [owners, setOwners] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editOwner, setEditOwner] = useState(null)
  const [form, setForm] = useState(defaultForm())
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('owners')
      .select('*, buildings(id, name, monthly_rent_to_owner, is_active)')
      .eq('is_active', true)
      .order('name')
    setOwners(data || [])
    setLoading(false)
  }

  function openAdd() { setEditOwner(null); setForm(defaultForm()); setModal(true) }
  function openEdit(o) {
    setEditOwner(o)
    setForm({ name: o.name, phone: o.phone || '', email: o.email || '', address: o.address || '', bank_name: o.bank_name || '', bank_account: o.bank_account || '', bank_ifsc: o.bank_ifsc || '', notes: o.notes || '' })
    setModal(true)
  }

  async function save() {
    if (!form.name) return toast.error('Name is required')
    setSaving(true)
    const { error } = editOwner
      ? await supabase.from('owners').update({ ...form, updated_at: new Date() }).eq('id', editOwner.id)
      : await supabase.from('owners').insert({ ...form, created_by: profile?.id })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editOwner ? 'Owner updated' : 'Owner added')
    setModal(false); load()
  }

  async function doDelete(id) {
    const { error } = await supabase.from('owners').update({ is_active: false }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Owner removed'); setDeleteConfirm(null); load()
  }

  const filtered = owners.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    (o.phone || '').includes(search)
  )

  const totalBuildings = owners.reduce((s, o) => s + (o.buildings?.filter(b => b.is_active)?.length || 0), 0)
  const totalMonthlyRent = owners.reduce((s, o) => s + (o.buildings || []).reduce((bs, b) => bs + (Number(b.monthly_rent_to_owner) || 0), 0), 0)

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Building Owners</h2>
          <p className="text-surface-500 text-sm mt-1">
            {owners.length} owners · {totalBuildings} buildings · {formatCurrency(totalMonthlyRent)}/mo payable
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search owners…" />
          <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Owner</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Home} title="No owners yet" description="Add building owners to track payments" action={<button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Owner</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(o => {
            const activeBuildings = (o.buildings || []).filter(b => b.is_active)
            const monthlyRent = activeBuildings.reduce((s, b) => s + (Number(b.monthly_rent_to_owner) || 0), 0)
            const color = avatarColor(o.name)
            const initials = o.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
            return (
              <div key={o.id} className="card p-5 space-y-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white text-sm flex-shrink-0 shadow-sm"
                      style={{ background: color }}
                    >
                      {initials}
                    </div>
                    <div>
                      <p className="font-semibold text-surface-800">{o.name}</p>
                      <p className="text-surface-500 text-xs">{activeBuildings.length} building{activeBuildings.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1.5 text-surface-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors" onClick={() => openEdit(o)}><Edit2 size={13} /></button>
                    <button className="p-1.5 text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" onClick={() => setDeleteConfirm({ id: o.id, name: o.name })}><Trash2 size={13} /></button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {o.phone && (
                    <a href={`tel:${o.phone}`} className="flex items-center gap-2 text-sm text-surface-500 hover:text-brand-600 transition-colors">
                      <Phone size={13} className="flex-shrink-0" />{o.phone}
                    </a>
                  )}
                  {o.email && (
                    <div className="flex items-center gap-2 text-sm text-surface-400">
                      <Mail size={13} className="flex-shrink-0" />{o.email}
                    </div>
                  )}
                </div>

                {activeBuildings.length > 0 && (
                  <div className="space-y-1">
                    {activeBuildings.slice(0, 3).map(b => (
                      <div key={b.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-surface-500">
                          <Building2 size={11} className="text-surface-300" />
                          {b.name}
                        </div>
                        {b.monthly_rent_to_owner > 0 && (
                          <span className="font-mono text-surface-400">{formatCurrency(b.monthly_rent_to_owner)}/mo</span>
                        )}
                      </div>
                    ))}
                    {activeBuildings.length > 3 && (
                      <p className="text-xs text-surface-400">+{activeBuildings.length - 3} more</p>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-surface-100">
                  {o.bank_name ? (
                    <div className="flex items-center gap-1.5 text-xs text-surface-500">
                      <Banknote size={12} className="text-surface-300" />
                      {o.bank_name} · ••••{o.bank_account?.slice(-4) || '—'}
                    </div>
                  ) : <div />}
                  {monthlyRent > 0 && (
                    <div className="text-xs font-semibold text-emerald-700 font-mono bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      {formatCurrency(monthlyRent)}/mo
                    </div>
                  )}
                </div>

                {/* Edit/delete always accessible via buttons at bottom */}
                <div className="flex gap-2 pt-1">
                  <button className="btn-secondary btn-sm flex-1 flex items-center justify-center gap-1" onClick={() => openEdit(o)}><Edit2 size={12} /> Edit</button>
                  <button className="btn-ghost btn-sm px-3 text-red-400 hover:text-red-600 hover:bg-red-50 border border-surface-200" onClick={() => setDeleteConfirm({ id: o.id, name: o.name })}><Trash2 size={12} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editOwner ? 'Edit Owner' : 'Add Owner'} size="md">
        <div className="p-6 space-y-4">
          <div className="form-group">
            <label className="label">Full Name *</label>
            <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Owner name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="9876543210" />
            </div>
            <div className="form-group">
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Address</label>
            <input className="input" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Bank Name</label>
              <input className="input" value={form.bank_name} onChange={e => setForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="HDFC, SBI…" />
            </div>
            <div className="form-group">
              <label className="label">Account Number</label>
              <input className="input" value={form.bank_account} onChange={e => setForm(p => ({ ...p, bank_account: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">IFSC Code</label>
            <input className="input" value={form.bank_ifsc} onChange={e => setForm(p => ({ ...p, bank_ifsc: e.target.value }))} placeholder="HDFC0001234" />
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea className="input min-h-[70px] resize-none" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner size={16} /> : (editOwner ? 'Update' : 'Add Owner')}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} onConfirm={() => doDelete(deleteConfirm?.id)} title="Remove Owner" message={`Remove "${deleteConfirm?.name}"?`} danger />
    </div>
  )
}
