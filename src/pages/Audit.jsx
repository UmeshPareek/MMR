import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  ShieldCheck, Upload, Download, AlertTriangle, CheckCircle2,
  XCircle, FileText, Plus, Trash2, MessageSquare, Eye,
  TrendingUp, TrendingDown, X, RefreshCw, ChevronDown, ChevronRight,
  Zap, Users, Banknote, BarChart2, Lock, Send, CheckSquare,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MONTHS = lastNMonths(8);

// ── Helpers ──────────────────────────────────────────────
function nameScore(a, b) {
  a = (a||'').toLowerCase().replace(/\s+/g,'');
  b = (b||'').toLowerCase().replace(/\s+/g,'');
  if (!a||!b) return 0;
  if (a===b) return 100;
  if (a.includes(b)||b.includes(a)) return 90;
  let c=0; for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]===b[i])c++;else break;}
  return Math.round((c/Math.min(a.length,b.length))*100);
}

function parseHDFCNarration(n) {
  const atn = n.match(/R?ATN-[A-Z0-9]+-([A-Z]+)(\d{3,4})(RENT|OTHERS|ELECTRICI|WATER|DEPOSIT)?/i);
  return {
    tenantHint: atn?.[1]?.toLowerCase()||null,
    roomHint: atn?.[2]||null,
    txnType: atn?.[3]?.toLowerCase().includes('rent')?'rent':'credit',
  };
}

function parseICICINarration(n) {
  const upi = n.match(/UPI\/([A-Za-z]+)/i);
  return { tenantHint: upi?.[1]?.toLowerCase()||null, roomHint: null, txnType: n.match(/RENTAL/i)?'rent':'credit' };
}

const STATUS_CONFIG = {
  pending:    { label: 'Pending',    color: 'bg-amber-50 text-amber-700 border-amber-200' },
  explained:  { label: 'Explained',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
  resolved:   { label: 'Resolved',   color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  escalated:  { label: 'Escalated',  color: 'bg-red-50 text-red-700 border-red-200' },
};

const FLAG_COLORS = {
  high:   'border-red-400 bg-red-50',
  medium: 'border-amber-400 bg-amber-50',
  low:    'border-blue-400 bg-blue-50',
};

export default function Audit() {
  const { isSuperAdmin, isAdmin, profile } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[MONTHS.length-2]||MONTHS[MONTHS.length-1]);
  const [fileQueue, setFileQueue] = useState([]);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();

  const [results, setResults] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');

  // Notes system
  const [notes, setNotes] = useState([]);
  const [noteModal, setNoteModal] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteStatus, setNoteStatus] = useState('explained');
  const [savingNote, setSavingNote] = useState(false);

  const allTxns = fileQueue.flatMap(f => f.txns||[]);

  useEffect(() => { if (selectedMonth) loadNotes(); }, [selectedMonth]);

  async function loadNotes() {
    const { data } = await supabase.from('audit_notes').select('*, tenant:tenants(full_name), flat:flats(door_number), building:buildings(name), responder:profiles!responded_by(full_name)').eq('month', selectedMonth).order('created_at', { ascending: false });
    setNotes(data||[]);
  }

  if (!isSuperAdmin && !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="card p-8 text-center max-w-sm">
          <ShieldCheck className="w-12 h-12 text-brand-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-surface-800 mb-2">Access Restricted</h2>
          <p className="text-surface-500 text-sm">Audit is only available to Admin and above.</p>
        </div>
      </div>
    );
  }

  // ── File handling ─────────────────────────────────────
  function addFiles(e) {
    const files = Array.from(e.target.files||[]);
    setFileQueue(prev => [...prev, ...files.map(file => ({
      id: Date.now()+Math.random(), file,
      bank: file.name.toLowerCase().includes('icici')||file.name.toLowerCase().includes('optransaction') ? 'icici' : 'hdfc',
      status: 'pending', txns: [], error: null,
    }))]);
    fileRef.current.value='';
  }

  async function parseAllFiles() {
    if (!fileQueue.length) return toast.error('Add at least one statement');
    setParsing(true);
    const updated = [...fileQueue];
    for (let i=0; i<updated.length; i++) {
      if (updated[i].status==='done') continue;
      updated[i] = {...updated[i], status:'parsing'};
      setFileQueue([...updated]);
      try {
        const base64 = await new Promise((res,rej)=>{
          const r=new FileReader();
          r.onload=()=>res(r.result.split(',')[1]);
          r.onerror=rej;
          r.readAsDataURL(updated[i].file);
        });
        const resp = await fetch('/api/extract-pdf',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({fileBase64:base64, bank:updated[i].bank, filename:updated[i].file.name})
        });
        if (!resp.ok) { const e=await resp.json(); throw new Error(e.error||'Server error'); }
        const data = await resp.json();
        const enriched = (data.txns||[]).map(t=>{
          const p = updated[i].bank==='hdfc' ? parseHDFCNarration(t.narration) : parseICICINarration(t.narration);
          return {...t, credit:Number(t.credit)||0, debit:Number(t.debit)||0, bank:updated[i].bank.toUpperCase(), ...p};
        }).filter(t=>t.credit>0||t.debit>0);
        updated[i] = {...updated[i], status:'done', txns:enriched, error:null};
        toast.success(`${updated[i].file.name.slice(0,30)}: ${enriched.length} transactions`);
      } catch(err) {
        updated[i] = {...updated[i], status:'error', error:err.message};
        toast.error(`${updated[i].file.name.slice(0,20)}: ${err.message}`);
      }
      setFileQueue([...updated]);
    }
    setParsing(false);
  }

  // ── Run Audit ─────────────────────────────────────────
  async function runAudit() {
    if (!allTxns.length) return toast.error('Extract transactions first');
    setAnalyzing(true);
    toast.loading('Running smart audit…', {id:'audit'});
    try {
      const { data: tenants } = await supabase.from('tenants').select('id,full_name,phone,flat_id,building_id,monthly_rent').eq('status','active');
      const flatIds=[...new Set((tenants||[]).map(t=>t.flat_id).filter(Boolean))];
      const bIds=[...new Set((tenants||[]).map(t=>t.building_id).filter(Boolean))];
      const [{data:flats},{data:buildings}] = await Promise.all([
        flatIds.length?supabase.from('flats').select('id,door_number').in('id',flatIds):{data:[]},
        bIds.length?supabase.from('buildings').select('id,name').in('id',bIds):{data:[]},
      ]);
      const flatMap={}, bMap={};
      (flats||[]).forEach(f=>{flatMap[f.id]=f});
      (buildings||[]).forEach(b=>{bMap[b.id]=b});
      const enrichedTenants=(tenants||[]).map(t=>({...t,flat:flatMap[t.flat_id],building:bMap[t.building_id]}));

      const {data:collections} = await supabase.from('rent_collections').select('*').eq('for_month',selectedMonth);
      const {data:allMonthCollections} = await supabase.from('rent_collections').select('flat_id,for_month,amount,payment_mode,payment_date,collected_by,created_at').eq('for_month',selectedMonth);

      const collByTenant={};
      (collections||[]).forEach(c=>{collByTenant[c.tenant_id]=collByTenant[c.tenant_id]||[];collByTenant[c.tenant_id].push(c);});

      const creditTxns = allTxns.filter(t=>t.credit>0);

      // ── Per tenant analysis ───────────────────────────
      const tenantStatus = enrichedTenants.map(t=>{
        const colls=collByTenant[t.id]||[];
        const paid=colls.reduce((s,c)=>s+Number(c.amount),0);
        const expected=Number(t.monthly_rent);
        const modes=[...new Set(colls.map(c=>c.payment_mode))];
        const bankMatch=creditTxns.find(tx=>{
          if(tx.roomHint&&t.flat?.door_number){
            const room=t.flat.door_number.replace(/\D/g,'');
            if(tx.roomHint===room) return nameScore(tx.tenantHint,t.full_name.split(' ')[0])>40;
          }
          return nameScore(tx.tenantHint,t.full_name.split(' ')[0])>70&&Math.abs(tx.credit-expected)<expected*0.15;
        });
        const amountMismatch=bankMatch&&Math.abs(bankMatch.credit-paid)>200;
        const modeFlag=bankMatch&&modes.includes('cash');
        const ghostPayment=paid>0&&!modes.includes('cash')&&!bankMatch;
        return {
          tenantId:t.id, name:t.full_name, phone:t.phone||'',
          room:t.flat?.door_number||'—', building:t.building?.name||'—',
          expected, paid, balance:expected-paid, modes,
          status:paid>=expected?'paid':paid>0?'partial':'unpaid',
          inSystem:colls.length>0, inBank:!!bankMatch,
          bankAmount:bankMatch?.credit||0, bankNarration:bankMatch?.narration||'',
          amountMismatch, modeFlag, ghostPayment,
          collectedBy:[...new Set(colls.map(c=>c.collected_by).filter(Boolean))],
          paymentDates:colls.map(c=>c.payment_date),
          colls,
        };
      });

      // ── Fraud flags ───────────────────────────────────
      const fraudFlags = [];

      // Mode fraud: logged cash but in bank
      tenantStatus.filter(t=>t.modeFlag).forEach(t=>{
        fraudFlags.push({
          severity:'high', type:'mode_fraud',
          title:`Mode Fraud Risk — ${t.name}`,
          detail:`Room ${t.room} (${t.building}): Logged as CASH but ₹${t.bankAmount.toLocaleString()} found in bank. Staff may have collected digitally and pocketed the difference.`,
          tenantId:t.tenantId, building:t.building,
        });
      });

      // Ghost payments: logged digital but not in bank
      tenantStatus.filter(t=>t.ghostPayment).forEach(t=>{
        fraudFlags.push({
          severity:'high', type:'ghost_payment',
          title:`Ghost Payment — ${t.name}`,
          detail:`Room ${t.room} (${t.building}): ₹${t.paid.toLocaleString()} logged as ${t.modes.join('/')} but NOT found in bank. Payment may be fake.`,
          tenantId:t.tenantId, building:t.building,
        });
      });

      // Amount mismatch
      tenantStatus.filter(t=>t.amountMismatch).forEach(t=>{
        fraudFlags.push({
          severity:'medium', type:'amount_mismatch',
          title:`Amount Mismatch — ${t.name}`,
          detail:`Room ${t.room}: App shows ₹${t.paid.toLocaleString()} but bank shows ₹${t.bankAmount.toLocaleString()} (difference ₹${Math.abs(t.bankAmount-t.paid).toLocaleString()})`,
          tenantId:t.tenantId, building:t.building,
        });
      });

      // Duplicate entries: same flat paid twice
      const flatPayCount={};
      (allMonthCollections||[]).forEach(c=>{flatPayCount[c.flat_id]=(flatPayCount[c.flat_id]||0)+1});
      Object.entries(flatPayCount).filter(([,v])=>v>1).forEach(([fid,count])=>{
        const t=tenantStatus.find(t=>t.colls[0]?.flat_id===fid);
        if(t) fraudFlags.push({
          severity:'medium', type:'duplicate',
          title:`Duplicate Entry — ${t.name}`,
          detail:`Room ${t.room} (${t.building}): ${count} collection entries for same month. Possible double-entry or split payment.`,
          tenantId:t.tenantId, building:t.building,
        });
      });

      // Cash concentration — one collector holding too much
      const cashByCollector={};
      (allMonthCollections||[]).filter(c=>c.payment_mode==='cash').forEach(c=>{
        cashByCollector[c.collected_by||'unknown']=(cashByCollector[c.collected_by||'unknown']||0)+Number(c.amount);
      });
      const totalCash=Object.values(cashByCollector).reduce((s,v)=>s+v,0);
      Object.entries(cashByCollector).forEach(([uid,amt])=>{
        if(totalCash>0&&amt/totalCash>0.7&&totalCash>50000){
          fraudFlags.push({
            severity:'low', type:'concentration',
            title:'Cash Concentration Risk',
            detail:`One collector handled ${Math.round(amt/totalCash*100)}% of all cash (₹${amt.toLocaleString()}). High concentration increases fraud risk.`,
          });
        }
      });

      // Unmatched bank credits
      const unmatchedBank=creditTxns.filter(tx=>{
        return !tenantStatus.some(t=>{
          if(tx.roomHint&&t.room!=='—') return tx.roomHint===t.room.replace(/\D/g,'')&&nameScore(tx.tenantHint,t.name.split(' ')[0])>40;
          return nameScore(tx.tenantHint,t.name.split(' ')[0])>70;
        });
      });

      unmatchedBank.forEach(tx=>{
        fraudFlags.push({
          severity:'high', type:'unmatched_bank',
          title:'Unmatched Bank Credit',
          detail:`₹${tx.credit.toLocaleString()} on ${tx.date} — "${tx.narration.slice(0,60)}" — Money received in bank but NO matching app entry.`,
          bankNarration:tx.narration, bankAmount:tx.credit,
        });
      });

      // ── Collector analysis ───────────────────────────
      const collectorStats={};
      const {data:profiles} = await supabase.from('profiles').select('id,full_name');
      const profileMap={};
      (profiles||[]).forEach(p=>{profileMap[p.id]=p.full_name});
      (allMonthCollections||[]).forEach(c=>{
        const name=profileMap[c.collected_by]||'Unknown';
        collectorStats[name]=collectorStats[name]||{name,total:0,cash:0,digital:0,count:0};
        collectorStats[name].total+=Number(c.amount);
        collectorStats[name].count++;
        if(c.payment_mode==='cash') collectorStats[name].cash+=Number(c.amount);
        else collectorStats[name].digital+=Number(c.amount);
      });

      // ── Day-wise collection pattern ──────────────────
      const dayWise={};
      (allMonthCollections||[]).forEach(c=>{
        const day=c.payment_date;
        dayWise[day]=dayWise[day]||{date:day,count:0,amount:0};
        dayWise[day].count++;
        dayWise[day].amount+=Number(c.amount);
      });
      const dayWiseArr=Object.values(dayWise).sort((a,b)=>a.date.localeCompare(b.date));

      // ── Building summary ─────────────────────────────
      const bSummary={};
      tenantStatus.forEach(t=>{
        if(!bSummary[t.building]) bSummary[t.building]={paid:0,partial:0,unpaid:0,total:0,collected:0,expected:0,flags:0};
        bSummary[t.building][t.status]++;
        bSummary[t.building].total++;
        bSummary[t.building].collected+=t.paid;
        bSummary[t.building].expected+=t.expected;
        bSummary[t.building].flags+=([t.modeFlag,t.ghostPayment,t.amountMismatch].filter(Boolean).length);
      });

      const totalExpected=tenantStatus.reduce((s,t)=>s+t.expected,0);
      const totalCollected=tenantStatus.reduce((s,t)=>s+t.paid,0);
      const totalBankCredits=allTxns.filter(t=>t.credit>0).reduce((s,t)=>s+t.credit,0);

      setResults({
        tenantStatus, unmatchedBank, fraudFlags,
        collectorStats:Object.values(collectorStats),
        dayWiseArr, bSummary,
        stats:{
          totalExpected, totalCollected, totalBankCredits,
          bankGap:Math.abs(totalBankCredits-totalCollected),
          paidCount:tenantStatus.filter(t=>t.status==='paid').length,
          partialCount:tenantStatus.filter(t=>t.status==='partial').length,
          unpaidCount:tenantStatus.filter(t=>t.status==='unpaid').length,
          fraudHigh:fraudFlags.filter(f=>f.severity==='high').length,
          fraudMedium:fraudFlags.filter(f=>f.severity==='medium').length,
          fraudLow:fraudFlags.filter(f=>f.severity==='low').length,
          collectionRate:totalExpected>0?Math.round(totalCollected/totalExpected*100):0,
          txnCount:allTxns.length,
        },
      });
      setActiveTab('summary');
      toast.success('Smart audit complete', {id:'audit'});
    } catch(e) {
      toast.error('Audit failed: '+e.message, {id:'audit'});
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Notes ─────────────────────────────────────────────
  async function saveNote() {
    if (!noteText.trim()) return toast.error('Enter a note');
    setSavingNote(true);
    try {
      if (noteModal.noteId) {
        await supabase.from('audit_notes').update({
          team_note: noteText, status: noteStatus,
          responded_by: profile?.id, responded_at: new Date().toISOString(),
        }).eq('id', noteModal.noteId);
      } else {
        await supabase.from('audit_notes').insert({
          month: selectedMonth,
          note_type: noteModal.type,
          tenant_id: noteModal.tenantId||null,
          flat_id: noteModal.flatId||null,
          building_id: noteModal.buildingId||null,
          bank_narration: noteModal.bankNarration||null,
          bank_amount: noteModal.bankAmount||null,
          flag_reason: noteModal.reason,
          team_note: noteText,
          status: noteStatus,
          created_by: profile?.id,
          responded_by: profile?.id,
          responded_at: new Date().toISOString(),
        });
      }
      toast.success('Note saved');
      setNoteModal(null); setNoteText(''); setNoteStatus('explained');
      loadNotes();
    } catch(e) { toast.error(e.message); }
    finally { setSavingNote(false); }
  }

  function openNote(config) {
    const existing = notes.find(n => n.tenant_id === config.tenantId && n.note_type === config.type);
    setNoteModal({...config, noteId: existing?.id||null});
    setNoteText(existing?.team_note||'');
    setNoteStatus(existing?.status||'explained');
  }

  // ── Export Excel ──────────────────────────────────────
  function exportExcel() {
    if (!results) return;
    const wb = XLSX.utils.book_new();
    const addSheet = (name, data) => {
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31));
    };
    addSheet('Tenant Status', results.tenantStatus.map(t=>({
      Building:t.building, Room:t.room, Tenant:t.name, Phone:t.phone,
      'Expected(₹)':t.expected, 'Paid(₹)':t.paid, 'Balance(₹)':t.balance,
      Status:t.status.toUpperCase(), Modes:t.modes.join(',')||'—',
      'In Bank':t.inBank?'Yes':t.modes.includes('cash')?'Cash-offline':'No',
      'Mode Flag':t.modeFlag?'YES':'', 'Ghost Pay':t.ghostPayment?'YES':'',
    })));
    addSheet('Unpaid & Dues', results.tenantStatus.filter(t=>t.status!=='paid').map(t=>({
      Building:t.building, Room:t.room, Tenant:t.name, Phone:t.phone,
      'Expected(₹)':t.expected, 'Paid(₹)':t.paid, 'Balance(₹)':t.balance, Status:t.status.toUpperCase(),
    })));
    addSheet('Fraud Flags', results.fraudFlags.map(f=>({
      Severity:f.severity.toUpperCase(), Type:f.type, Title:f.title, Detail:f.detail,
    })));
    addSheet('Bank Unmatched', results.unmatchedBank.map(t=>({
      Date:t.date, Bank:t.bank, Narration:t.narration, 'Credit(₹)':t.credit,
    })));
    addSheet('Collector Analysis', results.collectorStats.map(c=>({
      Collector:c.name, 'Total(₹)':c.total, 'Cash(₹)':c.cash, 'Digital(₹)':c.digital, Count:c.count,
    })));
    addSheet('Day-wise Collection', results.dayWiseArr.map(d=>({Date:d.date, Count:d.count, 'Amount(₹)':d.amount})));
    addSheet('Team Notes', notes.map(n=>({
      Type:n.note_type, Tenant:n.tenant?.full_name||'—', Room:n.flat?.door_number||'—',
      Building:n.building?.name||'—', 'Flag Reason':n.flag_reason,
      'Team Note':n.team_note||'—', Status:n.status, Responder:n.responder?.full_name||'—',
    })));
    addSheet('All Bank Txns', allTxns.map(t=>({Date:t.date, Bank:t.bank, Narration:t.narration, 'Credit(₹)':t.credit||'', 'Debit(₹)':t.debit||'', Type:t.txnType})));
    XLSX.writeFile(wb, `MMR_Audit_${selectedMonth}.xlsx`);
    toast.success('Excel exported');
  }

  // ── Export PDF ────────────────────────────────────────
  function exportPDF() {
    if (!results) return;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const { stats, tenantStatus, fraudFlags, bSummary, collectorStats } = results;
    let y=15;

    // Cover
    doc.setFillColor(13,148,136); doc.rect(0,0,210,40,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(20); doc.setFont('helvetica','bold');
    doc.text('MMR Monthly Audit Report', 105, 18, {align:'center'});
    doc.setFontSize(12); doc.setFont('helvetica','normal');
    doc.text(`Period: ${selectedMonth} | Generated: ${new Date().toLocaleDateString('en-IN')}`, 105, 28, {align:'center'});
    doc.text(`Buildings: ${Object.keys(bSummary).length} | Tenants: ${tenantStatus.length}`, 105, 36, {align:'center'});
    y=50;

    // Fraud alert box
    if (stats.fraudHigh > 0) {
      doc.setFillColor(254,226,226); doc.rect(10,y,190,18,'F');
      doc.setTextColor(185,28,28); doc.setFontSize(11); doc.setFont('helvetica','bold');
      doc.text(`⚠ ${stats.fraudHigh} HIGH SEVERITY FLAGS REQUIRE IMMEDIATE ATTENTION`, 15, y+8);
      doc.setFont('helvetica','normal'); doc.setFontSize(9);
      doc.text(`${stats.fraudMedium} Medium | ${stats.fraudLow} Low severity flags also detected`, 15, y+14);
      y+=24;
    }

    // KPI summary
    doc.setTextColor(30,30,30); doc.setFontSize(13); doc.setFont('helvetica','bold');
    doc.text('Financial Summary', 15, y); y+=6;
    autoTable(doc, {
      startY:y, margin:{left:10,right:10},
      head:[['Metric','Value']],
      body:[
        ['Expected Rent', `₹${stats.totalExpected.toLocaleString('en-IN')}`],
        ['Collected in App', `₹${stats.totalCollected.toLocaleString('en-IN')}`],
        ['Bank Credits Total', `₹${stats.totalBankCredits.toLocaleString('en-IN')}`],
        ['App vs Bank Gap', `₹${stats.bankGap.toLocaleString('en-IN')}`],
        ['Collection Rate', `${stats.collectionRate}%`],
        ['Paid Tenants', `${stats.paidCount} / ${tenantStatus.length}`],
        ['Unpaid / Partial', `${stats.unpaidCount} / ${stats.partialCount}`],
      ],
      styles:{fontSize:9}, headStyles:{fillColor:[13,148,136]},
      alternateRowStyles:{fillColor:[240,253,250]},
    });
    y = doc.lastAutoTable.finalY + 8;

    // Fraud Flags
    if (fraudFlags.length > 0) {
      doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.text('Fraud & Anomaly Flags', 15, y); y+=6;
      autoTable(doc, {
        startY:y, margin:{left:10,right:10},
        head:[['Severity','Type','Details']],
        body: fraudFlags.map(f=>[f.severity.toUpperCase(), f.type.replace(/_/g,' ').toUpperCase(), f.detail]),
        styles:{fontSize:8, cellPadding:2},
        headStyles:{fillColor:[185,28,28]},
        columnStyles:{0:{cellWidth:20},1:{cellWidth:35},2:{cellWidth:130}},
        didParseCell:(data)=>{
          if(data.column.index===0){
            const s=data.cell.raw;
            if(s==='HIGH') data.cell.styles.textColor=[185,28,28];
            if(s==='MEDIUM') data.cell.styles.textColor=[180,83,9];
          }
        }
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // Unpaid tenants
    const unpaid = tenantStatus.filter(t=>t.status!=='paid');
    if (unpaid.length > 0) {
      if (y > 220) { doc.addPage(); y=15; }
      doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.text('Unpaid & Partial Payments', 15, y); y+=6;
      autoTable(doc, {
        startY:y, margin:{left:10,right:10},
        head:[['Building','Room','Tenant','Phone','Expected','Paid','Balance','Status']],
        body: unpaid.map(t=>[t.building,t.room,t.name,t.phone,`₹${t.expected.toLocaleString()}`,`₹${t.paid.toLocaleString()}`,`₹${t.balance.toLocaleString()}`,t.status.toUpperCase()]),
        styles:{fontSize:8}, headStyles:{fillColor:[13,148,136]},
        didParseCell:(data)=>{
          if(data.column.index===7){
            if(data.cell.raw==='UNPAID') data.cell.styles.textColor=[185,28,28];
            if(data.cell.raw==='PARTIAL') data.cell.styles.textColor=[180,83,9];
          }
        }
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // Building summary
    if (y > 220) { doc.addPage(); y=15; }
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.text('Building-wise Performance', 15, y); y+=6;
    autoTable(doc, {
      startY:y, margin:{left:10,right:10},
      head:[['Building','Expected','Collected','Gap','Rate','Paid','Partial','Unpaid','Flags']],
      body: Object.entries(bSummary).map(([name,b])=>[
        name, `₹${b.expected.toLocaleString()}`, `₹${b.collected.toLocaleString()}`,
        `₹${(b.expected-b.collected).toLocaleString()}`,
        `${b.expected>0?Math.round(b.collected/b.expected*100):0}%`,
        b.paid, b.partial, b.unpaid, b.flags>0?`⚠ ${b.flags}`:'-',
      ]),
      styles:{fontSize:8}, headStyles:{fillColor:[13,148,136]},
    });
    y = doc.lastAutoTable.finalY + 8;

    // Collector analysis
    if (collectorStats.length > 0) {
      if (y > 220) { doc.addPage(); y=15; }
      doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.text('Collector Analysis', 15, y); y+=6;
      autoTable(doc, {
        startY:y, margin:{left:10,right:10},
        head:[['Collector','Total Collected','Cash','Digital','Count']],
        body: collectorStats.map(c=>[c.name,`₹${c.total.toLocaleString()}`,`₹${c.cash.toLocaleString()}`,`₹${c.digital.toLocaleString()}`,c.count]),
        styles:{fontSize:9}, headStyles:{fillColor:[13,148,136]},
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // Team notes
    if (notes.length > 0) {
      if (y > 220) { doc.addPage(); y=15; }
      doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.text('Team Notes & Responses', 15, y); y+=6;
      autoTable(doc, {
        startY:y, margin:{left:10,right:10},
        head:[['Type','Tenant','Flag','Team Response','Status']],
        body: notes.map(n=>[n.note_type,n.tenant?.full_name||n.bank_narration?.slice(0,20)||'—',n.flag_reason?.slice(0,30)||'—',n.team_note?.slice(0,50)||'Pending',n.status.toUpperCase()]),
        styles:{fontSize:8}, headStyles:{fillColor:[13,148,136]},
      });
    }

    // Footer on all pages
    const pageCount = doc.internal.getNumberOfPages();
    for (let i=1; i<=pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(150,150,150);
      doc.text(`MMR - Rent N Stay | Confidential | Page ${i} of ${pageCount}`, 105, 290, {align:'center'});
    }

    doc.save(`MMR_Audit_${selectedMonth}.pdf`);
    toast.success('PDF exported');
  }

  // ── Status badge ──────────────────────────────────────
  const statusBadge = s => {
    const map={paid:'bg-emerald-50 text-emerald-700 border-emerald-200',partial:'bg-amber-50 text-amber-700 border-amber-200',unpaid:'bg-red-50 text-red-700 border-red-200'};
    return <span className={`badge border text-xs ${map[s]}`}>{s.toUpperCase()}</span>;
  };

  const tabs = results ? [
    {id:'summary',label:'Summary'},
    {id:'flags',label:`🚨 Flags (${results.fraudFlags.length})`},
    {id:'unpaid',label:`Unpaid (${results.stats.unpaidCount+results.stats.partialCount})`},
    {id:'tenants',label:`All Tenants (${results.tenantStatus.length})`},
    {id:'unmatched',label:`Bank Unmatched (${results.unmatchedBank.length})`},
    {id:'collectors',label:'Collectors'},
    {id:'buildings',label:'By Building'},
    {id:'notes',label:`Notes (${notes.length})`},
    {id:'bank',label:`Bank Txns (${allTxns.length})`},
  ] : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Smart Monthly Audit</h1>
          <p className="text-sm text-surface-500 mt-0.5">Fraud detection · Bank reconciliation · Team responses</p>
        </div>
        {results && (
          <div className="flex gap-2">
            <button onClick={exportExcel} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> Excel
            </button>
            <button onClick={exportPDF} className="btn-primary flex items-center gap-2">
              <FileText className="w-4 h-4" /> PDF Report
            </button>
          </div>
        )}
      </div>

      {/* Step 1 */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">1</div>
          <h3 className="font-semibold text-surface-800">Select Month</h3>
        </div>
        <select className="select w-auto" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}>
          {MONTHS.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Step 2 */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">2</div>
            <h3 className="font-semibold text-surface-800">Upload Bank Statements <span className="text-xs font-normal text-surface-400">(.xlsx / .xls)</span></h3>
          </div>
          <button onClick={()=>fileRef.current?.click()} className="btn-primary btn-sm flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Files
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple onChange={addFiles} className="hidden" />
        </div>

        {fileQueue.length === 0 ? (
          <div onClick={()=>fileRef.current?.click()} className="border-2 border-dashed border-surface-300 hover:border-brand-400 rounded-lg p-8 text-center cursor-pointer transition-colors">
            <Upload className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-sm text-surface-500">Upload HDFC or ICICI Excel statements</p>
            <p className="text-xs text-surface-400 mt-1">Download from net banking → Statement → Excel format</p>
          </div>
        ) : (
          <div className="space-y-2">
            {fileQueue.map(item=>(
              <div key={item.id} className={`rounded-lg border p-3 ${item.status==='done'?'border-emerald-200 bg-emerald-50/50':item.status==='error'?'border-red-200 bg-red-50/50':'border-surface-200 bg-surface-50'}`}>
                <div className="flex items-center gap-3">
                  <FileText className={`w-4 h-4 flex-shrink-0 ${item.status==='done'?'text-emerald-600':item.status==='error'?'text-red-500':'text-surface-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-800 truncate">{item.file.name}</p>
                    {item.status==='done'&&<p className="text-xs text-emerald-600">{item.txns.length} transactions extracted</p>}
                    {item.status==='error'&&<p className="text-xs text-red-600">{item.error}</p>}
                    {item.status==='parsing'&&<p className="text-xs text-brand-600 flex items-center gap-1"><div className="w-3 h-3 border border-brand-400 border-t-transparent rounded-full animate-spin"/>Reading…</p>}
                  </div>
                  <select className="select py-1 text-xs w-20" value={item.bank} onChange={e=>setFileQueue(prev=>prev.map(f=>f.id===item.id?{...f,bank:e.target.value}:f))}>
                    <option value="hdfc">HDFC</option>
                    <option value="icici">ICICI</option>
                  </select>
                  <button onClick={()=>setFileQueue(prev=>prev.filter(f=>f.id!==item.id))} className="btn-ghost p-1.5 text-surface-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex gap-3 pt-1">
              <button onClick={()=>fileRef.current?.click()} className="btn-secondary btn-sm flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>Add More</button>
              <button onClick={parseAllFiles} disabled={parsing||fileQueue.every(f=>f.status==='done')} className="btn-primary flex items-center gap-2">
                {parsing?<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Reading…</>:<><Eye className="w-4 h-4"/>Extract Transactions</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 3 */}
      {allTxns.length > 0 && (
        <div className="card p-5 border-2 border-brand-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">3</div>
              <div>
                <h3 className="font-semibold text-surface-800">Run Smart Audit</h3>
                <p className="text-xs text-surface-500">{allTxns.length} bank transactions ready · Fraud detection + reconciliation</p>
              </div>
            </div>
            <button onClick={runAudit} disabled={analyzing} className="btn-primary flex items-center gap-2">
              {analyzing?<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Analyzing…</>:<><Zap className="w-4 h-4"/>Run Smart Audit</>}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <>
          <div className="flex border-b border-surface-200 overflow-x-auto">
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setActiveTab(t.id)} className={`tab flex-shrink-0 ${activeTab===t.id?'active':''}`}>{t.label}</button>
            ))}
          </div>

          {/* SUMMARY */}
          {activeTab==='summary' && (
            <div className="space-y-4">
              {/* Overall health */}
              <div className={`card p-5 border-l-4 ${results.stats.fraudHigh>0?'border-red-500 bg-red-50/50':results.stats.fraudMedium>0?'border-amber-400 bg-amber-50/50':'border-emerald-500 bg-emerald-50/50'}`}>
                <div className="flex items-start gap-3">
                  {results.stats.fraudHigh>0
                    ?<AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5"/>
                    :<CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5"/>}
                  <div>
                    <h3 className={`font-bold text-base ${results.stats.fraudHigh>0?'text-red-800':'text-emerald-800'}`}>
                      {results.stats.fraudHigh>0
                        ?`${results.stats.fraudHigh} High-Risk Flags — Immediate Action Required`
                        :`Audit Clean — No High-Risk Flags`}
                    </h3>
                    <p className="text-sm mt-1 text-surface-600">
                      {results.stats.collectionRate}% collected · {results.stats.paidCount} paid · {results.stats.unpaidCount} unpaid · {results.stats.partialCount} partial
                      {results.stats.fraudMedium>0&&` · ${results.stats.fraudMedium} medium flags`}
                    </p>
                  </div>
                </div>
              </div>

              {/* KPI grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {label:'Expected',value:formatCurrency(results.stats.totalExpected),color:'border-surface-300'},
                  {label:'Collected (App)',value:formatCurrency(results.stats.totalCollected),color:'border-emerald-400'},
                  {label:'Bank Credits',value:formatCurrency(results.stats.totalBankCredits),color:'border-brand-500'},
                  {label:'App vs Bank Gap',value:formatCurrency(results.stats.bankGap),color:results.stats.bankGap>1000?'border-red-400':'border-emerald-400'},
                ].map(({label,value,color})=>(
                  <div key={label} className={`card p-4 border-l-4 ${color}`}>
                    <p className="text-xs text-surface-500 mb-1">{label}</p>
                    <p className="text-lg font-bold font-mono text-surface-900">{value}</p>
                  </div>
                ))}
              </div>

              {/* Status counts */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[
                  {label:'Paid',val:results.stats.paidCount,color:'text-emerald-600 border-t-emerald-400'},
                  {label:'Partial',val:results.stats.partialCount,color:'text-amber-600 border-t-amber-400'},
                  {label:'Unpaid',val:results.stats.unpaidCount,color:'text-red-600 border-t-red-400'},
                  {label:'🚨 High Flags',val:results.stats.fraudHigh,color:'text-red-700 border-t-red-600'},
                  {label:'⚠ Med Flags',val:results.stats.fraudMedium,color:'text-amber-700 border-t-amber-400'},
                  {label:'Bank Unmatched',val:results.unmatchedBank.length,color:results.unmatchedBank.length>0?'text-red-600 border-t-red-400':'text-emerald-600 border-t-emerald-400'},
                ].map(({label,val,color})=>(
                  <div key={label} className={`card p-3 text-center border-t-4 ${color.split(' ')[1]}`}>
                    <p className={`text-2xl font-bold ${color.split(' ')[0]}`}>{val}</p>
                    <p className="text-xs text-surface-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Collection rate bar */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-surface-700">Collection Rate</span>
                  <span className="text-lg font-bold font-mono text-brand-700">{results.stats.collectionRate}%</span>
                </div>
                <div className="h-3 bg-surface-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{width:`${results.stats.collectionRate}%`,background:results.stats.collectionRate>=90?'#0d9488':results.stats.collectionRate>=70?'#f59e0b':'#dc2626'}}/>
                </div>
                <div className="flex justify-between text-xs text-surface-400 mt-1">
                  <span>₹0</span><span>{formatCurrency(results.stats.totalCollected)} / {formatCurrency(results.stats.totalExpected)}</span>
                </div>
              </div>

              {/* Building quick view */}
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
                  <h3 className="text-sm font-semibold text-surface-700">Building Overview</h3>
                </div>
                <div className="divide-y divide-surface-100">
                  {Object.entries(results.bSummary).map(([name,b])=>{
                    const rate=b.expected>0?Math.round(b.collected/b.expected*100):0;
                    return (
                      <div key={name} className="flex items-center gap-4 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-surface-800 text-sm truncate">{name}</p>
                            {b.flags>0&&<span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">⚠ {b.flags} flags</span>}
                          </div>
                          <div className="flex gap-3 mt-1 text-xs text-surface-400">
                            <span className="text-emerald-600">{b.paid} paid</span>
                            {b.partial>0&&<span className="text-amber-600">{b.partial} partial</span>}
                            {b.unpaid>0&&<span className="text-red-600">{b.unpaid} unpaid</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-mono text-sm font-semibold text-emerald-700">{formatCurrency(b.collected)}</p>
                          <p className="text-xs text-surface-400">of {formatCurrency(b.expected)}</p>
                        </div>
                        <div className="w-24 flex-shrink-0">
                          <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{width:`${rate}%`,backgroundColor:rate>=90?'#0d9488':rate>=70?'#f59e0b':'#dc2626'}}/>
                          </div>
                          <p className="text-xs font-mono text-surface-500 text-right mt-0.5">{rate}%</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* FRAUD FLAGS */}
          {activeTab==='flags' && (
            <div className="space-y-3">
              {results.fraudFlags.length===0?(
                <div className="card p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/><p className="text-surface-500">No fraud flags detected</p></div>
              ):results.fraudFlags.map((flag,i)=>(
                <div key={i} className={`card p-4 border-l-4 ${FLAG_COLORS[flag.severity]}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`badge border text-xs font-bold ${flag.severity==='high'?'bg-red-100 text-red-700 border-red-300':flag.severity==='medium'?'bg-amber-100 text-amber-700 border-amber-300':'bg-blue-100 text-blue-700 border-blue-300'}`}>
                          {flag.severity.toUpperCase()}
                        </span>
                        <span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{flag.type.replace(/_/g,' ')}</span>
                      </div>
                      <p className="font-semibold text-surface-800 text-sm">{flag.title}</p>
                      <p className="text-xs text-surface-600 mt-1 leading-relaxed">{flag.detail}</p>
                    </div>
                    <button onClick={()=>openNote({
                      type: flag.type==='unmatched_bank'?'unmatched':'mismatch',
                      tenantId:flag.tenantId,
                      reason:flag.title,
                      bankNarration:flag.bankNarration,
                      bankAmount:flag.bankAmount,
                    })} className="btn-secondary btn-sm flex items-center gap-1.5 flex-shrink-0">
                      <MessageSquare className="w-3.5 h-3.5"/> Note
                    </button>
                  </div>
                  {/* Existing note */}
                  {notes.find(n=>n.tenant_id===flag.tenantId&&n.flag_reason===flag.title)&&(
                    <div className="mt-3 pt-3 border-t border-surface-200">
                      {()=>{const n=notes.find(x=>x.tenant_id===flag.tenantId&&x.flag_reason===flag.title);return(
                        <div className="flex items-start gap-2">
                          <CheckSquare className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0"/>
                          <div>
                            <p className="text-xs font-medium text-surface-600">{n.team_note}</p>
                            <p className="text-xs text-surface-400 mt-0.5">{n.responder?.full_name} · <span className={`badge border text-xs ${STATUS_CONFIG[n.status]?.color}`}>{n.status}</span></p>
                          </div>
                        </div>
                      );}}()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* UNPAID */}
          {activeTab==='unpaid' && (
            <div className="card overflow-hidden">
              {results.tenantStatus.filter(t=>t.status!=='paid').length===0?(
                <div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/><p className="text-surface-500">All tenants paid</p></div>
              ):(
                <table className="data-table">
                  <thead><tr><th>Building</th><th>Room</th><th>Tenant</th><th>Phone</th><th className="text-right">Expected</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {results.tenantStatus.filter(t=>t.status!=='paid').map(t=>{
                      const existing=notes.find(n=>n.tenant_id===t.tenantId&&n.note_type==='unpaid');
                      return(
                        <tr key={t.tenantId} className={t.status==='unpaid'?'bg-red-50/20':'bg-amber-50/10'}>
                          <td className="text-xs text-surface-500">{t.building}</td>
                          <td className="font-mono font-semibold">{t.room}</td>
                          <td className="font-medium text-surface-800">{t.name}</td>
                          <td className="text-xs text-surface-500">{t.phone}</td>
                          <td className="text-right font-mono">{formatCurrency(t.expected)}</td>
                          <td className="text-right font-mono text-emerald-700">{formatCurrency(t.paid)}</td>
                          <td className="text-right font-mono font-bold text-red-600">{formatCurrency(t.balance)}</td>
                          <td>{statusBadge(t.status)}</td>
                          <td>
                            {existing?(
                              <button onClick={()=>openNote({type:'unpaid',tenantId:t.tenantId,reason:`Unpaid - ${t.name} Room ${t.room}`,noteId:existing.id})}
                                className={`badge border text-xs cursor-pointer ${STATUS_CONFIG[existing.status]?.color}`}>
                                {existing.status}
                              </button>
                            ):(
                              <button onClick={()=>openNote({type:'unpaid',tenantId:t.tenantId,reason:`Unpaid rent - ${t.name} Room ${t.room} (${t.building})`})}
                                className="btn-secondary btn-sm flex items-center gap-1 text-xs">
                                <MessageSquare className="w-3 h-3"/>Request Reason
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-50 border-t border-surface-200">
                      <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-surface-500">Total Outstanding</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-red-600">{formatCurrency(results.tenantStatus.filter(t=>t.status!=='paid').reduce((s,t)=>s+t.balance,0))}</td>
                      <td colSpan={2}/>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* ALL TENANTS */}
          {activeTab==='tenants' && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Building</th><th>Room</th><th>Tenant</th><th className="text-right">Expected</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Status</th><th>Mode</th><th>Bank</th><th>Flags</th></tr></thead>
                  <tbody>
                    {results.tenantStatus.map(t=>(
                      <tr key={t.tenantId} className={t.modeFlag||t.ghostPayment?'bg-red-50/20':''}>
                        <td className="text-xs text-surface-500">{t.building}</td>
                        <td className="font-mono font-semibold">{t.room}</td>
                        <td className="text-surface-700">{t.name}</td>
                        <td className="text-right font-mono">{formatCurrency(t.expected)}</td>
                        <td className="text-right font-mono text-emerald-700">{formatCurrency(t.paid)}</td>
                        <td className="text-right font-mono" style={{color:t.balance>0?'#dc2626':'#94a3b8'}}>{t.balance>0?formatCurrency(t.balance):'—'}</td>
                        <td>{statusBadge(t.status)}</td>
                        <td className="text-xs text-surface-500">{t.modes.join(', ')||'—'}</td>
                        <td>
                          {t.inBank?<span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs"><CheckCircle2 className="w-3 h-3"/>{formatCurrency(t.bankAmount)}</span>
                            :t.modes.includes('cash')?<span className="text-xs text-surface-400">Cash</span>
                            :t.status!=='unpaid'?<span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">Not found</span>
                            :<span className="text-surface-300 text-xs">—</span>}
                        </td>
                        <td>
                          <div className="flex gap-1">
                            {t.modeFlag&&<span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">Mode!</span>}
                            {t.ghostPayment&&<span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">Ghost!</span>}
                            {t.amountMismatch&&<span className="badge bg-amber-50 text-amber-600 border border-amber-200 text-xs">Amt!</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* UNMATCHED BANK */}
          {activeTab==='unmatched' && (
            <div className="card overflow-hidden">
              {results.unmatchedBank.length===0?(
                <div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/><p className="text-surface-500">All bank credits matched</p></div>
              ):(
                <>
                  <div className="px-5 py-3 bg-red-50 border-b border-red-200">
                    <p className="text-sm font-semibold text-red-800">Money received in bank but NOT logged in app — investigate these immediately</p>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Bank</th><th>Narration</th><th className="text-right">Amount</th><th>Action</th></tr></thead>
                    <tbody>
                      {results.unmatchedBank.map((t,i)=>{
                        const existing=notes.find(n=>n.bank_narration===t.narration&&n.note_type==='unmatched');
                        return(
                          <tr key={i} className="bg-red-50/20">
                            <td className="text-xs">{t.date}</td>
                            <td><span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{t.bank}</span></td>
                            <td className="text-xs text-surface-600 max-w-xs truncate">{t.narration}</td>
                            <td className="text-right font-mono font-semibold text-red-600">{formatCurrency(t.credit)}</td>
                            <td>
                              {existing?(
                                <button onClick={()=>openNote({type:'unmatched',bankNarration:t.narration,bankAmount:t.credit,reason:`Unmatched bank credit ₹${t.credit}`,noteId:existing.id})}
                                  className={`badge border text-xs cursor-pointer ${STATUS_CONFIG[existing.status]?.color}`}>{existing.status}</button>
                              ):(
                                <button onClick={()=>openNote({type:'unmatched',bankNarration:t.narration,bankAmount:t.credit,reason:`Unmatched bank credit ₹${t.credit} on ${t.date}`})}
                                  className="btn-secondary btn-sm flex items-center gap-1 text-xs">
                                  <MessageSquare className="w-3 h-3"/>Explain
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface-50 border-t border-surface-200">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-surface-500">Total unaccounted</td>
                        <td className="px-4 py-2 text-right font-mono font-bold text-red-600">{formatCurrency(results.unmatchedBank.reduce((s,t)=>s+t.credit,0))}</td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
            </div>
          )}

          {/* COLLECTORS */}
          {activeTab==='collectors' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {results.collectorStats.map(c=>{
                  const cashPct=c.total>0?Math.round(c.cash/c.total*100):0;
                  return(
                    <div key={c.name} className={`card p-4 ${cashPct>70&&c.cash>50000?'border-amber-300 bg-amber-50/30':''}`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">{c.name.charAt(0)}</div>
                        <div>
                          <p className="font-semibold text-surface-800 text-sm">{c.name}</p>
                          <p className="text-xs text-surface-400">{c.count} payments</p>
                        </div>
                        {cashPct>70&&c.cash>50000&&<span className="ml-auto badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">High cash</span>}
                      </div>
                      <p className="text-xl font-bold font-mono text-surface-900">{formatCurrency(c.total)}</p>
                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-amber-600 w-12">Cash</span>
                          <div className="flex-1 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-400 rounded-full" style={{width:`${cashPct}%`}}/>
                          </div>
                          <span className="text-surface-500 w-16 text-right">{formatCurrency(c.cash)} ({cashPct}%)</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-blue-600 w-12">Digital</span>
                          <div className="flex-1 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-400 rounded-full" style={{width:`${100-cashPct}%`}}/>
                          </div>
                          <span className="text-surface-500 w-16 text-right">{formatCurrency(c.digital)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Day-wise chart */}
              {results.dayWiseArr.length > 0 && (
                <div className="card p-5">
                  <h3 className="font-semibold text-surface-800 text-sm mb-4">Day-wise Collection Pattern</h3>
                  <div className="space-y-2">
                    {results.dayWiseArr.map(d=>{
                      const maxAmt=Math.max(...results.dayWiseArr.map(x=>x.amount));
                      const pct=maxAmt>0?Math.round(d.amount/maxAmt*100):0;
                      return(
                        <div key={d.date} className="flex items-center gap-3 text-xs">
                          <span className="text-surface-500 w-24 flex-shrink-0">{d.date}</span>
                          <div className="flex-1 h-5 bg-surface-100 rounded overflow-hidden">
                            <div className="h-full bg-brand-500 rounded flex items-center px-2" style={{width:`${Math.max(pct,2)}%`}}>
                              {pct>15&&<span className="text-white font-mono text-xs">{formatCurrency(d.amount)}</span>}
                            </div>
                          </div>
                          <span className="text-surface-500 w-8 flex-shrink-0">{d.count}x</span>
                          {pct<15&&<span className="text-surface-600 font-mono w-24 flex-shrink-0">{formatCurrency(d.amount)}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* BY BUILDING */}
          {activeTab==='buildings' && (
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead><tr><th>Building</th><th className="text-center">Paid</th><th className="text-center">Partial</th><th className="text-center">Unpaid</th><th className="text-right">Expected</th><th className="text-right">Collected</th><th className="text-right">Gap</th><th>Rate</th><th>Flags</th></tr></thead>
                <tbody>
                  {Object.entries(results.bSummary).map(([name,b])=>{
                    const rate=b.expected>0?Math.round(b.collected/b.expected*100):0;
                    return(
                      <tr key={name}>
                        <td className="font-medium text-surface-800">{name}</td>
                        <td className="text-center text-emerald-600 font-semibold">{b.paid}</td>
                        <td className="text-center text-amber-600 font-semibold">{b.partial}</td>
                        <td className="text-center text-red-600 font-semibold">{b.unpaid}</td>
                        <td className="text-right font-mono">{formatCurrency(b.expected)}</td>
                        <td className="text-right font-mono text-emerald-700">{formatCurrency(b.collected)}</td>
                        <td className="text-right font-mono text-red-600">{formatCurrency(b.expected-b.collected)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{width:`${rate}%`,backgroundColor:rate>=90?'#0d9488':rate>=70?'#f59e0b':'#dc2626'}}/>
                            </div>
                            <span className="text-xs font-mono text-surface-500">{rate}%</span>
                          </div>
                        </td>
                        <td>{b.flags>0?<span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">⚠ {b.flags}</span>:<span className="text-surface-300 text-xs">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* NOTES */}
          {activeTab==='notes' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-surface-500">{notes.length} notes for {selectedMonth}</p>
                <button onClick={loadNotes} className="btn-ghost btn-sm flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5"/>Refresh</button>
              </div>
              {notes.length===0?(
                <div className="card p-10 text-center"><MessageSquare className="w-10 h-10 text-surface-300 mx-auto mb-2"/><p className="text-surface-500 text-sm">No notes yet. Add notes from Flags or Unpaid tabs.</p></div>
              ):notes.map(n=>(
                <div key={n.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{n.note_type}</span>
                        <span className={`badge border text-xs ${STATUS_CONFIG[n.status]?.color}`}>{STATUS_CONFIG[n.status]?.label}</span>
                        {n.tenant&&<span className="text-xs text-surface-500">{n.tenant.full_name} · {n.flat?.door_number} · {n.building?.name}</span>}
                      </div>
                      <p className="text-xs text-surface-500 mb-2">{n.flag_reason}</p>
                      {n.team_note&&<p className="text-sm text-surface-700 bg-surface-50 rounded p-2">{n.team_note}</p>}
                      {n.responded_at&&<p className="text-xs text-surface-400 mt-1">{n.responder?.full_name} · {new Date(n.responded_at).toLocaleDateString('en-IN')}</p>}
                    </div>
                    <button onClick={()=>openNote({type:n.note_type,tenantId:n.tenant_id,bankNarration:n.bank_narration,bankAmount:n.bank_amount,reason:n.flag_reason,noteId:n.id})}
                      className="btn-secondary btn-sm flex items-center gap-1 text-xs flex-shrink-0">
                      <MessageSquare className="w-3 h-3"/>Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* BANK TRANSACTIONS */}
          {activeTab==='bank' && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
                <span className="text-sm font-medium text-surface-700">{allTxns.length} transactions from {fileQueue.filter(f=>f.status==='done').length} files</span>
                <div className="flex gap-4 text-xs">
                  <span className="text-emerald-600 font-mono">Credits: {formatCurrency(allTxns.filter(t=>t.credit>0).reduce((s,t)=>s+t.credit,0))}</span>
                  <span className="text-red-600 font-mono">Debits: {formatCurrency(allTxns.filter(t=>t.debit>0).reduce((s,t)=>s+t.debit,0))}</span>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="data-table">
                  <thead className="sticky top-0 bg-white"><tr><th>Date</th><th>Bank</th><th>Narration</th><th>Type</th><th className="text-right">Credit</th><th className="text-right">Debit</th></tr></thead>
                  <tbody>
                    {allTxns.map((t,i)=>(
                      <tr key={i}>
                        <td className="text-xs">{t.date}</td>
                        <td><span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{t.bank}</span></td>
                        <td className="text-xs text-surface-600 max-w-xs truncate">{t.narration}</td>
                        <td>{t.txnType!=='other'&&t.txnType!=='credit'&&t.txnType!=='debit'&&<span className="badge bg-brand-50 text-brand-700 border border-brand-100 text-xs">{t.txnType}</span>}</td>
                        <td className="text-right font-mono text-emerald-700">{t.credit>0?formatCurrency(t.credit):'—'}</td>
                        <td className="text-right font-mono text-red-600">{t.debit>0?formatCurrency(t.debit):'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Note Modal */}
      {noteModal && (
        <div className="modal-overlay" onClick={()=>setNoteModal(null)}>
          <div className="modal-content max-w-md p-5" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-surface-800">Add / Update Note</h3>
              <button onClick={()=>setNoteModal(null)} className="text-surface-400 hover:text-surface-600"><X className="w-5 h-5"/></button>
            </div>
            <div className="space-y-3">
              <div className="p-3 bg-surface-50 rounded-lg text-xs text-surface-600">{noteModal.reason}</div>
              <div>
                <label className="label">Status</label>
                <select className="select" value={noteStatus} onChange={e=>setNoteStatus(e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="explained">Explained</option>
                  <option value="resolved">Resolved</option>
                  <option value="escalated">Escalated</option>
                </select>
              </div>
              <div>
                <label className="label">Note / Explanation from team</label>
                <textarea className="input" rows={4} value={noteText} onChange={e=>setNoteText(e.target.value)}
                  placeholder="Enter team's explanation, reason, or action taken…"/>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={()=>setNoteModal(null)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={saveNote} disabled={savingNote} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {savingNote?<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>:<Send className="w-4 h-4"/>}
                  Save Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!results && !parsing && fileQueue.length===0 && (
        <div className="card p-10 text-center">
          <ShieldCheck className="w-12 h-12 text-surface-300 mx-auto mb-3"/>
          <h3 className="font-semibold text-surface-700 mb-1">Smart Audit Ready</h3>
          <p className="text-sm text-surface-400">Upload bank Excel files → Extract → Run Audit</p>
          <p className="text-xs text-surface-300 mt-1">Detects mode fraud, ghost payments, amount mismatches, duplicate entries & cash concentration</p>
        </div>
      )}
    </div>
  );
}
