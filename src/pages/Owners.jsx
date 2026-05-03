import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Modal, Badge, EmptyState, Spinner, ConfirmDialog, SearchInput } from '@/components/ui'
import { Home, Plus, Edit2, Trash2, Phone, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

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
    const { data } = await supabase.from('owners').select('*, buildings(count)').eq('is_active', true).order('name')
    setOwners(data || [])
    setLoading(false)
  }

  function openAdd() { setEditOwner(null); setForm(defaultForm()); setModal(true) }
  function openEdit(o) { setEditOwner(o); setForm({ name: o.name, phone: o.phone || '', email: o.email || '', address: o.address || '', bank_name: o.bank_name || '', bank_account: o.bank_account || '', bank_ifsc: o.bank_ifsc || '', notes: o.notes || '' }); setModal(true) }

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

  const filtered = owners.filter(o => o.name.toLowerCase().includes(search.toLowerCase()) || (o.phone || '').includes(search))

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Building Owners</h2>
          <p className="text-surface-500 text-sm mt-1">{owners.length} owners</p>
        </div>
        <div className="flex items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search owners…" />
          <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Owner</button>
        </div>
      </div>

      {loading ? <div className="flex justify-center py-20"><Spinner size={32} /></div> : filtered.length === 0 ? (
        <EmptyState icon={Home} title="No owners yet" description="Add building owners to track payments" action={<button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Owner</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(o => (
            <div key={o.id} className="card p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-500/15 flex items-center justify-center text-brand-400 font-semibold text-sm">{o.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <p className="font-semibold text-surface-100">{o.name}</p>
                    <p className="text-surface-500 text-xs">{o.buildings?.[0]?.count || 0} building(s)</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost btn-sm" onClick={() => openEdit(o)}><Edit2 size={13} /></button>
                  <button className="btn-ghost btn-sm text-expense" onClick={() => setDeleteConfirm({ id: o.id, name: o.name })}><Trash2 size={13} /></button>
                </div>
              </div>
              {o.phone && <div className="flex items-center gap-2 text-sm text-surface-400"><Phone size={13} />{o.phone}</div>}
              {o.email && <div className="flex items-center gap-2 text-sm text-surface-400"><Mail size={13} />{o.email}</div>}
              {o.bank_name && (
                <div className="text-xs text-surface-600 bg-surface-800 rounded-lg px-3 py-2">
                  Bank: {o.bank_name} · {o.bank_account ? `••••${o.bank_account.slice(-4)}` : '—'}
                </div>
              )}
            </div>
          ))}
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
