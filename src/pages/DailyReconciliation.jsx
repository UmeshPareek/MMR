import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  CheckCircle2, AlertTriangle, ClipboardList, Users,
  TrendingUp, Lock, RefreshCw, ChevronDown, ChevronRight,
  Banknote, Smartphone, Building2, Calendar
} from 'lucide-react';

const MODE_LABELS = {
  cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank Transfer',
  rentok: 'RentOK', crib: 'Crib', cheque: 'Cheque', other: 'Other'
};

export default function DailyReconciliation() {
  const { profile, isAdmin, isSuperAdmin } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [myCollections, setMyCollections] = useState([]);
  const [allCollections, setAllCollections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmations, setConfirmations] = useState([]);
  const [cashInHand, setCashInHand] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [todayConfirmed, setTodayConfirmed] = useState(false);
  const [expandedCollector, setExpandedCollector] = useState(null);

  const channelRef = useRef(null);

  useEffect(() => {
    load();

    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel('reconciliation-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rent_collections' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_reconciliations' }, () => load())
      .subscribe();
    channelRef.current = channel;

    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [selectedDate]);

  async function load() {
    setLoading(true);
    try {
      // My collections for the day
      const { data: mine } = await supabase
        .from('rent_collections')
        .select('*, flat:flats(door_number), building:buildings(name), tenant:tenants(full_name)')
        .eq('payment_date', selectedDate)
        .eq('collected_by', profile?.id)
        .order('created_at', { ascending: false });
      setMyCollections(mine || []);

      // All collections for the day (admin view)
      if (isAdmin || isSuperAdmin) {
        const { data: all } = await supabase
          .from('rent_collections')
          .select('*, flat:flats(door_number), building:buildings(name), tenant:tenants(full_name), collector:profiles!collected_by(full_name)')
          .eq('payment_date', selectedDate)
          .order('created_at', { ascending: false });
        setAllCollections(all || []);
      }

      // Check if already confirmed today
      const { data: conf } = await supabase
        .from('daily_reconciliations')
        .select('*')
        .eq('date', selectedDate)
        .eq('staff_id', profile?.id);
      if (conf?.length > 0) {
        setTodayConfirmed(true);
        setCashInHand(String(conf[0].cash_in_hand || ''));
      } else {
        setTodayConfirmed(false);
        setCashInHand('');
      }

      // All confirmations for admin
      if (isAdmin || isSuperAdmin) {
        const { data: confs } = await supabase
          .from('daily_reconciliations')
          .select('*, staff:profiles!staff_id(full_name)')
          .eq('date', selectedDate);
        setConfirmations(confs || []);
      }
    } catch {
      toast.error('Failed to load — please refresh')
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    const totalCash = myCollections
      .filter(c => c.payment_mode === 'cash')
      .reduce((s, c) => s + Number(c.amount), 0);
    const cashEntered = Number(cashInHand) || 0;
    const discrepancy = cashEntered - totalCash;

    if (!cashInHand) return toast.error('Enter cash amount in hand');
    setSubmitting(true);
    try {
      const { error } = await supabase.from('daily_reconciliations').upsert({
        staff_id: profile?.id,
        date: selectedDate,
        total_logged: myCollections.reduce((s, c) => s + Number(c.amount), 0),
        cash_logged: totalCash,
        cash_in_hand: cashEntered,
        discrepancy: discrepancy,
        collection_count: myCollections.length,
        confirmed_at: new Date().toISOString(),
        notes: discrepancy !== 0 ? `Discrepancy of ₹${Math.abs(discrepancy)} ${discrepancy > 0 ? 'excess' : 'short'}` : 'Balanced',
      });
      if (error) throw error;
      toast.success(discrepancy === 0 ? '✓ Reconciliation confirmed — all balanced!' : `⚠️ Submitted with ₹${Math.abs(discrepancy)} discrepancy`);
      setTodayConfirmed(true);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const myTotal = myCollections.reduce((s, c) => s + Number(c.amount), 0);
  const myCash = myCollections.filter(c => c.payment_mode === 'cash').reduce((s, c) => s + Number(c.amount), 0);
  const myDigital = myTotal - myCash;
  const discrepancy = (Number(cashInHand) || 0) - myCash;

  // Group all collections by collector for admin view
  const byCollector = {};
  allCollections.forEach(c => {
    const key = c.collected_by || 'unknown';
    const name = c.collector?.full_name || 'Unknown';
    if (!byCollector[key]) byCollector[key] = { name, collections: [], confirmed: false };
    byCollector[key].collections.push(c);
  });
  confirmations.forEach(conf => {
    if (byCollector[conf.staff_id]) {
      byCollector[conf.staff_id].confirmed = true;
      byCollector[conf.staff_id].reconciliation = conf;
    }
  });

  const totalAllCollectors = allCollections.reduce((s, c) => s + Number(c.amount), 0);
  const confirmedCount = confirmations.length;
  const staffCount = Object.keys(byCollector).length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Daily Reconciliation</h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {isAdmin || isSuperAdmin ? 'Team collection summary & confirmation status' : 'Confirm your collections for the day'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-surface-400" />
          <input type="date" className="select py-1.5 text-sm" value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)} max={new Date().toISOString().slice(0,10)} />
          <button onClick={load} className="btn-ghost btn-sm flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── ADMIN VIEW ── */}
      {(isAdmin || isSuperAdmin) && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card p-4 border-l-4 border-brand-500">
              <p className="text-xs text-surface-500 mb-1">Total Collected</p>
              <p className="text-xl font-bold font-mono text-surface-900">{formatCurrency(totalAllCollectors)}</p>
              <p className="text-xs text-surface-400 mt-1">{allCollections.length} payments</p>
            </div>
            <div className="card p-4 border-l-4 border-amber-400">
              <p className="text-xs text-surface-500 mb-1 flex items-center gap-1"><Banknote className="w-3 h-3" />Cash</p>
              <p className="text-xl font-bold font-mono text-amber-700">
                {formatCurrency(allCollections.filter(c => c.payment_mode === 'cash').reduce((s,c) => s + Number(c.amount), 0))}
              </p>
            </div>
            <div className="card p-4 border-l-4 border-blue-400">
              <p className="text-xs text-surface-500 mb-1 flex items-center gap-1"><Smartphone className="w-3 h-3" />Digital</p>
              <p className="text-xl font-bold font-mono text-blue-700">
                {formatCurrency(allCollections.filter(c => c.payment_mode !== 'cash').reduce((s,c) => s + Number(c.amount), 0))}
              </p>
            </div>
            <div className="card p-4 border-l-4 border-emerald-400">
              <p className="text-xs text-surface-500 mb-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Confirmed</p>
              <p className="text-xl font-bold text-emerald-700">{confirmedCount}/{staffCount}</p>
              <p className="text-xs text-surface-400 mt-1">staff reconciled</p>
            </div>
          </div>

          {/* Per collector */}
          <div className="space-y-3">
            {Object.entries(byCollector).map(([id, data]) => {
              const total = data.collections.reduce((s, c) => s + Number(c.amount), 0);
              const cash = data.collections.filter(c => c.payment_mode === 'cash').reduce((s,c) => s + Number(c.amount), 0);
              const rec = data.reconciliation;
              const isExpanded = expandedCollector === id;
              return (
                <div key={id} className="card overflow-hidden">
                  <button onClick={() => setExpandedCollector(isExpanded ? null : id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 transition-colors text-left">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
                    <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xs flex-shrink-0">
                      {data.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-surface-800 text-sm">{data.name}</p>
                      <p className="text-xs text-surface-400">{data.collections.length} payments · {formatCurrency(total)}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {cash > 0 && <span className="text-xs text-amber-600 font-medium">₹{(cash/1000).toFixed(0)}K cash</span>}
                      {data.confirmed ? (
                        <div className="flex items-center gap-1.5">
                          <span className={`badge border text-xs ${rec?.discrepancy === 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            {rec?.discrepancy === 0 ? <><CheckCircle2 className="w-3 h-3" /> Balanced</> : <><AlertTriangle className="w-3 h-3" /> ₹{Math.abs(rec?.discrepancy).toLocaleString()} off</>}
                          </span>
                        </div>
                      ) : (
                        <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">
                          <AlertTriangle className="w-3 h-3" /> Not confirmed
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-surface-100">
                      {rec && (
                        <div className={`px-4 py-3 text-sm flex items-center gap-6 ${rec.discrepancy !== 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                          <span className="text-surface-600">Cash logged: <strong>{formatCurrency(rec.cash_logged)}</strong></span>
                          <span className="text-surface-600">Cash in hand: <strong>{formatCurrency(rec.cash_in_hand)}</strong></span>
                          {rec.discrepancy !== 0 && (
                            <span className="text-red-700 font-semibold">
                              {rec.discrepancy > 0 ? '+' : ''}{formatCurrency(rec.discrepancy)} discrepancy
                            </span>
                          )}
                          <span className="text-xs text-surface-400">Confirmed at {new Date(rec.confirmed_at).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'})}</span>
                        </div>
                      )}
                      <table className="data-table">
                        <thead><tr><th>Time</th><th>Tenant</th><th>Flat</th><th>Building</th><th>Mode</th><th className="text-right">Amount</th></tr></thead>
                        <tbody>
                          {data.collections.map(c => (
                            <tr key={c.id}>
                              <td className="text-xs text-surface-400">{new Date(c.created_at).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'})}</td>
                              <td className="text-surface-700">{c.tenant?.full_name || '—'}</td>
                              <td className="font-mono text-sm">{c.flat?.door_number || '—'}</td>
                              <td className="text-xs text-surface-500">{c.building?.name || '—'}</td>
                              <td><span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{MODE_LABELS[c.payment_mode] || c.payment_mode}</span></td>
                              <td className="text-right font-mono font-semibold text-emerald-700">{formatCurrency(c.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {Object.keys(byCollector).length === 0 && !loading && (
              <div className="card p-10 text-center">
                <ClipboardList className="w-10 h-10 text-surface-300 mx-auto mb-3" />
                <p className="text-surface-500 text-sm">No collections logged for {selectedDate}</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TEAM VIEW ── */}
      {!isAdmin && !isSuperAdmin && (
        <>
          {/* My summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="card p-4 border-l-4 border-brand-500">
              <p className="text-xs text-surface-500 mb-1">Total Logged</p>
              <p className="text-xl font-bold font-mono text-surface-900">{formatCurrency(myTotal)}</p>
              <p className="text-xs text-surface-400 mt-1">{myCollections.length} payments</p>
            </div>
            <div className="card p-4 border-l-4 border-amber-400">
              <p className="text-xs text-surface-500 mb-1 flex items-center gap-1"><Banknote className="w-3 h-3"/>Cash Logged</p>
              <p className="text-xl font-bold font-mono text-amber-700">{formatCurrency(myCash)}</p>
            </div>
            <div className="card p-4 border-l-4 border-blue-400">
              <p className="text-xs text-surface-500 mb-1 flex items-center gap-1"><Smartphone className="w-3 h-3"/>Digital</p>
              <p className="text-xl font-bold font-mono text-blue-700">{formatCurrency(myDigital)}</p>
            </div>
          </div>

          {/* My collections table */}
          {myCollections.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
                <h3 className="text-sm font-semibold text-surface-700">Your Collections — {selectedDate}</h3>
              </div>
              <table className="data-table">
                <thead><tr><th>Time</th><th>Tenant</th><th>Flat</th><th>Building</th><th>Mode</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {myCollections.map(c => (
                    <tr key={c.id}>
                      <td className="text-xs text-surface-400">{new Date(c.created_at).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'})}</td>
                      <td className="text-surface-700">{c.tenant?.full_name || '—'}</td>
                      <td className="font-mono text-sm">{c.flat?.door_number || '—'}</td>
                      <td className="text-xs text-surface-500">{c.building?.name || '—'}</td>
                      <td><span className={`badge border text-xs ${c.payment_mode === 'cash' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>{MODE_LABELS[c.payment_mode] || c.payment_mode}</span></td>
                      <td className="text-right font-mono font-semibold text-emerald-700">{formatCurrency(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Confirmation form */}
          {todayConfirmed ? (
            <div className="card p-5 border border-emerald-200 bg-emerald-50">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-800">Day confirmed for {selectedDate}</p>
                  <p className="text-sm text-emerald-700 mt-0.5">Cash in hand: {formatCurrency(Number(cashInHand))} · Logged: {formatCurrency(myCash)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-5 border-2 border-brand-200">
              <h3 className="font-semibold text-surface-800 mb-1 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-brand-600" />
                End of Day Confirmation
              </h3>
              <p className="text-sm text-surface-500 mb-4">
                You logged <strong>{formatCurrency(myCash)}</strong> in cash today. Count your cash and enter the actual amount below.
              </p>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="label">Cash in hand right now (₹)</label>
                  <input type="number" className="input" placeholder="0"
                    value={cashInHand} onChange={e => setCashInHand(e.target.value)} />
                </div>
                <button onClick={handleConfirm} disabled={submitting || myCollections.length === 0}
                  className="btn-primary flex items-center gap-2 mb-0">
                  {submitting
                    ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <CheckCircle2 className="w-4 h-4" />}
                  Confirm Day
                </button>
              </div>
              {cashInHand && (
                <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${discrepancy === 0 ? 'bg-emerald-50 text-emerald-700' : discrepancy > 0 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                  {discrepancy === 0 && '✓ Balanced — cash in hand matches logged amount'}
                  {discrepancy > 0 && `You have ₹${discrepancy.toLocaleString()} more than logged — please check`}
                  {discrepancy < 0 && `⚠️ You are ₹${Math.abs(discrepancy).toLocaleString()} short — please check before confirming`}
                </div>
              )}
              {myCollections.length === 0 && (
                <p className="text-xs text-surface-400 mt-2">No collections logged today — nothing to confirm</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
