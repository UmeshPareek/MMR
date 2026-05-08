import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency, lastNMonths, fmtDate } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  Building2, ArrowLeft, Users, CreditCard, Zap, Droplets,
  ShieldCheck, Banknote, CheckCircle2, XCircle, Clock,
  TrendingUp, AlertCircle, Phone, Edit2
} from 'lucide-react';

export default function BuildingFile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const months = lastNMonths(3);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [building, setBuilding] = useState(null);
  const [flats, setFlats] = useState([]);
  const [collections, setCollections] = useState([]);
  const [utilities, setUtilities] = useState([]);
  const [ownerPayments, setOwnerPayments] = useState([]);
  const [deposits, setDeposits] = useState({ tenantTotal: 0, ownerTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => { loadBuilding(); }, [id]);
  useEffect(() => { if (building) loadMonthData(); }, [selectedMonth, building]);

  async function loadBuilding() {
    const { data: b } = await supabase
      .from('buildings')
      .select('*, owners(name, phone, bank_name, bank_account)')
      .eq('id', id).single();
    setBuilding(b);

    const { data: flatData } = await supabase
      .from('flats')
      .select('*, tenants!flats_current_tenant_id_fkey(id, full_name, phone, move_in_date, monthly_rent, security_deposit_paid, security_deposit_months)')
      .eq('building_id', id)
      .order('door_number');
    setFlats(flatData || []);

    // Deposit totals
    const { data: td } = await supabase.from('security_deposits').select('amount, deposit_type').eq('building_id', id);
    const tenantTotal = (td || []).filter(d => d.deposit_type === 'collection').reduce((s, d) => s + Number(d.amount), 0)
      - (td || []).filter(d => d.deposit_type === 'refund').reduce((s, d) => s + Number(d.amount), 0);
    const { data: op } = await supabase.from('owner_payments').select('amount').eq('building_id', id).eq('payment_type', 'security_deposit');
    const ownerTotal = (op || []).reduce((s, d) => s + Number(d.amount), 0);
    setDeposits({ tenantTotal, ownerTotal });

    setLoading(false);
  }

  async function loadMonthData() {
    const flatIds = flats.map(f => f.id);
    if (!flatIds.length) return;

    const [{ data: coll }, { data: util }, { data: ownerPmt }] = await Promise.all([
      supabase.from('rent_collections').select('*').eq('building_id', id).eq('for_month', selectedMonth),
      supabase.from('flat_utilities').select('*').eq('building_id', id).eq('for_month', selectedMonth),
      supabase.from('owner_payments').select('*').eq('building_id', id).order('payment_date', { ascending: false }).limit(6),
    ]);
    setCollections(coll || []);
    setUtilities(util || []);
    setOwnerPayments(ownerPmt || []);
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!building) return (
    <div className="card p-10 text-center">
      <p className="text-surface-500">Building not found</p>
      <button onClick={() => navigate('/buildings')} className="btn-secondary mt-3">Go back</button>
    </div>
  );

  const occupied = flats.filter(f => f.status === 'occupied').length;
  const vacant = flats.filter(f => f.status === 'vacant').length;
  const totalRent = flats.filter(f => f.status === 'occupied').reduce((s, f) => s + Number(f.monthly_rent), 0);
  const collByFlat = {};
  collections.forEach(c => { collByFlat[c.flat_id] = (collByFlat[c.flat_id] || 0) + Number(c.amount); });
  const utilByFlat = {};
  utilities.forEach(u => { utilByFlat[u.flat_id] = u; });
  const totalCollected = collections.reduce((s, c) => s + Number(c.amount), 0);
  const totalElec = utilities.reduce((s, u) => s + Number(u.electricity_amount || 0), 0);
  const totalWater = utilities.reduce((s, u) => s + Number(u.water_amount || 0), 0);

  const flatStatus = (flat) => {
    const paid = collByFlat[flat.id] || 0;
    const expected = Number(flat.monthly_rent);
    if (flat.status !== 'occupied') return { status: flat.status, paid: 0, balance: 0 };
    if (paid >= expected) return { status: 'paid', paid, balance: 0 };
    if (paid > 0) return { status: 'partial', paid, balance: expected - paid };
    return { status: 'unpaid', paid: 0, balance: expected };
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'flats', label: `Flats (${flats.length})` },
    { id: 'collections', label: 'Collections' },
    { id: 'utilities', label: 'Utilities' },
    { id: 'owner', label: 'Owner' },
  ];

  const statusBadge = (s) => {
    const map = {
      paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      partial: 'bg-amber-50 text-amber-700 border-amber-200',
      unpaid: 'bg-red-50 text-red-700 border-red-200',
      vacant: 'bg-surface-100 text-surface-500 border-surface-200',
      maintenance: 'bg-purple-50 text-purple-700 border-purple-200',
    };
    return <span className={`badge border text-xs ${map[s] || ''}`}>{s.toUpperCase()}</span>;
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/buildings')}
          className="btn-ghost p-2 mt-0.5 flex-shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-surface-900">{building.name}</h1>
          <p className="text-sm text-surface-500 mt-0.5">{building.address}{building.area ? ` · ${building.area}` : ''}</p>
        </div>
        <select className="select w-auto py-1.5 text-sm"
          value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-brand-500">
          <p className="text-xs text-surface-500 mb-1">Total Flats</p>
          <p className="text-xl font-bold text-surface-900">{flats.length}</p>
          <p className="text-xs text-surface-400 mt-1">{occupied} occupied · {vacant} vacant</p>
        </div>
        <div className="card p-4 border-l-4 border-emerald-500">
          <p className="text-xs text-surface-500 mb-1">Rent Roll</p>
          <p className="text-xl font-bold font-mono text-surface-900">{formatCurrency(totalRent)}</p>
          <p className="text-xs text-emerald-600 mt-1">{formatCurrency(totalCollected)} collected</p>
        </div>
        <div className="card p-4 border-l-4 border-red-400">
          <p className="text-xs text-surface-500 mb-1">Owner Rent</p>
          <p className="text-xl font-bold font-mono text-surface-900">{formatCurrency(building.monthly_rent_to_owner || 0)}</p>
          <p className="text-xs text-surface-400 mt-1">Per month</p>
        </div>
        <div className="card p-4 border-l-4 border-blue-400">
          <p className="text-xs text-surface-500 mb-1">Security Deposits</p>
          <p className="text-xl font-bold font-mono text-surface-900">{formatCurrency(deposits.tenantTotal)}</p>
          <p className="text-xs text-surface-400 mt-1">{formatCurrency(deposits.ownerTotal)} paid to owner</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`tab flex-shrink-0 ${activeTab === t.id ? 'active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Collection status */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-surface-700">Collection Status — {selectedMonth}</h3>
              <div className="flex items-center gap-1 text-xs text-surface-400">
                <span className="text-emerald-600 font-semibold">{formatCurrency(totalCollected)}</span>
                <span>/ {formatCurrency(totalRent)}</span>
              </div>
            </div>
            <div className="divide-y divide-surface-100">
              {flats.filter(f => f.status === 'occupied').map(flat => {
                const fs = flatStatus(flat);
                return (
                  <div key={flat.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="w-16 flex-shrink-0 font-mono text-sm font-medium text-surface-700">{flat.door_number}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-surface-700 truncate">{flat.tenants?.full_name || '—'}</p>
                    </div>
                    {statusBadge(fs.status)}
                    <div className="text-right flex-shrink-0 w-24">
                      {fs.status === 'paid'
                        ? <span className="text-sm font-mono text-emerald-600">{formatCurrency(fs.paid)}</span>
                        : <span className="text-sm font-mono text-red-600">{formatCurrency(fs.balance)} due</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Building info */}
          <div className="space-y-3">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-surface-700 mb-3">Building Details</h3>
              <dl className="space-y-2">
                {[
                  ['Owner', building.owners?.name || '—'],
                  ['Owner Phone', building.owners?.phone || '—'],
                  ['Monthly Rent to Owner', formatCurrency(building.monthly_rent_to_owner || 0)],
                  ['Lease Start', building.lease_start_date || '—'],
                  ['Lease End', building.lease_end_date || '—'],
                  ['City', building.city || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-sm">
                    <dt className="text-surface-400">{label}</dt>
                    <dd className="font-medium text-surface-700">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-surface-700 mb-3">Utility Summary — {selectedMonth}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="w-3.5 h-3.5 text-yellow-600" />
                    <span className="text-xs font-medium text-yellow-700">Electricity</span>
                  </div>
                  <p className="text-lg font-bold font-mono text-yellow-700">{formatCurrency(totalElec)}</p>
                  <p className="text-xs text-yellow-600 mt-0.5">{utilities.filter(u => u.electricity_amount > 0).length}/{occupied} entered</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Droplets className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-medium text-blue-700">Water</span>
                  </div>
                  <p className="text-lg font-bold font-mono text-blue-700">{formatCurrency(totalWater)}</p>
                  <p className="text-xs text-blue-600 mt-0.5">{utilities.filter(u => u.water_amount > 0).length}/{occupied} entered</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FLATS */}
      {activeTab === 'flats' && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Door No</th>
                <th>Type</th>
                <th>Tenant</th>
                <th>Phone</th>
                <th>Move-in</th>
                <th className="text-right">Monthly Rent</th>
                <th className="text-right">Security Dep.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {flats.map(flat => (
                <tr key={flat.id}>
                  <td className="font-mono font-semibold text-surface-800">{flat.door_number}</td>
                  <td className="text-surface-500 text-xs">{flat.flat_type || '—'}</td>
                  <td className="font-medium text-surface-700">{flat.tenants?.full_name || <span className="text-surface-400">Vacant</span>}</td>
                  <td>
                    {flat.tenants?.phone
                      ? <a href={`tel:${flat.tenants.phone}`} className="text-xs text-brand-600 flex items-center gap-1"><Phone className="w-3 h-3" />{flat.tenants.phone}</a>
                      : <span className="text-surface-300">—</span>}
                  </td>
                  <td className="text-xs text-surface-500">{flat.tenants?.move_in_date || '—'}</td>
                  <td className="text-right font-mono">{formatCurrency(flat.monthly_rent)}</td>
                  <td className="text-right font-mono text-surface-500">
                    {flat.tenants ? formatCurrency(flat.tenants.security_deposit_paid || 0) : '—'}
                  </td>
                  <td>
                    <span className={`badge border text-xs ${flat.status === 'occupied' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : flat.status === 'vacant' ? 'bg-surface-100 text-surface-500 border-surface-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                      {flat.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* COLLECTIONS */}
      {activeTab === 'collections' && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Flat</th>
                <th>Tenant</th>
                <th>Mode</th>
                <th className="text-right">Amount</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {collections.map(c => (
                <tr key={c.id}>
                  <td className="text-xs text-surface-500">{c.payment_date}</td>
                  <td className="font-mono text-sm">{flats.find(f => f.id === c.flat_id)?.door_number || '—'}</td>
                  <td>{flats.find(f => f.id === c.flat_id)?.tenants?.full_name || '—'}</td>
                  <td><span className="badge bg-brand-50 text-brand-700 border border-brand-100 text-xs">{c.payment_mode}</span></td>
                  <td className="text-right font-mono font-semibold text-emerald-700">{formatCurrency(c.amount)}</td>
                  <td className="text-xs text-surface-400">{c.transaction_ref || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-50 border-t border-surface-200">
                <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-surface-500">Total</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(totalCollected)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {collections.length === 0 && <p className="text-center py-8 text-surface-400 text-sm">No collections for {selectedMonth}</p>}
        </div>
      )}

      {/* UTILITIES */}
      {activeTab === 'utilities' && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Flat</th>
                <th>Tenant</th>
                <th className="text-right">Electricity</th>
                <th className="text-right">Water</th>
                <th className="text-right">Other</th>
                <th className="text-right">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {flats.filter(f => f.status === 'occupied').map(flat => {
                const u = utilByFlat[flat.id];
                const total = u ? Number(u.electricity_amount || 0) + Number(u.water_amount || 0) + Number(u.other_charges || 0) : 0;
                return (
                  <tr key={flat.id}>
                    <td className="font-mono font-semibold text-surface-800">{flat.door_number}</td>
                    <td>{flat.tenants?.full_name || '—'}</td>
                    <td className="text-right font-mono">{u?.electricity_amount ? formatCurrency(u.electricity_amount) : <span className="text-surface-300">—</span>}</td>
                    <td className="text-right font-mono">{u?.water_amount ? formatCurrency(u.water_amount) : <span className="text-surface-300">—</span>}</td>
                    <td className="text-right font-mono">{u?.other_charges ? formatCurrency(u.other_charges) : <span className="text-surface-300">—</span>}</td>
                    <td className="text-right font-mono font-semibold text-surface-700">{total > 0 ? formatCurrency(total) : '—'}</td>
                    <td>{u ? <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">Entered</span> : <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3" />Pending</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-50 border-t border-surface-200">
                <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-surface-500">Total</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-yellow-700">{formatCurrency(totalElec)}</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-blue-700">{formatCurrency(totalWater)}</td>
                <td />
                <td className="px-4 py-2 text-right font-mono font-bold text-surface-700">{formatCurrency(totalElec + totalWater)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* OWNER */}
      {activeTab === 'owner' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-surface-700 mb-4">Owner Details</h3>
            <dl className="space-y-3">
              {[
                ['Name', building.owners?.name || '—'],
                ['Phone', building.owners?.phone || '—'],
                ['Bank', building.owners?.bank_name || '—'],
                ['Account No', building.owners?.bank_account || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm border-b border-surface-100 pb-2">
                  <dt className="text-surface-400">{label}</dt>
                  <dd className="font-medium text-surface-700">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                <p className="text-xs text-red-600 mb-1">Monthly Rent to Owner</p>
                <p className="text-lg font-bold font-mono text-red-700">{formatCurrency(building.monthly_rent_to_owner || 0)}</p>
              </div>
              <div className="bg-surface-50 rounded-lg p-3 border border-surface-200">
                <p className="text-xs text-surface-500 mb-1">Security Deposit Paid</p>
                <p className="text-lg font-bold font-mono text-surface-700">{formatCurrency(deposits.ownerTotal)}</p>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
              <h3 className="text-sm font-semibold text-surface-700">Recent Owner Payments</h3>
            </div>
            <div className="divide-y divide-surface-100">
              {ownerPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-surface-700">{p.payment_type?.replace('_', ' ').toUpperCase()}</p>
                    <p className="text-xs text-surface-400">{p.payment_date} · {p.payment_mode}</p>
                  </div>
                  <p className="font-mono font-semibold text-red-600">{formatCurrency(p.amount)}</p>
                </div>
              ))}
              {ownerPayments.length === 0 && <p className="text-center py-8 text-surface-400 text-sm">No payments recorded</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
