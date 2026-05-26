import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths, exportMultiSheet } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  ShieldCheck, Plus, Download, TrendingUp, TrendingDown,
  ArrowUpCircle, ArrowDownCircle, Building2, Users,
  Filter, RefreshCw, X, Wallet, AlertCircle
} from 'lucide-react';

const MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'];
const MODE_LABELS = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank Transfer', cheque: 'Cheque', other: 'Other' };

export default function SecurityDeposits() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const channelRef = useRef(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);

  // Data
  const [tenantDeposits, setTenantDeposits] = useState([]);
  const [ownerDeposits, setOwnerDeposits] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [flats, setFlats] = useState([]);

  // Filters
  const [selectedBuilding, setSelectedBuilding] = useState('all');

  // Modals
  const [showAddTenant, setShowAddTenant] = useState(false);
  const [showAddOwner, setShowAddOwner] = useState(false);

  // Forms
  const [tForm, setTForm] = useState({
    tenant_id: '', flat_id: '', building_id: '', amount: '',
    payment_mode: 'cash', deposit_date: new Date().toISOString().slice(0, 10),
    deposit_type: 'collection', transaction_ref: '', notes: ''
  });
  const [oForm, setOForm] = useState({
    building_id: '', amount: '', payment_mode: 'bank_transfer',
    payment_date: new Date().toISOString().slice(0, 10),
    transaction_ref: '', notes: ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('deposits-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'security_deposits' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => loadAll())
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, []);
  useEffect(() => { loadAll(); }, [selectedBuilding]);

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([loadTenantDeposits(), loadOwnerDeposits(), loadBuildings(), loadTenants()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name');
    setBuildings(data || []);
  }

  async function loadTenants() {
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('id, full_name, flat_id, building_id, monthly_rent, security_deposit_paid, security_deposit_months, move_in_date, status, flats(door_number), buildings(name)')
      .order('full_name');
    setTenants(tenantData || []);

    const { data: flatData } = await supabase
      .from('flats').select('id, door_number, building_id, buildings(name)').eq('status', 'occupied');
    setFlats(flatData || []);
  }

  async function loadTenantDeposits() {
    let q = supabase
      .from('security_deposits')
      .select('*, tenant:tenants(full_name, phone), flat:flats(door_number), building:buildings(name), collector:profiles!collected_by(full_name)')
      .order('deposit_date', { ascending: false });
    if (selectedBuilding !== 'all') q = q.eq('building_id', selectedBuilding);
    const { data, error } = await q;
    if (error) toast.error('Failed to load deposits');
    setTenantDeposits(data || []);
  }

  async function loadOwnerDeposits() {
    let q = supabase
      .from('owner_payments')
      .select('*, building:buildings(name, owner_id, owners(name))')
      .eq('payment_type', 'security_deposit')
      .order('payment_date', { ascending: false });
    if (selectedBuilding !== 'all') q = q.eq('building_id', selectedBuilding);
    const { data, error } = await q;
    if (error) toast.error('Failed to load owner payments');
    setOwnerDeposits(data || []);
  }

  function handleTenantSelect(tenantId) {
    const tenant = tenants.find(t => t.id === tenantId);
    if (tenant) {
      setTForm(p => ({
        ...p,
        tenant_id: tenantId,
        flat_id: tenant.flat_id || '',
        building_id: tenant.building_id || '',
        amount: String(tenant.monthly_rent * (tenant.security_deposit_months || 2)),
      }));
    }
  }

  async function saveTenantDeposit(e) {
    e.preventDefault();
    if (!tForm.tenant_id || !tForm.amount) return toast.error('Select tenant and enter amount');
    setSaving(true);
    try {
      const { error } = await supabase.from('security_deposits').insert({
        tenant_id: tForm.tenant_id,
        flat_id: tForm.flat_id || null,
        building_id: tForm.building_id,
        amount: Number(tForm.amount),
        payment_mode: tForm.payment_mode,
        deposit_date: tForm.deposit_date,
        deposit_type: tForm.deposit_type,
        transaction_ref: tForm.transaction_ref || null,
        notes: tForm.notes || null,
        collected_by: profile?.id,
        org_id: profile?.org_id,
      });
      if (error) throw error;

      // Update tenant's security_deposit_paid
      if (tForm.deposit_type === 'collection') {
        const tenant = tenants.find(t => t.id === tForm.tenant_id);
        const newTotal = (Number(tenant?.security_deposit_paid) || 0) + Number(tForm.amount);
        await supabase.from('tenants').update({ security_deposit_paid: newTotal }).eq('id', tForm.tenant_id);
      }

      toast.success('Security deposit recorded');
      setShowAddTenant(false);
      setTForm({ tenant_id: '', flat_id: '', building_id: '', amount: '', payment_mode: 'cash', deposit_date: new Date().toISOString().slice(0, 10), deposit_type: 'collection', transaction_ref: '', notes: '' });
      loadAll();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveOwnerDeposit(e) {
    e.preventDefault();
    if (!oForm.building_id || !oForm.amount) return toast.error('Select building and enter amount');
    setSaving(true);
    try {
      const { error } = await supabase.from('owner_payments').insert({
        building_id: oForm.building_id,
        amount: Number(oForm.amount),
        payment_type: 'security_deposit',
        payment_mode: oForm.payment_mode,
        payment_date: oForm.payment_date,
        for_month: oForm.payment_date.slice(0, 7),
        transaction_ref: oForm.transaction_ref || null,
        notes: oForm.notes || null,
        paid_by: profile?.id,
        org_id: profile?.org_id,
      });
      if (error) throw error;
      // Update building security deposit field
      const building = buildings.find(b => b.id === oForm.building_id);
      if (building) {
        const { data: bData } = await supabase.from('buildings').select('security_deposit_bank').eq('id', oForm.building_id).single();
        await supabase.from('buildings').update({
          security_deposit_bank: (Number(bData?.security_deposit_bank) || 0) + Number(oForm.amount)
        }).eq('id', oForm.building_id);
      }
      toast.success('Owner deposit recorded');
      setShowAddOwner(false);
      setOForm({ building_id: '', amount: '', payment_mode: 'bank_transfer', payment_date: new Date().toISOString().slice(0, 10), transaction_ref: '', notes: '' });
      loadAll();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const tSheet = tenantDeposits.map(d => ({
      Date: d.deposit_date, Type: d.deposit_type.toUpperCase(),
      Tenant: d.tenant?.full_name, Flat: d.flat?.door_number,
      Building: d.building?.name, Mode: d.payment_mode,
      Amount: d.amount, Reference: d.transaction_ref || '—',
    }));
    const oSheet = ownerDeposits.map(d => ({
      Date: d.payment_date, Building: d.building?.name,
      'Owner': d.building?.owners?.name || '—',
      Mode: d.payment_mode, Amount: d.amount,
      Reference: d.transaction_ref || '—', Notes: d.notes || '—',
    }));
    exportMultiSheet([
      { name: 'Tenant Deposits', data: tSheet },
      { name: 'Owner Deposits', data: oSheet },
    ], 'MMR_Security_Deposits');
    toast.success('Exported');
  }

  // Summary calculations
  const totalCollected = tenantDeposits.filter(d => d.deposit_type === 'collection').reduce((s, d) => s + Number(d.amount), 0);
  const totalRefunded = tenantDeposits.filter(d => d.deposit_type === 'refund').reduce((s, d) => s + Number(d.amount), 0);
  const netTenantDeposit = totalCollected - totalRefunded;
  const totalPaidToOwners = ownerDeposits.reduce((s, d) => s + Number(d.amount), 0);
  const netHolding = netTenantDeposit - totalPaidToOwners;

  // Per-tenant deposit status
  const tenantDepositStatus = tenants.filter(t => t.status === 'active').map(t => {
    const expected = Number(t.monthly_rent) * (t.security_deposit_months || 2);
    const paid = Number(t.security_deposit_paid) || 0;
    const pending = expected - paid;
    return { ...t, expected, paid, pending, complete: paid >= expected };
  });

  const pendingDepositCount = tenantDepositStatus.filter(t => t.pending > 0).length;
  const totalPendingAmount = tenantDepositStatus.reduce((s, t) => s + Math.max(0, t.pending), 0);

  const modeBadge = (mode) => {
    const colors = {
      cash: 'bg-amber-50 text-amber-700 border-amber-200',
      upi: 'bg-blue-50 text-blue-700 border-blue-200',
      bank_transfer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      cheque: 'bg-surface-100 text-surface-600 border-surface-200',
      other: 'bg-surface-100 text-surface-500 border-surface-200',
    };
    return <span className={`badge border text-xs ${colors[mode] || ''}`}>{MODE_LABELS[mode] || mode}</span>;
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'tenant', label: `Tenant Deposits (${tenantDeposits.length})` },
    { id: 'owner', label: `Owner Deposits (${ownerDeposits.length})` },
    { id: 'pending', label: `Pending (${pendingDepositCount})` },
  ];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Security Deposits</h1>
          <p className="text-sm text-surface-500 mt-0.5">Track deposits collected from tenants & paid to building owners</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2 text-sm">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={() => setShowAddOwner(true)} className="btn-secondary flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4" /> Owner Deposit
          </button>
          <button onClick={() => setShowAddTenant(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Tenant Deposit
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="card p-3 flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-surface-400" />
        <div>
          <label className="label text-xs mb-0.5">Building</label>
          <select className="select py-1.5 text-sm" value={selectedBuilding} onChange={e => setSelectedBuilding(e.target.value)}>
            <option value="all">All Buildings</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button onClick={loadAll} className="btn-ghost btn-sm flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-emerald-500">
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownCircle className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-surface-500">Collected from Tenants</span>
          </div>
          <p className="text-xl font-bold text-surface-900 font-mono">{formatCurrency(totalCollected)}</p>
          {totalRefunded > 0 && <p className="text-xs text-red-500 mt-1">−{formatCurrency(totalRefunded)} refunded</p>}
        </div>

        <div className="card p-4 border-l-4 border-red-400">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-surface-500">Paid to Owners</span>
          </div>
          <p className="text-xl font-bold text-surface-900 font-mono">{formatCurrency(totalPaidToOwners)}</p>
          <p className="text-xs text-surface-400 mt-1">{ownerDeposits.length} buildings</p>
        </div>

        <div className={`card p-4 border-l-4 ${netHolding >= 0 ? 'border-brand-500' : 'border-amber-400'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-4 h-4 text-brand-600" />
            <span className="text-xs font-medium text-surface-500">Net Holding</span>
          </div>
          <p className={`text-xl font-bold font-mono ${netHolding >= 0 ? 'text-brand-700' : 'text-amber-600'}`}>
            {formatCurrency(Math.abs(netHolding))}
          </p>
          <p className="text-xs text-surface-400 mt-1">{netHolding >= 0 ? 'In our hands' : 'Deficit'}</p>
        </div>

        <div className="card p-4 border-l-4 border-amber-400">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium text-surface-500">Pending Collection</span>
          </div>
          <p className="text-xl font-bold text-amber-600 font-mono">{formatCurrency(totalPendingAmount)}</p>
          <p className="text-xs text-surface-400 mt-1">{pendingDepositCount} tenants pending</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-surface-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`tab ${activeTab === t.id ? 'active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Building-wise summary */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
              <h3 className="text-sm font-semibold text-surface-700">Building-wise Position</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th className="text-right">Collected</th>
                  <th className="text-right">Paid to Owner</th>
                  <th className="text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {buildings.map(b => {
                  const bCollected = tenantDeposits.filter(d => d.building_id === b.id && d.deposit_type === 'collection').reduce((s, d) => s + Number(d.amount), 0);
                  const bRefunded = tenantDeposits.filter(d => d.building_id === b.id && d.deposit_type === 'refund').reduce((s, d) => s + Number(d.amount), 0);
                  const bPaid = ownerDeposits.filter(d => d.building_id === b.id).reduce((s, d) => s + Number(d.amount), 0);
                  const bNet = bCollected - bRefunded - bPaid;
                  if (!bCollected && !bPaid) return null;
                  return (
                    <tr key={b.id}>
                      <td className="font-medium text-surface-800">{b.name}</td>
                      <td className="text-right font-mono text-emerald-700">{formatCurrency(bCollected - bRefunded)}</td>
                      <td className="text-right font-mono text-red-500">{formatCurrency(bPaid)}</td>
                      <td className={`text-right font-mono font-semibold ${bNet >= 0 ? 'text-brand-700' : 'text-amber-600'}`}>
                        {formatCurrency(bNet)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Recent activity */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
              <h3 className="text-sm font-semibold text-surface-700">Recent Activity</h3>
            </div>
            <div className="divide-y divide-surface-100">
              {[...tenantDeposits.slice(0, 5)].map(d => (
                <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${d.deposit_type === 'collection' ? 'bg-emerald-100' : 'bg-red-100'}`}>
                    {d.deposit_type === 'collection'
                      ? <ArrowDownCircle className="w-4 h-4 text-emerald-600" />
                      : <ArrowUpCircle className="w-4 h-4 text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-800 truncate">{d.tenant?.full_name}</p>
                    <p className="text-xs text-surface-400">{d.building?.name} · {d.deposit_date}</p>
                  </div>
                  <p className={`font-mono font-semibold text-sm flex-shrink-0 ${d.deposit_type === 'collection' ? 'text-emerald-700' : 'text-red-500'}`}>
                    {d.deposit_type === 'refund' ? '−' : '+'}{formatCurrency(d.amount)}
                  </p>
                </div>
              ))}
              {tenantDeposits.length === 0 && (
                <p className="text-center text-surface-400 text-sm py-8">No deposits recorded yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tenant Deposits Tab */}
      {activeTab === 'tenant' && (
        <div className="card overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Tenant</th>
                    <th>Flat</th>
                    <th>Building</th>
                    <th>Mode</th>
                    <th className="text-right">Amount</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantDeposits.map(d => (
                    <tr key={d.id}>
                      <td className="text-xs text-surface-500">{d.deposit_date}</td>
                      <td>
                        <span className={`badge border text-xs ${d.deposit_type === 'collection' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                          {d.deposit_type === 'collection' ? 'Collected' : 'Refunded'}
                        </span>
                      </td>
                      <td className="font-medium text-surface-800">{d.tenant?.full_name || '—'}</td>
                      <td className="font-mono text-sm">{d.flat?.door_number || '—'}</td>
                      <td className="text-surface-600 text-sm">{d.building?.name || '—'}</td>
                      <td>{modeBadge(d.payment_mode)}</td>
                      <td className={`text-right font-mono font-semibold ${d.deposit_type === 'collection' ? 'text-emerald-700' : 'text-red-600'}`}>
                        {d.deposit_type === 'refund' ? '−' : ''}{formatCurrency(d.amount)}
                      </td>
                      <td className="text-xs text-surface-400">{d.transaction_ref || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-50 border-t border-surface-200">
                    <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-surface-500">Net (Collected − Refunded)</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(netTenantDeposit)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              {tenantDeposits.length === 0 && (
                <p className="text-center text-surface-400 text-sm py-10">No tenant deposits recorded</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Owner Deposits Tab */}
      {activeTab === 'owner' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Building</th>
                  <th>Owner</th>
                  <th>Mode</th>
                  <th className="text-right">Amount</th>
                  <th>Reference</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {ownerDeposits.map(d => (
                  <tr key={d.id}>
                    <td className="text-xs text-surface-500">{d.payment_date}</td>
                    <td className="font-medium text-surface-800">{d.building?.name || '—'}</td>
                    <td className="text-surface-600">{d.building?.owners?.name || '—'}</td>
                    <td>{modeBadge(d.payment_mode)}</td>
                    <td className="text-right font-mono font-semibold text-red-600">{formatCurrency(d.amount)}</td>
                    <td className="text-xs text-surface-400">{d.transaction_ref || '—'}</td>
                    <td className="text-xs text-surface-400">{d.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-50 border-t border-surface-200">
                  <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-surface-500">Total Paid to Owners</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-red-600">{formatCurrency(totalPaidToOwners)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
            {ownerDeposits.length === 0 && (
              <p className="text-center text-surface-400 text-sm py-10">No owner deposits recorded</p>
            )}
          </div>
        </div>
      )}

      {/* Pending Tab */}
      {activeTab === 'pending' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100 bg-amber-50">
            <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Tenants with pending security deposits — {formatCurrency(totalPendingAmount)} outstanding
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Building</th>
                  <th>Flat</th>
                  <th className="text-right">Monthly Rent</th>
                  <th className="text-right">Expected Deposit</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Pending</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tenantDepositStatus.filter(t => t.pending > 0).map(t => (
                  <tr key={t.id} className="bg-amber-50/30">
                    <td className="font-medium text-surface-800">{t.full_name}</td>
                    <td className="text-surface-600 text-sm">{t.buildings?.name || '—'}</td>
                    <td className="font-mono text-sm">{t.flats?.door_number || '—'}</td>
                    <td className="text-right font-mono">{formatCurrency(t.monthly_rent)}</td>
                    <td className="text-right font-mono">{formatCurrency(t.expected)}</td>
                    <td className="text-right font-mono text-emerald-700">{formatCurrency(t.paid)}</td>
                    <td className="text-right font-mono font-semibold text-amber-700">{formatCurrency(t.pending)}</td>
                    <td>
                      <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">
                        {t.paid === 0 ? 'Not paid' : 'Partial'}
                      </span>
                    </td>
                  </tr>
                ))}
                {tenantDepositStatus.filter(t => t.pending > 0).length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-surface-400 text-sm">All deposits collected ✓</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Tenant Deposit Modal */}
      {showAddTenant && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAddTenant(false)}>
          <div className="modal-content max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
              <h2 className="font-semibold text-surface-800">Record Tenant Deposit</h2>
              <button onClick={() => setShowAddTenant(false)} className="text-surface-400 hover:text-surface-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={saveTenantDeposit} className="p-5 space-y-4">
              <div>
                <label className="label">Type</label>
                <select className="select" value={tForm.deposit_type} onChange={e => setTForm(p => ({ ...p, deposit_type: e.target.value }))}>
                  <option value="collection">Collection (New deposit)</option>
                  <option value="refund">Refund (Returning deposit)</option>
                </select>
              </div>
              <div>
                <label className="label">Tenant *</label>
                <select className="select" value={tForm.tenant_id} onChange={e => handleTenantSelect(e.target.value)} required>
                  <option value="">Select tenant…</option>
                  {tenants.filter(t => t.status === 'active').map(t => (
                    <option key={t.id} value={t.id}>{t.full_name} — {t.buildings?.name} {t.flats?.door_number}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount (₹) *</label>
                  <input type="number" className="input" value={tForm.amount} onChange={e => setTForm(p => ({ ...p, amount: e.target.value }))} required />
                </div>
                <div>
                  <label className="label">Mode *</label>
                  <select className="select" value={tForm.payment_mode} onChange={e => setTForm(p => ({ ...p, payment_mode: e.target.value }))}>
                    {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Date *</label>
                  <input type="date" className="input" value={tForm.deposit_date} onChange={e => setTForm(p => ({ ...p, deposit_date: e.target.value }))} required />
                </div>
                <div>
                  <label className="label">Reference</label>
                  <input className="input" value={tForm.transaction_ref} onChange={e => setTForm(p => ({ ...p, transaction_ref: e.target.value }))} placeholder="UPI/Receipt no." />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={tForm.notes} onChange={e => setTForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddTenant(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Owner Deposit Modal */}
      {showAddOwner && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAddOwner(false)}>
          <div className="modal-content max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
              <h2 className="font-semibold text-surface-800">Record Owner Security Deposit</h2>
              <button onClick={() => setShowAddOwner(false)} className="text-surface-400 hover:text-surface-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={saveOwnerDeposit} className="p-5 space-y-4">
              <div>
                <label className="label">Building *</label>
                <select className="select" value={oForm.building_id} onChange={e => setOForm(p => ({ ...p, building_id: e.target.value }))} required>
                  <option value="">Select building…</option>
                  {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount (₹) *</label>
                  <input type="number" className="input" value={oForm.amount} onChange={e => setOForm(p => ({ ...p, amount: e.target.value }))} required />
                </div>
                <div>
                  <label className="label">Mode *</label>
                  <select className="select" value={oForm.payment_mode} onChange={e => setOForm(p => ({ ...p, payment_mode: e.target.value }))}>
                    {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Date *</label>
                  <input type="date" className="input" value={oForm.payment_date} onChange={e => setOForm(p => ({ ...p, payment_date: e.target.value }))} required />
                </div>
                <div>
                  <label className="label">Reference</label>
                  <input className="input" value={oForm.transaction_ref} onChange={e => setOForm(p => ({ ...p, transaction_ref: e.target.value }))} placeholder="Cheque/Transfer ref." />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={oForm.notes} onChange={e => setOForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddOwner(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
