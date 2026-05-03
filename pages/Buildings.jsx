import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, FLAT_STATUSES } from '@/utils/helpers'
import { Modal, Badge, EmptyState, Spinner, ConfirmDialog, SearchInput } from '@/components/ui'
import { Building2, Plus, ChevronDown, ChevronRight, Edit2, Trash2, Home } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

const FLAT_STATUS_OPTIONS = ['occupied', 'vacant', 'maintenance']

export default function Buildings() {
  const { profile } = useAuth()
  const [buildings, setBuildings] = useState([])
  const [owners, setOwners] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedBuilding, setExpandedBuilding] = useState(null)
  const [flats, setFlats] = useState({}) // buildingId -> flats[]

  // Modals
  const [buildingModal, setBuildingModal] = useState(false)
  const [flatModal, setFlatModal] = useState({ open: false, buildingId: null })
  const [editBuilding, setEditBuilding] = useState(null)
  const [editFlat, setEditFlat] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [saving, setSaving] = useState(false)

  const [bForm, setBForm] = useState(defaultBuildingForm())
  const [fForm, setFFform] = useState(defaultFlatForm())

  useEffect(() => { loadBuildings(); loadOwners() }, [])

  function defaultBuildingForm() {
    return { name: '', address: '', area: '', city: 'Bangalore', owner_id: '', total_flats: '', monthly_rent_to_owner: '', security_deposit_cash: '', security_deposit_bank: '', lease_start_date: '', lease_end_date: '', notes: '' }
  }

  function defaultFlatForm() {
    return { door_number: '', floor_number: '', flat_type: '', area_sqft: '', monthly_rent: '', security_deposit_months: 2, status: 'vacant', notes: '' }
  }

  async function loadBuildings() {
    setLoading(true)
    const { data } = await supabase.from('buildings').select('*, owner:owners(name)').eq('is_active', true).order('name')
    setBuildings(data || [])
    setLoading(false)
  }

  async function loadOwners() {
    const { data } = await supabase.from('owners').select('id, name').eq('is_active', true).order('name')
    setOwners(data || [])
  }

  async function loadFlats(buildingId) {
    const { data } = await supabase.from('flats').select('*, tenant:tenants(full_name, phone)').eq('building_id', buildingId).order('door_number')
    setFlats(prev => ({ ...prev, [buildingId]: data || [] }))
  }

  async function toggleBuilding(id) {
    if (expandedBuilding === id) { setExpandedBuilding(null); return }
    setExpandedBuilding(id)
    if (!flats[id]) await loadFlats(id)
  }

  function openAddBuilding() {
    setEditBuilding(null)
    setBForm(defaultBuildingForm())
    setBuildingModal(true)
  }

  function openEditBuilding(b) {
    setEditBuilding(b)
    setBForm({ name: b.name, address: b.address, area: b.area || '', city: b.city || 'Bangalore', owner_id: b.owner_id || '', total_flats: b.total_flats || '', monthly_rent_to_owner: b.monthly_rent_to_owner || '', security_deposit_cash: b.security_deposit_cash || '', security_deposit_bank: b.security_deposit_bank || '', lease_start_date: b.lease_start_date || '', lease_end_date: b.lease_end_date || '', notes: b.notes || '' })
    setBuildingModal(true)
  }

  async function saveBuilding() {
    if (!bForm.name || !bForm.address) return toast.error('Name and address are required')
    setSaving(true)
    const payload = { ...bForm, monthly_rent_to_owner: parseFloat(bForm.monthly_rent_to_owner) || 0, security_deposit_cash: parseFloat(bForm.security_deposit_cash) || 0, security_deposit_bank: parseFloat(bForm.security_deposit_bank) || 0, total_flats: parseInt(bForm.total_flats) || 0, created_by: profile?.id }
    if (!payload.owner_id) delete payload.owner_id

    const { error } = editBuilding
      ? await supabase.from('buildings').update(payload).eq('id', editBuilding.id)
      : await supabase.from('buildings').insert(payload)

    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editBuilding ? 'Building updated' : 'Building added')
    setBuildingModal(false)
    loadBuildings()
  }

  function openAddFlat(buildingId) {
    setEditFlat(null)
    setFFform(defaultFlatForm())
    setFlatModal({ open: true, buildingId })
  }

  function openEditFlat(flat) {
    setEditFlat(flat)
    setFFform({ door_number: flat.door_number, floor_number: flat.floor_number || '', flat_type: flat.flat_type || '', area_sqft: flat.area_sqft || '', monthly_rent: flat.monthly_rent, security_deposit_months: flat.security_deposit_months || 2, status: flat.status, notes: flat.notes || '' })
    setFlatModal({ open: true, buildingId: flat.building_id })
  }

  async function saveFlat() {
    if (!fForm.door_number || !fForm.monthly_rent) return toast.error('Door number and rent are required')
    setSaving(true)
    const payload = { ...fForm, building_id: flatModal.buildingId, monthly_rent: parseFloat(fForm.monthly_rent) || 0, area_sqft: parseFloat(fForm.area_sqft) || null, floor_number: parseInt(fForm.floor_number) || null }

    const { error } = editFlat
      ? await supabase.from('flats').update(payload).eq('id', editFlat.id)
      : await supabase.from('flats').insert(payload)

    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editFlat ? 'Flat updated' : 'Flat added')
    setFlatModal({ open: false, buildingId: null })
    loadFlats(flatModal.buildingId)
  }

  async function deleteBuilding(id) {
    const { error } = await supabase.from('buildings').update({ is_active: false }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Building removed')
    setDeleteConfirm(null)
    loadBuildings()
  }

  const filtered = buildings.filter(b => b.name.toLowerCase().includes(search.toLowerCase()) || b.address.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Buildings & Flats</h2>
          <p className="text-surface-500 text-sm mt-1">{buildings.length} active buildings</p>
        </div>
        <div className="flex items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search buildings…" />
          <button className="btn-primary" onClick={openAddBuilding}>
            <Plus size={16} /> Add Building
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Building2} title="No buildings yet" description="Add your first building to get started" action={<button className="btn-primary" onClick={openAddBuilding}><Plus size={16} /> Add Building</button>} />
      ) : (
        <div className="space-y-3">
          {filtered.map(building => (
            <div key={building.id} className="card overflow-hidden">
              {/* Building Header */}
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-surface-800/30 transition-colors"
                onClick={() => toggleBuilding(building.id)}
              >
                <div className="w-10 h-10 bg-brand-500/15 rounded-xl flex items-center justify-center shrink-0">
                  <Building2 size={18} className="text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-surface-100 text-base">{building.name}</h3>
                    {building.area && <Badge variant="default">{building.area}</Badge>}
                  </div>
                  <p className="text-surface-500 text-sm truncate">{building.address}</p>
                </div>
                <div className="hidden md:flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="text-surface-600 text-xs">Owner Rent</p>
                    <p className="text-surface-200 font-semibold">{formatCurrency(building.monthly_rent_to_owner)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-surface-600 text-xs">Total Flats</p>
                    <p className="text-surface-200 font-semibold">{building.total_flats}</p>
                  </div>
                  {building.owner && (
                    <div className="text-center">
                      <p className="text-surface-600 text-xs">Owner</p>
                      <p className="text-surface-200 font-semibold">{building.owner.name}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <button className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEditBuilding(building) }}><Edit2 size={14} /></button>
                  <button className="btn-ghost btn-sm text-expense hover:text-expense" onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: building.id, name: building.name }) }}><Trash2 size={14} /></button>
                  {expandedBuilding === building.id ? <ChevronDown size={16} className="text-surface-500" /> : <ChevronRight size={16} className="text-surface-500" />}
                </div>
              </div>

              {/* Flats List */}
              {expandedBuilding === building.id && (
                <div className="border-t border-surface-800 animate-fade-in">
                  <div className="flex items-center justify-between px-4 py-3 bg-surface-800/30">
                    <p className="text-surface-400 text-sm font-medium">Flats in {building.name}</p>
                    <button className="btn-secondary btn-sm" onClick={() => openAddFlat(building.id)}>
                      <Plus size={13} /> Add Flat
                    </button>
                  </div>
                  <div className="table-container">
                    {!flats[building.id] ? (
                      <div className="py-8 flex justify-center"><Spinner /></div>
                    ) : flats[building.id].length === 0 ? (
                      <div className="py-8 text-center text-surface-600 text-sm">No flats added yet</div>
                    ) : (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Door No.</th>
                            <th>Floor</th>
                            <th>Type</th>
                            <th>Monthly Rent</th>
                            <th>Deposit Months</th>
                            <th>Status</th>
                            <th>Current Tenant</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {flats[building.id].map(flat => {
                            const st = FLAT_STATUSES[flat.status]
                            return (
                              <tr key={flat.id}>
                                <td className="font-semibold text-surface-100">{flat.door_number}</td>
                                <td>{flat.floor_number ?? '—'}</td>
                                <td>{flat.flat_type || '—'}</td>
                                <td className="amount-neutral">{formatCurrency(flat.monthly_rent)}</td>
                                <td>{flat.security_deposit_months}M</td>
                                <td>
                                  <span className={`badge ${st?.bg || 'bg-surface-700'} ${st?.color || 'text-surface-400'}`}>
                                    {st?.label || flat.status}
                                  </span>
                                </td>
                                <td>{flat.tenant?.full_name || <span className="text-surface-600">Vacant</span>}</td>
                                <td>
                                  <button className="btn-ghost btn-sm" onClick={() => openEditFlat(flat)}><Edit2 size={13} /></button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Building Modal */}
      <Modal open={buildingModal} onClose={() => setBuildingModal(false)} title={editBuilding ? 'Edit Building' : 'Add Building'} size="lg">
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group sm:col-span-2">
            <label className="label">Building Name *</label>
            <input className="input" value={bForm.name} onChange={e => setBForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Sunrise Apartments" />
          </div>
          <div className="form-group sm:col-span-2">
            <label className="label">Address *</label>
            <input className="input" value={bForm.address} onChange={e => setBForm(p => ({ ...p, address: e.target.value }))} placeholder="Full address" />
          </div>
          <div className="form-group">
            <label className="label">Area / Locality</label>
            <input className="input" value={bForm.area} onChange={e => setBForm(p => ({ ...p, area: e.target.value }))} placeholder="e.g. Indiranagar" />
          </div>
          <div className="form-group">
            <label className="label">City</label>
            <input className="input" value={bForm.city} onChange={e => setBForm(p => ({ ...p, city: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Building Owner</label>
            <select className="select" value={bForm.owner_id} onChange={e => setBForm(p => ({ ...p, owner_id: e.target.value }))}>
              <option value="">— Select owner —</option>
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Total Flats</label>
            <input type="number" className="input" value={bForm.total_flats} onChange={e => setBForm(p => ({ ...p, total_flats: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="label">Monthly Rent to Owner (₹)</label>
            <input type="number" className="input" value={bForm.monthly_rent_to_owner} onChange={e => setBForm(p => ({ ...p, monthly_rent_to_owner: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="label">Security Deposit – Cash (₹)</label>
            <input type="number" className="input" value={bForm.security_deposit_cash} onChange={e => setBForm(p => ({ ...p, security_deposit_cash: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="label">Security Deposit – Bank (₹)</label>
            <input type="number" className="input" value={bForm.security_deposit_bank} onChange={e => setBForm(p => ({ ...p, security_deposit_bank: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="label">Lease Start Date</label>
            <input type="date" className="input" value={bForm.lease_start_date} onChange={e => setBForm(p => ({ ...p, lease_start_date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Lease End Date</label>
            <input type="date" className="input" value={bForm.lease_end_date} onChange={e => setBForm(p => ({ ...p, lease_end_date: e.target.value }))} />
          </div>
          <div className="form-group sm:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input min-h-[80px] resize-none" value={bForm.notes} onChange={e => setBForm(p => ({ ...p, notes: e.target.value }))} placeholder="Any additional notes…" />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setBuildingModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveBuilding} disabled={saving}>{saving ? <Spinner size={16} /> : (editBuilding ? 'Update Building' : 'Add Building')}</button>
        </div>
      </Modal>

      {/* Flat Modal */}
      <Modal open={flatModal.open} onClose={() => setFlatModal({ open: false, buildingId: null })} title={editFlat ? 'Edit Flat' : 'Add Flat'} size="md">
        <div className="p-6 grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Door Number *</label>
            <input className="input" value={fForm.door_number} onChange={e => setFFform(p => ({ ...p, door_number: e.target.value }))} placeholder="e.g. A-101" />
          </div>
          <div className="form-group">
            <label className="label">Floor</label>
            <input type="number" className="input" value={fForm.floor_number} onChange={e => setFFform(p => ({ ...p, floor_number: e.target.value }))} placeholder="1" />
          </div>
          <div className="form-group">
            <label className="label">Flat Type</label>
            <select className="select" value={fForm.flat_type} onChange={e => setFFform(p => ({ ...p, flat_type: e.target.value }))}>
              <option value="">— Select —</option>
              {['Studio', '1RK', '1BHK', '2BHK', '3BHK', '4BHK'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Area (sq ft)</label>
            <input type="number" className="input" value={fForm.area_sqft} onChange={e => setFFform(p => ({ ...p, area_sqft: e.target.value }))} placeholder="450" />
          </div>
          <div className="form-group">
            <label className="label">Monthly Rent (₹) *</label>
            <input type="number" className="input" value={fForm.monthly_rent} onChange={e => setFFform(p => ({ ...p, monthly_rent: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="label">Deposit Months</label>
            <input type="number" className="input" value={fForm.security_deposit_months} onChange={e => setFFform(p => ({ ...p, security_deposit_months: e.target.value }))} placeholder="2" min="1" max="12" />
          </div>
          <div className="form-group col-span-2">
            <label className="label">Status</label>
            <select className="select" value={fForm.status} onChange={e => setFFform(p => ({ ...p, status: e.target.value }))}>
              {FLAT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{FLAT_STATUSES[s]?.label || s}</option>)}
            </select>
          </div>
          <div className="form-group col-span-2">
            <label className="label">Notes</label>
            <textarea className="input min-h-[70px] resize-none" value={fForm.notes} onChange={e => setFFform(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setFlatModal({ open: false, buildingId: null })}>Cancel</button>
          <button className="btn-primary" onClick={saveFlat} disabled={saving}>{saving ? <Spinner size={16} /> : (editFlat ? 'Update Flat' : 'Add Flat')}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} onConfirm={() => deleteBuilding(deleteConfirm?.id)} title="Remove Building" message={`Remove "${deleteConfirm?.name}"? This won't delete tenant or payment data.`} danger />
    </div>
  )
}
