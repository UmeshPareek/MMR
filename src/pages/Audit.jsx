import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, fmtDate, exportMultiSheet } from '../utils/helpers';
import { Spinner, EmptyState, Badge } from '../components/ui/index';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import {
  ShieldAlert, Upload, Download, AlertTriangle, CheckCircle2,
  XCircle, FileSpreadsheet, TrendingDown, RefreshCw, Eye,
  ArrowUpCircle, ArrowDownCircle, Zap
} from 'lucide-react';

const FLAG_SEVERITY = {
  high: { label: 'High', cls: 'bg-expense-500/20 text-expense-400 border border-expense-500/30' },
  medium: { label: 'Medium', cls: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
  low: { label: 'Low', cls: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' },
};

export default function Audit() {
  const { isSuperAdmin } = useAuth();
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [statements, setStatements] = useState([]);
  const [flags, setFlags] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState('upload');
  const [filename, setFilename] = useState('');

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="card p-8 text-center max-w-sm">
          <ShieldAlert className="w-12 h-12 text-expense-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-surface-100 mb-2">Access Restricted</h2>
          <p className="text-surface-400 text-sm">The Audit module is only available to Super Admin.</p>
        </div>
      </div>
    );
  }

  function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));
    return lines.slice(1).map(line => {
      const vals = line.split(',');
      const obj = {};
      headers.forEach((h, i) => obj[h] = (vals[i] || '').trim().replace(/^"|"$/g, ''));
      return obj;
    }).filter(r => Object.values(r).some(v => v));
  }

  function parseExcelStatement(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
          resolve(raw);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  }

  function normalizeRows(rows) {
    // Try to detect column mappings
    const sample = rows[0] ? Object.keys(rows[0]).map(k => k.toLowerCase()) : [];
    const findKey = (candidates) => {
      const lKeys = Object.keys(rows[0] || {});
      for (const c of candidates) {
        const match = lKeys.find(k => k.toLowerCase().includes(c));
        if (match) return match;
      }
      return null;
    };
    const dateKey = findKey(['date', 'txn_date', 'value_date', 'transaction_date', 'dt']);
    const descKey = findKey(['description', 'narration', 'particulars', 'remarks', 'desc', 'details']);
    const debitKey = findKey(['debit', 'withdrawal', 'dr', 'debit_amount']);
    const creditKey = findKey(['credit', 'deposit', 'cr', 'credit_amount']);
    const amtKey = findKey(['amount', 'amt']);
    const refKey = findKey(['reference', 'ref', 'cheque', 'chq', 'utr', 'txn_id']);
    const balKey = findKey(['balance', 'bal', 'closing_balance']);

    return rows.map((r, i) => {
      let debit = 0, credit = 0;
      if (debitKey) debit = parseFloat(String(r[debitKey]).replace(/,/g, '')) || 0;
      if (creditKey) credit = parseFloat(String(r[creditKey]).replace(/,/g, '')) || 0;
      if (amtKey && !debitKey && !creditKey) {
        const amt = parseFloat(String(r[amtKey]).replace(/,/g, '')) || 0;
        if (amt < 0) debit = Math.abs(amt); else credit = amt;
      }
      return {
        row: i + 2,
        date: dateKey ? r[dateKey] : '',
        description: descKey ? r[descKey] : '',
        debit,
        credit,
        balance: balKey ? parseFloat(String(r[balKey]).replace(/,/g, '')) || 0 : 0,
        ref: refKey ? r[refKey] : '',
      };
    }).filter(r => r.date || r.description || r.debit || r.credit);
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setUploading(true);
    toast.loading('Parsing bank statement…', { id: 'parse' });

    try {
      let rows;
      if (file.name.endsWith('.csv')) {
        const text = await file.text();
        const raw = parseCSV(text);
        rows = normalizeRows(raw);
      } else {
        const raw = await parseExcelStatement(file);
        rows = normalizeRows(raw);
      }

      if (!rows.length) throw new Error('No valid rows found in file');

      setStatements(rows);
      setActiveTab('analyze');
      toast.success(`Parsed ${rows.length} transactions`, { id: 'parse' });
    } catch (err) {
      toast.error(err.message || 'Failed to parse file', { id: 'parse' });
    } finally {
      setUploading(false);
      fileRef.current.value = '';
    }
  }

  async function runAnalysis() {
    if (!statements.length) return toast.error('Upload a statement first');
    setAnalyzing(true);
    toast.loading('Running audit analysis…', { id: 'audit' });

    try {
      // Fetch internal records
      const { data: collections } = await supabase
        .from('rent_collections').select('amount, payment_mode, payment_date, notes');
      const { data: ownerPmts } = await supabase
        .from('owner_payments').select('amount, payment_mode, payment_date, notes');
      const { data: expenses } = await supabase
        .from('expenses').select('amount, date, description, category');
      const { data: salaries } = await supabase
        .from('staff_salaries').select('net_amount, payment_date, notes');

      const allDebits = statements.filter(r => r.debit > 0);
      const allCredits = statements.filter(r => r.credit > 0);

      const foundFlags = [];
      let matchedDebits = 0, matchedCredits = 0;

      // 1. Large transactions (> ₹50,000)
      statements.filter(r => r.debit > 50000 || r.credit > 50000).forEach(r => {
        foundFlags.push({
          type: r.debit > 50000 ? 'Large Debit' : 'Large Credit',
          severity: 'high',
          row: r.row,
          date: r.date,
          amount: r.debit > 50000 ? r.debit : r.credit,
          description: r.description,
          note: `Transaction above ₹50,000 — requires manual review`,
        });
      });

      // 2. Duplicate transactions (same amount + date within 1 day)
      const seen = {};
      statements.forEach(r => {
        const key = `${r.date}_${r.debit}_${r.credit}`;
        if (seen[key]) {
          foundFlags.push({
            type: 'Potential Duplicate',
            severity: 'high',
            row: r.row,
            date: r.date,
            amount: r.debit || r.credit,
            description: r.description,
            note: `Identical amount on same date as row ${seen[key]}`,
          });
        }
        seen[key] = r.row;
      });

      // 3. Round number suspicion (exact round amounts > ₹10,000)
      statements.filter(r => {
        const amt = r.debit || r.credit;
        return amt > 10000 && amt % 1000 === 0;
      }).slice(0, 10).forEach(r => {
        foundFlags.push({
          type: 'Round Amount',
          severity: 'low',
          row: r.row,
          date: r.date,
          amount: r.debit || r.credit,
          description: r.description,
          note: `Round number above ₹10,000 — verify with records`,
        });
      });

      // 4. Weekend/odd hour transactions
      statements.forEach(r => {
        if (!r.date) return;
        const d = new Date(r.date);
        if (!isNaN(d) && (d.getDay() === 0 || d.getDay() === 6)) {
          foundFlags.push({
            type: 'Weekend Transaction',
            severity: 'low',
            row: r.row,
            date: r.date,
            amount: r.debit || r.credit,
            description: r.description,
            note: `Transaction recorded on a weekend`,
          });
        }
      });

      // 5. Unmatched debits (debit not found in any internal record ±10%)
      const internalDebits = [
        ...(ownerPmts || []).map(p => Number(p.amount)),
        ...(expenses || []).map(e => Number(e.amount)),
        ...(salaries || []).map(s => Number(s.net_amount)),
      ];
      allDebits.forEach(r => {
        const match = internalDebits.find(a => Math.abs(a - r.debit) / r.debit < 0.1);
        if (!match && r.debit > 1000) {
          foundFlags.push({
            type: 'Unmatched Debit',
            severity: 'medium',
            row: r.row,
            date: r.date,
            amount: r.debit,
            description: r.description,
            note: `No matching internal record found for this debit`,
          });
          matchedDebits++;
        }
      });

      // 6. Unmatched credits (credit not found in rent collections ±10%)
      const internalCredits = (collections || []).map(c => Number(c.amount));
      allCredits.forEach(r => {
        const match = internalCredits.find(a => Math.abs(a - r.credit) / r.credit < 0.1);
        if (!match && r.credit > 1000) {
          foundFlags.push({
            type: 'Unmatched Credit',
            severity: 'medium',
            row: r.row,
            date: r.date,
            amount: r.credit,
            description: r.description,
            note: `Credit not matched to any rent collection record`,
          });
          matchedCredits++;
        }
      });

      // 7. Balance consistency check
      let prevBal = null;
      statements.forEach((r, i) => {
        if (prevBal !== null && r.balance > 0) {
          const expectedBal = prevBal + r.credit - r.debit;
          const diff = Math.abs(expectedBal - r.balance);
          if (diff > 100 && r.balance > 0) {
            foundFlags.push({
              type: 'Balance Mismatch',
              severity: 'high',
              row: r.row,
              date: r.date,
              amount: diff,
              description: r.description,
              note: `Expected balance ₹${expectedBal.toFixed(2)}, got ₹${r.balance.toFixed(2)}`,
            });
          }
        }
        if (r.balance > 0) prevBal = r.balance;
      });

      setFlags(foundFlags);

      // Stats
      const totalDebits = allDebits.reduce((s, r) => s + r.debit, 0);
      const totalCredits = allCredits.reduce((s, r) => s + r.credit, 0);
      setStats({
        txCount: statements.length,
        debitCount: allDebits.length,
        creditCount: allCredits.length,
        totalDebits,
        totalCredits,
        netFlow: totalCredits - totalDebits,
        flagCount: foundFlags.length,
        highFlags: foundFlags.filter(f => f.severity === 'high').length,
        medFlags: foundFlags.filter(f => f.severity === 'medium').length,
        lowFlags: foundFlags.filter(f => f.severity === 'low').length,
      });

      setActiveTab('flags');
      toast.success(`Analysis complete — ${foundFlags.length} flags raised`, { id: 'audit' });
    } catch (err) {
      toast.error('Analysis failed: ' + err.message, { id: 'audit' });
    } finally {
      setAnalyzing(false);
    }
  }

  function exportAuditReport() {
    if (!statements.length) return toast.error('No data to export');

    const stmtSheet = statements.map(r => ({
      Row: r.row, Date: r.date, Description: r.description,
      'Debit (₹)': r.debit || '', 'Credit (₹)': r.credit || '',
      'Balance (₹)': r.balance || '', Reference: r.ref,
    }));

    const flagSheet = flags.map(f => ({
      Severity: f.severity.toUpperCase(), Type: f.type,
      Row: f.row, Date: f.date, 'Amount (₹)': f.amount,
      Description: f.description, Note: f.note,
    }));

    const summarySheet = stats ? [{
      'Total Transactions': stats.txCount,
      'Total Credits (₹)': stats.totalCredits,
      'Total Debits (₹)': stats.totalDebits,
      'Net Flow (₹)': stats.netFlow,
      'High Severity Flags': stats.highFlags,
      'Medium Severity Flags': stats.medFlags,
      'Low Severity Flags': stats.lowFlags,
      'Total Flags': stats.flagCount,
    }] : [];

    exportMultiSheet([
      { name: 'Summary', data: summarySheet },
      { name: 'All Transactions', data: stmtSheet },
      { name: 'Audit Flags', data: flagSheet },
    ], `MMR_Audit_${new Date().toISOString().slice(0, 10)}`);
    toast.success('Audit report exported');
  }

  const tabs = [
    { id: 'upload', label: 'Upload', icon: Upload },
    { id: 'analyze', label: `Transactions${statements.length ? ` (${statements.length})` : ''}`, icon: Eye },
    { id: 'flags', label: `Flags${flags.length ? ` (${flags.length})` : ''}`, icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-surface-50 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-brand-400" /> Audit
          </h1>
          <p className="text-surface-400 text-sm mt-0.5">Bank statement reconciliation & anomaly detection</p>
        </div>
        {statements.length > 0 && (
          <div className="flex gap-2 self-start sm:self-auto">
            <button onClick={runAnalysis} disabled={analyzing}
              className="btn-primary flex items-center gap-2">
              {analyzing ? <Spinner size="sm" /> : <Zap className="w-4 h-4" />}
              {analyzing ? 'Analyzing…' : 'Run Analysis'}
            </button>
            <button onClick={exportAuditReport} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        )}
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-xs text-surface-400 mb-1">Transactions</p>
            <p className="text-2xl font-display font-bold text-surface-50">{stats.txCount}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-surface-400 mb-1 flex items-center gap-1">
              <ArrowUpCircle className="w-3 h-3 text-income-400" /> Total Credits
            </p>
            <p className="text-xl font-display font-bold text-income-400">{formatCurrency(stats.totalCredits)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-surface-400 mb-1 flex items-center gap-1">
              <ArrowDownCircle className="w-3 h-3 text-expense-400" /> Total Debits
            </p>
            <p className="text-xl font-display font-bold text-expense-400">{formatCurrency(stats.totalDebits)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-surface-400 mb-1">Total Flags</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-display font-bold text-amber-400">{stats.flagCount}</p>
              <div className="flex gap-1 flex-wrap">
                {stats.highFlags > 0 && <span className={`badge text-xs ${FLAG_SEVERITY.high.cls}`}>{stats.highFlags}H</span>}
                {stats.medFlags > 0 && <span className={`badge text-xs ${FLAG_SEVERITY.medium.cls}`}>{stats.medFlags}M</span>}
                {stats.lowFlags > 0 && <span className={`badge text-xs ${FLAG_SEVERITY.low.cls}`}>{stats.lowFlags}L</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-700">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`tab flex items-center gap-2 ${activeTab === t.id ? 'active' : ''}`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div className="space-y-6">
          <div
            onClick={() => fileRef.current?.click()}
            className="card border-2 border-dashed border-surface-600 hover:border-brand-400 transition-colors p-12 text-center cursor-pointer group"
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
            <div className="w-16 h-16 rounded-2xl bg-brand-400/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-brand-400/20 transition-colors">
              {uploading ? <Spinner size="lg" /> : <FileSpreadsheet className="w-8 h-8 text-brand-400" />}
            </div>
            <h3 className="text-lg font-semibold text-surface-100 mb-2">
              {uploading ? 'Parsing…' : 'Upload Bank Statement'}
            </h3>
            <p className="text-surface-400 text-sm mb-4">
              Supports CSV, Excel (.xlsx, .xls) exports from any bank
            </p>
            <span className="btn-secondary text-sm">Choose File</span>
            {filename && <p className="mt-4 text-xs text-surface-500">{filename}</p>}
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-surface-200 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> What gets flagged
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { sev: 'high', label: 'Large transactions above ₹50,000' },
                { sev: 'high', label: 'Duplicate transactions (same date + amount)' },
                { sev: 'high', label: 'Balance consistency errors in statement' },
                { sev: 'medium', label: 'Debits with no matching internal record' },
                { sev: 'medium', label: 'Credits not linked to any rent collection' },
                { sev: 'low', label: 'Round-number transactions above ₹10,000' },
                { sev: 'low', label: 'Weekend / holiday transactions' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-surface-300">
                  <span className={`badge text-xs flex-shrink-0 ${FLAG_SEVERITY[item.sev].cls}`}>
                    {FLAG_SEVERITY[item.sev].label}
                  </span>
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Transactions Tab */}
      {activeTab === 'analyze' && (
        <div className="card overflow-hidden">
          {statements.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="w-8 h-8" />}
              title="No statement uploaded" description="Upload a bank statement to view transactions" />
          ) : (
            <>
              <div className="p-4 border-b border-surface-700 flex items-center justify-between">
                <span className="text-sm text-surface-400">{statements.length} transactions parsed</span>
                {!analyzing && (
                  <button onClick={runAnalysis} className="btn-primary text-xs flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" /> Run Analysis
                  </button>
                )}
              </div>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="data-table">
                  <thead className="sticky top-0 bg-surface-800">
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Credit</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((r, i) => (
                      <tr key={i}>
                        <td className="text-surface-600 font-mono text-xs">{r.row}</td>
                        <td className="text-xs">{r.date}</td>
                        <td className="max-w-xs truncate text-sm">{r.description}</td>
                        <td className="text-right font-mono text-expense-400">
                          {r.debit > 0 ? formatCurrency(r.debit) : '—'}
                        </td>
                        <td className="text-right font-mono text-income-400">
                          {r.credit > 0 ? formatCurrency(r.credit) : '—'}
                        </td>
                        <td className="text-right font-mono text-surface-400 text-xs">
                          {r.balance > 0 ? formatCurrency(r.balance) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Flags Tab */}
      {activeTab === 'flags' && (
        <div className="space-y-4">
          {flags.length === 0 ? (
            <div className="card p-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-income-400 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-surface-100 mb-2">
                {statements.length ? 'No flags raised' : 'Run analysis first'}
              </h3>
              <p className="text-surface-400 text-sm">
                {statements.length
                  ? 'All transactions look clean — no anomalies detected'
                  : 'Upload a bank statement and click Run Analysis'}
              </p>
            </div>
          ) : (
            <>
              {/* Filter by severity */}
              {['high', 'medium', 'low'].map(sev => {
                const sevFlags = flags.filter(f => f.severity === sev);
                if (!sevFlags.length) return null;
                return (
                  <div key={sev} className="card overflow-hidden">
                    <div className="p-4 border-b border-surface-700 flex items-center gap-2">
                      <span className={`badge ${FLAG_SEVERITY[sev].cls}`}>
                        {FLAG_SEVERITY[sev].label} Severity
                      </span>
                      <span className="text-sm text-surface-400">{sevFlags.length} flags</span>
                    </div>
                    <div className="divide-y divide-surface-700/50">
                      {sevFlags.map((f, i) => (
                        <div key={i} className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            <AlertTriangle className={`w-4 h-4 ${
                              sev === 'high' ? 'text-expense-400' :
                              sev === 'medium' ? 'text-amber-400' : 'text-blue-400'
                            }`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="font-semibold text-surface-100 text-sm">{f.type}</span>
                              <span className="text-xs text-surface-500">Row {f.row}</span>
                              {f.date && <span className="text-xs text-surface-500">{f.date}</span>}
                              {f.amount > 0 && (
                                <span className="font-mono text-sm text-brand-400">{formatCurrency(f.amount)}</span>
                              )}
                            </div>
                            {f.description && (
                              <p className="text-xs text-surface-400 mb-1 truncate">{f.description}</p>
                            )}
                            <p className="text-xs text-surface-300">{f.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
