import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths, exportMultiSheet } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  ShieldCheck, Upload, Download, AlertTriangle, CheckCircle2,
  XCircle, FileText, Eye, X, Plus, Trash2, Lock,
  Building2, TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronRight
} from 'lucide-react';

const MONTHS = lastNMonths(6);

// ─── Name fuzzy match ─────────────────────────────────────
function nameScore(a, b) {
  a = (a || '').toLowerCase().replace(/\s+/g, '');
  b = (b || '').toLowerCase().replace(/\s+/g, '');
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 90;
  let common = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) common++; else break;
  }
  return Math.round((common / Math.min(a.length, b.length)) * 100);
}

// ─── Parse HDFC narration ────────────────────────────────
function parseHDFCNarration(narration) {
  const n = (narration || '').toUpperCase();
  const atnMatch = n.match(/ATN-[A-Z0-9]+-([A-Z]+)(\d{3,4})(RENT|OTHERS|ELECTRICI|WATER|DEPOSIT)?/);
  if (atnMatch) {
    const typeStr = (atnMatch[3] || '').toLowerCase();
    return {
      tenantHint: atnMatch[1].toLowerCase(),
      roomHint: atnMatch[2],
      txnType: typeStr.includes('rent') ? 'rent' : typeStr.includes('electric') ? 'electricity' : typeStr.includes('water') ? 'water' : typeStr.includes('deposit') ? 'deposit' : 'other',
    };
  }
  return { tenantHint: null, roomHint: null, txnType: 'other' };
}

// ─── Parse ICICI narration ───────────────────────────────
function parseICICINarration(narration) {
  const n = (narration || '').toUpperCase();
  let tenantHint = null, txnType = 'other';
  if (n.includes('RENTAL')) txnType = 'rent';
  const upiName = n.match(/UPI\/([A-Z]+)/);
  const neftName = n.match(/NEFT-[A-Z0-9]+-([A-Z]+)/);
  if (upiName) tenantHint = upiName[1].toLowerCase();
  else if (neftName) tenantHint = neftName[1].toLowerCase();
  return { tenantHint, roomHint: null, txnType };
}

export default function Audit() {
  const { isSuperAdmin } = useAuth();
  const months = MONTHS;
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 2] || months[months.length - 1]);

  // File queue — multiple files
  const [fileQueue, setFileQueue] = useState([]); // [{file, bank, password, status, txns}]
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();

  // Results
  const [results, setResults] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="card p-8 text-center max-w-sm">
          <ShieldCheck className="w-12 h-12 text-brand-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-surface-800 mb-2">Access Restricted</h2>
          <p className="text-surface-500 text-sm">Audit is only available to Super Admin.</p>
        </div>
      </div>
    );
  }

  function addFiles(e) {
    const files = Array.from(e.target.files || []);
    const newItems = files.map(file => ({
      id: Date.now() + Math.random(),
      file,
      bank: file.name.toLowerCase().includes('icici') ? 'icici' : 'hdfc',
      password: '',
      status: 'pending', // pending | parsing | done | error
      txns: [],
      error: null,
    }));
    setFileQueue(prev => [...prev, ...newItems]);
    fileRef.current.value = '';
  }

  function removeFile(id) {
    setFileQueue(prev => prev.filter(f => f.id !== id));
  }

  function updateFile(id, field, value) {
    setFileQueue(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
  }

  async function parseAllFiles() {
    if (!fileQueue.length) return toast.error('Add at least one bank statement');
    setParsing(true);

    const updated = [...fileQueue];
    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      if (item.status === 'done') continue;

      updated[i] = { ...item, status: 'parsing' };
      setFileQueue([...updated]);

      try {
        const base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result.split(',')[1]);
          reader.onerror = rej;
          reader.readAsDataURL(item.file);
        });

        const response = await fetch('/api/extract-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfBase64: base64, password: item.password, bank: item.bank })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Server error ${response.status}: ${errText.slice(0, 200)}`);
        }
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        const rawTxns = data.txns;
        const enriched = rawTxns.map(t => {
          const parsed = item.bank === 'hdfc'
            ? parseHDFCNarration(t.narration)
            : parseICICINarration(t.narration);
          return {
            ...t,
            credit: Number(t.credit) || 0,
            debit: Number(t.debit) || 0,
            bank: item.bank.toUpperCase(),
            ...parsed,
          };
        }).filter(t => t.credit > 0 || t.debit > 0);

        updated[i] = { ...updated[i], status: 'done', txns: enriched, error: null };
        toast.success(`${item.file.name}: ${enriched.length} transactions extracted`);
      } catch (err) {
        updated[i] = { ...updated[i], status: 'error', error: err.message };
        toast.error(`${item.file.name}: ${err.message}`);
      }
      setFileQueue([...updated]);
    }
    setParsing(false);
  }

  async function runAudit() {
    const allTxns = fileQueue.flatMap(f => f.txns);
    if (!allTxns.length) return toast.error('Parse bank statements first');
    setAnalyzing(true);
    toast.loading('Running audit…', { id: 'audit' });

    try {
      // Fetch all active tenants
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, full_name, phone, flat_id, building_id, monthly_rent')
        .eq('status', 'active');

      // Fetch flat and building info separately
      const flatIds = [...new Set((tenants || []).map(t => t.flat_id).filter(Boolean))];
      const bIds = [...new Set((tenants || []).map(t => t.building_id).filter(Boolean))];
      const [{ data: flats }, { data: buildings }] = await Promise.all([
        flatIds.length ? supabase.from('flats').select('id, door_number').in('id', flatIds) : { data: [] },
        bIds.length ? supabase.from('buildings').select('id, name').in('id', bIds) : { data: [] },
      ]);
      const flatMap = {}, bMap = {};
      (flats || []).forEach(f => { flatMap[f.id] = f; });
      (buildings || []).forEach(b => { bMap[b.id] = b; });

      const enrichedTenants = (tenants || []).map(t => ({
        ...t,
        flat: flatMap[t.flat_id],
        building: bMap[t.building_id],
      }));

      // Fetch collections for month
      const { data: collections } = await supabase
        .from('rent_collections')
        .select('*, tenant_id, flat_id, building_id, amount, payment_mode')
        .eq('for_month', selectedMonth);

      const collByTenant = {};
      (collections || []).forEach(c => {
        collByTenant[c.tenant_id] = collByTenant[c.tenant_id] || [];
        collByTenant[c.tenant_id].push(c);
      });

      const rentTxns = allTxns.filter(t => t.credit > 0);

      // ── Per tenant status ─────────────────────────────
      const tenantStatus = enrichedTenants.map(t => {
        const colls = collByTenant[t.id] || [];
        const paid = colls.reduce((s, c) => s + Number(c.amount), 0);
        const expected = Number(t.monthly_rent);
        const modes = [...new Set(colls.map(c => c.payment_mode))];

        // Find bank match
        const bankMatch = rentTxns.find(tx => {
          if (tx.roomHint && t.flat?.door_number) {
            const room = t.flat.door_number.replace(/\D/g, '');
            if (tx.roomHint === room) {
              return nameScore(tx.tenantHint, t.full_name.split(' ')[0]) > 40;
            }
          }
          return nameScore(tx.tenantHint, t.full_name.split(' ')[0]) > 70
            && Math.abs(tx.credit - expected) < expected * 0.15;
        });

        return {
          tenantId: t.id,
          name: t.full_name,
          room: t.flat?.door_number || '—',
          building: t.building?.name || '—',
          expected,
          paid,
          balance: expected - paid,
          modes,
          status: paid >= expected ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
          inSystem: colls.length > 0,
          inBank: !!bankMatch,
          bankAmount: bankMatch?.credit || 0,
          modeFlag: bankMatch && modes.includes('cash'),
        };
      });

      // ── Bank credits not in system ─────────────────────
      const unmatchedBank = rentTxns.filter(tx => {
        return !tenantStatus.some(t => {
          if (tx.roomHint && t.room !== '—') {
            return tx.roomHint === t.room.replace(/\D/g, '') && nameScore(tx.tenantHint, t.name.split(' ')[0]) > 40;
          }
          return nameScore(tx.tenantHint, t.name.split(' ')[0]) > 70;
        });
      });

      // ── Mode mismatches ────────────────────────────────
      const modeMismatches = tenantStatus.filter(t => t.modeFlag);

      // ── Bank summary ───────────────────────────────────
      const totalBankCredits = allTxns.filter(t => t.credit > 0).reduce((s, t) => s + t.credit, 0);
      const totalBankDebits = allTxns.filter(t => t.debit > 0).reduce((s, t) => s + t.debit, 0);
      const totalAppCollected = tenantStatus.reduce((s, t) => s + t.paid, 0);
      const totalExpected = tenantStatus.reduce((s, t) => s + t.expected, 0);

      // ── Building summary ───────────────────────────────
      const bSummary = {};
      tenantStatus.forEach(t => {
        if (!bSummary[t.building]) bSummary[t.building] = { paid: 0, unpaid: 0, partial: 0, total: 0, collected: 0, expected: 0 };
        bSummary[t.building][t.status]++;
        bSummary[t.building].total++;
        bSummary[t.building].collected += t.paid;
        bSummary[t.building].expected += t.expected;
      });

      setResults({
        tenantStatus,
        unmatchedBank,
        modeMismatches,
        allTxns,
        bSummary,
        stats: {
          totalExpected, totalAppCollected, totalBankCredits, totalBankDebits,
          paidCount: tenantStatus.filter(t => t.status === 'paid').length,
          partialCount: tenantStatus.filter(t => t.status === 'partial').length,
          unpaidCount: tenantStatus.filter(t => t.status === 'unpaid').length,
          unmatchedCount: unmatchedBank.length,
          mismatchCount: modeMismatches.length,
          bankGap: Math.abs(totalBankCredits - totalAppCollected),
          bankFiles: fileQueue.filter(f => f.status === 'done').length,
          totalTxns: allTxns.length,
        },
      });

      setActiveTab('summary');
      toast.success('Audit complete', { id: 'audit' });
    } catch (e) {
      toast.error('Audit failed: ' + e.message, { id: 'audit' });
    } finally {
      setAnalyzing(false);
    }
  }

  function handleExport() {
    if (!results) return;
    const { tenantStatus, unmatchedBank, modeMismatches, allTxns } = results;
    exportMultiSheet([
      {
        name: 'All Tenants',
        data: tenantStatus.map(t => ({
          Building: t.building, Room: t.room, Tenant: t.name,
          'Expected (₹)': t.expected, 'Paid in App (₹)': t.paid, 'Balance (₹)': t.balance,
          Status: t.status.toUpperCase(), Mode: t.modes.join(', ') || '—',
          'Found in Bank': t.inBank ? 'Yes' : t.modes.includes('cash') ? 'Cash-offline' : 'No',
          'Bank Amount': t.bankAmount || '—',
        }))
      },
      {
        name: 'Unpaid & Dues',
        data: tenantStatus.filter(t => t.status !== 'paid').map(t => ({
          Building: t.building, Room: t.room, Tenant: t.name,
          'Expected (₹)': t.expected, 'Paid (₹)': t.paid, 'Balance (₹)': t.balance,
          Status: t.status.toUpperCase(),
        }))
      },
      {
        name: 'Bank Not in System',
        data: unmatchedBank.map(t => ({
          Date: t.date, Narration: t.narration, Bank: t.bank, 'Amount (₹)': t.credit,
        }))
      },
      {
        name: 'Mode Mismatches',
        data: modeMismatches.map(t => ({
          Building: t.building, Room: t.room, Tenant: t.name,
          'Mode in App': t.modes.join(', '), Note: 'Logged as cash but found in bank',
        }))
      },
      {
        name: 'All Bank Transactions',
        data: allTxns.map(t => ({
          Date: t.date, Bank: t.bank, Narration: t.narration,
          'Credit (₹)': t.credit || '', 'Debit (₹)': t.debit || '',
          Type: t.txnType,
        }))
      },
    ], `MMR_Audit_${selectedMonth}`);
    toast.success('Exported');
  }

  const statusBadge = s => {
    const map = { paid: 'bg-emerald-50 text-emerald-700 border-emerald-200', partial: 'bg-amber-50 text-amber-700 border-amber-200', unpaid: 'bg-red-50 text-red-700 border-red-200' };
    return <span className={`badge border text-xs ${map[s]}`}>{s.toUpperCase()}</span>;
  };

  const allTxns = fileQueue.flatMap(f => f.txns);
  const tabs = results ? [
    { id: 'summary', label: 'Summary' },
    { id: 'tenants', label: `All Tenants (${results.tenantStatus.length})` },
    { id: 'unpaid', label: `Unpaid (${results.stats.unpaidCount + results.stats.partialCount})` },
    { id: 'unmatched', label: `Not in System (${results.stats.unmatchedCount})` },
    { id: 'mismatch', label: `Mode Issues (${results.stats.mismatchCount})` },
    { id: 'buildings', label: 'By Building' },
    { id: 'bank', label: `Bank Txns (${allTxns.length})` },
  ] : [];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Monthly Audit</h1>
          <p className="text-sm text-surface-500 mt-0.5">Upload bank statements → match against app collections</p>
        </div>
        {results && (
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2 self-start">
            <Download className="w-4 h-4" /> Export Full Report
          </button>
        )}
      </div>

      {/* Step 1 — Month */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</div>
          <h3 className="font-semibold text-surface-800">Select Month</h3>
        </div>
        <select className="select w-auto" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Step 2 — Upload files */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</div>
            <h3 className="font-semibold text-surface-800">Upload Bank Statements</h3>
          </div>
          <button onClick={() => fileRef.current?.click()} className="btn-primary btn-sm flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Add Files
          </button>
          <input ref={fileRef} type="file" accept=".pdf" multiple onChange={addFiles} className="hidden" />
        </div>

        {fileQueue.length === 0 ? (
          <div onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-surface-300 hover:border-brand-400 rounded-lg p-8 text-center cursor-pointer transition-colors">
            <Upload className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-sm text-surface-500">Click to upload HDFC or ICICI PDF statements</p>
            <p className="text-xs text-surface-400 mt-1">Multiple files supported · Password-protected PDFs supported</p>
          </div>
        ) : (
          <div className="space-y-3">
            {fileQueue.map(item => (
              <div key={item.id} className={`rounded-lg border p-3 ${item.status === 'done' ? 'border-emerald-200 bg-emerald-50/50' : item.status === 'error' ? 'border-red-200 bg-red-50/50' : 'border-surface-200 bg-surface-50'}`}>
                <div className="flex items-center gap-3">
                  <FileText className={`w-4 h-4 flex-shrink-0 ${item.status === 'done' ? 'text-emerald-600' : item.status === 'error' ? 'text-red-500' : 'text-surface-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-800 truncate">{item.file.name}</p>
                    {item.status === 'done' && <p className="text-xs text-emerald-600">{item.txns.length} transactions extracted</p>}
                    {item.status === 'error' && <p className="text-xs text-red-600">{item.error}</p>}
                    {item.status === 'parsing' && <p className="text-xs text-brand-600 flex items-center gap-1"><div className="w-3 h-3 border border-brand-400 border-t-transparent rounded-full animate-spin" /> Reading PDF…</p>}
                  </div>

                  {/* Bank selector */}
                  <select className="select py-1 text-xs w-20"
                    value={item.bank} onChange={e => updateFile(item.id, 'bank', e.target.value)}>
                    <option value="hdfc">HDFC</option>
                    <option value="icici">ICICI</option>
                  </select>

                  {/* Password field */}
                  <div className="relative">
                    <Lock className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-400" />
                    <input type="password" placeholder="Password (if any)" value={item.password}
                      onChange={e => updateFile(item.id, 'password', e.target.value)}
                      className="input pl-6 py-1 text-xs w-36" />
                  </div>

                  <button onClick={() => removeFile(item.id)} className="btn-ghost p-1.5 text-surface-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            <div className="flex gap-3 pt-1">
              <button onClick={() => fileRef.current?.click()} className="btn-secondary btn-sm flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add More
              </button>
              <button onClick={parseAllFiles} disabled={parsing || fileQueue.every(f => f.status === 'done')}
                className="btn-primary flex items-center gap-2">
                {parsing
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Reading…</>
                  : <><Eye className="w-4 h-4" />Extract Transactions</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 3 — Run Audit */}
      {allTxns.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</div>
              <div>
                <h3 className="font-semibold text-surface-800">Run Audit</h3>
                <p className="text-xs text-surface-500">{allTxns.length} transactions ready · {fileQueue.filter(f => f.status === 'done').length} files</p>
              </div>
            </div>
            <button onClick={runAudit} disabled={analyzing} className="btn-primary flex items-center gap-2">
              {analyzing
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analyzing…</>
                : <><ShieldCheck className="w-4 h-4" />Run Audit for {selectedMonth}</>}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-surface-200 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`tab flex-shrink-0 ${activeTab === t.id ? 'active' : ''}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* SUMMARY */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              {/* Flags first */}
              {(results.stats.unmatchedCount > 0 || results.stats.mismatchCount > 0) ? (
                <div className="card p-4 border border-red-200 bg-red-50">
                  <h3 className="font-semibold text-red-800 flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4" /> {results.stats.unmatchedCount + results.stats.mismatchCount} flags require attention
                  </h3>
                  <div className="space-y-1.5">
                    {results.stats.unmatchedCount > 0 && (
                      <p className="text-sm text-red-700 flex items-center gap-2">
                        <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {results.stats.unmatchedCount} bank credit(s) have NO matching entry in the app — money received but not logged
                      </p>
                    )}
                    {results.stats.mismatchCount > 0 && (
                      <p className="text-sm text-red-700 flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        {results.stats.mismatchCount} payment(s) logged as Cash but found in bank — wrong payment mode
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card p-4 border border-emerald-200 bg-emerald-50 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <p className="text-sm font-medium text-emerald-800">Clean audit — all bank entries matched. No anomalies detected.</p>
                </div>
              )}

              {/* Key metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Expected Rent', value: formatCurrency(results.stats.totalExpected), color: 'border-surface-300' },
                  { label: 'Collected in App', value: formatCurrency(results.stats.totalAppCollected), color: 'border-emerald-400' },
                  { label: 'Bank Credits', value: formatCurrency(results.stats.totalBankCredits), color: 'border-brand-500' },
                  { label: 'App vs Bank Gap', value: formatCurrency(results.stats.bankGap), color: results.stats.bankGap > 1000 ? 'border-red-400' : 'border-emerald-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`card p-4 border-l-4 ${color}`}>
                    <p className="text-xs text-surface-500 mb-1">{label}</p>
                    <p className="text-lg font-bold font-mono text-surface-900">{value}</p>
                  </div>
                ))}
              </div>

              {/* Status breakdown */}
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-4 text-center border-t-4 border-emerald-400">
                  <p className="text-3xl font-bold text-emerald-600">{results.stats.paidCount}</p>
                  <p className="text-xs text-surface-500 mt-1 font-medium">Fully Paid</p>
                </div>
                <div className="card p-4 text-center border-t-4 border-amber-400">
                  <p className="text-3xl font-bold text-amber-600">{results.stats.partialCount}</p>
                  <p className="text-xs text-surface-500 mt-1 font-medium">Partial</p>
                </div>
                <div className="card p-4 text-center border-t-4 border-red-400">
                  <p className="text-3xl font-bold text-red-600">{results.stats.unpaidCount}</p>
                  <p className="text-xs text-surface-500 mt-1 font-medium">Unpaid</p>
                </div>
              </div>

              {/* Bank files summary */}
              <div className="card p-4">
                <h4 className="text-sm font-semibold text-surface-700 mb-3">Bank Statements Analyzed</h4>
                <div className="space-y-2">
                  {fileQueue.filter(f => f.status === 'done').map(f => (
                    <div key={f.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-surface-600">
                        <FileText className="w-3.5 h-3.5 text-surface-400" />
                        {f.file.name}
                        <span className="badge bg-brand-50 text-brand-700 border border-brand-100 text-xs">{f.bank.toUpperCase()}</span>
                        {f.password && <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs"><Lock className="w-2.5 h-2.5" />Protected</span>}
                      </span>
                      <span className="text-xs text-surface-400">{f.txns.length} txns · ₹{(f.txns.filter(t=>t.credit>0).reduce((s,t)=>s+t.credit,0)/100000).toFixed(1)}L credits</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ALL TENANTS */}
          {activeTab === 'tenants' && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>Building</th><th>Room</th><th>Tenant</th><th className="text-right">Expected</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Status</th><th>Mode</th><th>In Bank</th></tr>
                  </thead>
                  <tbody>
                    {results.tenantStatus.map(t => (
                      <tr key={t.tenantId}>
                        <td className="text-xs text-surface-500">{t.building}</td>
                        <td className="font-mono font-semibold text-surface-800">{t.room}</td>
                        <td className="text-surface-700">{t.name}</td>
                        <td className="text-right font-mono">{formatCurrency(t.expected)}</td>
                        <td className="text-right font-mono text-emerald-700">{formatCurrency(t.paid)}</td>
                        <td className="text-right font-mono" style={{ color: t.balance > 0 ? '#dc2626' : '#94a3b8' }}>
                          {t.balance > 0 ? formatCurrency(t.balance) : '—'}
                        </td>
                        <td>{statusBadge(t.status)}</td>
                        <td className="text-xs text-surface-500">{t.modes.join(', ') || '—'}</td>
                        <td>
                          {t.inBank
                            ? <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs"><CheckCircle2 className="w-3 h-3" />{formatCurrency(t.bankAmount)}</span>
                            : t.modes.includes('cash')
                              ? <span className="badge bg-surface-100 text-surface-500 border border-surface-200 text-xs">Cash offline</span>
                              : t.status !== 'unpaid'
                                ? <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs"><AlertTriangle className="w-3 h-3" />Not found</span>
                                : <span className="text-surface-300 text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* UNPAID */}
          {activeTab === 'unpaid' && (
            <div className="card overflow-hidden">
              {results.tenantStatus.filter(t => t.status !== 'paid').length === 0 ? (
                <div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" /><p className="text-surface-500 text-sm">All tenants paid</p></div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Building</th><th>Room</th><th>Tenant</th><th className="text-right">Expected</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
                  <tbody>
                    {results.tenantStatus.filter(t => t.status !== 'paid').map(t => (
                      <tr key={t.tenantId} className={t.status === 'unpaid' ? 'bg-red-50/30' : 'bg-amber-50/20'}>
                        <td className="text-xs text-surface-500">{t.building}</td>
                        <td className="font-mono font-semibold">{t.room}</td>
                        <td className="font-medium text-surface-800">{t.name}</td>
                        <td className="text-right font-mono">{formatCurrency(t.expected)}</td>
                        <td className="text-right font-mono text-emerald-700">{formatCurrency(t.paid)}</td>
                        <td className="text-right font-mono font-bold text-red-600">{formatCurrency(t.balance)}</td>
                        <td>{statusBadge(t.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-50 border-t border-surface-200">
                      <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-surface-500">Total Outstanding</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-red-600">{formatCurrency(results.tenantStatus.filter(t => t.status !== 'paid').reduce((s,t) => s+t.balance, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* NOT IN SYSTEM */}
          {activeTab === 'unmatched' && (
            <div className="card overflow-hidden">
              {results.unmatchedBank.length === 0 ? (
                <div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" /><p className="text-surface-500 text-sm">All bank credits matched</p></div>
              ) : (
                <>
                  <div className="px-5 py-3 bg-red-50 border-b border-red-200">
                    <p className="text-sm font-semibold text-red-800 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Money received in bank but NOT logged in app — investigate immediately
                    </p>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Bank</th><th>Narration</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {results.unmatchedBank.map((t, i) => (
                        <tr key={i} className="bg-red-50/20">
                          <td className="text-xs">{t.date}</td>
                          <td><span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{t.bank}</span></td>
                          <td className="text-xs text-surface-600 max-w-sm truncate">{t.narration}</td>
                          <td className="text-right font-mono font-semibold text-red-600">{formatCurrency(t.credit)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface-50 border-t border-surface-200">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-surface-500">Total unaccounted</td>
                        <td className="px-4 py-2 text-right font-mono font-bold text-red-600">{formatCurrency(results.unmatchedBank.reduce((s,t) => s+t.credit, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
            </div>
          )}

          {/* MODE MISMATCH */}
          {activeTab === 'mismatch' && (
            <div className="card overflow-hidden">
              {results.modeMismatches.length === 0 ? (
                <div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" /><p className="text-surface-500 text-sm">No mode mismatches</p></div>
              ) : (
                <>
                  <div className="px-5 py-3 bg-amber-50 border-b border-amber-200">
                    <p className="text-sm font-semibold text-amber-800">Logged as Cash but found in bank — mode needs correction</p>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Building</th><th>Room</th><th>Tenant</th><th>Logged As</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {results.modeMismatches.map(t => (
                        <tr key={t.tenantId} className="bg-amber-50/30">
                          <td className="text-xs text-surface-500">{t.building}</td>
                          <td className="font-mono font-semibold">{t.room}</td>
                          <td className="font-medium text-surface-800">{t.name}</td>
                          <td><span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">{t.modes.join(', ')}</span></td>
                          <td className="text-right font-mono">{formatCurrency(t.paid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* BY BUILDING */}
          {activeTab === 'buildings' && (
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead>
                  <tr><th>Building</th><th className="text-center">Paid</th><th className="text-center">Partial</th><th className="text-center">Unpaid</th><th className="text-right">Expected</th><th className="text-right">Collected</th><th className="text-right">Gap</th><th>Rate</th></tr>
                </thead>
                <tbody>
                  {Object.entries(results.bSummary).map(([name, b]) => {
                    const rate = b.expected > 0 ? Math.round((b.collected / b.expected) * 100) : 0;
                    return (
                      <tr key={name}>
                        <td className="font-medium text-surface-800">{name}</td>
                        <td className="text-center text-emerald-600 font-semibold">{b.paid}</td>
                        <td className="text-center text-amber-600 font-semibold">{b.partial}</td>
                        <td className="text-center text-red-600 font-semibold">{b.unpaid}</td>
                        <td className="text-right font-mono">{formatCurrency(b.expected)}</td>
                        <td className="text-right font-mono text-emerald-700">{formatCurrency(b.collected)}</td>
                        <td className="text-right font-mono text-red-600">{formatCurrency(b.expected - b.collected)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${rate}%`, backgroundColor: rate >= 90 ? '#0d9488' : rate >= 70 ? '#f59e0b' : '#dc2626' }} />
                            </div>
                            <span className="text-xs font-mono text-surface-500">{rate}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* BANK TRANSACTIONS */}
          {activeTab === 'bank' && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
                <span className="text-sm font-medium text-surface-700">{allTxns.length} total transactions</span>
                <div className="flex gap-4 text-xs text-surface-500">
                  <span className="text-emerald-600 font-mono">Credits: {formatCurrency(allTxns.filter(t=>t.credit>0).reduce((s,t)=>s+t.credit,0))}</span>
                  <span className="text-red-600 font-mono">Debits: {formatCurrency(allTxns.filter(t=>t.debit>0).reduce((s,t)=>s+t.debit,0))}</span>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="data-table">
                  <thead className="sticky top-0 bg-white"><tr><th>Date</th><th>Bank</th><th>Narration</th><th>Type</th><th className="text-right">Credit</th><th className="text-right">Debit</th></tr></thead>
                  <tbody>
                    {allTxns.map((t, i) => (
                      <tr key={i}>
                        <td className="text-xs">{t.date}</td>
                        <td><span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{t.bank}</span></td>
                        <td className="text-xs text-surface-600 max-w-xs truncate">{t.narration}</td>
                        <td>{t.txnType !== 'other' && <span className="badge bg-brand-50 text-brand-700 border border-brand-100 text-xs">{t.txnType}</span>}</td>
                        <td className="text-right font-mono text-emerald-700 text-sm">{t.credit > 0 ? formatCurrency(t.credit) : '—'}</td>
                        <td className="text-right font-mono text-red-600 text-sm">{t.debit > 0 ? formatCurrency(t.debit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
