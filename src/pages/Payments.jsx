import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths, exportMultiSheet } from '../utils/helpers';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import {
  Download, Camera, Upload, X, CheckCircle2,
  Clock, XCircle, Building2, ChevronDown, ChevronRight,
  Phone, Lock, Trash2, Eye, ImageIcon, RefreshCw, Receipt, Pencil, AlertTriangle
} from 'lucide-react';
import { ConfirmDialog } from '../components/ui';

function printReceipt({ tenantName, flatNumber, buildingName, amount, payment_mode, payment_date, for_month, transaction_ref }) {
  const doc = new jsPDF({ format: 'a5', unit: 'mm', orientation: 'portrait' })
  const W = 148, pad = 12

  doc.setFillColor(13, 148, 136)
  doc.rect(0, 0, W, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('RENT RECEIPT', W / 2, 12, { align: 'center' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('CashMyRent', W / 2, 20, { align: 'center' })

  doc.setTextColor(30, 41, 59)
  let y = 38

  const row = (label, value, bold = false) => {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text(label, pad, y)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setTextColor(30, 41, 59)
    doc.text(String(value || '—'), W - pad, y, { align: 'right' })
    y += 8
  }

  row('Tenant', tenantName)
  row('Flat / Room', flatNumber)
  row('Building', buildingName)
  doc.setDrawColor(226, 232, 240); doc.line(pad, y, W - pad, y); y += 6
  row('For Month', for_month)
  row('Payment Date', payment_date)
  row('Payment Mode', String(payment_mode || '').toUpperCase())
  if (transaction_ref) row('Reference', transaction_ref)
  doc.setDrawColor(226, 232, 240); doc.line(pad, y, W - pad, y); y += 8

  doc.setFillColor(240, 253, 250)
  doc.roundedRect(pad, y, W - pad * 2, 20, 3, 3, 'F')
  doc.setTextColor(15, 118, 110)
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('Amount Paid', pad + 4, y + 7)
  doc.setFontSize(16)
  doc.text(formatCurrency(amount), W - pad - 4, y + 12, { align: 'right' })
  y += 30

  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(148, 163, 184)
  doc.text('This is a computer-generated receipt and does not require a signature.', W / 2, y, { align: 'center' })
  doc.text(`Printed on ${new Date().toLocaleDateString('en-IN')}`, W / 2, y + 5, { align: 'center' })
  doc.save(`Receipt_${flatNumber}_${for_month}.pdf`)
}

const MODES = ['cash', 'upi', 'bank_transfer', 'rentok', 'crib', 'cheque', 'other'];
const MODE_LABELS = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank Transfer', rentok: 'RentOK', crib: 'Crib', cheque: 'Cheque', other: 'Other' };
const MODE_COLORS = {
  cash: 'bg-amber-50 text-amber-700 border-amber-200',
  upi: 'bg-blue-50 text-blue-700 border-blue-200',
  bank_transfer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rentok: 'bg-purple-50 text-purple-700 border-purple-200',
  crib: 'bg-pink-50 text-pink-700 border-pink-200',
  cheque: 'bg-surface-100 text-surface-600 border-surface-200',
  other: 'bg-surface-100 text-surface-500 border-surface-200',
};

const CASH_PROOFS = [
  { key: 'cash_voucher_url', label: 'Signed Voucher', hint: 'Photo of signed cash receipt' },
  { key: 'cash_photo_url', label: 'Cash Photo', hint: 'Photo of the cash amount' },
  { key: 'payer_photo_url', label: 'Payer Photo', hint: 'Photo of the person paying' },
];

function ProofUpload({ proofKey, label, hint, value, onChange }) {
  const inputRef = useRef();
  const [uploading, setUploading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Images only');
    if (file.size > 5 * 1024 * 1024) return toast.error('Max 5MB');
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
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={`rounded-lg border p-2.5 ${value ? 'border-emerald-300 bg-emerald-50/50' : 'border-surface-300 bg-surface-50'}`}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-surface-700 flex items-center gap-1">
            {value ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Camera className="w-3 h-3 text-surface-400" />}
            {label} <span className="text-red-500">*</span>
          </p>
          <p className="text-xs text-surface-400">{hint}</p>
        </div>
        {value ? (
          <div className="flex gap-1">
            <a href={value} target="_blank" rel="noopener noreferrer" className="btn btn-sm bg-emerald-50 text-emerald-700 border border-emerald-200 p-1.5"><Eye className="w-3 h-3" /></a>
            <button type="button" onClick={() => onChange(null)} className="btn btn-sm bg-red-50 text-red-600 border border-red-200 p-1.5"><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            className="btn btn-sm btn-secondary flex items-center gap-1 text-xs">
            {uploading ? <div className="w-3 h-3 border border-surface-400 border-t-transparent rounded-full animate-spin" /> : <Upload className="w-3 h-3" />}
            {uploading ? '…' : 'Upload'}
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
  const [buildingData, setBuildingData] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);

  // New payment form
  const [activeFlat, setActiveFlat] = useState(null);
  const [form, setForm] = useState({
    amount: '', payment_mode: 'upi', payment_date: new Date().toISOString().slice(0, 10),
    transaction_ref: '', notes: '',
    cash_voucher_url: null, cash_photo_url: null, payer_photo_url: null,
  });

  // Edit payment form
  const [editPayment, setEditPayment] = useState(null);
  const [editForm, setEditForm] = useState({
    amount: '', payment_mode: 'upi', payment_date: '',
    transaction_ref: '', notes: '',
  });

  const [saving, setSaving] = useState(false);
  const [viewProofs, setViewProofs] = useState(null);
  const [viewMode, setViewMode] = useState('log');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const channelRef = useRef(null);

  useEffect(() => {
    loadAll();
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase.channel('payments-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rent_collections' }, () => loadAll())
      .subscribe();
    channelRef.current = channel;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [selectedMonth]);

  async function loadAll() {
    setLoading(true);
    try {
      const { data: bList } = await supabase.from('buildings').select('id, name').eq('is_active', true).order('name');
      setBuildings(bList || []);

      const { data: flats } = await supabase
        .from('flats').select('id, door_number, monthly_rent, building_id').eq('status', 'occupied').order('door_number');

      const flatIds = (flats || []).map(f => f.id);

      const [{ data: tenants }, { data: collections }] = await Promise.all([
        flatIds.length
          ? supabase.from('tenants').select('id, full_name, phone, flat_id').eq('status', 'active').in('flat_id', flatIds)
          : { data: [] },
        flatIds.length
          ? supabase.from('rent_collections').select('*').eq('for_month', selectedMonth).in('flat_id', flatIds)
          : { data: [] },
      ]);

      const tenantMap = {};
      (tenants || []).forEach(t => { tenantMap[t.flat_id] = t; });
      const collMap = {};
      (collections || []).forEach(c => {
        collMap[c.flat_id] = collMap[c.flat_id] || [];
        collMap[c.flat_id].push(c);
      });

      const bData = {};
      (bList || []).forEach(b => { bData[b.id] = { flats: [], stats: { paid: 0, partial: 0, unpaid: 0, total: 0 } }; });
      (flats || []).forEach(f => {
        if (!bData[f.building_id]) return;
        const tenant = tenantMap[f.id];
        const colls = collMap[f.id] || [];
        const paid = colls.reduce((s, c) => s + Number(c.amount), 0);
        const expected = Number(f.monthly_rent);
        const status = paid >= expected ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
        bData[f.building_id].flats.push({ ...f, tenant, colls, paid, expected, balance: expected - paid, status });
        bData[f.building_id].stats[status]++;
        bData[f.building_id].stats.total++;
      });

      setBuildingData(bData);

      const exp = {};
      Object.entries(bData).forEach(([id, d]) => {
        if (d.stats.unpaid > 0 || d.stats.partial > 0) exp[id] = true;
      });
      setExpanded(exp);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openPay(flat) {
    setActiveFlat(flat);
    setForm({
      amount: String(flat.balance > 0 ? flat.balance : flat.expected),
      payment_mode: 'upi',
      payment_date: new Date().toISOString().slice(0, 10),
      transaction_ref: '', notes: '',
      cash_voucher_url: null, cash_photo_url: null, payer_photo_url: null,
    });
  }

  function openEditPayment(coll) {
    setEditPayment(coll);
    setEditForm({
      amount: String(coll.amount),
      payment_mode: coll.payment_mode,
      payment_date: coll.payment_date,
      transaction_ref: coll.transaction_ref || '',
      notes: coll.notes || '',
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!activeFlat?.tenant) return toast.error('No active tenant for this flat');
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Enter amount');
    if (form.payment_mode === 'cash') {
      if (!form.cash_voucher_url) return toast.error('Voucher photo required');
      if (!form.cash_photo_url) return toast.error('Cash photo required');
      if (!form.payer_photo_url) return toast.error('Payer photo required');
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('rent_collections').insert({
        flat_id: activeFlat.id,
        tenant_id: activeFlat.tenant.id,
        building_id: activeFlat.building_id,
        amount: Number(form.amount),
        payment_mode: form.payment_mode,
        payment_date: form.payment_date,
        for_month: selectedMonth,
        transaction_ref: form.transaction_ref || null,
        notes: form.notes || null,
        cash_voucher_url: form.cash_voucher_url || null,
        cash_photo_url: form.cash_photo_url || null,
        payer_photo_url: form.payer_photo_url || null,
        collected_by: profile?.id,
      });
      if (error) throw error;
      toast.success(`Payment logged — ${activeFlat.tenant.full_name}`);
      setActiveFlat(null);
      loadAll();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editForm.amount || Number(editForm.amount) <= 0) return toast.error('Enter amount');
    setSaving(true);
    try {
      const { error } = await supabase.from('rent_collections').update({
        amount: Number(editForm.amount),
        payment_mode: editForm.payment_mode,
        payment_date: editForm.payment_date,
        transaction_ref: editForm.transaction_ref || null,
        notes: editForm.notes || null,
      }).eq('id', editPayment.id);
      if (error) throw error;
      toast.success('Payment updated');
      setEditPayment(null);
      loadAll();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(id) {
    setConfirmDelete(id);
  }

  async function doDelete() {
    const { error } = await supabase.from('rent_collections').delete().eq('id', confirmDelete);
    if (error) toast.error(error.message);
    else { toast.success('Deleted'); loadAll(); }
    setConfirmDelete(null);
  }

  function generateStatement(flat) {
    const bName = buildings.find(x => x.id === flat.building_id)?.name || '—';
    const tenant = flat.tenant;
    const doc = new jsPDF({ format: 'a5', unit: 'mm', orientation: 'portrait' });
    const W = 148, pad = 12;

    // Header
    doc.setFillColor(13, 148, 136);
    doc.rect(0, 0, W, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text('RENT STATEMENT', W / 2, 11, { align: 'center' });
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text(`CashMyRent · ${selectedMonth}`, W / 2, 20, { align: 'center' });

    // Tenant info block
    doc.setFillColor(248, 250, 252);
    doc.rect(pad, 32, W - pad * 2, 30, 'F');
    doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text('TENANT', pad + 3, 39);
    doc.setTextColor(30, 41, 59); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(tenant?.full_name || '—', pad + 3, 46);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
    doc.text(`${flat.door_number} · ${bName}`, pad + 3, 53);
    doc.text(`Phone: ${tenant?.phone || '—'}`, pad + 3, 59);

    // Summary row
    const summaryY = 68;
    const boxes = [
      { label: 'Expected', value: formatCurrency(flat.expected), color: [30, 41, 59] },
      { label: 'Paid', value: formatCurrency(flat.paid), color: [5, 150, 105] },
      { label: 'Balance', value: formatCurrency(Math.max(flat.balance, 0)), color: flat.balance > 0 ? [220, 38, 38] : [100, 116, 139] },
    ];
    const boxW = (W - pad * 2) / 3;
    boxes.forEach((b, i) => {
      const bx = pad + i * boxW;
      doc.setFillColor(i === 1 ? 240 : i === 2 && flat.balance > 0 ? 254 : 248, i === 1 ? 253 : i === 2 && flat.balance > 0 ? 226 : 250, i === 1 ? 250 : i === 2 && flat.balance > 0 ? 226 : 252);
      doc.roundedRect(bx, summaryY, boxW - 2, 18, 2, 2, 'F');
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
      doc.text(b.label, bx + (boxW - 2) / 2, summaryY + 6, { align: 'center' });
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...b.color);
      doc.text(b.value, bx + (boxW - 2) / 2, summaryY + 13, { align: 'center' });
    });

    // Payment rows
    let y = summaryY + 26;
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59);
    doc.text('PAYMENT DETAILS', pad, y); y += 6;
    doc.setDrawColor(226, 232, 240); doc.line(pad, y, W - pad, y); y += 4;

    if (flat.colls.length === 0) {
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(148, 163, 184);
      doc.text('No payments recorded for this month.', pad, y + 4);
    } else {
      flat.colls.forEach((c, i) => {
        if (i % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(pad, y - 1, W - pad * 2, 10, 'F');
        }
        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59);
        doc.text(c.payment_date || '—', pad + 2, y + 5);
        doc.text(String(c.payment_mode || '').toUpperCase(), pad + 32, y + 5);
        doc.text(c.transaction_ref || '—', pad + 62, y + 5, { maxWidth: 30 });
        doc.setFont('helvetica', 'bold'); doc.setTextColor(5, 150, 105);
        doc.text(formatCurrency(c.amount), W - pad - 2, y + 5, { align: 'right' });
        y += 11;
      });
      doc.setDrawColor(226, 232, 240); doc.line(pad, y, W - pad, y); y += 4;
      doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59);
      doc.text('TOTAL PAID', pad + 2, y + 5);
      doc.setTextColor(5, 150, 105);
      doc.text(formatCurrency(flat.paid), W - pad - 2, y + 5, { align: 'right' });
    }

    // Footer
    const fY = 200;
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(148, 163, 184);
    doc.text('This is a computer-generated statement.', W / 2, fY, { align: 'center' });
    doc.text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, W / 2, fY + 5, { align: 'center' });
    doc.save(`Statement_${flat.door_number}_${selectedMonth}.pdf`);
    toast.success('Statement downloaded');
  }

  function handleExport() {
    const rows = Object.values(buildingData).flatMap(b =>
      b.flats.map(f => ({
        Building: buildings.find(x => x.id === f.building_id)?.name || '—',
        Room: f.door_number,
        Tenant: f.tenant?.full_name || '—',
        'Expected (₹)': f.expected,
        'Paid (₹)': f.paid,
        'Balance (₹)': f.balance,
        Status: f.status.toUpperCase(),
        Mode: f.colls.map(c => c.payment_mode).join(', ') || '—',
      }))
    );
    exportMultiSheet([{ name: selectedMonth, data: rows }], `Payments_${selectedMonth}`);
    toast.success('Exported');
  }

  const allCollections = Object.values(buildingData).flatMap(b =>
    b.flats.flatMap(f => f.colls.map(c => ({
      ...c,
      flatNumber: f.door_number,
      tenantName: f.tenant?.full_name || '—',
      buildingName: buildings.find(x => x.id === f.building_id)?.name || '—',
    })))
  ).sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date));

  const totalCollected = Object.values(buildingData).reduce((s, b) => s + b.flats.reduce((ss, f) => ss + f.paid, 0), 0);
  const totalExpected = Object.values(buildingData).reduce((s, b) => s + b.flats.reduce((ss, f) => ss + f.expected, 0), 0);
  const totalUnpaid = Object.values(buildingData).reduce((s, b) => s + b.stats.unpaid, 0);

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Rent Collection</h1>
          <p className="text-sm text-surface-500 mt-0.5">Tap a flat to log or edit payment</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="select w-auto py-1.5 text-sm" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={handleExport} className="btn-secondary btn-sm flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /></button>
          <button onClick={loadAll} className="btn-ghost btn-sm"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 border-l-4 border-emerald-400">
          <p className="text-xs text-surface-500">Collected</p>
          <p className="text-lg font-bold font-mono text-emerald-700">{formatCurrency(totalCollected)}</p>
        </div>
        <div className="card p-3 border-l-4 border-red-400">
          <p className="text-xs text-surface-500">Pending</p>
          <p className="text-lg font-bold font-mono text-red-600">{formatCurrency(totalExpected - totalCollected)}</p>
        </div>
        <div className="card p-3 border-l-4 border-amber-400">
          <p className="text-xs text-surface-500">Unpaid Flats</p>
          <p className="text-lg font-bold text-amber-700">{totalUnpaid}</p>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-1 border-b border-surface-200">
        <button onClick={() => setViewMode('log')} className={`tab ${viewMode === 'log' ? 'active' : ''}`}>Log Payments</button>
        <button onClick={() => setViewMode('history')} className={`tab ${viewMode === 'history' ? 'active' : ''}`}>History ({allCollections.length})</button>
      </div>

      {/* ── LOG MODE ── */}
      {viewMode === 'log' && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : buildings.map(b => {
            const bData = buildingData[b.id];
            if (!bData || bData.stats.total === 0) return null;
            const isOpen = expanded[b.id];
            return (
              <div key={b.id} className="card overflow-hidden">
                {/* Building header */}
                <button onClick={() => setExpanded(p => ({ ...p, [b.id]: !p[b.id] }))}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 transition-colors text-left">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
                  <Building2 className="w-4 h-4 text-surface-400 flex-shrink-0" />
                  <span className="font-semibold text-surface-800 flex-1 text-sm">{b.name}</span>
                  <div className="flex items-center gap-2">
                    {bData.stats.unpaid > 0 && <span className="badge bg-red-50 text-red-700 border border-red-200 text-xs">{bData.stats.unpaid} unpaid</span>}
                    {bData.stats.partial > 0 && <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">{bData.stats.partial} partial</span>}
                    {bData.stats.paid > 0 && <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">{bData.stats.paid} paid</span>}
                  </div>
                </button>

                {/* Flat list */}
                {isOpen && (
                  <div className="border-t border-surface-100 divide-y divide-surface-100">
                    {bData.flats.map(flat => (
                      <div key={flat.id}>
                        {/* Flat row */}
                        <div className={`flex items-center gap-3 px-4 py-3 ${flat.status === 'unpaid' ? 'bg-red-50/30' : flat.status === 'partial' ? 'bg-amber-50/20' : ''}`}>
                          <div className="flex-shrink-0">
                            {flat.status === 'paid' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                            {flat.status === 'partial' && <Clock className="w-5 h-5 text-amber-500" />}
                            {flat.status === 'unpaid' && <XCircle className="w-5 h-5 text-red-400" />}
                          </div>

                          <div className="w-12 flex-shrink-0">
                            <p className="font-mono font-bold text-surface-800 text-sm">{flat.door_number}</p>
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-surface-700 truncate">{flat.tenant?.full_name || <span className="text-surface-400">No tenant</span>}</p>
                            {flat.tenant?.phone && (
                              <a href={`tel:${flat.tenant.phone}`} className="text-xs text-brand-600 flex items-center gap-1">
                                <Phone className="w-3 h-3" />{flat.tenant.phone}
                              </a>
                            )}
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-right">
                              {flat.status === 'paid' ? (
                                <p className="text-sm font-mono font-semibold text-emerald-600">{formatCurrency(flat.paid)}</p>
                              ) : (
                                <>
                                  <p className="text-sm font-mono font-semibold text-red-600">{formatCurrency(flat.balance)}</p>
                                  {flat.paid > 0 && <p className="text-xs text-surface-400 font-mono">{formatCurrency(flat.paid)} paid</p>}
                                </>
                              )}
                            </div>

                            {/* Mode badges */}
                            {flat.colls.length > 0 && (
                              <div className="flex gap-1 flex-wrap max-w-[80px]">
                                {[...new Set(flat.colls.map(c => c.payment_mode))].map(m => (
                                  <span key={m} className={`badge border text-xs ${MODE_COLORS[m] || ''}`}>{MODE_LABELS[m]?.slice(0, 4) || m}</span>
                                ))}
                              </div>
                            )}

                            {/* Statement button for flats that have payments */}
                            {flat.colls.length > 0 && (
                              <button onClick={() => generateStatement(flat)}
                                className="p-1.5 text-surface-300 hover:text-brand-600 transition-colors" title="Download statement">
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {/* Always show + Pay for tenants — allows additional / part payments */}
                            {flat.tenant && (
                              <button
                                onClick={() => activeFlat?.id === flat.id ? setActiveFlat(null) : openPay(flat)}
                                className={`btn btn-sm flex-shrink-0 ${activeFlat?.id === flat.id ? 'btn-secondary' : 'btn-primary'}`}>
                                {activeFlat?.id === flat.id ? 'Cancel' : flat.status === 'paid' ? '+ More' : '+ Pay'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Existing payment entries — with edit & delete per entry */}
                        {flat.colls.length > 0 && (
                          <div className="px-4 py-2 bg-surface-50/70 border-t border-surface-100 space-y-1.5">
                            {flat.colls.map(c => (
                              <div key={c.id} className="flex items-center gap-2 text-xs py-1">
                                <span className="text-surface-400 w-20 flex-shrink-0">{c.payment_date}</span>
                                <span className={`badge border text-xs ${MODE_COLORS[c.payment_mode] || ''}`}>{MODE_LABELS[c.payment_mode] || c.payment_mode}</span>
                                <span className="font-mono font-semibold text-emerald-700 flex-1">{formatCurrency(c.amount)}</span>
                                {c.transaction_ref && <span className="text-surface-400 truncate max-w-[80px]">{c.transaction_ref}</span>}
                                {/* Per-payment actions */}
                                <button onClick={() => printReceipt({
                                  tenantName: flat.tenant?.full_name || '—',
                                  flatNumber: flat.door_number,
                                  buildingName: buildings.find(x => x.id === flat.building_id)?.name || '—',
                                  amount: c.amount, payment_mode: c.payment_mode,
                                  payment_date: c.payment_date, for_month: selectedMonth,
                                  transaction_ref: c.transaction_ref,
                                })} className="p-1 text-surface-300 hover:text-brand-600 transition-colors" title="Print receipt">
                                  <Receipt className="w-3.5 h-3.5" />
                                </button>
                                {(isAdmin || isSuperAdmin) && (
                                  <>
                                    <button onClick={() => openEditPayment(c)} className="p-1 text-surface-300 hover:text-brand-600 transition-colors" title="Edit payment">
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => handleDelete(c.id)} className="p-1 text-surface-300 hover:text-red-500 transition-colors" title="Delete">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Inline new payment form */}
                        {activeFlat?.id === flat.id && (
                          <div className="bg-brand-50/50 border-t border-brand-100 px-4 py-4">
                            <form onSubmit={handleSubmit} className="space-y-3">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-semibold text-brand-800">
                                  {flat.status === 'paid' ? 'Additional payment — ' : 'Log payment — '}{flat.tenant?.full_name} ({flat.door_number})
                                </p>
                                <p className="text-xs text-surface-500">
                                  {flat.status === 'paid' ? `Already paid: ${formatCurrency(flat.paid)}` : `Balance: ${formatCurrency(flat.balance)}`}
                                </p>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="label">Amount (₹) *</label>
                                  <input type="number" className="input" value={form.amount}
                                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                                    placeholder={flat.balance > 0 ? flat.balance : flat.expected} required />
                                </div>
                                <div>
                                  <label className="label">Date *</label>
                                  <input type="date" className="input" value={form.payment_date}
                                    onChange={e => setForm(p => ({ ...p, payment_date: e.target.value }))} required />
                                </div>
                              </div>

                              <div>
                                <label className="label">Payment Mode *</label>
                                <div className="flex flex-wrap gap-2">
                                  {MODES.map(m => (
                                    <button key={m} type="button"
                                      onClick={() => setForm(p => ({ ...p, payment_mode: m }))}
                                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all ${form.payment_mode === m ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-surface-600 border-surface-300 hover:border-brand-400'}`}>
                                      {MODE_LABELS[m]}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {form.payment_mode !== 'cash' && (
                                <div>
                                  <label className="label">Transaction Reference</label>
                                  <input className="input" value={form.transaction_ref}
                                    onChange={e => setForm(p => ({ ...p, transaction_ref: e.target.value }))}
                                    placeholder="UPI ref / App ID / Cheque no." />
                                </div>
                              )}

                              {form.payment_mode === 'cash' && (
                                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
                                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                                    <Camera className="w-3.5 h-3.5" /> Cash — 3 photos required
                                  </p>
                                  {CASH_PROOFS.map(({ key, label, hint }) => (
                                    <ProofUpload key={key} proofKey={key} label={label} hint={hint}
                                      value={form[key]} onChange={url => setForm(p => ({ ...p, [key]: url }))} />
                                  ))}
                                </div>
                              )}

                              <div className="flex gap-2 pt-1">
                                <button type="button" onClick={() => setActiveFlat(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                                  {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                  {saving ? 'Saving…' : 'Confirm Payment'}
                                </button>
                              </div>
                            </form>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── HISTORY MODE ── */}
      {viewMode === 'history' && (
        <div className="card overflow-hidden">
          {allCollections.length === 0 ? (
            <div className="text-center py-10 text-surface-400 text-sm">No payments recorded for {selectedMonth}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Building</th><th>Room</th><th>Tenant</th>
                    <th>Mode</th><th className="text-right">Amount</th><th>Ref</th><th>Proof</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allCollections.map(c => (
                    <tr key={c.id}>
                      <td className="text-xs text-surface-500">{c.payment_date}</td>
                      <td className="text-xs text-surface-500">{c.buildingName}</td>
                      <td className="font-mono font-semibold text-surface-800">{c.flatNumber}</td>
                      <td className="text-surface-700">{c.tenantName}</td>
                      <td>
                        <span className={`badge border text-xs ${MODE_COLORS[c.payment_mode] || ''}`}>{MODE_LABELS[c.payment_mode] || c.payment_mode}</span>
                      </td>
                      <td className="text-right font-mono font-semibold text-emerald-700">{formatCurrency(c.amount)}</td>
                      <td className="text-xs text-surface-400 max-w-[100px] truncate">{c.transaction_ref || '—'}</td>
                      <td>
                        {c.payment_mode === 'cash' ? (
                          <button onClick={() => setViewProofs(c)}
                            className={`btn btn-sm text-xs flex items-center gap-1 ${c.cash_voucher_url ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                            <Camera className="w-3 h-3" />{c.cash_voucher_url ? 'View' : 'Missing'}
                          </button>
                        ) : <span className="text-surface-300 text-xs">—</span>}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => printReceipt({
                            tenantName: c.tenantName, flatNumber: c.flatNumber,
                            buildingName: c.buildingName, amount: c.amount,
                            payment_mode: c.payment_mode, payment_date: c.payment_date,
                            for_month: selectedMonth, transaction_ref: c.transaction_ref,
                          })} className="btn-ghost btn-sm p-1.5 text-surface-400 hover:text-brand-600" title="Print receipt">
                            <Receipt className="w-3.5 h-3.5" />
                          </button>
                          {(isAdmin || isSuperAdmin) ? (
                            <>
                              <button onClick={() => openEditPayment(c)} className="btn-ghost btn-sm p-1.5 text-surface-400 hover:text-brand-600" title="Edit">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDelete(c.id)} className="btn-ghost btn-sm p-1.5 text-surface-400 hover:text-red-500" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <Lock className="w-3.5 h-3.5 text-surface-300" />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-50 border-t border-surface-200">
                    <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-surface-500">Total</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">
                      {formatCurrency(allCollections.reduce((s, c) => s + Number(c.amount), 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── EDIT PAYMENT MODAL ── */}
      {editPayment && (
        <div className="modal-overlay" onClick={() => setEditPayment(null)}>
          <div className="modal-content max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-surface-100">
              <h3 className="font-semibold text-surface-800">Edit Payment</h3>
              <button onClick={() => setEditPayment(null)} className="text-surface-400 hover:text-surface-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount (₹) *</label>
                  <input type="number" className="input" value={editForm.amount}
                    onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))} required autoFocus />
                </div>
                <div>
                  <label className="label">Date *</label>
                  <input type="date" className="input" value={editForm.payment_date}
                    onChange={e => setEditForm(p => ({ ...p, payment_date: e.target.value }))} required />
                </div>
              </div>

              <div>
                <label className="label">Payment Mode *</label>
                <div className="flex flex-wrap gap-2">
                  {MODES.map(m => (
                    <button key={m} type="button"
                      onClick={() => setEditForm(p => ({ ...p, payment_mode: m }))}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all ${editForm.payment_mode === m ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-surface-600 border-surface-300 hover:border-brand-400'}`}>
                      {MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Transaction Reference</label>
                <input className="input" value={editForm.transaction_ref}
                  onChange={e => setEditForm(p => ({ ...p, transaction_ref: e.target.value }))}
                  placeholder="UPI ref / cheque no. / app ID" />
              </div>

              <div>
                <label className="label">Notes</label>
                <input className="input" value={editForm.notes}
                  onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional note" />
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setEditPayment(null)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={doDelete}
        title="Delete Payment?"
        message="This payment entry will be permanently removed. This action cannot be undone."
        danger
      />

      {/* Cash proof viewer */}
      {viewProofs && (
        <div className="modal-overlay" onClick={() => setViewProofs(null)}>
          <div className="modal-content max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-surface-800">Cash Proofs</h3>
              <button onClick={() => setViewProofs(null)} className="text-surface-400 hover:text-surface-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {CASH_PROOFS.map(({ key, label }) => (
                <div key={key}>
                  <p className="text-xs font-medium text-surface-500 mb-1.5">{label}</p>
                  {viewProofs[key]
                    ? <img src={viewProofs[key]} alt={label} className="w-full rounded-lg border border-surface-200 max-h-44 object-cover" />
                    : <div className="h-16 bg-surface-100 rounded border border-dashed border-surface-300 flex items-center justify-center text-surface-400 text-xs">Not uploaded</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
