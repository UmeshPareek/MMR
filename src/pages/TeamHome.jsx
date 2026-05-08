import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths } from '../utils/helpers';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, Clock, Phone, Plus,
  Building2, ChevronDown, ChevronRight, Zap, Droplets, AlertTriangle
} from 'lucide-react';

export default function TeamHome() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const months = lastNMonths(2);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState('unpaid'); // unpaid | all

  useEffect(() => { load(); }, [selectedMonth, filter]);

  async function load() {
    setLoading(true);
    try {
      const { data: flats } = await supabase
        .from('flats')
        .select('id, door_number, monthly_rent, building_id, buildings(id, name)')
        .eq('status', 'occupied');

      const flatIds = (flats || []).map(f => f.id);
      if (!flatIds.length) { setData([]); setLoading(false); return; }

      const [{ data: tenants }, { data: collections }, { data: utils }] = await Promise.all([
        supabase.from('tenants').select('id, full_name, phone, flat_id').eq('status', 'active').in('flat_id', flatIds),
        supabase.from('rent_collections').select('flat_id, amount, payment_mode').eq('for_month', selectedMonth).in('flat_id', flatIds),
        supabase.from('flat_utilities').select('flat_id, electricity_amount, water_amount').eq('for_month', selectedMonth).in('flat_id', flatIds),
      ]);

      const tenantMap = {}, collMap = {}, utilMap = {};
      (tenants || []).forEach(t => { tenantMap[t.flat_id] = t; });
      (collections || []).forEach(c => {
        collMap[c.flat_id] = (collMap[c.flat_id] || 0) + Number(c.amount);
      });
      (utils || []).forEach(u => { utilMap[u.flat_id] = u; });

      const rows = (flats || []).map(flat => {
        const tenant = tenantMap[flat.id];
        const paid = collMap[flat.id] || 0;
        const expected = Number(flat.monthly_rent);
        const balance = expected - paid;
        let status = paid >= expected ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
        return {
          id: flat.id, doorNumber: flat.door_number, buildingId: flat.building_id,
          buildingName: flat.buildings?.name || '—',
          tenant: tenant?.full_name || '—', phone: tenant?.phone || '',
          expected, paid, balance, status,
          hasElec: !!utilMap[flat.id]?.electricity_amount,
          hasWater: !!utilMap[flat.id]?.water_amount,
        };
      });

      const filtered = filter === 'unpaid' ? rows.filter(r => r.status !== 'paid') : rows;

      // Group by building
      const bMap = {};
      filtered.forEach(r => {
        if (!bMap[r.buildingId]) bMap[r.buildingId] = { name: r.buildingName, flats: [] };
        bMap[r.buildingId].flats.push(r);
      });

      const list = Object.entries(bMap).map(([id, v]) => {
        v.flats.sort((a, b) => a.doorNumber.localeCompare(b.doorNumber));
        return { id, ...v,
          unpaid: v.flats.filter(f => f.status === 'unpaid').length,
          partial: v.flats.filter(f => f.status === 'partial').length,
          paid: v.flats.filter(f => f.status === 'paid').length,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      setData(list);
      // Auto-expand all
      const exp = {};
      list.forEach(b => { exp[b.id] = true; });
      setExpanded(exp);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  const totalBalance = data.flatMap(b => b.flats).reduce((s, f) => s + f.balance, 0);
  const totalUnpaid = data.flatMap(b => b.flats).filter(f => f.status !== 'paid').length;

  const statusIcon = (s) => {
    if (s === 'paid') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (s === 'partial') return <Clock className="w-4 h-4 text-amber-500" />;
    return <XCircle className="w-4 h-4 text-red-500" />;
  };

  return (
    <div className="space-y-5">

      {/* Greeting */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900">
            {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {profile?.full_name?.split(' ')[0]}
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {totalUnpaid > 0 ? `${totalUnpaid} flats pending collection` : 'All collections done for this month'}
          </p>
        </div>
        <button onClick={() => navigate('/payments')}
          className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Log Payment
        </button>
      </div>

      {/* Quick stats */}
      {totalBalance > 0 && (
        <div className="card p-4 border-l-4 border-amber-400 flex items-center justify-between">
          <div>
            <p className="text-xs text-surface-500">Outstanding this month</p>
            <p className="text-2xl font-bold font-mono text-amber-600">{formatCurrency(totalBalance)}</p>
          </div>
          <AlertTriangle className="w-8 h-8 text-amber-300" />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select className="select w-auto py-1.5 text-sm" value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="flex gap-1">
          {[
            { v: 'unpaid', label: 'Pending' },
            { v: 'all', label: 'All Flats' },
          ].map(({ v, label }) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`btn btn-sm ${filter === v ? 'btn-primary' : 'btn-secondary'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Building list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data.length === 0 ? (
        <div className="card p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <p className="font-semibold text-surface-700">All collections done for {selectedMonth}</p>
          <p className="text-surface-400 text-sm mt-1">Every flat has paid their rent.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(building => (
            <div key={building.id} className="card overflow-hidden">
              <button onClick={() => setExpanded(p => ({ ...p, [building.id]: !p[building.id] }))}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 transition-colors text-left">
                {expanded[building.id] ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
                <Building2 className="w-4 h-4 text-surface-400" />
                <span className="font-semibold text-surface-800 flex-1">{building.name}</span>
                <div className="flex items-center gap-2">
                  {building.unpaid > 0 && <span className="badge bg-red-50 text-red-700 border border-red-200 text-xs">{building.unpaid} unpaid</span>}
                  {building.partial > 0 && <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">{building.partial} partial</span>}
                  {building.paid > 0 && <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">{building.paid} paid</span>}
                </div>
              </button>

              {expanded[building.id] && (
                <div className="border-t border-surface-100 divide-y divide-surface-100">
                  {building.flats.map(flat => (
                    <div key={flat.id} className={`flex items-center gap-3 px-4 py-3 ${flat.status === 'unpaid' ? 'bg-red-50/30' : flat.status === 'partial' ? 'bg-amber-50/20' : ''}`}>
                      {statusIcon(flat.status)}
                      <div className="w-16 flex-shrink-0">
                        <p className="font-mono font-semibold text-sm text-surface-800">{flat.doorNumber}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-700 truncate">{flat.tenant}</p>
                        {flat.phone && (
                          <a href={`tel:${flat.phone}`} className="text-xs text-brand-600 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3" />{flat.phone}
                          </a>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {flat.status === 'paid' ? (
                          <p className="text-sm font-mono font-semibold text-emerald-600">{formatCurrency(flat.paid)}</p>
                        ) : (
                          <>
                            <p className="text-sm font-mono font-semibold text-red-600">{formatCurrency(flat.balance)} due</p>
                            {flat.paid > 0 && <p className="text-xs text-surface-400 font-mono">{formatCurrency(flat.paid)} paid</p>}
                          </>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {!flat.hasElec && <Zap className="w-3.5 h-3.5 text-amber-400" title="Electricity not entered" />}
                        {!flat.hasWater && <Droplets className="w-3.5 h-3.5 text-blue-400" title="Water not entered" />}
                      </div>
                      <button onClick={() => navigate('/payments')}
                        className="btn btn-sm btn-secondary text-xs flex-shrink-0">
                        + Pay
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
