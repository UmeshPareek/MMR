import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate, currentMonth } from '@/utils/helpers'
import { Modal, Spinner, EmptyState } from '@/components/ui'
import { Zap, Droplets, Plus, Download, Edit2, Trash2, TrendingUp, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

export default function UtilityBills() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const channelRef = useRef(null)
  const [tab, setTab] = useState('readings')
  const [buildings, setBuildings] = useState([])
  const [flats, setFlats] = useState([])
  const [readings, setReadings] = useState([])
  const [bills, setBills] = useState([])
  const [settings, setSettings] = useState({ electricity_rate: 10, water_rate: 20 })
  const [loading, setLoading] = useState(true)
  const [filterBuilding, setFilterBuilding] = useState('')
  const [filterMonth, setFilterMonth] = useState(currentMonth())
  const [filterType, setFilterType] = useState('electricity')

  // Reading modal
  const [readingModal, setReadingModal] = useState(false)
  const [rForm, setRForm] = useState({ building_id: '', flat_id: '', reading_type: 'electricity', reading_value: '', reading_date: new Date().toISOString().slice(0,10), for_month: currentMonth(), is_common_area: false, notes: '', payment_collected: false, payment_mode: 'cash' })
  const [isFirstReading, setIsFirstReading] = useState(false)
  const [prevReading, setPrevReading] = useState(null)
  const [rFlats, setRFlats] = useState([])
  const [saving, setSaving] = useState(false)

  // Bill modal (bulk building payment)
  const [billModal, setBillModal] = useState(false)
  const [bForm, setBForm] = useState({ building_id: '', utility_type: 'electricity', amount: '', payment_mode: 'upi', for_month: currentMonth(), vendor: '', bill_number: '', payment_date: new Date().toISOString().slice(0,10) })

  const [editReading, setEditReading] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    loadAll()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('utility-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meter_readings' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'utility_bills' }, () => loadAll())
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [filterMonth, filterBuilding, filterType])

  async function loadAll() {
    setLoading(true)
    const [{ data: b }, { data: s }, { data: r }, { data: bl }] = await Promise.all([
      supabase.from('buildings').select('id, name, electricity_reading_enabled, water_reading_enabled').eq('is_active', true).order('name'),
      supabase.from('master_settings').select('setting_key, setting_value'),
      supabase.from('meter_readings').select('*, flat:flats(door_number), building:buildings(name)')
        .eq('for_month', filterMonth)
        .order('reading_date', { ascending: false }),
      supabase.from('utility_bills').select('*, building:buildings(name)')
        .eq('for_month', filterMonth)
        .order('payment_date', { ascending: false }),
    ])
    setBuildings(b || [])
    const sm = {}; (s||[]).forEach(r => { sm[r.setting_key] = parseFloat(r.setting_value) })
    setSettings(sm)
    const filteredR = filterBuilding ? (r||[]).filter(x=>x.building_id===filterBuilding) : (r||[])
    setReadings(filteredR.filter(x => !filterType || x.reading_type === filterType))
    const filteredBl = filterBuilding ? (bl||[]).filter(x=>x.building_id===filterBuilding) : (bl||[])
    setBills(filteredBl)
    setLoading(false)
  }

  async function loadFlats(buildingId) {
    const { data } = await supabase.from('flats').select('id, door_number, status').eq('building_id', buildingId).order('door_number')
    setRFlats(data || [])
  }

  async function loadPrevReading(flatId, type, month) {
    const { data } = await supabase.from('meter_readings')
      .select('reading_value, reading_date, for_month')
      .eq('flat_id', flatId).eq('reading_type', type)
      .lt('for_month', month)
      .order('for_month', { ascending: false }).limit(1)
    if (data && data.length > 0) {
      setPrevReading(data[0])
      setIsFirstReading(false)
    } else {
      // First reading ever — start from 0, allow manual entry
      setPrevReading({ reading_value: '0', for_month: 'first reading' })
      setIsFirstReading(true)
    }
  }

  async function saveReading() {
    if (!rForm.building_id || (!rForm.flat_id && !rForm.is_common_area) || !rForm.reading_value) return toast.error('Fill all required fields')
    setSaving(true)
    const rate = rForm.reading_type === 'electricity' ? (settings.electricity_rate || 10) : (settings.water_rate || 20)
    const payload = {
      building_id: rForm.building_id,
      flat_id: rForm.is_common_area ? null : rForm.flat_id,
      reading_type: rForm.reading_type,
      reading_value: parseFloat(rForm.reading_value),
      previous_reading: parseFloat(prevReading?.reading_value || 0),
      reading_date: rForm.reading_date,
      for_month: rForm.for_month,
      rate_per_unit: rate,
      is_common_area: rForm.is_common_area,
      notes: rForm.notes,
      payment_collected: rForm.payment_collected,
      created_by: profile?.id,
      org_id: profile?.org_id,
    }
    const { error } = editReading
      ? await supabase.from('meter_readings').update(payload).eq('id', editReading.id)
      : await supabase.from('meter_readings').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editReading ? 'Reading updated' : 'Reading saved ✓')
    setReadingModal(false); setEditReading(null)
    setRForm({ building_id:'', flat_id:'', reading_type:'electricity', reading_value:'', reading_date:new Date().toISOString().slice(0,10), for_month:currentMonth(), is_common_area:false, notes:'', payment_collected:false, payment_mode:'cash' })
    setPrevReading(null); setIsFirstReading(false); loadAll()
  }

  async function saveBill() {
    if (!bForm.building_id || !bForm.amount) return toast.error('Building and amount required')
    setSaving(true)
    const { error } = await supabase.from('utility_bills').insert({ ...bForm, amount: parseFloat(bForm.amount), paid_by: profile?.id, org_id: profile?.org_id })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Bill recorded ✓')
    setBillModal(false)
    setBForm({ building_id:'', utility_type:'electricity', amount:'', payment_mode:'upi', for_month:currentMonth(), vendor:'', bill_number:'', payment_date:new Date().toISOString().slice(0,10) })
    loadAll()
  }

  async function deleteReading(id) {
    const { error } = await supabase.from('meter_readings').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Deleted'); setDeleteConfirm(null); loadAll()
  }

  async function downloadExcel() {
    const { utils, writeFile } = await import('xlsx')
    const wb = utils.book_new()
    const rRows = readings.map(r => ({
      Building: r.building?.name, Flat: r.is_common_area ? 'Common Area' : r.flat?.door_number,
      Type: r.reading_type, Month: r.for_month, Date: r.reading_date,
      'Previous Reading': r.previous_reading, 'Current Reading': r.reading_value,
      'Units Consumed': r.units_consumed, 'Rate/Unit': r.rate_per_unit, 'Amount (₹)': r.amount_charged
    }))
    utils.book_append_sheet(wb, utils.json_to_sheet(rRows), 'Meter Readings')
    const bRows = bills.map(b => ({
      Building: b.building?.name, Type: b.utility_type, 'Amount Paid (₹)': b.amount,
      Mode: b.payment_mode, Month: b.for_month, Vendor: b.vendor || '—', 'Bill No': b.bill_number || '—'
    }))
    utils.book_append_sheet(wb, utils.json_to_sheet(bRows), 'Bills Paid')
    writeFile(wb, `Utility_${filterMonth}.xlsx`)
    toast.success('Downloaded')
  }

  // Dashboard stats
  const totalCharged = readings.reduce((s, r) => s + Number(r.amount_charged || 0), 0)
  const totalPaid = bills.reduce((s, b) => s + Number(b.amount || 0), 0)
  const byBuilding = {}
  readings.forEach(r => {
    const bn = r.building?.name || '—'
    if (!byBuilding[bn]) byBuilding[bn] = { charged: 0, units: 0 }
    byBuilding[bn].charged += Number(r.amount_charged || 0)
    byBuilding[bn].units += Number(r.units_consumed || 0)
  })
  const chartData = Object.entries(byBuilding).map(([name, d]) => ({ name: name.slice(0, 10), charged: d.charged }))

  const units = readings.reduce((s, r) => s + Number(r.units_consumed || 0), 0)

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h2 className="page-title">Utility Bills</h2>
          <p className="text-surface-500 text-sm mt-1">Meter readings, charges & payments — {filterMonth}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="month" className="input py-1.5 text-sm" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
          <select className="select py-1.5 text-sm w-36" value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)}>
            <option value="">All Buildings</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button onClick={downloadExcel} className="btn-secondary flex items-center gap-2"><Download className="w-4 h-4"/> Excel</button>
          <button onClick={() => setBillModal(true)} className="btn-secondary flex items-center gap-2">+ Bill Paid</button>
          <button onClick={() => { setEditReading(null); setRForm({ building_id:'', flat_id:'', reading_type:'electricity', reading_value:'', reading_date:new Date().toISOString().slice(0,10), for_month:filterMonth, is_common_area:false, notes:'' }); setPrevReading(null); setReadingModal(true) }} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4"/> Add Reading
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-amber-400">
          <p className="text-xs text-surface-500 mb-1">Total Charged to Tenants</p>
          <p className="text-xl font-bold font-mono text-amber-700">{formatCurrency(totalCharged)}</p>
          <p className="text-xs text-surface-400">{units.toFixed(0)} units consumed</p>
        </div>
        <div className="card p-4 border-l-4 border-red-400">
          <p className="text-xs text-surface-500 mb-1">Bills Paid (to vendors)</p>
          <p className="text-xl font-bold font-mono text-red-600">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="card p-4 border-l-4 border-emerald-400">
          <p className="text-xs text-surface-500 mb-1">Net Position</p>
          <p className={`text-xl font-bold font-mono ${totalCharged - totalPaid >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(Math.abs(totalCharged - totalPaid))}</p>
          <p className="text-xs text-surface-400">{totalCharged - totalPaid >= 0 ? 'surplus' : 'deficit'}</p>
        </div>
        <div className="card p-4 border-l-4 border-brand-400">
          <p className="text-xs text-surface-500 mb-1">Readings This Month</p>
          <p className="text-xl font-bold text-surface-900">{readings.length}</p>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-surface-700 mb-4">Charges by Building</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => formatCurrency(v)} />
              <Bar dataKey="charged" fill="#0D9488" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-surface-200">
        {[['readings','Meter Readings'],['bills','Bills Paid']].map(([k,l]) => (
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {/* Type filter */}
      <div className="flex gap-2">
        {[['electricity','⚡ Electricity'],['water','💧 Water']].map(([v,l]) => (
          <button key={v} onClick={() => setFilterType(v)} className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${filterType===v?'bg-brand-600 text-white border-brand-600':'border-surface-200 text-surface-600 hover:border-brand-300'}`}>{l}</button>
        ))}
      </div>

      {/* READINGS TABLE */}
      {tab === 'readings' && (
        <div className="card overflow-hidden">
          {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
          : readings.length === 0 ? <EmptyState icon={Zap} title="No readings" description="Add meter readings to calculate consumption" />
          : (
            <table className="data-table">
              <thead>
                <tr><th>Building</th><th>Flat</th><th>Type</th><th>Prev Reading</th><th>Current</th><th>Units</th><th>Rate</th><th className="text-right">Amount</th><th>Date</th><th></th></tr>
              </thead>
              <tbody>
                {readings.map(r => (
                  <tr key={r.id}>
                    <td className="text-xs text-surface-500">{r.building?.name}</td>
                    <td className="font-mono font-semibold">{r.is_common_area ? <span className="badge bg-surface-100 text-surface-600 text-xs">Common</span> : r.flat?.door_number}</td>
                    <td>{r.reading_type === 'electricity' ? '⚡' : '💧'}</td>
                    <td className="font-mono text-surface-400">{r.previous_reading}</td>
                    <td className="font-mono font-semibold">{r.reading_value}</td>
                    <td className="font-mono text-brand-700 font-semibold">{Number(r.units_consumed).toFixed(1)}</td>
                    <td className="text-xs text-surface-500">₹{r.rate_per_unit}/u</td>
                    <td className="text-right font-mono font-semibold text-amber-700">{formatCurrency(r.amount_charged)}</td>
                    <td className="text-xs text-surface-500">{fmtDate(r.reading_date)}</td>
                    <td>{r.payment_collected ? <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">Paid</span> : r.is_common_area ? <span className="text-surface-300 text-xs">—</span> : <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">Pending</span>}</td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditReading(r); setRForm({ building_id:r.building_id, flat_id:r.flat_id||'', reading_type:r.reading_type, reading_value:r.reading_value, reading_date:r.reading_date, for_month:r.for_month, is_common_area:r.is_common_area, notes:r.notes||'' }); setPrevReading({ reading_value:r.previous_reading }); loadFlats(r.building_id); setReadingModal(true) }}
                          className="btn-ghost p-1.5"><Edit2 className="w-3.5 h-3.5"/></button>
                        <button onClick={() => setDeleteConfirm({ id: r.id, type: 'reading' })} className="btn-ghost p-1.5 text-red-400"><Trash2 className="w-3.5 h-3.5"/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-50 border-t-2 border-surface-200">
                  <td colSpan={7} className="px-4 py-2 text-xs font-bold text-surface-600">TOTAL</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-amber-700">{formatCurrency(totalCharged)}</td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* BILLS TABLE */}
      {tab === 'bills' && (
        <div className="card overflow-hidden">
          {bills.length === 0 ? <EmptyState icon={Droplets} title="No bills recorded" description="Record utility bills paid to vendors" />
          : (
            <table className="data-table">
              <thead><tr><th>Building</th><th>Type</th><th>Vendor</th><th>Bill No.</th><th>Mode</th><th>Month</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {bills.map(b => (
                  <tr key={b.id}>
                    <td>{b.building?.name}</td>
                    <td>{b.utility_type === 'electricity' ? '⚡ Electricity' : b.utility_type === 'water' ? '💧 Water' : b.utility_type}</td>
                    <td className="text-xs text-surface-500">{b.vendor || '—'}</td>
                    <td className="font-mono text-xs">{b.bill_number || '—'}</td>
                    <td><span className="badge badge-surface text-xs">{b.payment_mode?.toUpperCase()}</span></td>
                    <td className="text-xs text-surface-500">{b.for_month}</td>
                    <td className="text-right font-mono font-bold text-red-600">{formatCurrency(b.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* READING MODAL */}
      <Modal open={readingModal} onClose={() => { setReadingModal(false); setEditReading(null) }} title={editReading ? 'Edit Meter Reading' : 'Add Meter Reading'} size="md">
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Utility Type</label>
            <div className="flex gap-2">
              {[['electricity','⚡ Electricity'],['water','💧 Water']].map(([v,l]) => (
                <button key={v} type="button" onClick={() => setRForm(p=>({...p,reading_type:v}))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${rForm.reading_type===v?'bg-brand-600 text-white border-brand-600':'border-surface-200 text-surface-600'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="label">For Month</label>
            <input type="month" className="input" value={rForm.for_month} onChange={e => setRForm(p=>({...p,for_month:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">Building *</label>
            <select className="select" value={rForm.building_id} onChange={e => { setRForm(p=>({...p,building_id:e.target.value,flat_id:''})); loadFlats(e.target.value) }}>
              <option value="">— Select building —</option>
              {buildings
                .filter(b => rForm.reading_type === 'electricity' ? b.electricity_reading_enabled : b.water_reading_enabled)
                .map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              {buildings.filter(b => rForm.reading_type === 'electricity' ? b.electricity_reading_enabled : b.water_reading_enabled).length === 0 && (
                <option disabled>No buildings have {rForm.reading_type} readings enabled — enable in Settings</option>
              )}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Flat</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-surface-600">
                <input type="checkbox" checked={rForm.is_common_area} onChange={e => setRForm(p=>({...p,is_common_area:e.target.checked,flat_id:''}))} className="rounded" />
                Common Area
              </label>
              {!rForm.is_common_area && (
                <select className="select" value={rForm.flat_id} onChange={e => { setRForm(p=>({...p,flat_id:e.target.value})); if(e.target.value) loadPrevReading(e.target.value,rForm.reading_type,rForm.for_month) }}>
                  <option value="">— Select flat —</option>
                  {rFlats.map(f => <option key={f.id} value={f.id}>{f.door_number}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Previous reading display */}
          {prevReading && (
            <div className={`col-span-2 p-3 rounded-lg border text-sm ${isFirstReading ? 'bg-amber-50 border-amber-200' : 'bg-surface-50 border-surface-200'}`}>
              {isFirstReading ? (
                <p className="text-amber-700 font-medium">⚡ First reading for this flat — enter the opening meter reading below. It will be used as the baseline going forward.</p>
              ) : (
                <>
                  <span className="text-surface-500">Previous reading ({prevReading.for_month}): </span>
                  <span className="font-mono font-bold text-surface-800">{prevReading.reading_value} units</span>
                </>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="label">
              Previous Reading {isFirstReading ? '— enter opening reading' : '(auto-filled from last month)'}
            </label>
            <input type="number" className={`input font-mono ${!isFirstReading && prevReading ? 'bg-surface-50 text-surface-500' : ''}`}
              value={prevReading?.reading_value || '0'}
              readOnly={!isFirstReading && !!prevReading}
              onChange={e => (isFirstReading || !prevReading) && setPrevReading({ reading_value: e.target.value, for_month: 'opening' })} />
          </div>
          <div className="form-group">
            <label className="label">Current Reading *</label>
            <input type="number" className="input font-mono" value={rForm.reading_value} onChange={e => setRForm(p=>({...p,reading_value:e.target.value}))} placeholder="Enter meter reading" autoFocus={!editReading} />
          </div>
          <div className="form-group">
            <label className="label">Reading Date</label>
            <input type="date" className="input" value={rForm.reading_date} onChange={e => setRForm(p=>({...p,reading_date:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <input className="input" value={rForm.notes} onChange={e => setRForm(p=>({...p,notes:e.target.value}))} placeholder="Optional" />
          </div>

          {/* Payment status */}
          {!rForm.is_common_area && (
            <div className="col-span-2">
              <label className="label mb-2">Payment Status</label>
              <div className="flex gap-3">
                <button type="button" onClick={() => setRForm(p=>({...p,payment_collected:false}))}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${!rForm.payment_collected?'border-amber-400 bg-amber-50 text-amber-700':'border-surface-200 text-surface-500'}`}>
                  ⏳ Payment Pending
                </button>
                <button type="button" onClick={() => setRForm(p=>({...p,payment_collected:true}))}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${rForm.payment_collected?'border-emerald-400 bg-emerald-50 text-emerald-700':'border-surface-200 text-surface-500'}`}>
                  ✓ Payment Collected
                </button>
              </div>
              {rForm.payment_collected && (
                <div className="mt-2">
                  <label className="label">Payment Mode</label>
                  <select className="select" value={rForm.payment_mode} onChange={e => setRForm(p=>({...p,payment_mode:e.target.value}))}>
                    {['cash','upi','bank_transfer','other'].map(m=><option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Live calculation preview */}
          {rForm.reading_value && (prevReading || rForm.reading_value > 0) && (
            <div className="col-span-2 p-4 bg-brand-50 rounded-xl border border-brand-200">
              <p className="text-sm font-semibold text-brand-800 mb-2">Calculation Preview</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {(() => {
                  const units = Math.max(0, parseFloat(rForm.reading_value || 0) - parseFloat(prevReading?.reading_value || 0))
                  const rate = rForm.reading_type === 'electricity' ? (settings.electricity_rate || 10) : (settings.water_rate || 20)
                  const amount = units * rate
                  return <>
                    <div><span className="text-brand-600">Units:</span> <span className="font-mono font-bold">{units.toFixed(1)}</span></div>
                    <div><span className="text-brand-600">Rate:</span> <span className="font-mono font-bold">₹{rate}/unit</span></div>
                    <div><span className="text-brand-600">Amount:</span> <span className="font-mono font-bold text-brand-700">{formatCurrency(amount)}</span></div>
                  </>
                })()}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => { setReadingModal(false); setEditReading(null) }}>Cancel</button>
          <button className="btn-primary" onClick={saveReading} disabled={saving}>{saving ? <Spinner size={16}/> : editReading ? 'Update' : 'Save Reading'}</button>
        </div>
      </Modal>

      {/* BILL MODAL */}
      <Modal open={billModal} onClose={() => setBillModal(false)} title="Record Utility Bill Paid" size="sm">
        <div className="p-6 space-y-4">
          <div className="form-group">
            <label className="label">Building *</label>
            <select className="select" value={bForm.building_id} onChange={e => setBForm(p=>({...p,building_id:e.target.value}))}>
              <option value="">— Select —</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Type *</label>
              <select className="select" value={bForm.utility_type} onChange={e => setBForm(p=>({...p,utility_type:e.target.value}))}>
                <option value="electricity">⚡ Electricity</option>
                <option value="water">💧 Water</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">Amount (₹) *</label>
              <input type="number" className="input" value={bForm.amount} onChange={e => setBForm(p=>({...p,amount:e.target.value}))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Month</label>
              <input type="month" className="input" value={bForm.for_month} onChange={e => setBForm(p=>({...p,for_month:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Payment Mode</label>
              <select className="select" value={bForm.payment_mode} onChange={e => setBForm(p=>({...p,payment_mode:e.target.value}))}>
                {['cash','upi','bank_transfer','online','other'].map(m=><option key={m} value={m}>{m.toUpperCase()}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group"><label className="label">Vendor</label><input className="input" value={bForm.vendor} onChange={e => setBForm(p=>({...p,vendor:e.target.value}))} placeholder="BESCOM, BWSSB…"/></div>
            <div className="form-group"><label className="label">Bill Number</label><input className="input" value={bForm.bill_number} onChange={e => setBForm(p=>({...p,bill_number:e.target.value}))} /></div>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setBillModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveBill} disabled={saving}>{saving ? <Spinner size={16}/> : 'Record Bill'}</button>
        </div>
      </Modal>

      {/* DELETE CONFIRM */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold mb-2">Delete reading?</h3>
            <p className="text-surface-500 text-sm mb-5">This cannot be undone. Future month carry-forward will be affected.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => deleteReading(deleteConfirm.id)} className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
