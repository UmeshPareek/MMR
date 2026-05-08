import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, lastNMonths } from '../utils/helpers';
import toast from 'react-hot-toast';
import { Zap, Droplets, Building2, Save, AlertTriangle, CheckCircle2, Filter, RefreshCw } from 'lucide-react';

export default function UtilityBills() {
  const months = lastNMonths(6);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState('all');
  const [flats, setFlats] = useState([]);
  const [entries, setEntries] = useState({}); // { flatId: { electricity_amount, water_amount, other_charges, notes, id } }
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState({});

  useEffect(() => { loadBuildings(); }, []);
  useEffect(() => { loadFlats(); }, [selectedMonth, selectedBuilding]);

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name');
    setBuildings(data || []);
  }

  async function loadFlats() {
    setLoading(true);
    try {
      let q = supabase
        .from('flats')
        .select('id, door_number, monthly_rent, building_id, buildings(name)')
        .eq('status', 'occupied');
      if (selectedBuilding !== 'all') q = q.eq('building_id', selectedBuilding);
      const { data: flatData, error } = await q;
      if (error) throw error;

      // Fetch active tenants separately
      const flatIds2 = (flatData || []).map(f => f.id);
      const { data: tenantData } = flatIds2.length
        ? await supabase.from('tenants').select('id, full_name, flat_id').eq('status', 'active').in('flat_id', flatIds2)
        : { data: [] };
      const tenantByFlat = {};
      (tenantData || []).forEach(t => { tenantByFlat[t.flat_id] = t; });
      // Attach tenant to each flat
      flatData && flatData.forEach(f => { f._tenant = tenantByFlat[f.id] || null; });

      const flatIds = (flatData || []).map(f => f.id);
      let existingEntries = {};
      if (flatIds.length > 0) {
        const { data: utils } = await supabase
          .from('flat_utilities')
          .select('*')
          .eq('for_month', selectedMonth)
          .in('flat_id', flatIds);
        (utils || []).forEach(u => { existingEntries[u.flat_id] = u; });
      }

      setFlats(flatData || []);
      // Pre-populate form state
      const init = {};
      (flatData || []).forEach(f => {
        const ex = existingEntries[f.id];
        init[f.id] = {
          id: ex?.id || null,
          electricity_amount: ex?.electricity_amount ?? '',
          water_amount: ex?.water_amount ?? '',
          other_charges: ex?.other_charges ?? '',
          notes: ex?.notes ?? '',
          saved: !!ex,
        };
      });
      setEntries(init);
    } catch (e) {
      toast.error('Failed to load: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function update(flatId, field, value) {
    setEntries(p => ({ ...p, [flatId]: { ...p[flatId], [field]: value, saved: false } }));
  }

  async function saveFlat(flat) {
    const entry = entries[flat.id];
    if (!entry) return;
    setSaving(p => ({ ...p, [flat.id]: true }));
    try {
      const payload = {
        flat_id: flat.id,
        building_id: flat.building_id,
        for_month: selectedMonth,
        electricity_amount: Number(entry.electricity_amount) || 0,
        water_amount: Number(entry.water_amount) || 0,
        other_charges: Number(entry.other_charges) || 0,
        notes: entry.notes || null,
      };

      if (entry.id) {
        const { error } = await supabase.from('flat_utilities').update(payload).eq('id', entry.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('flat_utilities').insert(payload).select().single();
        if (error) throw error;
        setEntries(p => ({ ...p, [flat.id]: { ...p[flat.id], id: data.id } }));
      }
      setEntries(p => ({ ...p, [flat.id]: { ...p[flat.id], saved: true } }));
      toast.success(`Saved ${flat.door_number}`);
    } catch (e) {
      toast.error('Save failed: ' + e.message);
    } finally {
      setSaving(p => ({ ...p, [flat.id]: false }));
    }
  }

  async function saveAll() {
    const unsaved = flats.filter(f => !entries[f.id]?.saved);
    if (!unsaved.length) return toast.success('All already saved');
    for (const f of unsaved) await saveFlat(f);
  }

  const savedCount = Object.values(entries).filter(e => e.saved).length;
  const totalElec = Object.values(entries).reduce((s, e) => s + (Number(e.electricity_amount) || 0), 0);
  const totalWater = Object.values(entries).reduce((s, e) => s + (Number(e.water_amount) || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Utility Bills</h1>
          <p className="text-sm text-surface-500 mt-0.5">Enter electricity & water charges per flat per month</p>
        </div>
        <button onClick={saveAll} className="btn-primary flex items-center gap-2 self-start">
          <Save className="w-4 h-4" /> Save All
        </button>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <Filter className="w-4 h-4 text-surface-400 self-center" />
        <div>
          <label className="label text-xs mb-0.5">Month</label>
          <select className="select py-1.5 text-sm" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs mb-0.5">Building</label>
          <select className="select py-1.5 text-sm" value={selectedBuilding} onChange={e => setSelectedBuilding(e.target.value)}>
            <option value="all">All Buildings</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button onClick={loadFlats} className="btn-ghost btn-sm flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-surface-500">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          {savedCount}/{flats.length} saved
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-yellow-400">
          <p className="text-xs text-surface-500 mb-1">Total Flats</p>
          <p className="text-xl font-bold text-surface-900">{flats.length}</p>
        </div>
        <div className="card p-4 border-l-4 border-emerald-400">
          <p className="text-xs text-surface-500 mb-1">Entries Done</p>
          <p className="text-xl font-bold text-emerald-700">{savedCount}</p>
        </div>
        <div className="card p-4 border-l-4 border-blue-400">
          <p className="text-xs text-surface-500 mb-1 flex items-center gap-1"><Zap className="w-3 h-3" />Total Electricity</p>
          <p className="text-xl font-bold text-surface-900 font-mono">{formatCurrency(totalElec)}</p>
        </div>
        <div className="card p-4 border-l-4 border-cyan-400">
          <p className="text-xs text-surface-500 mb-1 flex items-center gap-1"><Droplets className="w-3 h-3" />Total Water</p>
          <p className="text-xl font-bold text-surface-900 font-mono">{formatCurrency(totalWater)}</p>
        </div>
      </div>

      {/* Flat entry table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
          <span className="text-sm font-medium text-surface-700">Flat-wise Entry — {selectedMonth}</span>
          {flats.length - savedCount > 0 && (
            <span className="badge bg-amber-50 text-amber-700 border border-amber-200">
              <AlertTriangle className="w-3 h-3" />
              {flats.length - savedCount} pending
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : flats.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-surface-400 text-sm">No occupied flats found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th>Flat</th>
                  <th>Tenant</th>
                  <th>Electricity (₹)</th>
                  <th>Water (₹)</th>
                  <th>Other (₹)</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {flats.map(flat => {
                  const e = entries[flat.id] || {};
                  const isSaving = saving[flat.id];
                  return (
                    <tr key={flat.id} className={e.saved ? 'bg-emerald-50/30' : ''}>
                      <td className="text-xs text-surface-500">{flat.buildings?.name || '—'}</td>
                      <td className="font-mono font-medium text-surface-800">{flat.door_number}</td>
                      <td className="text-surface-600 text-sm">{flat._tenant?.full_name || '—'}</td>
                      <td>
                        <div className="relative">
                          <Zap className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-yellow-400" />
                          <input type="number" min="0" step="0.01" placeholder="0.00"
                            value={e.electricity_amount ?? ''}
                            onChange={ev => update(flat.id, 'electricity_amount', ev.target.value)}
                            className="input pl-7 py-1.5 text-sm w-28" />
                        </div>
                      </td>
                      <td>
                        <div className="relative">
                          <Droplets className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-blue-400" />
                          <input type="number" min="0" step="0.01" placeholder="0.00"
                            value={e.water_amount ?? ''}
                            onChange={ev => update(flat.id, 'water_amount', ev.target.value)}
                            className="input pl-7 py-1.5 text-sm w-28" />
                        </div>
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" placeholder="0.00"
                          value={e.other_charges ?? ''}
                          onChange={ev => update(flat.id, 'other_charges', ev.target.value)}
                          className="input py-1.5 text-sm w-24" />
                      </td>
                      <td>
                        <input type="text" placeholder="Optional note"
                          value={e.notes ?? ''}
                          onChange={ev => update(flat.id, 'notes', ev.target.value)}
                          className="input py-1.5 text-sm w-32" />
                      </td>
                      <td>
                        <button onClick={() => saveFlat(flat)} disabled={isSaving || e.saved}
                          className={`btn btn-sm flex items-center gap-1.5 ${e.saved ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'btn-primary'}`}>
                          {isSaving
                            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                            : e.saved
                              ? <><CheckCircle2 className="w-3.5 h-3.5" />Saved</>
                              : <><Save className="w-3.5 h-3.5" />Save</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
