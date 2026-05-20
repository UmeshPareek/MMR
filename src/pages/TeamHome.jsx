import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths } from '../utils/helpers';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, Clock, Phone, Plus,
  Building2, ChevronDown, ChevronRight, Zap, Droplets, AlertTriangle
} from 'lucide-react';

const WaIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

export default function TeamHome() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const months = lastNMonths(2);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState('unpaid');

  const channelRef = useRef(null);

  useEffect(() => {
    load();
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel('teamhome-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rent_collections' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flat_utilities' }, () => load())
      .subscribe();
    channelRef.current = channel;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [selectedMonth, filter]);

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
      (collections || []).forEach(c => { collMap[c.flat_id] = (collMap[c.flat_id] || 0) + Number(c.amount); });
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

      const bMap = {};
      filtered.forEach(r => {
        if (!bMap[r.buildingId]) bMap[r.buildingId] = { name: r.buildingName, flats: [] };
        bMap[r.buildingId].flats.push(r);
      });

      const list = Object.entries(bMap).map(([id, v]) => {
        v.flats.sort((a, b) => a.doorNumber.localeCompare(b.doorNumber));
        return { id, ...v,
          unpaid:  v.flats.filter(f => f.status === 'unpaid').length,
          partial: v.flats.filter(f => f.status === 'partial').length,
          paid:    v.flats.filter(f => f.status === 'paid').length,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      setData(list);
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
  const totalUnpaid  = data.flatMap(b => b.flats).filter(f => f.status !== 'paid').length;
  const totalPaid    = data.flatMap(b => b.flats).filter(f => f.status === 'paid').length;
  const totalFlats   = data.flatMap(b => b.flats).length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const statusIcon = (s) => {
    if (s === 'paid')    return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
    if (s === 'partial') return <Clock        className="w-4 h-4 text-amber-500  flex-shrink-0" />;
    return                      <XCircle      className="w-4 h-4 text-red-400    flex-shrink-0" />;
  };

  return (
    <div className="space-y-4">

      {/* Greeting header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-display font-bold text-surface-900 dark:text-surface-50 tracking-tight">
            {greeting}, {profile?.full_name?.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {totalUnpaid > 0
              ? `${totalUnpaid} flat${totalUnpaid > 1 ? 's' : ''} pending collection`
              : 'All collections done!'}
          </p>
        </div>
        <button
          onClick={() => navigate('/payments')}
          className="btn-primary flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden xs:inline">Log Payment</span>
          <span className="xs:hidden">Pay</span>
        </button>
      </div>

      {/* Outstanding banner */}
      {totalBalance > 0 && (
        <div className="card p-4 border-l-4 border-amber-400 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-surface-500 font-medium">Outstanding this month</p>
            <p className="text-2xl font-display font-bold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
              {formatCurrency(totalBalance)}
            </p>
          </div>
          <AlertTriangle className="w-8 h-8 text-amber-300 flex-shrink-0" />
        </div>
      )}

      {/* Progress bar when all paid */}
      {totalFlats > 0 && (
        <div className="card p-3 flex items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5 text-xs">
              <span className="text-surface-500 font-medium">{totalPaid}/{totalFlats} collected</span>
              <span className={`font-semibold ${totalPaid === totalFlats ? 'text-emerald-600' : 'text-brand-600'}`}>
                {Math.round((totalPaid / totalFlats) * 100)}%
              </span>
            </div>
            <div className="h-2 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round((totalPaid / totalFlats) * 100)}%`,
                  background: totalPaid === totalFlats
                    ? 'linear-gradient(90deg,#059669,#10b981)'
                    : 'linear-gradient(90deg,#0d9488,#14b8a6)',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Month + filter controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="select w-auto py-1.5 text-sm flex-shrink-0"
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
        >
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="flex gap-1">
          {[
            { v: 'unpaid', label: 'Pending' },
            { v: 'all',    label: 'All' },
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
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="card p-4 space-y-3">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="card p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <p className="font-display font-semibold text-surface-700 dark:text-surface-300">All collected for {selectedMonth}</p>
          <p className="text-surface-400 text-sm mt-1">Every flat has paid.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(building => (
            <div key={building.id} className="card overflow-hidden">
              {/* Building header */}
              <button
                onClick={() => setExpanded(p => ({ ...p, [building.id]: !p[building.id] }))}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 dark:hover:bg-white/3 transition-colors text-left"
              >
                {expanded[building.id]
                  ? <ChevronDown  className="w-4 h-4 text-surface-400 flex-shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-surface-400 flex-shrink-0" />}
                <Building2 className="w-4 h-4 text-surface-400 flex-shrink-0" />
                <span className="font-semibold text-surface-800 dark:text-surface-200 flex-1 text-sm">{building.name}</span>
                <div className="flex items-center gap-1.5">
                  {building.unpaid  > 0 && <span className="badge bg-red-50     text-red-700     border border-red-200     dark:bg-red-900/20     dark:text-red-400     dark:border-red-800/40     text-xs">{building.unpaid}  unpaid</span>}
                  {building.partial > 0 && <span className="badge bg-amber-50   text-amber-700   border border-amber-200   dark:bg-amber-900/20   dark:text-amber-400   dark:border-amber-800/40   text-xs">{building.partial} partial</span>}
                  {building.paid    > 0 && <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/40 text-xs">{building.paid}    paid</span>}
                </div>
              </button>

              {/* Flat cards */}
              {expanded[building.id] && (
                <div className="border-t border-surface-100 dark:border-white/5 divide-y divide-surface-100 dark:divide-white/5">
                  {building.flats.map(flat => (
                    <div
                      key={flat.id}
                      className={`px-4 py-3 ${
                        flat.status === 'unpaid'  ? 'bg-red-50/40  dark:bg-red-900/10' :
                        flat.status === 'partial' ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''
                      }`}
                    >
                      {/* Row: icon + door + name | amount + action */}
                      <div className="flex items-center gap-3">
                        {statusIcon(flat.status)}

                        {/* Door number */}
                        <span className="font-mono font-bold text-sm text-surface-800 dark:text-surface-200 w-12 flex-shrink-0">
                          {flat.doorNumber}
                        </span>

                        {/* Tenant name */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{flat.tenant}</p>
                        </div>

                        {/* Amount */}
                        <div className="text-right flex-shrink-0">
                          {flat.status === 'paid' ? (
                            <p className="text-sm font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(flat.paid)}
                            </p>
                          ) : (
                            <>
                              <p className="text-sm font-mono font-bold text-red-600 dark:text-red-400">
                                ₹{flat.balance.toLocaleString('en-IN')}
                              </p>
                              {flat.paid > 0 && (
                                <p className="text-[10px] text-surface-400 font-mono">{formatCurrency(flat.paid)} paid</p>
                              )}
                            </>
                          )}
                        </div>

                        {/* Pay button */}
                        {flat.status !== 'paid' && (
                          <button
                            onClick={() => navigate('/payments')}
                            className="btn-primary btn-sm flex-shrink-0 px-3"
                          >
                            Pay
                          </button>
                        )}
                      </div>

                      {/* Second row: phone, whatsapp, utility icons */}
                      {(flat.phone || !flat.hasElec || !flat.hasWater) && (
                        <div className="flex items-center gap-3 mt-1.5 pl-7">
                          {flat.phone && (
                            <a
                              href={`tel:${flat.phone}`}
                              className="flex items-center gap-1 text-xs text-surface-400 dark:text-surface-500 hover:text-brand-600 transition-colors"
                            >
                              <Phone className="w-3 h-3" />{flat.phone}
                            </a>
                          )}
                          {flat.phone && flat.status !== 'paid' && (
                            <a
                              href={`https://wa.me/91${flat.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hi ${flat.tenant}, your rent of ₹${flat.expected} is pending for ${selectedMonth}. Balance due: ₹${flat.balance}. Please pay at the earliest. - CashMyRent`)}`}
                              target="_blank" rel="noreferrer"
                              className="text-emerald-600 hover:text-emerald-700 transition-colors"
                              title="Send WhatsApp reminder"
                            >
                              <WaIcon />
                            </a>
                          )}
                          <div className="flex gap-1.5 ml-auto">
                            {!flat.hasElec  && <Zap      className="w-3.5 h-3.5 text-amber-400" title="Electricity not entered" />}
                            {!flat.hasWater && <Droplets className="w-3.5 h-3.5 text-blue-400"  title="Water not entered" />}
                          </div>
                        </div>
                      )}
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
