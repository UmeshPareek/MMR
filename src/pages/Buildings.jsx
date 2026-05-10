import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, FLAT_STATUSES } from '@/utils/helpers'
import { Modal, Badge, EmptyState, Spinner, ConfirmDialog, SearchInput } from '@/components/ui'
import { Building2, Plus, ChevronDown, ChevronRight, Edit2, Trash2, Home, Upload, Download, Lock, AlertTriangle, ExternalLink } from 'lucide-react'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'

const FLAT_STATUS_OPTIONS = ['occupied', 'vacant', 'maintenance']

export default function Buildings() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const bulkRef = useRef()
  const navigate = useNavigate()
  const [buildings, setBuildings] = useState([])
  const [owners, setOwners] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedBuilding, setExpandedBuilding] = useState(null)
  const [flats, setFlats] = useState({})
  const [flatCounts, setFlatCounts] = useState({})
  const [flatFilter, setFlatFilter] = useState({}) // buildingId -> flats[]

  // Modals
  const [buildingModal, setBuildingModal] = useState(false)
  const [flatModal, setFlatModal] = useState({ open: false, buildingId: null })
  const [editBuilding, setEditBuilding] = useState(null)
  const [editFlat, setEditFlat] = useState(null)
  const [bulkPreview, setBulkPreview] = useState(null)
  const [bulkUploading, setBulkUploading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [saving, setSaving] = useState(false)

  const [bForm, setBForm] = useState(defaultBuildingForm())
  const [fForm, setFFform] = useState(defaultFlatForm())

  useEffect(() => {
    loadBuildings()
    loadOwners()

    // Real-time — refresh counts whenever any flat changes
    const channel = supabase.channel('buildings-flats-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flats' }, async () => {
        const { data: bList } = await supabase.from('buildings').select('id').eq('is_active', true)
        loadCounts(bList || [])
        // Also refresh open flat list
        setFlats(prev => {
          // Clear cache so next expand re-fetches fresh data
          const updated = { ...prev }
          return updated
        })
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  function defaultBuildingForm() {
    return { name: '', address: '', area: '', city: 'Bangalore', owner_id: '', total_flats: '', monthly_rent_to_owner: '', security_deposit_cash: '', security_deposit_bank: '', lease_start_date: '', lease_end_date: '', notes: '' }
  }

  function defaultFlatForm() {
    return { door_number: '', floor_number: '', flat_type: '', area_sqft: '', monthly_rent: '', security_deposit_months: 2, status: 'vacant', notes: '' }
  }

  async function loadCounts(bList) {
    if (!bList || bList.length === 0) return
    const bIds = bList.map(b => b.id)
    const { data: flatData } = await supabase.from('flats').select('building_id, status').in('building_id', bIds)
    const counts = {}
    ;(flatData || []).forEach(f => {
      if (!counts[f.building_id]) counts[f.building_id] = { total: 0, occupied: 0, vacant: 0, maintenance: 0 }
      counts[f.building_id].total++
      counts[f.building_id][f.status] = (counts[f.building_id][f.status] || 0) + 1
    })
    setFlatCounts(counts)
  }

  async function loadBuildings() {
    setLoading(true)
    const { data } = await supabase.from('buildings').select('*, owner:owners(name)').eq('is_active', true).order('name')
    const bList = data || []
    setBuildings(bList)
    await loadCounts(bList)
    setLoading(false)
  }

  async function loadOwners() {
    const { data } = await supabase.from('owners').select('id, name').order('name')
    setOwners(data || [])
  }

  async function loadFlats(buildingId) {
    const { data: flatData } = await supabase.from('flats').select('*').eq('building_id', buildingId).order('door_number')
    // Fetch active tenants separately
    const flatIds = (flatData || []).map(f => f.id)
    const { data: tenantData } = flatIds.length
      ? await supabase.from('tenants').select('id, full_name, phone, flat_id').eq('status', 'active').in('flat_id', flatIds)
      : { data: [] }
    const tenantByFlat = {}
    ;(tenantData || []).forEach(t => { tenantByFlat[t.flat_id] = t })
    const data = (flatData || []).map(f => ({ ...f, tenant: tenantByFlat[f.id] || null }))
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
    const payload = {
      ...bForm,
      monthly_rent_to_owner: parseFloat(bForm.monthly_rent_to_owner) || 0,
      security_deposit_cash: parseFloat(bForm.security_deposit_cash) || 0,
      security_deposit_bank: parseFloat(bForm.security_deposit_bank) || 0,
      total_flats: parseInt(bForm.total_flats) || 0,
      lease_start_date: bForm.lease_start_date || null,
      lease_end_date: bForm.lease_end_date || null,
      created_by: profile?.id,
    }
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
    // Rent change requires admin permission
    if (editFlat && parseFloat(fForm.monthly_rent) !== parseFloat(editFlat.monthly_rent)) {
      if (!isAdmin && !isSuperAdmin) {
        return toast.error('Only admin can change rent amount. Contact your admin.')
      }
      // Log the change
      await supabase.from('rent_change_log').insert({
        flat_id: editFlat.id,
        old_rent: editFlat.monthly_rent,
        new_rent: parseFloat(fForm.monthly_rent),
        reason: fForm.notes || 'Rent updated',
        changed_by: profile?.id,
      })
    }
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
    // Refresh counts immediately
    const { data: bList } = await supabase.from('buildings').select('id').eq('is_active', true)
    loadCounts(bList || [])
  }

  async function deleteBuilding(id) {
    const { error } = await supabase.from('buildings').update({ is_active: false }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Building removed')
    setDeleteConfirm(null)
    loadBuildings()
  }


  function downloadBulkTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      { building_name: 'Green Valley', building_address: '12 MG Road, Bangalore', area: 'Koramangala', door_number: 'A-101', floor_number: 1, flat_type: '1BHK', monthly_rent: 12000, status: 'vacant' },
      { building_name: 'Green Valley', building_address: '12 MG Road, Bangalore', area: 'Koramangala', door_number: 'A-102', floor_number: 1, flat_type: '2BHK', monthly_rent: 18000, status: 'vacant' },
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Buildings & Flats')
    XLSX.writeFile(wb, 'MMR_Bulk_Upload_Template.xlsx')
    toast.success('Template downloaded')
  }

  async function handleBulkFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const wb = XLSX.read(ev.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (!rows.length) return toast.error('No data found in file')
        // Validate
        const errors = []
        rows.forEach((r, i) => {
          if (!r.building_name) errors.push(`Row ${i+2}: building_name required`)
          if (!r.door_number) errors.push(`Row ${i+2}: door_number required`)
          if (!r.monthly_rent || isNaN(Number(r.monthly_rent))) errors.push(`Row ${i+2}: valid monthly_rent required`)
        })
        if (errors.length) { toast.error(errors.slice(0,3).join(' | ')); return }
        setBulkPreview(rows)
      }
      reader.readAsBinaryString(file)
    } catch (e) {
      toast.error('Failed to parse file: ' + e.message)
    }
    bulkRef.current.value = ''
  }

  async function confirmBulkUpload() {
    if (!bulkPreview?.length) return
    setBulkUploading(true)
    try {
      // Group by building name
      const buildingMap = {}
      bulkPreview.forEach(r => {
        const key = r.building_name.trim()
        if (!buildingMap[key]) buildingMap[key] = { address: r.building_address || '', area: r.area || '', flats: [] }
        buildingMap[key].flats.push(r)
      })

      let buildingsCreated = 0, flatsCreated = 0
      for (const [name, bData] of Object.entries(buildingMap)) {
        // Upsert building
        let buildingId
        const existing = buildings.find(b => b.name.toLowerCase() === name.toLowerCase())
        if (existing) {
          buildingId = existing.id
        } else {
          const { data: nb, error } = await supabase.from('buildings')
            .insert({ name, address: bData.address, area: bData.area, city: 'Bangalore', created_by: profile?.id })
            .select().single()
          if (error) throw error
          buildingId = nb.id
          buildingsCreated++
        }

        // Insert flats
        const flatPayloads = bData.flats.map(r => ({
          building_id: buildingId,
          door_number: String(r.door_number),
          floor_number: parseInt(r.floor_number) || null,
          flat_type: r.flat_type || null,
          monthly_rent: parseFloat(r.monthly_rent) || 0,
          status: r.status || 'vacant',
        }))
        const { error: fe } = await supabase.from('flats').insert(flatPayloads)
        if (fe) throw fe
        flatsCreated += flatPayloads.length
      }

      toast.success(`Uploaded: ${buildingsCreated} buildings, ${flatsCreated} flats`)
      setBulkPreview(null)
      loadBuildings()
    } catch (e) {
      toast.error('Upload failed: ' + e.message)
    } finally {
      setBulkUploading(false)
    }
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
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-surface-100 transition-colors"
                onClick={() => toggleBuilding(building.id)}
              >
                <div className="w-10 h-10 bg-brand-500/15 rounded-xl flex items-center justify-center shrink-0">
                  <Building2 size={18} className="text-brand-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-surface-800 text-base">{building.name}</h3>
                    {building.area && <Badge variant="default">{building.area}</Badge>}
                  </div>
                  <p className="text-surface-500 text-sm truncate">{building.address}</p>
                </div>
                <div className="hidden md:flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="text-surface-500 text-xs">Owner Rent</p>
                    <p className="text-surface-700 font-semibold">{formatCurrency(building.monthly_rent_to_owner)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-surface-500 text-xs">Total Flats</p>
                    <p className="text-surface-700 font-semibold">{flatCounts[building.id]?.total ?? building.total_flats ?? 0}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-surface-500 text-xs">Occupied</p>
                    <p className="text-emerald-700 font-semibold">{flatCounts[building.id]?.occupied ?? 0}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-surface-500 text-xs">Vacant</p>
                    <p className={(flatCounts[building.id]?.vacant ?? 0) > 0 ? 'text-red-600 font-semibold' : 'text-surface-500 font-semibold'}>
                      {flatCounts[building.id]?.vacant ?? 0}
                    </p>
                  </div>
                  {building.owner && (
                    <div className="text-center">
                      <p className="text-surface-500 text-xs">Owner</p>
                      <p className="text-surface-700 font-semibold">{building.owner.name}</p>
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
                <div className="border-t border-surface-200 animate-fade-in">
                  <div className="flex items-center justify-between px-4 py-3 bg-surface-100">
                    <div className="flex items-center gap-3">
                      <p className="text-surface-400 text-sm font-medium">Flats in {building.name}</p>
                      <div className="flex gap-1">
                        {['all','occupied','vacant','maintenance'].map(s => (
                          <button key={s}
                            onClick={e => { e.stopPropagation(); setFlatFilter(prev => ({...prev, [building.id]: s})) }}
                            className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                              (flatFilter[building.id]||'all') === s
                                ? s==='vacant' ? 'bg-red-500 text-white border-red-500'
                                  : s==='occupied' ? 'bg-emerald-500 text-white border-emerald-500'
                                  : s==='maintenance' ? 'bg-amber-500 text-white border-amber-500'
                                  : 'bg-brand-600 text-white border-brand-600'
                                : 'bg-white text-surface-600 border-surface-300 hover:border-brand-400'
                            }`}>
                            {s==='all'?`All (${(flats[building.id]||[]).length})`:
                             s==='occupied'?`Occupied (${(flats[building.id]||[]).filter(f=>f.status==='occupied').length})`:
                             s==='vacant'?`Vacant (${(flats[building.id]||[]).filter(f=>f.status==='vacant').length})`:
                             `Demo (${(flats[building.id]||[]).filter(f=>f.status==='maintenance').length})`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button className="btn-secondary btn-sm" onClick={() => openAddFlat(building.id)}>
                      <Plus size={13} /> Add Flat
                    </button>
                  </div>
                  <div className="table-container">
                    {!flats[building.id] ? (
                      <div className="py-8 flex justify-center"><Spinner /></div>
                    ) : flats[building.id].length === 0 ? (
                      <div className="py-8 text-center text-surface-500 text-sm">No flats added yet</div>
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
                          {(flats[building.id].filter(flat => { const filter = flatFilter[building.id] || 'all'; return filter === 'all' || flat.status === filter; })).map(flat => {
                            const st = FLAT_STATUSES[flat.status]
                            return (
                              <tr key={flat.id}>
                                <td className="font-semibold text-surface-800">{flat.door_number}</td>
                                <td>{flat.floor_number ?? '—'}</td>
                                <td>{flat.flat_type || '—'}</td>
                                <td className="amount-neutral">{formatCurrency(flat.monthly_rent)}</td>
                                <td>{flat.security_deposit_months}M</td>
                                <td>
                                  <span className={`badge ${st?.bg || 'bg-surface-700'} ${st?.color || 'text-surface-400'}`}>
                                    {st?.label || flat.status}
                                  </span>
                                </td>
                                <td>{flat.tenant?.full_name || <span className="text-surface-500">Vacant</span>}</td>
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
            <div className="relative">
              <input type="number" className={`input ${editFlat && !isAdmin && !isSuperAdmin ? 'opacity-60 cursor-not-allowed' : ''}`} 
                value={fForm.monthly_rent} 
                onChange={e => setFFform(p => ({ ...p, monthly_rent: e.target.value }))} 
                placeholder="0"
                readOnly={editFlat && !isAdmin && !isSuperAdmin}
              />
              {editFlat && !isAdmin && !isSuperAdmin && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <Lock className="w-3.5 h-3.5 text-surface-400" />
                </div>
              )}
            </div>
            {editFlat && !isAdmin && !isSuperAdmin && (
              <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                <AlertTriangle className="w-3 h-3" /> Contact admin to change rent
              </p>
            )}
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


      {/* Bulk Upload Preview */}
      {bulkPreview && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setBulkPreview(null)}>
          <div className="modal-content max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
              <h2 className="font-semibold text-surface-800">Preview — {bulkPreview.length} rows</h2>
              <button onClick={() => setBulkPreview(null)} className="text-surface-400 hover:text-surface-600">
                <span className="text-lg">×</span>
              </button>
            </div>
            <div className="overflow-auto flex-1 p-4">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Building</th>
                    <th>Door No</th>
                    <th>Floor</th>
                    <th>Type</th>
                    <th>Monthly Rent</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkPreview.map((r, i) => (
                    <tr key={i}>
                      <td>{r.building_name}</td>
                      <td className="font-mono">{r.door_number}</td>
                      <td>{r.floor_number || '—'}</td>
                      <td>{r.flat_type || '—'}</td>
                      <td className="font-mono">{formatCurrency(Number(r.monthly_rent) || 0)}</td>
                      <td>{r.status || 'vacant'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-surface-200">
              <button onClick={() => setBulkPreview(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmBulkUpload} disabled={bulkUploading} className="btn-primary flex-1 flex items-center justify-center gap-2">
                {bulkUploading
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Uploading…</>
                  : <><Upload className="w-4 h-4" /> Confirm Upload</>}
              </button>
            </div>
          </div>
        </div>
      )}

            <ConfirmDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} onConfirm={() => deleteBuilding(deleteConfirm?.id)} title="Remove Building" message={`Remove "${deleteConfirm?.name}"? This won't delete tenant or payment data.`} danger />
    </div>

  )
}
