import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths, exportMultiSheet } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  ShieldCheck, Upload, Download, AlertTriangle, CheckCircle2,
  XCircle, FileText, RefreshCw, ChevronDown, ChevronRight,
  Banknote, Smartphone, Eye, X, Filter, Building2
} from 'lucide-react';
import * as XLSX from 'xlsx';

// ─── Bank Statement Parsers ───────────────────────────────
function parseHDFC(text) {
  const txns = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Date pattern DD/MM/YY or DD/MM/YYYY
    const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{2,4})/);
    if (!dateMatch) continue;

    const dateStr = dateMatch[1];
    const parts = dateStr.split('/');
    const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
    const date = `${year}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;

    // Full narration — may span 2 lines
    let narration = line.replace(dateMatch[0], '').trim();
    if (i + 1 < lines.length && !lines[i+1].match(/^\d{2}\/\d{2}/)) {
      narration += ' ' + lines[i+1];
      i++;
    }

    // Extract amounts — look for numbers with commas
    const amounts = narration.match(/[\d,]+\.\d{2}/g) || [];
    const cleanNarration = narration.replace(/[\d,]+\.\d{2}/g, '').replace(/\s+/g, ' ').trim();

    // Parse HDFC ATN pattern: ATN-XXXXXXXX0820-NAME+ROOM+TYPE
    let tenantHint = null, roomHint = null, txnType = 'other';
    const atnMatch = cleanNarration.match(/ATN-[A-Z0-9]+-([A-Z0-9]+?)(\d{3,4})(RENT|OTHERS|ELECTRICI|WATER|DEPOSIT)?/i);
    if (atnMatch) {
      tenantHint = atnMatch[1].toLowerCase();
      roomHint = atnMatch[2];
      const typeStr = (atnMatch[3] || '').toLowerCase();
      if (typeStr.includes('rent')) txnType = 'rent';
      else if (typeStr.includes('electric')) txnType = 'electricity';
      else if (typeStr.includes('water')) txnType = 'water';
      else if (typeStr.includes('deposit')) txnType = 'deposit';
      else txnType = 'other';
    }

    // Determine credit/debit from amounts position
    // In HDFC: withdrawal comes before deposit in the line
    let credit = 0, debit = 0;
    if (amounts.length >= 2) {
      const a = parseFloat(amounts[0].replace(/,/g,''));
      const b = parseFloat(amounts[1].replace(/,/g,''));
      // If line has "withdrawal" context, first is debit
      if (cleanNarration.match(/UPI|IMPS|NEFT|RTGS/) && b > 0) {
        credit = b;
      } else if (a > 0) {
        credit = a;
      }
    } else if (amounts.length === 1) {
      credit = parseFloat(amounts[0].replace(/,/g,''));
    }

    if (credit > 0 || debit > 0) {
      txns.push({ date, narration: cleanNarration, credit, debit, tenantHint, roomHint, txnType, bank: 'HDFC' });
    }
  }
  return txns;
}

function parseICICI(text) {
  const txns = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Date: DD.MM.YYYY or DD/MM/YYYY
    const dateMatch = line.match(/^(\d{1,2}[./]\d{2}[./]\d{4})/);
    if (!dateMatch) continue;

    const dateStr = dateMatch[1].replace(/\./g, '/');
    const parts = dateStr.split('/');
    const date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;

    let narration = line.replace(dateMatch[0], '').trim();
    // Collect continuation lines
    while (i + 1 < lines.length && !lines[i+1].match(/^\d{1,2}[./]\d{2}[./]\d{4}/)) {
      const next = lines[i+1];
      if (next.match(/^\d[\d,]*\.\d{2}/) || next.match(/^[A-Z]{2,}/)) {
        narration += ' ' + next;
        i++;
      } else break;
    }

    const amounts = narration.match(/[\d,]+\.\d{2}/g) || [];
    const cleanNarration = narration.replace(/[\d,]+\.\d{2}/g, '').replace(/\s+/g, ' ').trim();

    // Try to extract name hints from ICICI narration
    let tenantHint = null, roomHint = null, txnType = 'other';
    const rentalMatch = cleanNarration.match(/RENTAL\s*PAYMENT/i);
    if (rentalMatch) txnType = 'rent';

    // Extract name from UPI: UPI/NAME/... or NEFT-...-NAME-...
    const upiMatch = cleanNarration.match(/UPI\/([A-Za-z]+)/i);
    const neftMatch = cleanNarration.match(/NEFT-[A-Z0-9]+-[A-Z0-9]+-([A-Z]+)/i);
    if (upiMatch) tenantHint = upiMatch[1].toLowerCase();
    else if (neftMatch) tenantHint = neftMatch[1].toLowerCase();

    // Determine credit vs debit
    let credit = 0, debit = 0;
    if (amounts.length >= 2) {
      // ICICI: withdrawal, deposit, balance order
      const a = parseFloat(amounts[0].replace(/,/g,''));
      const b = parseFloat(amounts.length > 1 ? amounts[amounts.length-2].replace(/,/g,'') : '0');
      if (cleanNarration.match(/UPI\/|NEFT-|RTGS-|IMPS-/) && b > 0) credit = b;
      else if (a > 0) credit = a;
    } else if (amounts.length === 1) {
      credit = parseFloat(amounts[0].replace(/,/g,''));
    }

    if (credit > 0 || debit > 0) {
      txns.push({ date, narration: cleanNarration, credit, debit, tenantHint, roomHint, txnType, bank: 'ICICI' });
    }
  }
  return txns;
}

// ─── Fuzzy name match ─────────────────────────────────────
function nameScore(a, b) {
  a = (a || '').toLowerCase().replace(/\s+/g,'');
  b = (b || '').toLowerCase().replace(/\s+/g,'');
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 90;
  // Common prefix length
  let common = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) { if (a[i] === b[i]) common++; else break; }
  return Math.round((common / minLen) * 100);
}

export default function Audit() {
  const { isSuperAdmin } = useAuth();
  const fileRef = useRef();
  const months = lastNMonths(6);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [bankTxns, setBankTxns] = useState([]);
  const [filename, setFilename] = useState('');
  const [bankType, setBankType] = useState('hdfc');
  const [parsing, setParsing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Results
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [expandedBuilding, setExpandedBuilding] = useState(null);

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

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setParsing(true);
    toast.loading('Reading PDF…', { id: 'parse' });

    try {
      // Use Claude's Anthropic API to extract text from PDF
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 }
              },
              {
                type: 'text',
                text: `Extract ALL transactions from this bank statement as JSON array. Each transaction must have: date (YYYY-MM-DD), narration (full description), credit (number, 0 if none), debit (number, 0 if none). Return ONLY valid JSON array, no other text. Example: [{"date":"2026-04-01","narration":"IMPS-EAZYAPP-ATN-XXXXXXXX0820-NABEEL403RENT","credit":22000,"debit":0}]`
              }
            ]
          }]
        })
      });

      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Could not extract transactions');

      const rawTxns = JSON.parse(jsonMatch[0]);

      // Enrich with parsing logic
      const enriched = rawTxns.map(t => {
        let tenantHint = null, roomHint = null, txnType = 'other';
        const n = (t.narration || '').toUpperCase();

        // HDFC ATN pattern
        const atnMatch = n.match(/ATN-[A-Z0-9]+-([A-Z]+)(\d{3,4})(RENT|OTHERS|ELECTRICI|WATER|DEPOSIT)?/);
        if (atnMatch) {
          tenantHint = atnMatch[1].toLowerCase();
          roomHint = atnMatch[2];
          const tp = (atnMatch[3] || '').toLowerCase();
          txnType = tp.includes('rent') ? 'rent' : tp.includes('electric') ? 'electricity' : tp.includes('water') ? 'water' : tp.includes('deposit') ? 'deposit' : 'other';
        }

        // ICICI RENTAL PAYMENT
        if (n.includes('RENTAL')) txnType = 'rent';

        // Extract tenant name from various patterns
        if (!tenantHint) {
          const upiName = n.match(/UPI\/([A-Z]+)/);
          const neftName = n.match(/NEFT-[A-Z0-9]+-([A-Z]+)/);
          if (upiName) tenantHint = upiName[1].toLowerCase();
          else if (neftName) tenantHint = neftName[1].toLowerCase();
        }

        return { ...t, tenantHint, roomHint, txnType, bank: bankType.toUpperCase() };
      });

      setBankTxns(enriched);
      toast.success(`Extracted ${enriched.length} transactions`, { id: 'parse' });
    } catch (err) {
      toast.error('Failed to parse PDF: ' + err.message, { id: 'parse' });
    } finally {
      setParsing(false);
      fileRef.current.value = '';
    }
  }

  async function runAudit() {
    if (!bankTxns.length) return toast.error('Upload a bank statement first');
    setAnalyzing(true);
    toast.loading('Running audit…', { id: 'audit' });

    try {
      const forMonth = selectedMonth;

      // Fetch all active tenants with flat/building
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, full_name, phone, flat_id, building_id, monthly_rent, flats(door_number), buildings(name)')
        .eq('status', 'active');

      // Fetch all collections for the month
      const { data: collections } = await supabase
        .from('rent_collections')
        .select('*, tenant:tenants(full_name), flat:flats(door_number), building:buildings(name)')
        .eq('for_month', forMonth);

      const collByTenant = {};
      (collections || []).forEach(c => {
        collByTenant[c.tenant_id] = collByTenant[c.tenant_id] || [];
        collByTenant[c.tenant_id].push(c);
      });

      // ── 1. Tenant payment status ──────────────────────
      const tenantStatus = (tenants || []).map(t => {
        const colls = collByTenant[t.id] || [];
        const totalPaid = colls.reduce((s, c) => s + Number(c.amount), 0);
        const expected = Number(t.monthly_rent);
        const balance = expected - totalPaid;
        const modes = [...new Set(colls.map(c => c.payment_mode))];

        // Try to find matching bank transaction
        const bankMatch = bankTxns.find(tx => {
          if (tx.credit <= 0) return false;
          // Room number match (strong signal)
          if (tx.roomHint && t.flats?.door_number) {
            const room = t.flats.door_number.replace(/\D/g,'');
            if (tx.roomHint === room) {
              // Also check name similarity
              const score = nameScore(tx.tenantHint, t.full_name.split(' ')[0]);
              return score > 50;
            }
          }
          // Name match (weaker)
          const score = nameScore(tx.tenantHint, t.full_name.split(' ')[0]);
          return score > 70 && Math.abs(tx.credit - expected) < expected * 0.1;
        });

        return {
          tenantId: t.id,
          name: t.full_name,
          room: t.flats?.door_number || '—',
          building: t.buildings?.name || '—',
          expected,
          paid: totalPaid,
          balance,
          modes,
          status: totalPaid >= expected ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid',
          inSystem: colls.length > 0,
          inBank: !!bankMatch,
          bankAmount: bankMatch?.credit || 0,
          bankMismatch: bankMatch && Math.abs(bankMatch.credit - totalPaid) > 100,
        };
      });

      // ── 2. Bank credits not in system ─────────────────
      const creditTxns = bankTxns.filter(t => t.credit > 0 && t.txnType === 'rent');
      const unmatchedBank = creditTxns.filter(tx => {
        return !tenantStatus.some(t => {
          if (tx.roomHint && t.room) {
            const room = t.room.replace(/\D/g,'');
            return tx.roomHint === room && nameScore(tx.tenantHint, t.name.split(' ')[0]) > 50;
          }
          return nameScore(tx.tenantHint, t.name.split(' ')[0]) > 70;
        });
      });

      // ── 3. Mode mismatch ──────────────────────────────
      const modeMismatches = tenantStatus.filter(t => {
        // If logged as UPI/bank_transfer but found in bank, consistent
        // If logged as cash but found in bank credits, suspicious
        if (!t.inBank) return false;
        return t.modes.includes('cash') && t.inBank;
      });

      // ── 4. Summary stats ──────────────────────────────
      const totalExpected = tenantStatus.reduce((s, t) => s + t.expected, 0);
      const totalCollected = tenantStatus.reduce((s, t) => s + t.paid, 0);
      const totalBankCredits = bankTxns.filter(t => t.credit > 0).reduce((s, t) => s + t.credit, 0);
      const paidCount = tenantStatus.filter(t => t.status === 'paid').length;
      const unpaidCount = tenantStatus.filter(t => t.status === 'unpaid').length;
      const partialCount = tenantStatus.filter(t => t.status === 'partial').length;

      setResults({
        tenantStatus,
        unmatchedBank,
        modeMismatches,
        stats: {
          totalExpected, totalCollected, totalBankCredits,
          paidCount, unpaidCount, partialCount,
          bankTxnCount: bankTxns.length,
          unmatchedCount: unmatchedBank.length,
          mismatchCount: modeMismatches.length,
        },
        month: forMonth,
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
    const { tenantStatus, unmatchedBank, modeMismatches } = results;

    exportMultiSheet([
      {
        name: 'Tenant Payment Status',
        data: tenantStatus.map(t => ({
          Building: t.building, Room: t.room, Tenant: t.name,
          'Expected (₹)': t.expected, 'Paid (₹)': t.paid, 'Balance (₹)': t.balance,
          Status: t.status.toUpperCase(), Modes: t.modes.join(', ') || '—',
          'In System': t.inSystem ? 'Yes' : 'No',
          'In Bank': t.inBank ? 'Yes' : 'No',
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
        name: 'Bank Not In System',
        data: unmatchedBank.map(t => ({
          Date: t.date, Narration: t.narration, 'Credit (₹)': t.credit, Bank: t.bank,
        }))
      },
      {
        name: 'Mode Mismatches',
        data: modeMismatches.map(t => ({
          Building: t.building, Room: t.room, Tenant: t.name,
          'Logged as': t.modes.join(', '), 'In Bank': t.inBank ? 'Yes' : 'No',
          Note: 'Logged as cash but found in bank credits',
        }))
      },
    ], `MMR_Audit_${results.month}`);
    toast.success('Audit report exported');
  }

  const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'tenants', label: `All Tenants (${results?.tenantStatus?.length || 0})` },
    { id: 'unpaid', label: `Unpaid (${results?.stats?.unpaidCount + results?.stats?.partialCount || 0})` },
    { id: 'unmatched', label: `Bank Unmatched (${results?.stats?.unmatchedCount || 0})` },
    { id: 'mismatch', label: `Mode Issues (${results?.stats?.mismatchCount || 0})` },
    { id: 'bank', label: `Bank Txns (${bankTxns.length})` },
  ];

  const statusBadge = (s) => {
    const map = {
      paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      partial: 'bg-amber-50 text-amber-700 border-amber-200',
      unpaid: 'bg-red-50 text-red-700 border-red-200',
    };
    return <span className={`badge border text-xs ${map[s]}`}>{s.toUpperCase()}</span>;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Monthly Audit</h1>
          <p className="text-sm text-surface-500 mt-0.5">Bank statement vs app collections reconciliation</p>
        </div>
        {results && (
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2 self-start">
            <Download className="w-4 h-4" /> Export Report
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="card p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="label">Month</label>
          <select className="select" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Bank</label>
          <select className="select" value={bankType} onChange={e => setBankType(e.target.value)}>
            <option value="hdfc">HDFC</option>
            <option value="icici">ICICI</option>
          </select>
        </div>
        <div>
          <label className="label">Bank Statement PDF</label>
          <input ref={fileRef} type="file" accept=".pdf" onChange={handleFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={parsing}
            className="btn-secondary flex items-center gap-2">
            {parsing
              ? <div className="w-4 h-4 border-2 border-surface-400 border-t-transparent rounded-full animate-spin" />
              : <Upload className="w-4 h-4" />}
            {parsing ? 'Reading…' : filename ? filename.slice(0, 25) + '…' : 'Upload PDF'}
          </button>
        </div>
        <button onClick={runAudit} disabled={analyzing || !bankTxns.length}
          className="btn-primary flex items-center gap-2">
          {analyzing
            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <ShieldCheck className="w-4 h-4" />}
          {analyzing ? 'Analyzing…' : 'Run Audit'}
        </button>
      </div>

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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Expected', value: formatCurrency(results.stats.totalExpected), color: 'border-surface-300' },
                  { label: 'Collected in App', value: formatCurrency(results.stats.totalCollected), color: 'border-emerald-400' },
                  { label: 'Bank Credits', value: formatCurrency(results.stats.totalBankCredits), color: 'border-brand-500' },
                  { label: 'Gap (App vs Bank)', value: formatCurrency(Math.abs(results.stats.totalCollected - results.stats.totalBankCredits)), color: results.stats.totalCollected !== results.stats.totalBankCredits ? 'border-red-400' : 'border-emerald-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`card p-4 border-l-4 ${color}`}>
                    <p className="text-xs text-surface-500 mb-1">{label}</p>
                    <p className="text-lg font-bold font-mono text-surface-900">{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="card p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{results.stats.paidCount}</p>
                  <p className="text-xs text-surface-500 mt-1">Fully Paid</p>
                </div>
                <div className="card p-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{results.stats.partialCount}</p>
                  <p className="text-xs text-surface-500 mt-1">Partial</p>
                </div>
                <div className="card p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{results.stats.unpaidCount}</p>
                  <p className="text-xs text-surface-500 mt-1">Unpaid</p>
                </div>
                <div className={`card p-4 text-center ${results.stats.unmatchedCount > 0 ? 'border-red-200 bg-red-50' : ''}`}>
                  <p className={`text-2xl font-bold ${results.stats.unmatchedCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {results.stats.unmatchedCount}
                  </p>
                  <p className="text-xs text-surface-500 mt-1">Bank Credits Unmatched</p>
                </div>
              </div>

              {/* Flags */}
              {(results.stats.unmatchedCount > 0 || results.stats.mismatchCount > 0) && (
                <div className="card p-4 border border-red-200 bg-red-50 space-y-2">
                  <h3 className="font-semibold text-red-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Flags Requiring Attention
                  </h3>
                  {results.stats.unmatchedCount > 0 && (
                    <p className="text-sm text-red-700">• {results.stats.unmatchedCount} bank credit(s) have no matching collection entry in the app</p>
                  )}
                  {results.stats.mismatchCount > 0 && (
                    <p className="text-sm text-red-700">• {results.stats.mismatchCount} payment(s) logged as Cash but found in bank credits — verify mode</p>
                  )}
                </div>
              )}
              {results.stats.unmatchedCount === 0 && results.stats.mismatchCount === 0 && (
                <div className="card p-4 border border-emerald-200 bg-emerald-50 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <p className="text-sm font-medium text-emerald-800">No flags — all bank entries matched to collection records</p>
                </div>
              )}
            </div>
          )}

          {/* ALL TENANTS */}
          {activeTab === 'tenants' && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Building</th><th>Room</th><th>Tenant</th>
                      <th className="text-right">Expected</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Balance</th>
                      <th>Status</th><th>Mode</th>
                      <th>In Bank</th>
                    </tr>
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
                            ? <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs"><CheckCircle2 className="w-3 h-3" /> {formatCurrency(t.bankAmount)}</span>
                            : t.modes.includes('cash')
                              ? <span className="badge bg-surface-100 text-surface-500 border border-surface-200 text-xs">Cash (offline)</span>
                              : <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs"><AlertTriangle className="w-3 h-3" /> Not found</span>}
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
                <div className="p-10 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="text-surface-500 text-sm">All tenants paid for {results.month}</p>
                </div>
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
                      <td className="px-4 py-2 text-right font-mono font-bold text-red-600">
                        {formatCurrency(results.tenantStatus.filter(t => t.status !== 'paid').reduce((s,t) => s + t.balance, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* UNMATCHED BANK */}
          {activeTab === 'unmatched' && (
            <div className="card overflow-hidden">
              {results.unmatchedBank.length === 0 ? (
                <div className="p-10 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="text-surface-500 text-sm">All bank credits matched to collection records</p>
                </div>
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-surface-100 bg-red-50">
                    <p className="text-sm font-semibold text-red-800 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      {results.unmatchedBank.length} bank credit(s) not found in app — money received but not logged
                    </p>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Narration</th><th>Bank</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {results.unmatchedBank.map((t, i) => (
                        <tr key={i} className="bg-red-50/20">
                          <td className="text-xs">{t.date}</td>
                          <td className="text-xs max-w-xs truncate">{t.narration}</td>
                          <td><span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{t.bank}</span></td>
                          <td className="text-right font-mono font-semibold text-red-600">{formatCurrency(t.credit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* MODE MISMATCH */}
          {activeTab === 'mismatch' && (
            <div className="card overflow-hidden">
              {results.modeMismatches.length === 0 ? (
                <div className="p-10 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="text-surface-500 text-sm">No mode mismatches found</p>
                </div>
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-surface-100 bg-amber-50">
                    <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Logged as Cash but found in bank — verify payment mode
                    </p>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Building</th><th>Room</th><th>Tenant</th><th>Logged Mode</th><th className="text-right">Amount</th><th>Bank Entry</th></tr></thead>
                    <tbody>
                      {results.modeMismatches.map(t => (
                        <tr key={t.tenantId} className="bg-amber-50/30">
                          <td className="text-xs text-surface-500">{t.building}</td>
                          <td className="font-mono font-semibold">{t.room}</td>
                          <td className="font-medium text-surface-800">{t.name}</td>
                          <td><span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">{t.modes.join(', ')}</span></td>
                          <td className="text-right font-mono">{formatCurrency(t.paid)}</td>
                          <td><span className="badge bg-red-50 text-red-700 border border-red-200 text-xs">Found in bank</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* BANK TRANSACTIONS */}
          {activeTab === 'bank' && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
                <span className="text-sm font-medium text-surface-700">{bankTxns.length} transactions from {bankType.toUpperCase()} statement</span>
                <span className="text-xs text-surface-400">Credits: {formatCurrency(bankTxns.filter(t=>t.credit>0).reduce((s,t)=>s+t.credit,0))}</span>
              </div>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="data-table">
                  <thead className="sticky top-0 bg-white"><tr><th>Date</th><th>Narration</th><th>Type</th><th className="text-right">Credit</th><th className="text-right">Debit</th></tr></thead>
                  <tbody>
                    {bankTxns.map((t, i) => (
                      <tr key={i}>
                        <td className="text-xs">{t.date}</td>
                        <td className="text-xs max-w-xs truncate">{t.narration}</td>
                        <td>
                          {t.txnType !== 'other' && (
                            <span className="badge bg-brand-50 text-brand-700 border border-brand-100 text-xs">{t.txnType}</span>
                          )}
                        </td>
                        <td className="text-right font-mono text-emerald-700">{t.credit > 0 ? formatCurrency(t.credit) : '—'}</td>
                        <td className="text-right font-mono text-red-600">{t.debit > 0 ? formatCurrency(t.debit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!results && !parsing && (
        <div className="card p-10 text-center">
          <FileText className="w-12 h-12 text-surface-300 mx-auto mb-3" />
          <h3 className="font-semibold text-surface-700 mb-1">Upload Bank Statement to Begin</h3>
          <p className="text-sm text-surface-400">Select month, choose bank (HDFC or ICICI), upload PDF statement, then click Run Audit</p>
        </div>
      )}
    </div>
  );
}
