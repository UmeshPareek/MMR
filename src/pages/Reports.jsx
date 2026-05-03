import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, lastNMonths, exportMultiSheet } from '../utils/helpers';
import toast from 'react-hot-toast';
import { Download, RefreshCw, Building2, CheckCircle2, XCircle, AlertCircle, Filter } from 'lucide-react';

export default function Reports() {
  const months = lastNMonths(6);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { loadBuildings(); }, []);
  useEffect(() => { loadReport(); }, [selectedMonth, selectedBuilding]);

  async function loadBuildings() {
    try {
      const { data } = await supabase.from('buildings').select('id, name').order('name');
      setBuildings(data || []);
    } catch (e) {}
  }

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      let q = supabase
        .from('flats')
        .select('id, door_no, floor, monthly_rent, building_id, buildings(name)')
        .eq('status', 'occupied');
      if (selectedBuilding !== 'all') q = q.eq('building_id', selectedBuilding);
      const { data: flats, error: flatErr } = await q;
      if (flatErr) throw flatErr;

      const flatIds = (flats || []).map(f => f.id);
      let tenantMap = {};
      let collMap = {};

      if (flatIds.length > 0) {
        const { data: tenants } = await supabase
          .from('tenants')
          .select('id, name, phone, flat_id')
          .eq('status', 'active')
          .in('flat_id', flatIds);
        (tenants || []).forEach(t => { tenantMap[t.flat_id] = t; });

        const { data: collections } = await supabase
          .from('rent_collections')
          .select('flat_id, amount, payment_mode')
          .eq('for_month', selectedMonth)
          .in('flat_id', flatIds);
        (collections || []).forEach(c => {
          if (!collMap[c.flat_id]) collMap[c.flat_id] = { total: 0, modes: [] };
          collMap[c.flat_id].total += Number(c.amount) || 0;
          if (c.payment_mode) collMap[c.flat_id].modes.push(c.payment_mode);
        });
      }

      const result = (flats || []).map(flat => {
        const tenant = tenantMap[flat.id];
        const coll = collMap[flat.id] || { total: 0, modes: [] };
        const expected = Number(flat.monthly_rent) || 0;
        const paid = coll.total;
        const balance = expected - paid;
        let status = 'unpaid';
        if (paid >= expected && expected > 0) status = 'paid';
        else if (paid > 0) status = 'partial';
        const bName = flat.buildings ? String(flat.buildings.name || '') : '—';
        const bLoc = flat.buildings ? '' : '';
        return {
          id: String(flat.id),
          building: bName,
          location: bLoc,
          doorNo: String(flat.door_no || '—'),
          tenant: tenant ? String(tenant.name || '—') : '—',
          phone: tenant ? String(tenant.phone || '') : '',
          expected,
          paid,
          balance,
          status,
          modes: Array.isArray(coll.modes) ? coll.modes.map(String) : [],
        };
      });

      result.sort((a, b) => a.building.localeCompare(b.building) || a.doorNo.localeCompare(b.doorNo));
      setRows(result);
    } catch (e) {
      console.error('Report error:', e);
      setError(String(e.message || 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!rows.length) return toast.error('No data to export');
    const sheet = rows.map(r => ({
      Building: r.building,
      'Door No': r.doorNo,
      Tenant: r.tenant,
      'Expected (Rs)': r.expected,
      'Paid (Rs)': r.paid,
      'Balance (Rs)': r.balance,
      Status: r.status.toUpperCase(),
      Modes: r.modes.join(', ') || '—',
    }));
    exportMultiSheet([{ name: 'Rent Status', data: sheet }], 'MMR_Report_' + selectedMonth);
    toast.success('Exported');
  }

  const totalExpected = rows.reduce((s, r) => s + r.expected, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const paidCount = rows.filter(r => r.status === 'paid').length;
  const partialCount = rows.filter(r => r.status === 'partial').length;
  const unpaidCount = rows.filter(r => r.status === 'unpaid').length;
  const collRate = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-surface-50">Reports</h1>
          <p className="text-surface-400 text-sm mt-0.5">Building-wise rent collection status</p>
        </div>
        <button onClick={handleExport} className="btn-primary flex items-center gap-2 self-start">
          <Download className="w-4 h-4" /> Export Excel
        </button>
      </div>

      <div className="card p-4 flex flex-wrap gap-4 items-end">
        <Filter className="w-4 h-4 text-surface-400 self-center" />
        <div>
          <label className="label text-xs mb-1">Month</label>
          <select className="select" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs mb-1">Building</label>
          <select className="select" value={selectedBuilding} onChange={e => setSelectedBuilding(e.target.value)}>
            <option value="all">All Buildings</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button onClick={loadReport} className="btn-ghost flex items-center gap-1.5 text-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-brand-400" /><span className="text-xs text-surface-400">Total Flats</span></div>
          <p className="text-2xl font-display font-bold text-surface-50">{rows.length}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><CheckCircle2 className="w-4 h-4 text-green-400" /><span className="text-xs text-surface-400">Fully Paid</span></div>
          <p className="text-2xl font-display font-bold text-green-400">{paidCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><AlertCircle className="w-4 h-4 text-amber-400" /><span className="text-xs text-surface-400">Partial</span></div>
          <p className="text-2xl font-display font-bold text-amber-400">{partialCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><XCircle className="w-4 h-4 text-red-400" /><span className="text-xs text-surface-400">Unpaid</span></div>
          <p className="text-2xl font-display font-bold text-red-400">{unpaidCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Expected</p>
          <p className="text-xl font-display font-bold text-surface-50">{formatCurrency(totalExpected)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Collected</p>
          <p className="text-xl font-display font-bold text-green-400">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Collection Rate</p>
          <p className="text-xl font-display font-bold text-brand-400">{collRate}%</p>
          <div className="mt-2 h-1.5 bg-surface-700 rounded-full overflow-hidden">
            <div className="h-full bg-brand-400 rounded-full" style={{ width: collRate + '%' }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-4 border border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm font-mono">{error}</p>
          <button onClick={loadReport} className="text-xs text-red-300 underline mt-1">Retry</button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-700 flex items-center justify-between">
          <h3 className="font-semibold text-surface-200">Flat-wise Rent Status</h3>
          <span className="text-xs text-surface-500">{rows.length} flats · {selectedMonth}</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 && !error ? (
          <div className="text-center py-16">
            <Building2 className="w-10 h-10 text-surface-600 mx-auto mb-3" />
            <p className="text-surface-400 text-sm">No occupied flats found for this period</p>
            <p className="text-surface-600 text-xs mt-1">Add buildings, flats and tenants first</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th>Door No</th>
                  <th>Tenant</th>
                  <th className="text-right">Expected</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Balance</th>
                  <th>Status</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td>
                      <div className="font-medium text-surface-200">{row.building}</div>
                      {row.location ? <div className="text-xs text-surface-500">{row.location}</div> : null}
                    </td>
                    <td className="font-mono text-sm">{row.doorNo}</td>
                    <td>
                      <div className="text-surface-200">{row.tenant}</div>
                      {row.phone ? <div className="text-xs text-surface-500">{row.phone}</div> : null}
                    </td>
                    <td className="text-right font-mono">{formatCurrency(row.expected)}</td>
                    <td className="text-right font-mono text-green-400">{formatCurrency(row.paid)}</td>
                    <td className="text-right font-mono" style={{ color: row.balance > 0 ? '#ef4444' : '#64748b' }}>
                      {row.balance > 0 ? formatCurrency(row.balance) : '—'}
                    </td>
                    <td>
                      {row.status === 'paid' && <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">PAID</span>}
                      {row.status === 'partial' && <span className="badge bg-amber-500/20 text-amber-400 border border-amber-500/30">PARTIAL</span>}
                      {row.status === 'unpaid' && <span className="badge bg-red-500/20 text-red-400 border border-red-500/30">UNPAID</span>}
                    </td>
                    <td className="text-xs text-surface-400">{row.modes.length > 0 ? row.modes.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
