import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, lastNMonths, exportMultiSheet } from '../utils/helpers';
import toast from 'react-hot-toast';
import ReactConfetti from 'react-confetti';
import {
  CheckCircle2, XCircle, Clock, Building2, ChevronDown, ChevronRight,
  Download, Filter, RefreshCw, AlertTriangle, Zap, Phone
} from 'lucide-react';

const WaIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

export default function DailyCollection() {
  const months = lastNMonths(6);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [buildings, setBuildings] = useState([]);
  const [data, setData] = useState([]); // [{building, flats: [{...flat, status, paid, balance}]}]
  const [loading, setLoading] = useState(false);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [filterStatus, setFilterStatus] = useState('all'); // all | unpaid | partial | paid
  const channelRef = useRef(null);

  useEffect(() => {
    load();
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = supabase.channel('daily-collection-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rent_collections' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flat_utilities' }, () => load())
      .subscribe();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [selectedMonth, filterStatus]);

  async function load() {
    setLoading(true);
    try {
      // Get all occupied flats with buildings
      const { data: flats, error } = await supabase
        .from('flats')
        .select('id, door_number, floor_number, monthly_rent, building_id, buildings(id, name, area)')
        .eq('status', 'occupied');
      if (error) throw error;

      const flatIds = (flats || []).map(f => f.id);
      if (!flatIds.length) { setData([]); return; }

      // Get active tenants
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, full_name, phone, flat_id, monthly_rent')
        .eq('status', 'active')
        .in('flat_id', flatIds);
      const tenantByFlat = {};
      (tenants || []).forEach(t => { tenantByFlat[t.flat_id] = t; });

      // Get collections for selected month
      const { data: collections } = await supabase
        .from('rent_collections')
        .select('flat_id, amount, payment_mode')
        .eq('for_month', selectedMonth)
        .in('flat_id', flatIds);
      const collByFlat = {};
      (collections || []).forEach(c => {
        if (!collByFlat[c.flat_id]) collByFlat[c.flat_id] = { total: 0, modes: [] };
        collByFlat[c.flat_id].total += Number(c.amount);
        collByFlat[c.flat_id].modes.push(c.payment_mode);
      });

      // Get utility bills for month
      const { data: utilities } = await supabase
        .from('flat_utilities')
        .select('flat_id, electricity_amount, water_amount, other_charges')
        .eq('for_month', selectedMonth)
        .in('flat_id', flatIds);
      const utilByFlat = {};
      (utilities || []).forEach(u => { utilByFlat[u.flat_id] = u; });

      // Build flat rows
      const rows = (flats || []).map(flat => {
        const tenant = tenantByFlat[flat.id];
        const coll = collByFlat[flat.id] || { total: 0, modes: [] };
        const util = utilByFlat[flat.id];
        const expected = Number(flat.monthly_rent) || 0;
        const paid = coll.total;
        const balance = expected - paid;
        const elec = util ? Number(util.electricity_amount) : null;
        const water = util ? Number(util.water_amount) : null;
        let status = 'unpaid';
        if (paid >= expected && expected > 0) status = 'paid';
        else if (paid > 0) status = 'partial';
        return {
          id: flat.id,
          doorNumber: flat.door_number || '—',
          floor: flat.floor_number,
          building: flat.buildings?.name || '—',
          buildingId: flat.building_id,
          buildingArea: flat.buildings?.area || '',
          tenant: tenant?.full_name || 'No tenant',
          phone: tenant?.phone || '',
          tenantId: tenant?.id,
          expected,
          paid,
          balance,
          status,
          modes: coll.modes,
          electricity: elec,
          water,
          hasUtility: !!util,
        };
      });

      // Filter
      const filtered = filterStatus === 'all' ? rows : rows.filter(r => r.status === filterStatus);

      // Group by building
      const buildingMap = {};
      filtered.forEach(r => {
        if (!buildingMap[r.buildingId]) {
          buildingMap[r.buildingId] = { name: r.building, area: r.buildingArea, flats: [] };
        }
        buildingMap[r.buildingId].flats.push(r);
      });

      // Sort flats within each building
      Object.values(buildingMap).forEach(b => {
        b.flats.sort((a, b) => a.doorNumber.localeCompare(b.doorNumber));
        b.total = b.flats.length;
        b.paid = b.flats.filter(f => f.status === 'paid').length;
        b.unpaid = b.flats.filter(f => f.status === 'unpaid').length;
        b.partial = b.flats.filter(f => f.status === 'partial').length;
        b.expectedTotal = b.flats.reduce((s, f) => s + f.expected, 0);
        b.collectedTotal = b.flats.reduce((s, f) => s + f.paid, 0);
      });

      const buildingList = Object.entries(buildingMap).map(([id, v]) => ({ id, ...v }));
      buildingList.sort((a, b) => a.name.localeCompare(b.name));
      setData(buildingList);

      // Auto-expand buildings with unpaid flats
      const expanded = {};
      buildingList.forEach(b => { if (b.unpaid > 0 || b.partial > 0) expanded[b.id] = true; });
      setExpandedBuildings(expanded);

    } catch (e) {
      toast.error('Failed to load: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleBuilding(id) {
    setExpandedBuildings(p => ({ ...p, [id]: !p[id] }));
  }

  function handleExport() {
    const rows = data.flatMap(b =>
      b.flats.map(f => ({
        Building: b.name,
        'Door No': f.doorNumber,
        Tenant: f.tenant,
        Phone: f.phone,
        'Expected (₹)': f.expected,
        'Collected (₹)': f.paid,
        'Balance (₹)': f.balance,
        Status: f.status.toUpperCase(),
        'Payment Modes': f.modes.join(', ') || '—',
        'Electricity (₹)': f.electricity ?? '—',
        'Water (₹)': f.water ?? '—',
      }))
    );
    exportMultiSheet([{ name: selectedMonth, data: rows }], `MMR_Collection_${selectedMonth}`);
    toast.success('Exported');
  }

  const totalExpected = data.reduce((s, b) => s + b.expectedTotal, 0);
  const totalCollected = data.reduce((s, b) => s + b.collectedTotal, 0);
  const totalUnpaid = data.reduce((s, b) => s + b.unpaid, 0);
  const totalPartial = data.reduce((s, b) => s + b.partial, 0);
  const totalPaid = data.reduce((s, b) => s + b.paid, 0);
  const totalFlats = data.reduce((s, b) => s + b.total, 0);

  const statusColor = {
    paid: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    partial: 'text-amber-700 bg-amber-50 border-amber-200',
    unpaid: 'text-red-700 bg-red-50 border-red-200',
  };

  const allPaid = totalFlats > 0 && totalPaid === totalFlats

  return (
    <div className="space-y-5">
      {allPaid && (
        <ReactConfetti
          width={window.innerWidth}
          height={window.innerHeight}
          recycle={false}
          numberOfPieces={350}
          gravity={0.25}
          style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999, pointerEvents: 'none' }}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-50">Rent Collection Tracker</h1>
          <p className="text-sm text-surface-500 mt-0.5">Building-wise · who has paid, who hasn't</p>
        </div>
        <button onClick={handleExport} className="btn-secondary flex items-center gap-2 self-start">
          <Download className="w-4 h-4" /> Export
        </button>
      </div>

      {allPaid && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 rounded-xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-emerald-800 dark:text-emerald-400 text-sm">100% collection achieved!</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-500">All flats have paid for {selectedMonth}.</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-surface-400 flex-shrink-0" />
        <div>
          <label className="label text-xs mb-0.5">Month</label>
          <select className="select py-1.5 text-sm" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[
            { v: 'all', label: `All (${totalFlats})` },
            { v: 'unpaid', label: `Unpaid (${totalUnpaid})`, cls: 'text-red-700 border-red-200 bg-red-50' },
            { v: 'partial', label: `Partial (${totalPartial})`, cls: 'text-amber-700 border-amber-200 bg-amber-50' },
            { v: 'paid', label: `Paid (${totalPaid})`, cls: 'text-emerald-700 border-emerald-200 bg-emerald-50' },
          ].map(({ v, label, cls }) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              className={`badge border cursor-pointer text-xs py-1 px-2.5 transition-all
                ${filterStatus === v ? (cls || 'bg-brand-600 text-white border-brand-600') : 'bg-white text-surface-500 border-surface-300 hover:border-surface-400'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={load} className="btn-ghost btn-sm flex items-center gap-1.5 ml-auto">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Expected', value: formatCurrency(totalExpected), color: 'border-surface-300' },
          { label: 'Collected', value: formatCurrency(totalCollected), color: 'border-emerald-400' },
          { label: 'Pending', value: formatCurrency(totalExpected - totalCollected), color: 'border-red-400' },
          { label: 'Collection %', value: totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) + '%' : '0%', color: 'border-brand-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`card p-4 border-l-4 ${color}`}>
            <p className="text-xs text-surface-500 mb-1">{label}</p>
            <p className="text-lg font-bold text-surface-900 font-mono">{value}</p>
          </div>
        ))}
      </div>

      {/* Building list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-surface-500 text-sm">No data found for this filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(building => (
            <div key={building.id} className="card overflow-hidden">
              {/* Building header — clickable */}
              <button
                onClick={() => toggleBuilding(building.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-50 transition-colors text-left"
              >
                <span className="text-surface-400">
                  {expandedBuildings[building.id]
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />}
                </span>
                <Building2 className="w-4 h-4 text-surface-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-surface-800 text-sm">{building.name}</span>
                  {building.area && <span className="text-surface-400 text-xs ml-2">{building.area}</span>}
                </div>

                {/* Mini stats */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {building.unpaid > 0 && (
                    <span className="badge bg-red-50 text-red-700 border border-red-200">
                      <XCircle className="w-3 h-3" /> {building.unpaid} unpaid
                    </span>
                  )}
                  {building.partial > 0 && (
                    <span className="badge bg-amber-50 text-amber-700 border border-amber-200">
                      <Clock className="w-3 h-3" /> {building.partial} partial
                    </span>
                  )}
                  {building.paid > 0 && (
                    <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" /> {building.paid} paid
                    </span>
                  )}
                  <span className="text-xs text-surface-400 ml-1 hidden sm:block">
                    {formatCurrency(building.collectedTotal)} / {formatCurrency(building.expectedTotal)}
                  </span>
                </div>
              </button>

              {/* Flat rows */}
              {expandedBuildings[building.id] && (
                <div className="border-t border-surface-100 overflow-x-auto">
                  <table className="data-table min-w-[700px]">
                    <thead>
                      <tr>
                        <th>Flat</th>
                        <th>Tenant</th>
                        <th>Phone</th>
                        <th className="text-right">Expected</th>
                        <th className="text-right">Paid</th>
                        <th className="text-right">Balance</th>
                        <th>Status</th>
                        <th>Mode</th>
                        <th>Electricity</th>
                        <th>Water</th>
                      </tr>
                    </thead>
                    <tbody>
                      {building.flats.map(flat => (
                        <tr key={flat.id}
                          className={flat.status === 'unpaid' ? 'bg-red-50/40' : flat.status === 'partial' ? 'bg-amber-50/30' : ''}>
                          <td className="font-mono text-sm font-medium text-surface-800">{flat.doorNumber}</td>
                          <td className="text-surface-700">{flat.tenant}</td>
                          <td>
                            {flat.phone ? (
                              <div className="flex items-center gap-1.5">
                                <a href={`tel:${flat.phone}`}
                                  className="flex items-center gap-1 text-brand-600 hover:text-brand-700 text-xs">
                                  <Phone className="w-3 h-3" /> {flat.phone}
                                </a>
                                {flat.status !== 'paid' && (
                                  <a
                                    href={`https://wa.me/91${flat.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hi ${flat.tenant}, your rent of ₹${flat.expected} for ${selectedMonth} is pending. Balance due: ₹${flat.balance}. Please pay at the earliest. - CashMyRent`)}`}
                                    target="_blank" rel="noreferrer"
                                    className="text-emerald-600 hover:text-emerald-700 transition-colors"
                                    title="Send WhatsApp reminder"
                                  >
                                    <WaIcon />
                                  </a>
                                )}
                              </div>
                            ) : <span className="text-surface-400 text-xs">—</span>}
                          </td>
                          <td className="text-right font-mono">{formatCurrency(flat.expected)}</td>
                          <td className="text-right font-mono text-emerald-700">{formatCurrency(flat.paid)}</td>
                          <td className="text-right font-mono" style={{ color: flat.balance > 0 ? '#dc2626' : '#94a3b8' }}>
                            {flat.balance > 0 ? formatCurrency(flat.balance) : '—'}
                          </td>
                          <td>
                            <span className={`badge border text-xs ${statusColor[flat.status]}`}>
                              {flat.status === 'paid' && <CheckCircle2 className="w-3 h-3" />}
                              {flat.status === 'partial' && <Clock className="w-3 h-3" />}
                              {flat.status === 'unpaid' && <XCircle className="w-3 h-3" />}
                              {flat.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="text-xs text-surface-500">
                            {flat.modes.length > 0 ? flat.modes.join(', ') : '—'}
                          </td>
                          <td className="text-xs">
                            {flat.electricity !== null
                              ? <span className="font-mono text-surface-700">{formatCurrency(flat.electricity)}</span>
                              : <span className="text-amber-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Not entered</span>}
                          </td>
                          <td className="text-xs">
                            {flat.water !== null
                              ? <span className="font-mono text-surface-700">{formatCurrency(flat.water)}</span>
                              : <span className="text-amber-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Not entered</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Building footer */}
                    <tfoot>
                      <tr className="bg-surface-50 border-t border-surface-200">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-surface-500">
                          {building.total} flats total
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold text-sm text-surface-700">
                          {formatCurrency(building.expectedTotal)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold text-sm text-emerald-700">
                          {formatCurrency(building.collectedTotal)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold text-sm text-red-600">
                          {formatCurrency(building.expectedTotal - building.collectedTotal)}
                        </td>
                        <td colSpan={4} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
