import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, fmtDate, lastNMonths, exportMultiSheet, PAYMENT_MODES } from '../utils/helpers';
import { MonthPicker, Spinner, EmptyState, Badge, PaymentModeBadge } from '../components/ui/index';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell
} from 'recharts';
import {
  FileBarChart2, Download, Building2, Users, CheckCircle2,
  XCircle, AlertCircle, TrendingUp, Filter, RefreshCw
} from 'lucide-react';

const COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="card p-3 text-xs space-y-1 min-w-[160px]">
        <p className="font-semibold text-surface-100 mb-2">{label}</p>
        {payload.map((p, i) => (
          <div key={i} className="flex justify-between gap-4">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-mono">{formatCurrency(p.value)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function Reports() {
  const [selectedMonth, setSelectedMonth] = useState(lastNMonths(1)[0]);
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState('all');
  const [reportData, setReportData] = useState([]);
  const [summary, setSummary] = useState({ total: 0, collected: 0, pending: 0, partial: 0 });
  const [modeBreakdown, setModeBreakdown] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('rent');

  useEffect(() => { fetchBuildings(); fetchTrend(); }, []);
  useEffect(() => { fetchReport(); }, [selectedMonth, selectedBuilding]);

  async function fetchBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').order('name');
    setBuildings(data || []);
  }

  async function fetchTrend() {
    const months = lastNMonths(6);
    const rows = [];
    for (const m of months) {
      const { data } = await supabase
        .from('rent_collections')
        .select('amount')
        .eq('for_month', m);
      const total = (data || []).reduce((s, r) => s + Number(r.amount), 0);
      rows.push({ month: m.slice(0, 7), amount: total });
    }
    setTrendData(rows.reverse());
  }

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      // Get all flats with tenant info for this building filter
      let flatQuery = supabase
        .from('flats')
        .select(`
          id, door_no, floor, monthly_rent, status,
          building:buildings(id, name, location),
          tenants(id, name, phone, status)
        `)
        .eq('status', 'occupied');

      if (selectedBuilding !== 'all') flatQuery = flatQuery.eq('building_id', selectedBuilding);

      const { data: flats } = await flatQuery;

      // Get rent collections for the month
      let rcQuery = supabase
        .from('rent_collections')
        .select('*, flat:flats(id), tenant:tenants(name)')
        .eq('for_month', selectedMonth);

      if (selectedBuilding !== 'all') {
        const flatIds = (flats || []).map(f => f.id);
        rcQuery = rcQuery.in('flat_id', flatIds);
      }

      const { data: collections } = await rcQuery;
      const collMap = {};
      (collections || []).forEach(c => {
        collMap[c.flat_id] = collMap[c.flat_id] || [];
        collMap[c.flat_id].push(c);
      });

      // Build row data
      const rows = (flats || []).map(flat => {
        const activeTenant = (flat.tenants || []).find(t => t.status === 'active');
        const colls = collMap[flat.id] || [];
        const totalPaid = colls.reduce((s, c) => s + Number(c.amount), 0);
        const expected = Number(flat.monthly_rent);
        let status = 'unpaid';
        if (totalPaid >= expected) status = 'paid';
        else if (totalPaid > 0) status = 'partial';
        return {
          flatId: flat.id,
          building: flat.building?.name || '—',
          location: flat.building?.location || '—',
          doorNo: flat.door_no,
          floor: flat.floor,
          tenant: activeTenant?.name || '—',
          phone: activeTenant?.phone || '—',
          expected,
          paid: totalPaid,
          balance: expected - totalPaid,
          status,
          modes: colls.map(c => c.payment_mode).filter(Boolean),
          collections: colls,
        };
      });

      rows.sort((a, b) => a.building.localeCompare(b.building) || a.doorNo.localeCompare(b.doorNo));
      setReportData(rows);

      // Summary
      const total = rows.length;
      const paid = rows.filter(r => r.status === 'paid').length;
      const partial = rows.filter(r => r.status === 'partial').length;
      const pending = rows.filter(r => r.status === 'unpaid').length;
      setSummary({ total, collected: paid, partial, pending });

      // Mode breakdown
      const modeMap = {};
      (collections || []).forEach(c => {
        modeMap[c.payment_mode] = (modeMap[c.payment_mode] || 0) + Number(c.amount);
      });
      setModeBreakdown(Object.entries(modeMap).map(([mode, amount]) => ({ mode, amount })));
    } catch (e) {
      toast.error('Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedBuilding]);

  function handleExport() {
    if (!reportData.length) return toast.error('No data to export');

    // Sheet 1: Full rent status
    const rentSheet = reportData.map(r => ({
      Building: r.building,
      Location: r.location,
      'Door No': r.doorNo,
      Floor: r.floor || '—',
      Tenant: r.tenant,
      Phone: r.phone,
      'Expected (₹)': r.expected,
      'Paid (₹)': r.paid,
      'Balance (₹)': r.balance,
      Status: r.status.toUpperCase(),
      'Payment Modes': r.modes.join(', ') || '—',
    }));

    // Sheet 2: Paid
    const paidSheet = reportData.filter(r => r.status === 'paid').map(r => ({
      Building: r.building, 'Door No': r.doorNo, Tenant: r.tenant,
      'Amount (₹)': r.paid, Modes: r.modes.join(', '),
    }));

    // Sheet 3: Unpaid / Partial
    const pendingSheet = reportData.filter(r => r.status !== 'paid').map(r => ({
      Building: r.building, 'Door No': r.doorNo, Tenant: r.tenant,
      'Expected (₹)': r.expected, 'Paid (₹)': r.paid,
      'Balance (₹)': r.balance, Status: r.status.toUpperCase(),
    }));

    // Sheet 4: Mode breakdown
    const modeSheet = modeBreakdown.map(m => ({
      'Payment Mode': m.mode, 'Total Amount (₹)': m.amount,
    }));

    exportMultiSheet(
      [
        { name: 'Rent Status', data: rentSheet },
        { name: 'Paid', data: paidSheet },
        { name: 'Pending & Partial', data: pendingSheet },
        { name: 'Mode Breakdown', data: modeSheet },
      ],
      `MMR_Report_${selectedMonth}`
    );
    toast.success('Report exported');
  }

  const statusBadge = (s) => {
    if (s === 'paid') return <span className="badge bg-income-500/20 text-income-400 border border-income-500/30">Paid</span>;
    if (s === 'partial') return <span className="badge bg-amber-500/20 text-amber-400 border border-amber-500/30">Partial</span>;
    return <span className="badge bg-expense-500/20 text-expense-400 border border-expense-500/30">Unpaid</span>;
  };

  const paidAmt = reportData.reduce((s, r) => s + r.paid, 0);
  const expectedAmt = reportData.reduce((s, r) => s + r.expected, 0);
  const collRate = expectedAmt > 0 ? Math.round((paidAmt / expectedAmt) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-surface-50 flex items-center gap-2">
            <FileBarChart2 className="w-6 h-6 text-brand-400" /> Reports
          </h1>
          <p className="text-surface-400 text-sm mt-0.5">Building-wise rent status & collection analytics</p>
        </div>
        <button onClick={handleExport} className="btn-primary flex items-center gap-2 self-start sm:self-auto">
          <Download className="w-4 h-4" /> Export Excel
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-surface-400" />
          <span className="text-sm text-surface-400">Filters:</span>
        </div>
        <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
        <select className="select w-auto"
          value={selectedBuilding} onChange={e => setSelectedBuilding(e.target.value)}>
          <option value="all">All Buildings</option>
          {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button onClick={fetchReport} className="btn-ghost flex items-center gap-1.5 text-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Flats', value: summary.total, icon: Building2, color: 'text-brand-400' },
          { label: 'Fully Paid', value: summary.collected, icon: CheckCircle2, color: 'text-income-400' },
          { label: 'Partial', value: summary.partial, icon: AlertCircle, color: 'text-amber-400' },
          { label: 'Unpaid', value: summary.pending, icon: XCircle, color: 'text-expense-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-surface-400">{label}</span>
            </div>
            <p className="text-2xl font-display font-bold text-surface-50">{value}</p>
          </div>
        ))}
      </div>

      {/* Amount KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Expected This Month</p>
          <p className="text-xl font-display font-bold text-surface-50">{formatCurrency(expectedAmt)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Collected</p>
          <p className="text-xl font-display font-bold text-income-400">{formatCurrency(paidAmt)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Collection Rate</p>
          <div className="flex items-end gap-2">
            <p className="text-xl font-display font-bold text-brand-400">{collRate}%</p>
          </div>
          <div className="mt-2 h-1.5 bg-surface-700 rounded-full overflow-hidden">
            <div className="h-full bg-brand-400 rounded-full transition-all duration-700"
              style={{ width: `${collRate}%` }} />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 6-month trend */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-surface-200 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-400" /> 6-Month Collection Trend
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trendData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="amount" name="Collected" radius={[4, 4, 0, 0]}>
                {trendData.map((_, i) => (
                  <Cell key={i} fill={i === trendData.length - 1 ? '#f59e0b' : '#475569'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Mode breakdown */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-surface-200 mb-4">Payment Mode Breakdown</h3>
          {modeBreakdown.length === 0 ? (
            <EmptyState icon={<FileBarChart2 className="w-8 h-8" />} title="No collections yet" description="No payments recorded for this period" />
          ) : (
            <div className="space-y-3">
              {modeBreakdown.sort((a, b) => b.amount - a.amount).map((m, i) => {
                const pct = expectedAmt > 0 ? Math.round((m.amount / paidAmt) * 100) : 0;
                return (
                  <div key={m.mode} className="flex items-center gap-3">
                    <div className="w-24 flex-shrink-0">
                      <PaymentModeBadge mode={m.mode} />
                    </div>
                    <div className="flex-1">
                      <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                      </div>
                    </div>
                    <span className="text-xs font-mono text-surface-300 w-20 text-right">{formatCurrency(m.amount)}</span>
                    <span className="text-xs text-surface-500 w-8 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Rent Status Table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-700 flex items-center justify-between">
          <h3 className="font-semibold text-surface-200">Flat-wise Rent Status</h3>
          <span className="text-xs text-surface-500">{reportData.length} flats</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : reportData.length === 0 ? (
          <EmptyState icon={<Building2 className="w-8 h-8" />}
            title="No occupied flats" description="No occupied flats found for the selected filter" />
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
                  <th>Modes</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map(row => (
                  <tr key={row.flatId}>
                    <td>
                      <div className="font-medium text-surface-200">{row.building}</div>
                      <div className="text-xs text-surface-500">{row.location}</div>
                    </td>
                    <td className="font-mono text-sm">{row.doorNo}</td>
                    <td>
                      <div className="text-surface-200">{row.tenant}</div>
                      {row.phone !== '—' && <div className="text-xs text-surface-500">{row.phone}</div>}
                    </td>
                    <td className="text-right font-mono">{formatCurrency(row.expected)}</td>
                    <td className="text-right font-mono text-income-400">{formatCurrency(row.paid)}</td>
                    <td className={`text-right font-mono ${row.balance > 0 ? 'text-expense-400' : 'text-surface-500'}`}>
                      {row.balance > 0 ? formatCurrency(row.balance) : '—'}
                    </td>
                    <td>{statusBadge(row.status)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {row.modes.length > 0
                          ? row.modes.map((m, i) => <PaymentModeBadge key={i} mode={m} />)
                          : <span className="text-surface-600 text-xs">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Building Summary */}
      {selectedBuilding === 'all' && reportData.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-surface-700">
            <h3 className="font-semibold text-surface-200">Building Summary</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th className="text-center">Total Flats</th>
                  <th className="text-center">Paid</th>
                  <th className="text-center">Partial</th>
                  <th className="text-center">Unpaid</th>
                  <th className="text-right">Expected</th>
                  <th className="text-right">Collected</th>
                  <th className="text-right">Pending</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(
                  reportData.reduce((acc, r) => {
                    if (!acc[r.building]) acc[r.building] = {
                      building: r.building, total: 0, paid: 0, partial: 0, unpaid: 0,
                      expected: 0, collected: 0
                    };
                    acc[r.building].total++;
                    acc[r.building][r.status]++;
                    acc[r.building].expected += r.expected;
                    acc[r.building].collected += r.paid;
                    return acc;
                  }, {})
                ).map(b => (
                  <tr key={b.building}>
                    <td className="font-medium text-surface-200">{b.building}</td>
                    <td className="text-center">{b.total}</td>
                    <td className="text-center text-income-400">{b.paid}</td>
                    <td className="text-center text-amber-400">{b.partial}</td>
                    <td className="text-center text-expense-400">{b.unpaid}</td>
                    <td className="text-right font-mono">{formatCurrency(b.expected)}</td>
                    <td className="text-right font-mono text-income-400">{formatCurrency(b.collected)}</td>
                    <td className="text-right font-mono text-expense-400">
                      {formatCurrency(b.expected - b.collected)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
