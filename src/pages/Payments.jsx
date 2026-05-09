import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths, PAYMENT_MODES, exportMultiSheet } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  Plus, Download, Filter, Camera, Upload, X, CheckCircle2,
  AlertTriangle, Lock, Eye, Trash2, RefreshCw, ImageIcon
} from 'lucide-react';

const MODES = ['cash', 'upi', 'bank_transfer', 'rentok', 'crib', 'cheque', 'other'];
const MODE_LABELS = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank Transfer', rentok: 'RentOK', crib: 'Crib', cheque: 'Cheque', other: 'Other' };

// Cash proof requirements
const CASH_PROOFS = [
  { key: 'cash_voucher_url', label: 'Signed Cash Voucher', hint: 'Photo of the signed receipt/voucher' },
  { key: 'cash_photo_url', label: 'Cash Photo', hint: 'Photo of the actual cash amount' },
  { key: 'payer_photo_url', label: 'Payer Photo', hint: 'Photo of the person paying' },
];

function ProofUpload({ proofKey, label, hint, value, onChange, disabled }) {
  const inputRef = useRef();
  const [uploading, setUploading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Images only');
    if (file.size > 5 * 1024 * 1024) return toast.error('Max 5MB per image');

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `cash-proofs/${Date.now()}-${proofKey}.${ext}`;
      const { error } = await supabase.storage.from('cash-proofs').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('cash-proofs').getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success(`${label} uploaded`);
    } catch (e) {
      toast.error('Upload failed: ' + e.message);
    } finally {
      setUploading(false);
      inputRef.current.value = '';
    }
  }

  return (
    <div className={`border rounded-lg p-3 ${value ? 'border-emerald-300 bg-emerald-50/50' : 'border-surface-300 bg-surface-50'}`}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        onChange={handleFile} className="hidden" disabled={disabled || uploading} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-xs font-semibold text-surface-700 flex items-center gap-1">
            {value ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Camera className="w-3.5 h-3.5 text-surface-400" />}
            {label} <span className="text-red-500">*</span>
          </p>
          <p className="text-xs text-surface-400 mt-0.5">{hint}</p>
        </div>
        {value ? (
          <div className="flex gap-1">
            <a href={value} target="_blank" rel="noopener noreferrer"
              className="btn btn-sm bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200">
              <Eye className="w-3.5 h-3.5" />
            </a>
            <button onClick={() => onChange(null)} className="btn btn-sm bg-red-50 text-red-600 border border-red-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            className="btn btn-sm btn-secondary flex items-center gap-1.5">
            {uploading
              ? <div className="w-3 h-3 border border-surface-400 border-t-transparent rounded-full animate-spin" />
              : <Upload className="w-3 h-3" />}
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Payments() {
  const { isAdmin, isSuperAdmin, profile } = useAuth();
  const months = lastNMonths(6);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState('all');
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [viewProofs, setViewProofs] = useState(null);

  // Form state
  const [flats, setFlats] = useState([]);
  const [form, setForm] = useState({
    flat_id: '', tenant_id: '', building_id: '', amount: '',
    payment_mode: 'cash', payment_date: new Date().toISOString().slice(0, 10),
    for_month: months[months.length - 1], transaction_ref: '', notes: '',
    cash_voucher_url: null, cash_photo_url: null, payer_photo_url: null,
  });
  const [saving, setSaving] = useState(false);
  const [flatTenants, setFlatTenants] = useState({});

  useEffect(() => { loadBuildings(); }, []);
  useEffect(() => { loadCollections(); }, [selectedMonth, selectedBuilding]);

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name');
    setBuildings(data || []);
  }

  async function loadFlatsForForm() {
    const { data: flatData } = await supabase
      .from('flats')
      .select('id, door_number, monthly_rent, building_id, buildings(name)')
      .eq('status', 'occupied')
      .order('door_number');
    setFlats(flatData || []);

    // Get tenants for each flat
    const ids = (flatData || []).map(f => f.id);
    if (ids.length) {
      const { data: tenants } = await supabase
        .from('tenants').select('id, full_name, flat_id, monthly_rent')
        .eq('status', 'active').in('flat_id', ids);
      const map = {};
      (tenants || []).forEach(t => { map[t.flat_id] = t; });
      setFlatTenants(map);
    }
  }

  async function loadCollections() {
    setLoading(true);
    try {
      let q = supabase
        .from('rent_collections')
        .select(`id, amount, payment_mode, payment_date, for_month, transaction_ref, notes,
          cash_voucher_url, cash_photo_url, payer_photo_url,
          tenant:tenants(full_name, phone),
          flat:flats(door_number),
          building:buildings(name),
          collector:profiles!collected_by(full_name)`)
        .eq('for_month', selectedMonth)
        .order('payment_date', { ascending: false });
      if (selectedBuilding !== 'all') q = q.eq('building_id', selectedBuilding);
      const { data, error } = await q;
      if (error) throw error;
      setCollections(data || []);
    } catch (e) {
      toast.error('Load failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleFlatSelect(flatId) {
    const flat = flats.find(f => f.id === flatId);
    const tenant = flatTenants[flatId];
    setForm(p => ({
      ...p,
      flat_id: flatId,
      building_id: flat?.building_id || '',
      tenant_id: tenant?.id || '',
      amount: String(tenant?.monthly_rent || flat?.monthly_rent || ''),
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.flat_id) return toast.error('Select a flat');
    if (!form.tenant_id) return toast.error('No active tenant for this flat');
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Enter a valid amount');

    // Cash requires all 3 proofs
    if (form.payment_mode === 'cash') {
      if (!form.cash_voucher_url) return toast.error('Cash voucher photo required');
      if (!form.cash_photo_url) return toast.error('Cash photo required');
      if (!form.payer_photo_url) return toast.error('Payer photo required');
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('rent_collections').insert({
        flat_id: form.flat_id,
        tenant_id: form.tenant_id,
        building_id: form.building_id,
        amount: Number(form.amount),
        payment_mode: form.payment_mode,
        payment_date: form.payment_date,
        for_month: form.for_month,
        transaction_ref: form.transaction_ref || null,
        notes: form.notes || null,
        cash_voucher_url: form.cash_voucher_url || null,
        cash_photo_url: form.cash_photo_url || null,
        payer_photo_url: form.payer_photo_url || null,
        collected_by: profile?.id,
      });
      if (error) throw error;
      toast.success('Payment recorded');
      setShowAdd(false);
      setForm({
        flat_id: '', tenant_id: '', building_id: '', amount: '',
        payment_mode: 'cash', payment_date: new Date().toISOString().slice(0, 10),
        for_month: months[months.length - 1], transaction_ref: '', notes: '',
        cash_voucher_url: null, cash_photo_url: null, payer_photo_url: null,
      });
      loadCollections();
    } catch (e) {
      toast.error('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this collection record?')) return;
    const { error } = await supabase.from('rent_collections').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Deleted'); loadCollections(); }
  }

  function handleExport() {
    if (!collections.length) return toast.error('No data to export');
    const rows = collections.map(c => ({
      Date: c.payment_date,
      Tenant: c.tenant?.full_name || '—',
      Flat: c.flat?.door_number || '—',
      Building: c.building?.name || '—',
      Month: c.for_month,
      Mode: c.payment_mode,
      Amount: c.amount,
      Reference: c.transaction_ref || '—',
      'Collected By': c.collector?.full_name || '—',
      'Has Cash Proof': c.cash_voucher_url ? 'Yes' : 'No',
    }));
    exportMultiSheet([{ name: 'Collections', data: rows }], `Rent_${selectedMonth}`);
    toast.success('Exported');
  }

  const totalCollected = collections.reduce((s, c) => s + Number(c.amount), 0);
  const cashCount = collections.filter(c => c.payment_mode === 'cash').length;

  const modeBadge = (mode) => {
    const colors = {
      cash: 'bg-amber-50 text-amber-700 border-amber-200',
      upi: 'bg-blue-50 text-blue-700 border-blue-200',
      bank_transfer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      rentok: 'bg-purple-50 text-purple-700 border-purple-200',
      crib: 'bg-pink-50 text-pink-700 border-pink-200',
      cheque: 'bg-surface-100 text-surface-700 border-surface-200',
      other: 'bg-surface-100 text-surface-500 border-surface-200',
    };
    return <span className={`badge border text-xs ${colors[mode] || 'bg-surface-100 border-surface-200'}`}>{MODE_LABELS[mode] || mode}</span>;
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Rent Collection</h1>
          <p className="text-sm text-surface-500 mt-0.5">Record payments · Cash requires photo proof</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={() => { setShowAdd(true); loadFlatsForForm(); }} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Record Payment
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <Filter className="w-4 h-4 text-surface-400 self-center" />
        <div>
          <label className="label text-xs mb-0.5">Month</label>
          <select className="select py-1.5 text-sm" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs mb-0.5">Building</label>
          <select className="select py-1.5 text-sm" value={selectedBuilding} onChange={e => setSelectedBuilding(e.target.value)}>
            <option value="all">All Buildings</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button onClick={loadCollections} className="btn-ghost btn-sm flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <div className="ml-auto flex items-center gap-3 text-xs text-surface-500">
          <span>{collections.length} records</span>
          {cashCount > 0 && (
            <span className="badge bg-amber-50 text-amber-700 border border-amber-200">
              {cashCount} cash payments
            </span>
          )}
          <span className="font-semibold text-emerald-700 font-mono">{formatCurrency(totalCollected)}</span>
        </div>
      </div>

      {/* Add Payment Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="modal-content max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
              <h2 className="font-semibold text-surface-800">Record Rent Payment</h2>
              <button onClick={() => setShowAdd(false)} className="text-surface-400 hover:text-surface-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Flat *</label>
                  <select className="select" value={form.flat_id} onChange={e => handleFlatSelect(e.target.value)} required>
                    <option value="">Select flat…</option>
                    {flats.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.buildings?.name} — {f.door_number} (₹{f.monthly_rent?.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">Amount (₹) *</label>
                  <input type="number" className="input" value={form.amount}
                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0.00" required />
                </div>

                <div>
                  <label className="label">Payment Mode *</label>
                  <select className="select" value={form.payment_mode}
                    onChange={e => setForm(p => ({ ...p, payment_mode: e.target.value }))}>
                    {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label">For Month *</label>
                  <select className="select" value={form.for_month}
                    onChange={e => setForm(p => ({ ...p, for_month: e.target.value }))}>
                    {months.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label">Payment Date *</label>
                  <input type="date" className="input" value={form.payment_date}
                    onChange={e => setForm(p => ({ ...p, payment_date: e.target.value }))} required />
                </div>

                <div className="col-span-2">
                  <label className="label">Transaction Reference</label>
                  <input className="input" value={form.transaction_ref}
                    onChange={e => setForm(p => ({ ...p, transaction_ref: e.target.value }))}
                    placeholder="UPI ID / Cheque No / App reference" />
                </div>

                <div className="col-span-2">
                  <label className="label">Notes</label>
                  <input className="input" value={form.notes}
                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Any additional notes" />
                </div>
              </div>

              {/* Cash proof section — only shown for cash */}
              {form.payment_mode === 'cash' && (
                <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Cash Payment — 3 Photos Required
                  </p>
                  <p className="text-xs text-amber-700">All three photos must be uploaded before saving.</p>
                  {CASH_PROOFS.map(({ key, label, hint }) => (
                    <ProofUpload key={key} proofKey={key} label={label} hint={hint}
                      value={form[key]}
                      onChange={url => setForm(p => ({ ...p, [key]: url }))} />
                  ))}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {saving
                    ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                    : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cash Proofs Viewer */}
      {viewProofs && (
        <div className="modal-overlay" onClick={() => setViewProofs(null)}>
          <div className="modal-content max-w-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-surface-800">Cash Payment Proofs</h3>
              <button onClick={() => setViewProofs(null)} className="text-surface-400 hover:text-surface-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {CASH_PROOFS.map(({ key, label }) => (
                <div key={key}>
                  <p className="text-xs font-medium text-surface-500 mb-1.5">{label}</p>
                  {viewProofs[key]
                    ? <img src={viewProofs[key]} alt={label} className="w-full rounded-lg border border-surface-200 max-h-48 object-cover" />
                    : <div className="h-20 bg-surface-100 rounded-lg flex items-center justify-center text-surface-400 text-sm border border-dashed border-surface-300">
                        No photo uploaded
                      </div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Collections table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : collections.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-surface-400 text-sm">No collections for {selectedMonth}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Tenant</th>
                  <th>Flat</th>
                  <th>Building</th>
                  <th>Month</th>
                  <th>Mode</th>
                  <th className="text-right">Amount</th>
                  <th>Reference</th>
                  <th>Proof</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {collections.map(c => (
                  <tr key={c.id}>
                    <td className="text-xs text-surface-500">{c.payment_date}</td>
                    <td className="font-medium text-surface-800">{c.tenant?.full_name || '—'}</td>
                    <td className="font-mono text-sm">{c.flat?.door_number || '—'}</td>
                    <td className="text-surface-600 text-sm">{c.building?.name || '—'}</td>
                    <td className="text-surface-500 text-xs">{c.for_month}</td>
                    <td>{modeBadge(c.payment_mode)}</td>
                    <td className="text-right font-mono font-semibold text-emerald-700">{formatCurrency(c.amount)}</td>
                    <td className="text-xs text-surface-400">{c.transaction_ref || '—'}</td>
                    <td>
                      {c.payment_mode === 'cash' ? (
                        <button onClick={() => setViewProofs(c)}
                          className={`btn btn-sm flex items-center gap-1 ${c.cash_voucher_url ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-red-600 bg-red-50 border border-red-200'}`}>
                          <ImageIcon className="w-3.5 h-3.5" />
                          {c.cash_voucher_url ? 'View' : 'Missing'}
                        </button>
                      ) : (
                        <span className="text-surface-400 text-xs">—</span>
                      )}
                    </td>
                    <td>
                      {(isAdmin || isSuperAdmin) ? (
                        <button onClick={() => handleDelete(c.id)}
                          className="btn-ghost btn-sm text-surface-400 hover:text-red-500 p-1.5"
                          title="Delete payment">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-surface-300 mx-auto" title="Only admin can delete" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-50 border-t border-surface-200">
                  <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-surface-500">
                    Total — {collections.length} payments
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">
                    {formatCurrency(totalCollected)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
