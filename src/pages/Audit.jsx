import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  ShieldCheck, Upload, Download, AlertTriangle, CheckCircle2,
  XCircle, FileText, Plus, Trash2, MessageSquare,
  X, RefreshCw, Zap, Send, CheckSquare, Save, Clock,
  ChevronDown, ChevronRight, Eye, BarChart2, Users, TrendingDown,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MONTHS = lastNMonths(8);

// ── Helpers ─────────────────────────────────────────────

/** Fuzzy name similarity 0-100 */
function nameScore(a, b) {
  a = (a||'').toLowerCase().replace(/[^a-z]/g,'');
  b = (b||'').toLowerCase().replace(/[^a-z]/g,'');
  if (!a||!b) return 0;
  if (a===b) return 100;
  if (a.includes(b)||b.includes(a)) return 90;
  // Levenshtein-based similarity
  const la=a.length, lb=b.length;
  if (Math.abs(la-lb)/Math.max(la,lb)>0.5) return 0;
  let same=0; for(let i=0;i<Math.min(la,lb);i++){if(a[i]===b[i])same++;else break;}
  return Math.round((same/Math.min(la,lb))*80);
}

/** Match score between a name from narration and a full tenant name */
function namePairScore(hint, fullName) {
  if (!hint || !fullName) return 0;
  const parts = fullName.toLowerCase().split(/\s+/).filter(p => p.length > 2);
  return Math.max(...parts.map(p => nameScore(hint, p)));
}

/** Detect payment mode from bank narration */
function modeFromNarration(n) {
  if (!n) return 'unknown';
  if (/UPI|BHIM|GPAY|PHONEPE|PAYTM|BHARAT\s?PAY/i.test(n)) return 'upi';
  if (/IMPS/i.test(n)) return 'imps';
  if (/NEFT/i.test(n)) return 'neft';
  if (/RTGS/i.test(n)) return 'rtgs';
  if (/NACH|ECS|MANDATE/i.test(n)) return 'nach';
  return 'transfer';
}

/** Universal narration parser — handles HDFC, ICICI, SBI, Axis, Kotak */
function parseNarration(n, bank) {
  if (!n) return { allHints:[], roomHint:null, mode:'unknown', phoneInNarration:null };
  const nu = n.toUpperCase();
  const hints = [];
  let roomHint = null;
  const mode = modeFromNarration(n);

  // HDFC ATN: ATN-BANKCODE-NAME123RENT or RATN-...
  const atn = n.match(/R?ATN-[A-Z0-9]+-([A-Z]{2,}?)(\d{3,4})(RENT|OTHERS|ELECTRICI|WATER|DEPOSIT)?(?:-|$)/i);
  if (atn) { hints.push(atn[1]); roomHint = atn[2]; }

  // UPI-CR: UPI-CR-XXXXXXXXXX-FIRSTNAME-LASTNAME-BANKIFSC (HDFC net banking)
  const upiCr = n.match(/UPI-CR-\d{6,}-([A-Za-z]{2,})-?([A-Za-z]{2,})?/i);
  if (upiCr) { hints.push(upiCr[1]); if (upiCr[2]) hints.push(upiCr[2]); }

  // UPI/P2P/txnid/NAME or UPI/NAME (ICICI, SBI)
  const upiSlash = n.match(/UPI\/(?:P2[PM]\/\d+\/)?([A-Za-z]{2,}(?:\s[A-Za-z]{2,})?)/i);
  if (upiSlash) upiSlash[1].split(/\s+/).forEach(w => hints.push(w));

  // IMPS/txnref/NAME/ACNO or IMPS/txn/NAME (any bank)
  const imps = n.match(/IMPS\/\d+\/([A-Za-z]{2,}(?:\s[A-Za-z]{2,})?)/i);
  if (imps) imps[1].trim().split(/\s+/).slice(0,2).forEach(w => hints.push(w));

  // NEFT-txnref-NAME (HDFC, ICICI)
  const neft = n.match(/NEFT-[A-Z0-9]+-([A-Za-z]{2,})/i);
  if (neft) hints.push(neft[1]);

  // /NAME/ pattern common in many banks: /JOHN DOE/ or -JOHN DOE-
  const nameInSlash = n.match(/\/([A-Za-z]{2,}(?:\s[A-Za-z]{2,})?)\//);
  if (nameInSlash) nameInSlash[1].split(/\s+/).forEach(w => hints.push(w));

  // Room number in narration: ROOM101, FLAT202, A-303, 401
  const roomMatch = n.match(/(?:ROOM|FLAT|UNIT|APT|F)[-\s]?(\d{2,4})/i) || n.match(/\b([A-Z]-?\d{2,4})\b/i);
  if (!roomHint && roomMatch) roomHint = roomMatch[1].replace(/[^0-9]/g, '');

  // Phone number in narration (10 digit Indian mobile)
  const phoneMatch = n.match(/[6-9]\d{9}/);

  // Deduplicate hints, keep only meaningful ones (3+ chars)
  const uniqueHints = [...new Set(hints.map(h => h.toLowerCase()).filter(h => h.length >= 3))];

  return { allHints: uniqueHints, roomHint, mode, phoneInNarration: phoneMatch?.[0] || null };
}

/** Find best-matching bank transaction for a tenant */
function findBankMatch(tenant, creditTxns, expectedRent) {
  const nameParts = (tenant.full_name || tenant.name || '').toLowerCase().split(/\s+/).filter(p => p.length > 2);
  const phone = (tenant.phone || '').replace(/\D/g, '');
  const roomNum = (tenant.flat?.door_number || tenant.room || '').replace(/\D/g, '');

  let best = null, bestScore = 0;

  for (const tx of creditTxns) {
    if (!tx.credit || tx.credit <= 0) continue;
    let score = 0;

    // Phone match → near certain
    if (phone && tx.phoneInNarration === phone) { score = 95; }

    // Room + name combo → very high
    if (score < 95 && tx.roomHint && roomNum && tx.roomHint === roomNum) {
      const ns = Math.max(0, ...tx.allHints.map(h => namePairScore(h, tenant.full_name || tenant.name || '')));
      score = Math.max(score, 55 + (ns > 40 ? 30 : 10));
    }

    // Name match across all hints
    if (score < 80) {
      for (const hint of (tx.allHints || [])) {
        for (const part of nameParts) {
          const ns = nameScore(hint, part);
          if (ns >= 75) score = Math.max(score, 65);
          else if (ns >= 60) score = Math.max(score, 50);
        }
      }
    }

    // Amount proximity bonus
    if (expectedRent > 0) {
      const diff = Math.abs(tx.credit - expectedRent);
      if (diff === 0) score += 20;
      else if (diff < expectedRent * 0.03) score += 15;
      else if (diff < expectedRent * 0.10) score += 8;
    }

    if (score >= 50 && score > bestScore) { bestScore = score; best = { ...tx, matchScore: Math.min(score, 100) }; }
  }
  return best;
}

const STATUS_CFG = {
  pending:   { label:'Pending',   cls:'bg-amber-50 text-amber-700 border-amber-200' },
  explained: { label:'Explained', cls:'bg-blue-50 text-blue-700 border-blue-200' },
  resolved:  { label:'Resolved',  cls:'bg-emerald-50 text-emerald-700 border-emerald-200' },
  escalated: { label:'Escalated', cls:'bg-red-50 text-red-700 border-red-200' },
};

// ── Excel Team Report (rich formatting via SheetJS + cell styles trick) ─
function generateTeamExcel(tenantStatus, notes, month) {
  const wb = XLSX.utils.book_new();

  // Color helpers for SheetJS
  const H = (v, bold=false, bg=null, color='000000', sz=10) => ({
    v, t:'s',
    s:{
      font:{bold, sz, color:{rgb:color}},
      fill: bg ? {fgColor:{rgb:bg}, type:'pattern', patternType:'solid'} : {patternType:'none'},
      alignment:{wrapText:true, vertical:'center'},
      border:{top:{style:'thin',color:{rgb:'CCCCCC'}},bottom:{style:'thin',color:{rgb:'CCCCCC'}},left:{style:'thin',color:{rgb:'CCCCCC'}},right:{style:'thin',color:{rgb:'CCCCCC'}}},
    }
  });

  // Group tenants by building
  const byBuilding = {};
  tenantStatus.forEach(t => {
    if (!byBuilding[t.building]) byBuilding[t.building] = [];
    byBuilding[t.building].push(t);
  });

  // Sheet per building — unpaid/partial only (team needs to fill reasons)
  Object.entries(byBuilding).forEach(([bName, tenants]) => {
    const unpaid = tenants.filter(t => t.status !== 'paid');
    if (unpaid.length === 0) return;

    const rows = [];

    // Title row
    rows.push([H(`${bName} — Rent Collection Report — ${month}`, true, '0D9488', 'FFFFFF', 13),
      '','','','','','','','','','','']);

    // Instructions
    rows.push([H('⚠ Please fill columns I, J, K for each tenant below and return this file to manager', false, 'FEF3C7', '92400E', 9),
      '','','','','','','','','','','']);

    rows.push([]); // spacer

    // Header
    rows.push([
      H('Room', true, '1E293B', 'FFFFFF', 10),
      H('Tenant Name', true, '1E293B', 'FFFFFF', 10),
      H('Phone', true, '1E293B', 'FFFFFF', 10),
      H('Expected Rent (₹)', true, '1E293B', 'FFFFFF', 10),
      H('Paid (₹)', true, '1E293B', 'FFFFFF', 10),
      H('Balance Due (₹)', true, '1E293B', 'FFFFFF', 10),
      H('Status', true, '1E293B', 'FFFFFF', 10),
      H('Payment Mode', true, '1E293B', 'FFFFFF', 10),
      H('★ REASON FOR NON-PAYMENT', true, 'DC2626', 'FFFFFF', 10),
      H('★ EXPECTED PAYMENT DATE', true, 'DC2626', 'FFFFFF', 10),
      H('★ ACTION TAKEN', true, 'DC2626', 'FFFFFF', 10),
      H('★ VERIFIED BY', true, 'DC2626', 'FFFFFF', 10),
    ]);

    unpaid.forEach(t => {
      const existing = notes.find(n => n.tenant_id === t.tenantId && n.note_type === 'unpaid');
      const bg = t.status === 'unpaid' ? 'FEF2F2' : 'FFFBEB';
      rows.push([
        H(t.room, true, bg, '000000', 10),
        H(t.name, false, bg, '000000', 10),
        H(t.phone||'', false, bg, '374151', 10),
        H(t.expected, false, bg, '059669', 10),
        H(t.paid, false, bg, '374151', 10),
        H(t.balance, true, bg, t.balance > 0 ? 'DC2626' : '059669', 10),
        H(t.status.toUpperCase(), true, t.status==='unpaid'?'FEE2E2':'FEF3C7', t.status==='unpaid'?'DC2626':'B45309', 10),
        H(t.modes.join(', ')||'—', false, bg, '374151', 10),
        H(existing?.team_note||'', false, 'F0FDF4', '000000', 10), // pre-fill if exists
        H('', false, 'F0FDF4', '000000', 10),
        H('', false, 'F0FDF4', '000000', 10),
        H('', false, 'F0FDF4', '000000', 10),
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows.map(r => r.map(c => c?.v ?? c)));

    // Apply styles (SheetJS Pro only supports this, but we set it for compatibility)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({r:R, c:C});
        if (!ws[addr]) ws[addr] = {t:'s', v:''};
        if (rows[R]?.[C]?.s) ws[addr].s = rows[R][C].s;
      }
    }

    ws['!cols'] = [
      {wch:8},{wch:22},{wch:14},{wch:16},{wch:12},{wch:14},
      {wch:10},{wch:14},{wch:30},{wch:18},{wch:25},{wch:16}
    ];
    ws['!rows'] = [{hpt:30},{hpt:20},{hpt:10},{hpt:22},...unpaid.map(()=>({hpt:22}))];
    ws['!merges'] = [
      {s:{r:0,c:0},e:{r:0,c:11}},
      {s:{r:1,c:0},e:{r:1,c:11}},
    ];

    XLSX.utils.book_append_sheet(wb, ws, bName.slice(0,28));
  });

  // Summary sheet
  const summaryRows = [
    [H('MMR — Monthly Audit Summary', true, '0D9488', 'FFFFFF', 14),'','','',''],
    [H(`Month: ${month} | Generated: ${new Date().toLocaleDateString('en-IN')}`, false, 'F0FDFA', '374151', 10),'','','',''],
    [],
    [H('Building',true,'1E293B','FFFFFF'),H('Expected',true,'1E293B','FFFFFF'),H('Collected',true,'1E293B','FFFFFF'),H('Gap',true,'1E293B','FFFFFF'),H('Rate',true,'1E293B','FFFFFF')],
  ];
  const bSummary = {};
  tenantStatus.forEach(t => {
    if (!bSummary[t.building]) bSummary[t.building] = {exp:0,col:0,paid:0,unpaid:0,partial:0};
    bSummary[t.building].exp += t.expected;
    bSummary[t.building].col += t.paid;
    bSummary[t.building][t.status]++;
  });
  Object.entries(bSummary).forEach(([name,b]) => {
    const rate = b.exp>0?Math.round(b.col/b.exp*100):0;
    summaryRows.push([
      H(name,false,null,'000000'),
      H(`₹${b.exp.toLocaleString('en-IN')}`,false,null,'059669'),
      H(`₹${b.col.toLocaleString('en-IN')}`,false,null,'374151'),
      H(`₹${(b.exp-b.col).toLocaleString('en-IN')}`,true,b.exp-b.col>0?'FEF2F2':null,b.exp-b.col>0?'DC2626':'059669'),
      H(`${rate}%`,true,rate>=90?'F0FDF4':rate>=70?'FFFBEB':'FEF2F2',rate>=90?'059669':rate>=70?'B45309':'DC2626'),
    ]);
  });

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows.map(r=>r.map(c=>c?.v??c)));
  const sRange = XLSX.utils.decode_range(summaryWs['!ref']);
  for (let R=sRange.s.r;R<=sRange.e.r;R++)
    for (let C=sRange.s.c;C<=sRange.e.c;C++) {
      const addr=XLSX.utils.encode_cell({r:R,c:C});
      if (!summaryWs[addr]) summaryWs[addr]={t:'s',v:''};
      if (summaryRows[R]?.[C]?.s) summaryWs[addr].s=summaryRows[R][C].s;
    }
  summaryWs['!cols']=[{wch:28},{wch:16},{wch:16},{wch:16},{wch:10}];
  summaryWs['!merges']=[{s:{r:0,c:0},e:{r:0,c:4}},{s:{r:1,c:0},e:{r:1,c:4}}];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  XLSX.writeFile(wb, `MMR_Team_Report_${month}.xlsx`);
  toast.success('Team Excel downloaded — share with your team to fill reasons');
}

// ── Upload team response ─────────────────────────────────
async function processTeamResponse(file, tenantStatus, selectedMonth, profile, loadNotes) {
  const base64 = await new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
  const buf = Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
  const wb = XLSX.read(buf, {type:'array'});
  let updated = 0;

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Summary') continue;
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

    // Find header row (has "REASON" column)
    let headerIdx = -1;
    for (let i=0;i<rows.length;i++) {
      const row = rows[i].map(c=>String(c||'').toUpperCase());
      if (row.some(c=>c.includes('REASON'))) { headerIdx = i; break; }
    }
    if (headerIdx === -1) continue;

    const header = rows[headerIdx].map(c=>String(c||'').toLowerCase());
    const roomIdx = header.findIndex(h=>h.includes('room'));
    const reasonIdx = header.findIndex(h=>h.includes('reason'));
    const dateIdx = header.findIndex(h=>h.includes('expected payment'));
    const actionIdx = header.findIndex(h=>h.includes('action'));

    for (let i=headerIdx+1; i<rows.length; i++) {
      const row = rows[i];
      const room = String(row[roomIdx]||'').trim();
      const reason = String(row[reasonIdx]||'').trim();
      if (!room || !reason) continue;

      const tenant = tenantStatus.find(t=>t.room===room&&t.building===sheetName);
      if (!tenant) continue;

      const note = reason + (row[dateIdx]?`\nExpected by: ${row[dateIdx]}`:'') + (row[actionIdx]?`\nAction: ${row[actionIdx]}`:'');

      const { data: existing } = await supabase.from('audit_notes').select('id').eq('month',selectedMonth).eq('tenant_id',tenant.tenantId).eq('note_type','unpaid').single().catch(()=>({data:null}));

      if (existing) {
        await supabase.from('audit_notes').update({team_note:note, status:'explained', responded_by:profile?.id, responded_at:new Date().toISOString()}).eq('id',existing.id);
      } else {
        await supabase.from('audit_notes').insert({month:selectedMonth, note_type:'unpaid', tenant_id:tenant.tenantId, flag_reason:`Unpaid - ${tenant.name} Room ${tenant.room}`, team_note:note, status:'explained', created_by:profile?.id, responded_by:profile?.id, responded_at:new Date().toISOString(), org_id:profile?.org_id});
      }
      updated++;
    }
  }
  await loadNotes();
  toast.success(`${updated} team responses imported`);
  return updated;
}

// ── PDF Report ───────────────────────────────────────────
function generatePDF(results, notes, month) {
  const doc = new jsPDF({orientation:'portrait', unit:'mm', format:'a4'});
  const { stats, tenantStatus, fraudFlags, bSummary } = results;
  const TEAL = [13,148,136], RED = [185,28,28], AMBER = [180,83,9], DARK = [15,23,42];
  const TEAL_LIGHT = [240,253,250], RED_LIGHT = [254,242,242];

  // Helper: section heading
  const heading = (text, y, color=DARK) => {
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...color);
    doc.text(text, 14, y);
    doc.setDrawColor(...color); doc.setLineWidth(0.3);
    doc.line(14, y+2, 196, y+2);
    return y + 10;
  };

  // Helper: footer
  const footer = () => {
    const pages = doc.internal.getNumberOfPages();
    for (let i=1;i<=pages;i++) {
      doc.setPage(i);
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(180,180,180);
      doc.text(`CashMyRent — ${month} Audit Report — Confidential`, 14, 290);
      doc.text(`${i} / ${pages}`, 196, 290, {align:'right'});
    }
  };

  // ══ PAGE 1: RENT COLLECTED ════════════════════════════
  // Header bar
  doc.setFillColor(...TEAL);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text('CashMyRent', 14, 12);
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.text('Monthly Audit Report', 14, 20);
  doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(month, 196, 12, {align:'right'});
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.text(`Generated ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}`, 196, 20, {align:'right'});

  let y = 40;

  // ── Section 1: Rent Collected ──
  y = heading('1.  RENT COLLECTED', y, TEAL);

  // 3 big KPI boxes
  const rate = stats.collectionRate;
  const rateColor = rate>=90?TEAL:rate>=70?AMBER:RED;
  const kpis = [
    {label:'Total Collected', val: formatCurrency(stats.totalCollected), color: TEAL},
    {label:'Expected', val: formatCurrency(stats.totalExpected), color: DARK},
    {label:'Collection Rate', val: `${rate}%`, color: rateColor},
  ];
  kpis.forEach(({label,val,color}, i) => {
    const x = 14 + i * 62;
    doc.setFillColor(248,250,252); doc.roundedRect(x, y, 58, 22, 2, 2, 'F');
    doc.setDrawColor(...color); doc.setLineWidth(0.5);
    doc.roundedRect(x, y, 58, 22, 2, 2, 'S');
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(120,130,145);
    doc.text(label, x+4, y+7);
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(...color);
    doc.text(val, x+4, y+17);
  });

  // Collection rate bar
  y += 28;
  doc.setFillColor(226,232,240); doc.roundedRect(14, y, 130, 5, 2, 2, 'F');
  doc.setFillColor(...rateColor); doc.roundedRect(14, y, Math.max(rate*1.3,2), 5, 2, 2, 'F');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...rateColor);
  doc.text(`${rate}% collected`, 150, y+4);
  y += 14;

  // Mode breakdown
  const modeBreakdown = {};
  tenantStatus.forEach(t => t.modes.forEach(m => {
    modeBreakdown[m] = (modeBreakdown[m]||0) + 1;
  }));
  const modeRows = Object.entries(modeBreakdown).map(([mode,count]) => {
    const amt = tenantStatus.filter(t=>t.modes.includes(mode)).reduce((s,t)=>s+t.paid,0);
    return [mode.toUpperCase(), `${count} tenants`, formatCurrency(amt)];
  });
  if (modeRows.length > 0) {
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...DARK);
    doc.text('Collection by Payment Mode', 14, y); y += 4;
    autoTable(doc, {
      startY:y, margin:{left:14,right:14},
      head:[['Payment Mode','Tenants','Amount']],
      body: modeRows,
      styles:{fontSize:9,cellPadding:3},
      headStyles:{fillColor:TEAL,textColor:[255,255,255],fontStyle:'bold'},
      alternateRowStyles:{fillColor:TEAL_LIGHT},
      tableWidth:100,
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Building breakdown
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...DARK);
  doc.text('Building-wise Collection', 14, y); y += 4;
  autoTable(doc, {
    startY:y, margin:{left:14,right:14},
    head:[['Building','Paid','Partial','Unpaid','Collected','Rate']],
    body: Object.entries(bSummary).map(([name,b]) => {
      const r = b.expected>0?Math.round(b.collected/b.expected*100):0;
      return [name, b.paid, b.partial, b.unpaid, formatCurrency(b.collected), `${r}%`];
    }),
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:TEAL,textColor:[255,255,255],fontStyle:'bold'},
    alternateRowStyles:{fillColor:TEAL_LIGHT},
    didParseCell:(d)=>{
      if(d.column.index===5 && d.section==='body') {
        const r = parseInt(d.cell.raw);
        d.cell.styles.textColor = r>=90?TEAL:r>=70?AMBER:RED;
        d.cell.styles.fontStyle='bold';
      }
    }
  });

  // ══ PAGE 2: RENT NOT PAID ══════════════════════════════
  doc.addPage();
  // Repeat header bar
  doc.setFillColor(...TEAL); doc.rect(0,0,210,14,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text(`CashMyRent — ${month} Audit`, 14, 9);
  doc.text(`Page 2`, 196, 9, {align:'right'});
  y = 22;

  const unpaid = tenantStatus.filter(t=>t.status!=='paid');
  const totalDue = unpaid.reduce((s,t)=>s+t.balance,0);
  y = heading('2.  RENT NOT PAID — RECOVERY REQUIRED', y, RED);

  if (unpaid.length === 0) {
    doc.setFillColor(...TEAL_LIGHT); doc.roundedRect(14,y,182,16,2,2,'F');
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...TEAL);
    doc.text('✓  All tenants have paid — no outstanding dues', 14, y+10);
    y += 22;
  } else {
    // Summary box
    doc.setFillColor(...RED_LIGHT); doc.roundedRect(14,y,182,16,2,2,'F');
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...RED);
    doc.text(`${unpaid.length} tenants with outstanding dues — Total: ${formatCurrency(totalDue)}`, 18, y+10);
    y += 20;

    autoTable(doc, {
      startY:y, margin:{left:14,right:14},
      head:[['Building','Room','Tenant','Phone','Expected','Paid','Balance Due','Status','Note']],
      body: unpaid.map(t => {
        const note = notes.find(n=>n.tenant_id===t.tenantId&&n.note_type==='unpaid');
        return [
          t.building, t.room, t.name, t.phone||'—',
          formatCurrency(t.expected), formatCurrency(t.paid),
          formatCurrency(t.balance), t.status.toUpperCase(),
          note?.team_note?.slice(0,35)||'—'
        ];
      }),
      styles:{fontSize:7.5,cellPadding:2.5},
      headStyles:{fillColor:RED,textColor:[255,255,255],fontStyle:'bold'},
      alternateRowStyles:{fillColor:RED_LIGHT},
      columnStyles:{8:{fontSize:7,textColor:[120,130,145]}},
      didParseCell:(d)=>{
        if(d.column.index===7&&d.section==='body'){
          d.cell.styles.textColor=d.cell.raw==='UNPAID'?RED:AMBER;
          d.cell.styles.fontStyle='bold';
        }
        if(d.column.index===6&&d.section==='body') d.cell.styles.textColor=RED;
      }
    });
    y = doc.lastAutoTable.finalY + 8;

    // Total row
    doc.setFillColor(254,226,226); doc.roundedRect(14,y,182,12,2,2,'F');
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...RED);
    doc.text('Total outstanding dues to recover:', 18, y+8);
    doc.text(formatCurrency(totalDue), 192, y+8, {align:'right'});
  }

  // ══ PAGE 3: PATTERNS & ALERTS ══════════════════════════
  doc.addPage();
  doc.setFillColor(...TEAL); doc.rect(0,0,210,14,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text(`CashMyRent — ${month} Audit`, 14, 9);
  doc.text(`Page 3`, 196, 9, {align:'right'});
  y = 22;

  // Section 3: Patterns
  y = heading('3.  PATTERNS NOTICED', y, DARK);

  const patterns = [];
  // Cash concentration
  const cashTotal = tenantStatus.filter(t=>t.modes.includes('cash')).reduce((s,t)=>s+t.paid,0);
  const totalColl = stats.totalCollected;
  if (cashTotal > 0) {
    const cashPct = Math.round(cashTotal/totalColl*100);
    patterns.push([
      cashPct > 50 ? '⚠ HIGH CASH' : '📊 Cash split',
      `${cashPct}% of collections (${formatCurrency(cashTotal)}) were in cash. ${cashPct>50?'High cash concentration — verify with daily reconciliation.':'Normal split.'}`
    ]);
  }
  // Late payers (partial)
  if (stats.partialCount > 0) {
    patterns.push(['📊 Partial payments', `${stats.partialCount} tenant(s) made partial payments. Total balance pending: ${formatCurrency(tenantStatus.filter(t=>t.status==='partial').reduce((s,t)=>s+t.balance,0))}`]);
  }
  // Building with lowest collection rate
  const lowestBuilding = Object.entries(bSummary).sort((a,b)=>{
    const ra = a[1].expected>0?a[1].collected/a[1].expected:1;
    const rb = b[1].expected>0?b[1].collected/b[1].expected:1;
    return ra-rb;
  })[0];
  if (lowestBuilding) {
    const [bName, bData] = lowestBuilding;
    const bRate = bData.expected>0?Math.round(bData.collected/bData.expected*100):100;
    if (bRate < 95) patterns.push(['📍 Attention building', `${bName} has the lowest collection rate at ${bRate}%. ${bData.unpaid} unpaid, ${bData.partial} partial.`]);
  }
  // Mode fraud
  const modeFraud = fraudFlags.filter(f=>f.type==='mode_fraud');
  if (modeFraud.length > 0) patterns.push(['🔴 Mode mismatch', `${modeFraud.length} payment(s) logged as cash but found in bank statement. Needs investigation.`]);
  // Ghost
  const ghosts = fraudFlags.filter(f=>f.type==='ghost_payment');
  if (ghosts.length > 0) patterns.push(['🔴 Ghost payments', `${ghosts.length} digital payment(s) logged in app but NOT found in bank. Possible fabrication.`]);
  // Clean
  if (patterns.length === 0) patterns.push(['✓ All clear', 'No unusual patterns detected this month.']);

  autoTable(doc, {
    startY:y, margin:{left:14,right:14},
    body: patterns,
    styles:{fontSize:9,cellPadding:4},
    columnStyles:{0:{cellWidth:40,fontStyle:'bold'},1:{cellWidth:142}},
    alternateRowStyles:{fillColor:[248,250,252]},
    didParseCell:(d)=>{
      if(d.column.index===0&&d.section==='body'){
        if(d.cell.raw.includes('🔴')) d.cell.styles.textColor=RED;
        else if(d.cell.raw.includes('⚠')) d.cell.styles.textColor=AMBER;
        else if(d.cell.raw.includes('✓')) d.cell.styles.textColor=TEAL;
      }
    }
  });
  y = doc.lastAutoTable.finalY + 12;

  // Section 4: Alerts
  y = heading('4.  ALERTS', y, AMBER);

  const alerts = [];
  const highFlags = fraudFlags.filter(f=>f.severity==='high');
  if (highFlags.length > 0) {
    highFlags.forEach(f => alerts.push(['🔴 HIGH', f.title, f.detail.slice(0,80)]));
  }
  const medFlags = fraudFlags.filter(f=>f.severity==='medium');
  if (medFlags.length > 0) {
    medFlags.forEach(f => alerts.push(['🟡 MEDIUM', f.title, f.detail.slice(0,80)]));
  }
  if (results.unmatchedBank?.length > 0) {
    alerts.push(['🔴 HIGH', 'Unmatched bank credits', `${results.unmatchedBank.length} credit(s) in bank with no matching collection entry`]);
  }
  if (alerts.length === 0) alerts.push(['✓ None', 'No alerts this month', 'Audit looks clean.']);

  autoTable(doc, {
    startY:y, margin:{left:14,right:14},
    head:[['Severity','Alert','Detail']],
    body: alerts,
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:AMBER,textColor:[255,255,255],fontStyle:'bold'},
    columnStyles:{0:{cellWidth:24},1:{cellWidth:52},2:{cellWidth:106}},
    alternateRowStyles:{fillColor:[255,251,235]},
    didParseCell:(d)=>{
      if(d.column.index===0&&d.section==='body'){
        if(d.cell.raw.includes('HIGH')) d.cell.styles.textColor=RED;
        else if(d.cell.raw.includes('MEDIUM')) d.cell.styles.textColor=AMBER;
        else d.cell.styles.textColor=TEAL;
        d.cell.styles.fontStyle='bold';
      }
    }
  });

  footer();
  doc.save(`CashMyRent_Audit_${month}.pdf`);
  toast.success('Audit report downloaded');
}


// ── Building-wise Mode Collection Excel ──────────────
function downloadModeCollectionExcel(tenantStatus, month) {
  const wb = XLSX.utils.book_new();

  // Group by building
  const byBuilding = {};
  tenantStatus.forEach(t => {
    if (!byBuilding[t.building]) byBuilding[t.building] = [];
    byBuilding[t.building].push(t);
  });

  // One sheet per building
  Object.entries(byBuilding).forEach(([building, tenants]) => {
    const rows = [
      [`${building} — Payment Mode Report — ${month}`, '', '', '', '', '', ''],
      ['Room', 'Tenant', 'Phone', 'Rent (₹)', 'Paid (₹)', 'Balance (₹)', 'Payment Mode', 'In Bank', 'Status'],
      ...tenants.map(t => [
        t.room, t.name, t.phone || '—',
        t.expected, t.paid,
        t.balance > 0 ? t.balance : 0,
        t.modes.join(', ') || '—',
        t.inBank ? `Yes — ₹${t.bankAmount?.toLocaleString('en-IN')||0}` : t.modes.includes('cash') ? 'Cash (offline)' : '—',
        t.status.toUpperCase(),
      ]),
      // Totals
      ['TOTAL', '', '',
        tenants.reduce((s,t)=>s+t.expected,0),
        tenants.reduce((s,t)=>s+t.paid,0),
        tenants.reduce((s,t)=>s+t.balance,0),
        '', '', ''
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws['!cols'] = [{wch:8},{wch:22},{wch:13},{wch:12},{wch:12},{wch:12},{wch:18},{wch:20},{wch:10}];
    // Merge title row
    ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:8}}];

    XLSX.utils.book_append_sheet(wb, ws, building.slice(0,28));
  });

  // Summary sheet
  const summaryRows = [
    [`Payment Mode Summary — ${month}`, '', '', '', ''],
    ['Building', 'RentOK', 'Cash', 'Other/Bank', 'Total Collected'],
    ...Object.entries(byBuilding).map(([b, tenants]) => {
      const rentok = tenants.filter(t=>t.modes.includes('rentok')).reduce((s,t)=>s+t.paid,0);
      const cash = tenants.filter(t=>t.modes.includes('cash')&&!t.modes.includes('rentok')).reduce((s,t)=>s+t.paid,0);
      const other = tenants.filter(t=>!t.modes.includes('rentok')&&!t.modes.includes('cash')&&t.paid>0).reduce((s,t)=>s+t.paid,0);
      return [b, rentok||'—', cash||'—', other||'—', tenants.reduce((s,t)=>s+t.paid,0)];
    }),
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{wch:28},{wch:14},{wch:14},{wch:14},{wch:16}];
  summaryWs['!merges'] = [{s:{r:0,c:0},e:{r:0,c:4}}];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Mode Summary');

  XLSX.writeFile(wb, `CashMyRent_ModeCollection_${month}.xlsx`);
  toast.success('Mode collection report downloaded');
}

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════
export default function Audit() {
  const { isSuperAdmin, isAdmin, profile } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[MONTHS.length-2]||MONTHS[MONTHS.length-1]);
  const [fileQueue, setFileQueue] = useState([]);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();
  const responseRef = useRef();

  const [results, setResults] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');

  const [notes, setNotes] = useState([]);
  const [noteModal, setNoteModal] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteStatus, setNoteStatus] = useState('explained');
  const [savingNote, setSavingNote] = useState(false);

  const [savedSessions, setSavedSessions] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Deduplicate across all uploaded files — same date+amount+narration prefix = same txn
  const allTxns = (() => {
    const raw = fileQueue.flatMap(f => f.txns || []);
    const seen = new Set();
    return raw.filter(t => {
      const key = `${t.date}|${t.credit}|${t.debit}|${(t.narration||'').slice(0,35).replace(/\s+/g,'')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  useEffect(()=>{ loadNotes(); loadHistory(); },[selectedMonth]);

  async function loadNotes() {
    const {data}=await supabase.from('audit_notes').select('*, tenant:tenants(full_name), flat:flats(door_number), building:buildings(name), responder:profiles!responded_by(full_name)').eq('month',selectedMonth).order('created_at',{ascending:false});
    setNotes(data||[]);
  }

  async function loadHistory() {
    const {data}=await supabase.from('audit_sessions').select('id,month,stats,tenant_status,fraud_flags,unmatched_bank,building_summary,collector_stats,day_wise,created_at,created_by').order('created_at',{ascending:false}).limit(20);
    setSavedSessions(data||[]);
  }

  async function loadSession(session) {
    // If session was loaded from list (partial), fetch full data
    let s = session;
    if (!session.tenant_status) {
      const { data } = await supabase.from('audit_sessions').select('*').eq('id', session.id).single();
      if (data) s = data;
    }
    setSelectedMonth(s.month);
    setResults({
      tenantStatus: s.tenant_status||[],
      fraudFlags: s.fraud_flags||[],
      unmatchedBank: s.unmatched_bank||[],
      bSummary: s.building_summary||{},
      collectorStats: s.collector_stats||[],
      dayWiseArr: s.day_wise||[],
      stats: s.stats||{},
    });
    setActiveTab('summary');
    setShowHistory(false);
    toast.success(`Loaded audit for ${s.month}`);
  }

  async function saveSession() {
    if (!results) return;
    setSaving(true);
    try {
      await supabase.from('audit_sessions').upsert({
        month: selectedMonth,
        stats: results.stats,
        tenant_status: results.tenantStatus,
        fraud_flags: results.fraudFlags,
        unmatched_bank: results.unmatchedBank,
        building_summary: results.bSummary,
        collector_stats: results.collectorStats,
        created_by: profile?.id,
        updated_at: new Date().toISOString(),
      }, {onConflict:'month,created_by'});
      toast.success('Audit saved — access it anytime from history');
      loadHistory();
    } catch(e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (!isSuperAdmin && !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="card p-8 text-center max-w-sm">
          <ShieldCheck className="w-12 h-12 text-brand-600 mx-auto mb-3"/>
          <h2 className="text-lg font-semibold text-surface-800 mb-2">Access Restricted</h2>
          <p className="text-surface-500 text-sm">Audit is only for Admin and above.</p>
        </div>
      </div>
    );
  }

  function addFiles(e) {
    const files=Array.from(e.target.files||[]);
    setFileQueue(prev=>[...prev,...files.map(file=>({
      id:Date.now()+Math.random(), file,
      bank:file.name.toLowerCase().includes('icici')||file.name.toLowerCase().includes('optransaction')?'icici':'hdfc',
      status:'pending', txns:[], error:null,
    }))]);
    fileRef.current.value='';
  }

  async function parseAllFiles() {
    if (!fileQueue.length) return toast.error('Add at least one file');
    setParsing(true);
    const updated=[...fileQueue];
    for (let i=0;i<updated.length;i++) {
      if (updated[i].status==='done') continue;
      updated[i]={...updated[i],status:'parsing'};
      setFileQueue([...updated]);
      try {
        const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(updated[i].file);});
        const { data: { session } } = await supabase.auth.getSession();
        const resp=await fetch('/api/extract-pdf',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?.access_token||'')},body:JSON.stringify({fileBase64:base64,bank:updated[i].bank,filename:updated[i].file.name})});
        if (!resp.ok){const e=await resp.json();throw new Error(e.error||'Server error');}
        const data=await resp.json();
        const enriched=(data.txns||[]).map(t=>{
          const p = parseNarration(t.narration, updated[i].bank);
          // backwards compat: keep tenantHint as first hint for old code
          return { ...t, credit:Number(t.credit)||0, debit:Number(t.debit)||0, bank:updated[i].bank.toUpperCase(), ...p, tenantHint: p.allHints[0] || null };
        }).filter(t=>t.credit>0||t.debit>0);
        updated[i]={...updated[i],status:'done',txns:enriched};
        toast.success(`${updated[i].file.name.slice(0,25)}: ${enriched.length} txns`);
      } catch(err) {
        updated[i]={...updated[i],status:'error',error:err.message};
        toast.error(`${updated[i].file.name.slice(0,20)}: ${err.message}`);
      }
      setFileQueue([...updated]);
    }
    setParsing(false);
  }

  // ── Property data (loads on mount for property tabs) ─────
  const [propData, setPropData] = useState(null)
  const [loadingProp, setLoadingProp] = useState(false)

  useEffect(() => { loadPropertyData() }, [selectedMonth])

  async function loadPropertyData() {
    setLoadingProp(true)
    try {
      const [
        { data: buildings },
        { data: flats },
        { data: tenants },
        { data: collections },
      ] = await Promise.all([
        supabase.from('buildings').select('id, name').eq('is_active', true),
        supabase.from('flats').select('id, building_id, door_number, monthly_rent, status'),
        supabase.from('tenants').select('id, full_name, phone, flat_id, building_id, monthly_rent, status, move_in_date'),
        supabase.from('rent_collections').select('flat_id, tenant_id, building_id, amount, payment_mode, for_month').eq('for_month', selectedMonth),
      ])

      const bMap = {}
      ;(buildings||[]).forEach(b => { bMap[b.id] = b.name })

      const collByTenant = {}
      ;(collections||[]).forEach(c => {
        collByTenant[c.tenant_id] = collByTenant[c.tenant_id] || []
        collByTenant[c.tenant_id].push(c)
      })

      // Flat + tenant map
      const flatMap = {}
      ;(flats||[]).forEach(f => { flatMap[f.id] = f })

      const activeTenants = (tenants||[]).filter(t => t.status === 'active')
      const vacantFlats = (flats||[]).filter(f => f.status === 'vacant' || f.status === 'maintenance')
      const occupiedFlats = (flats||[]).filter(f => f.status === 'occupied')

      // Per tenant rent status
      const tenantRentStatus = activeTenants.map(t => {
        const colls = collByTenant[t.id] || []
        const paid = colls.reduce((s, c) => s + Number(c.amount), 0)
        const expected = Number(t.monthly_rent || 0)
        const balance = expected - paid
        const status = paid >= expected && expected > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
        const modes = [...new Set(colls.map(c => c.payment_mode))]
        return {
          ...t,
          building: bMap[t.building_id] || '—',
          flat: flatMap[t.flat_id]?.door_number || '—',
          paid, expected, balance, status, modes, colls
        }
      })

      // Building summary
      const bSummary = {}
      ;(buildings||[]).forEach(b => {
        const bFlats = (flats||[]).filter(f => f.building_id === b.id)
        const bTenants = tenantRentStatus.filter(t => t.building_id === b.id)
        bSummary[b.id] = {
          name: b.name,
          total: bFlats.length,
          occupied: bFlats.filter(f => f.status==='occupied').length,
          vacant: bFlats.filter(f => f.status==='vacant').length,
          demo: bFlats.filter(f => f.status==='maintenance').length,
          paid: bTenants.filter(t => t.status==='paid').length,
          partial: bTenants.filter(t => t.status==='partial').length,
          unpaid: bTenants.filter(t => t.status==='unpaid').length,
          expected: bTenants.reduce((s,t) => s+t.expected, 0),
          collected: bTenants.reduce((s,t) => s+t.paid, 0),
          vacantRevLoss: bFlats.filter(f=>f.status==='vacant').reduce((s,f) => s+Number(f.monthly_rent||0), 0),
        }
      })

      setPropData({
        buildings: buildings||[], flats: flats||[], vacantFlats,
        occupiedFlats, tenantRentStatus, bSummary,
        unpaid: tenantRentStatus.filter(t => t.status==='unpaid'),
        partial: tenantRentStatus.filter(t => t.status==='partial'),
        paid: tenantRentStatus.filter(t => t.status==='paid'),
        totalExpected: tenantRentStatus.reduce((s,t)=>s+t.expected,0),
        totalCollected: tenantRentStatus.reduce((s,t)=>s+t.paid,0),
        totalVacantLoss: vacantFlats.reduce((s,f)=>s+Number(f.monthly_rent||0),0),
      })
    } catch { /* audit load failed silently */ }
    finally { setLoadingProp(false) }
  }

  async function runAudit() {
    if (!allTxns.length) return toast.error('Extract transactions first');
    setAnalyzing(true);
    toast.loading('Running smart audit…',{id:'audit'});
    try {
      const {data:tenants}=await supabase.from('tenants').select('id,full_name,phone,flat_id,building_id,monthly_rent').eq('status','active');
      const flatIds=[...new Set((tenants||[]).map(t=>t.flat_id).filter(Boolean))];
      const bIds=[...new Set((tenants||[]).map(t=>t.building_id).filter(Boolean))];
      const [{data:flats},{data:buildings}]=await Promise.all([
        flatIds.length?supabase.from('flats').select('id,door_number').in('id',flatIds):{data:[]},
        bIds.length?supabase.from('buildings').select('id,name').in('id',bIds):{data:[]},
      ]);
      const flatMap={},bMap={};
      (flats||[]).forEach(f=>{flatMap[f.id]=f});
      (buildings||[]).forEach(b=>{bMap[b.id]=b});
      const enrichedTenants=(tenants||[]).map(t=>({...t,flat:flatMap[t.flat_id],building:bMap[t.building_id]}));

      const {data:collections}=await supabase.from('rent_collections').select('*').eq('for_month',selectedMonth);
      const {data:allColl}=await supabase.from('rent_collections').select('flat_id,amount,payment_mode,payment_date,collected_by,created_at').eq('for_month',selectedMonth);
      const {data:profiles}=await supabase.from('profiles').select('id,full_name');
      const profileMap={};(profiles||[]).forEach(p=>{profileMap[p.id]=p.full_name});

      const collByTenant={};
      (collections||[]).forEach(c=>{collByTenant[c.tenant_id]=collByTenant[c.tenant_id]||[];collByTenant[c.tenant_id].push(c);});
      const creditTxns=allTxns.filter(t=>t.credit>0);

      // Track which bank txns are matched so we can find truly unmatched ones
      const matchedBankKeys = new Set();

      const tenantStatus=enrichedTenants.map(t=>{
        const colls=collByTenant[t.id]||[];
        const paid=colls.reduce((s,c)=>s+Number(c.amount),0);
        const expected=Number(t.monthly_rent);
        const modes=[...new Set(colls.map(c=>c.payment_mode))];
        const isCashOnly = modes.length > 0 && modes.every(m => m === 'cash');
        const hasDigital = modes.some(m => m !== 'cash');

        // Use improved matcher
        const bankMatch = findBankMatch(
          { ...t, full_name: t.full_name, room: t.flat?.door_number },
          creditTxns,
          expected
        );
        if (bankMatch) {
          const bKey = `${bankMatch.date}|${bankMatch.credit}|${(bankMatch.narration||'').slice(0,35)}`;
          matchedBankKeys.add(bKey);
        }

        const payStatus = paid >= expected && expected > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

        // Reconciliation status — the clean view the user wants
        let recoStatus = 'unpaid';
        if (payStatus === 'unpaid')  recoStatus = 'unpaid';
        else if (payStatus === 'partial') recoStatus = 'partial';
        else if (isCashOnly) recoStatus = 'cash_paid';           // cash only — no bank match needed
        else if (bankMatch && !isCashOnly) recoStatus = 'matched'; // paid + found in bank ✅
        else if (hasDigital && !bankMatch) recoStatus = 'ghost';  // digital but not in bank ⚠️
        else recoStatus = 'paid_unconfirmed';                     // paid but couldn't confirm in bank

        const bankModeDetected = bankMatch ? modeFromNarration(bankMatch.narration) : null;

        return {
          tenantId:t.id, name:t.full_name, phone:t.phone||'', room:t.flat?.door_number||'—', building:t.building?.name||'—',
          expected, paid, balance:expected-paid, modes,
          status: payStatus,
          recoStatus,
          inSystem:colls.length>0, inBank:!!bankMatch,
          bankAmount:bankMatch?.credit||0, bankNarration:bankMatch?.narration||'',
          bankMode: bankModeDetected,
          matchScore: bankMatch?.matchScore || 0,
          modeFlag:!!(bankMatch&&isCashOnly),
          ghostPayment: recoStatus === 'ghost',
          amountMismatch:!!(bankMatch&&Math.abs(bankMatch.credit-paid)>200),
          colls,
        };
      });

      // Store matched keys on creditTxns for unmatched detection
      const unmatchedCreditTxns = creditTxns.filter(tx => {
        const bKey = `${tx.date}|${tx.credit}|${(tx.narration||'').slice(0,35)}`;
        return !matchedBankKeys.has(bKey);
      });

      const fraudFlags=[];
      tenantStatus.filter(t=>t.modeFlag).forEach(t=>fraudFlags.push({severity:'high',type:'mode_fraud',title:`Mode Fraud — ${t.name}`,detail:`Room ${t.room} (${t.building}): Logged CASH but ₹${t.bankAmount.toLocaleString()} found in bank. May have collected digital and pocketed cash.`,tenantId:t.tenantId,building:t.building}));
      tenantStatus.filter(t=>t.ghostPayment).forEach(t=>fraudFlags.push({severity:'high',type:'ghost_payment',title:`Ghost Payment — ${t.name}`,detail:`Room ${t.room} (${t.building}): ₹${t.paid.toLocaleString()} logged as ${t.modes.join('/')} but NOT in bank. Payment may be fabricated.`,tenantId:t.tenantId,building:t.building}));
      tenantStatus.filter(t=>t.amountMismatch).forEach(t=>fraudFlags.push({severity:'medium',type:'amount_mismatch',title:`Amount Mismatch — ${t.name}`,detail:`Room ${t.room}: App ₹${t.paid.toLocaleString()} vs Bank ₹${t.bankAmount.toLocaleString()} (diff ₹${Math.abs(t.bankAmount-t.paid).toLocaleString()})`,tenantId:t.tenantId,building:t.building}));

      const flatPayCount={};
      (allColl||[]).forEach(c=>{flatPayCount[c.flat_id]=(flatPayCount[c.flat_id]||0)+1});
      Object.entries(flatPayCount).filter(([,v])=>v>1).forEach(([fid,count])=>{
        const t=tenantStatus.find(t=>t.colls[0]?.flat_id===fid);
        if(t) fraudFlags.push({severity:'medium',type:'duplicate',title:`Duplicate Entry — ${t.name}`,detail:`Room ${t.room} (${t.building}): ${count} entries for same month.`,tenantId:t.tenantId,building:t.building});
      });

      const cashByCol={};
      (allColl||[]).filter(c=>c.payment_mode==='cash').forEach(c=>{cashByCol[c.collected_by||'unknown']=(cashByCol[c.collected_by||'unknown']||0)+Number(c.amount);});
      const totalCash=Object.values(cashByCol).reduce((s,v)=>s+v,0);
      Object.entries(cashByCol).forEach(([uid,amt])=>{if(totalCash>0&&amt/totalCash>0.7&&totalCash>50000)fraudFlags.push({severity:'low',type:'concentration',title:'Cash Concentration',detail:`One collector handled ${Math.round(amt/totalCash*100)}% of cash (₹${amt.toLocaleString()}).`});});

      const unmatchedBank = unmatchedCreditTxns;
      unmatchedBank.forEach(tx=>fraudFlags.push({severity:'high',type:'unmatched_bank',title:'Unmatched Bank Credit',detail:`₹${tx.credit.toLocaleString()} on ${tx.date} — "${(tx.narration||'').slice(0,60)}" — in bank but NOT in app.`,bankNarration:tx.narration,bankAmount:tx.credit,bankMode:tx.mode}));

      const collectorStats={};
      (allColl||[]).forEach(c=>{const name=profileMap[c.collected_by]||'Unknown';collectorStats[name]=collectorStats[name]||{name,total:0,cash:0,digital:0,count:0};collectorStats[name].total+=Number(c.amount);collectorStats[name].count++;if(c.payment_mode==='cash')collectorStats[name].cash+=Number(c.amount);else collectorStats[name].digital+=Number(c.amount);});

      const dayWise={};
      (allColl||[]).forEach(c=>{dayWise[c.payment_date]=dayWise[c.payment_date]||{date:c.payment_date,count:0,amount:0};dayWise[c.payment_date].count++;dayWise[c.payment_date].amount+=Number(c.amount);});
      const dayWiseArr=Object.values(dayWise).sort((a,b)=>a.date.localeCompare(b.date));

      const bSummary={};
      tenantStatus.forEach(t=>{
        if(!bSummary[t.building])bSummary[t.building]={paid:0,partial:0,unpaid:0,total:0,collected:0,expected:0,flags:0};
        bSummary[t.building][t.status]++;bSummary[t.building].total++;
        bSummary[t.building].collected+=t.paid;bSummary[t.building].expected+=t.expected;
        bSummary[t.building].flags+=([t.modeFlag,t.ghostPayment,t.amountMismatch].filter(Boolean).length);
      });

      const totalExpected=tenantStatus.reduce((s,t)=>s+t.expected,0);
      const totalCollected=tenantStatus.reduce((s,t)=>s+t.paid,0);
      const totalBankCredits=allTxns.filter(t=>t.credit>0).reduce((s,t)=>s+t.credit,0);

      const res={
        tenantStatus, unmatchedBank, fraudFlags,
        collectorStats:Object.values(collectorStats),
        dayWiseArr, bSummary,
        stats:{
          totalExpected, totalCollected, totalBankCredits,
          bankGap: Math.abs(totalBankCredits-totalCollected),
          paidCount:   tenantStatus.filter(t=>t.status==='paid').length,
          partialCount:tenantStatus.filter(t=>t.status==='partial').length,
          unpaidCount: tenantStatus.filter(t=>t.status==='unpaid').length,
          // Reconciliation counts
          matchedCount:         tenantStatus.filter(t=>t.recoStatus==='matched').length,
          cashPaidCount:        tenantStatus.filter(t=>t.recoStatus==='cash_paid').length,
          paidUnconfirmedCount: tenantStatus.filter(t=>t.recoStatus==='paid_unconfirmed').length,
          ghostCount:           tenantStatus.filter(t=>t.recoStatus==='ghost').length,
          unmatchedBankCount:   unmatchedBank.length,
          fraudHigh:  fraudFlags.filter(f=>f.severity==='high').length,
          fraudMedium:fraudFlags.filter(f=>f.severity==='medium').length,
          fraudLow:   fraudFlags.filter(f=>f.severity==='low').length,
          collectionRate:totalExpected>0?Math.round(totalCollected/totalExpected*100):0,
          // Mode breakdown from app
          modeBreakdown: (() => {
            const m = {};
            tenantStatus.forEach(t => t.modes.forEach(mode => { m[mode] = (m[mode]||0) + 1; }));
            return m;
          })(),
        },
      };
      setResults(res);
      setActiveTab('summary');
      toast.success('Smart audit complete',{id:'audit'});
    } catch(e){toast.error('Audit failed: '+e.message,{id:'audit'});}
    finally{setAnalyzing(false);}
  }

  async function saveNote() {
    if (!noteText.trim()) return toast.error('Enter a note');
    setSavingNote(true);
    try {
      if (noteModal.noteId) {
        await supabase.from('audit_notes').update({team_note:noteText,status:noteStatus,responded_by:profile?.id,responded_at:new Date().toISOString()}).eq('id',noteModal.noteId);
      } else {
        await supabase.from('audit_notes').insert({month:selectedMonth,note_type:noteModal.type,tenant_id:noteModal.tenantId||null,flag_reason:noteModal.reason,bank_narration:noteModal.bankNarration||null,bank_amount:noteModal.bankAmount||null,team_note:noteText,status:noteStatus,created_by:profile?.id,responded_by:profile?.id,responded_at:new Date().toISOString(),org_id:profile?.org_id});
      }
      toast.success('Note saved');
      setNoteModal(null);setNoteText('');setNoteStatus('explained');
      loadNotes();
    } catch(e){toast.error(e.message);}
    finally{setSavingNote(false);}
  }

  function openNote(config) {
    const existing=notes.find(n=>n.tenant_id===config.tenantId&&n.note_type===config.type)||notes.find(n=>n.bank_narration===config.bankNarration&&n.note_type===config.type);
    setNoteModal({...config,noteId:existing?.id||null});
    setNoteText(existing?.team_note||'');
    setNoteStatus(existing?.status||'explained');
  }

  const statusBadge=s=>{const m={paid:'bg-emerald-50 text-emerald-700 border-emerald-200',partial:'bg-amber-50 text-amber-700 border-amber-200',unpaid:'bg-red-50 text-red-700 border-red-200'};return <span className={`badge border text-xs ${m[s]}`}>{s.toUpperCase()}</span>;};
  const flagBg={high:'border-l-red-500 bg-red-50/40',medium:'border-l-amber-400 bg-amber-50/40',low:'border-l-blue-400 bg-blue-50/40'};

  const propTabs = [
    {id:'summary', label:'Summary'},
    {id:'flats_overview', label:`Flats Overview`},
    {id:'vacant', label:`Vacant (${propData?.vacantFlats?.length||0})`},
    {id:'unpaid', label:`Unpaid (${propData?.unpaid?.length||0})`},
    {id:'partial', label:`Partial (${propData?.partial?.length||0})`},
  ]

  const auditTabs = results ? [
    {id:'flags', label:`🚨 Flags (${results.fraudFlags.length})`},
    {id:'tenants', label:'All Tenants'},
    {id:'unmatched', label:`Bank Unmatched (${results.unmatchedBank.length})`},
    {id:'collectors', label:'Collectors'},
    {id:'buildings', label:'By Building'},
    {id:'notes', label:`Notes (${notes.length})`},
    {id:'bank', label:`Bank (${allTxns.length})`},
  ] : []

  const allTabs = results ? [
    {id:'summary',    label:'Summary'},
    {id:'reconcile',  label:`✅ Reconciliation`},
    {id:'flags',      label:`🚨 Flags (${results.fraudFlags.length})`},
    {id:'unpaid',     label:`Unpaid (${results.stats.unpaidCount+results.stats.partialCount})`},
    {id:'tenants',    label:`All Tenants`},
    {id:'unmatched',  label:`Bank Unmatched (${results.unmatchedBank.length})`},
    {id:'collectors', label:'Collectors'},
    {id:'buildings',  label:'By Building'},
    {id:'notes',      label:`Notes (${notes.length})`},
    {id:'bank',       label:`Bank (${allTxns.length})`},
  ]:[];

  function downloadIssueReport(type) {
    if (!results) return;
    const wb = XLSX.utils.book_new();
    const month = selectedMonth;

    if (type === 'revenue_leakage') {
      const unpaid = results.tenantStatus.filter(t => t.status !== 'paid');
      const total = unpaid.reduce((s,t) => s + t.balance, 0);
      const ws = XLSX.utils.json_to_sheet([
        { 'REVENUE LEAKAGE REPORT': `Month: ${month}`, '': '', ' ': '', '  ': '', '   ': '', '    ': '' },
        { 'REVENUE LEAKAGE REPORT': `Total Leakage: ₹${total.toLocaleString('en-IN')}`, '': `${unpaid.length} tenants`, ' ': '', '  ': '', '   ': '', '    ': '' },
        {},
        ...unpaid.map(t => ({
          Building: t.building, Room: t.room, Tenant: t.name, Phone: t.phone,
          'Expected (₹)': t.expected, 'Paid (₹)': t.paid, 'Leakage (₹)': t.balance,
          Status: t.status.toUpperCase(),
          'Team Note': notes.find(n => n.tenant_id === t.tenantId)?.team_note || 'No explanation',
          'Note Status': notes.find(n => n.tenant_id === t.tenantId)?.status || 'PENDING',
        }))
      ]);
      XLSX.utils.book_append_sheet(wb, ws, 'Revenue Leakage');
      XLSX.writeFile(wb, `Revenue_Leakage_${month}.xlsx`);
      toast.success(`Revenue Leakage report: ${unpaid.length} tenants, ₹${total.toLocaleString('en-IN')}`);
    }

    else if (type === 'ghost_payments') {
      const ghosts = results.fraudFlags.filter(f => f.type === 'ghost_payment');
      const ws = XLSX.utils.json_to_sheet(ghosts.length ? ghosts.map(f => ({
        Building: f.building, 'Flag': f.title, 'Details': f.detail,
        'Team Explanation': notes.find(n => n.tenant_id === f.tenantId)?.team_note || 'NO EXPLANATION',
        'Status': notes.find(n => n.tenant_id === f.tenantId)?.status || 'PENDING INVESTIGATION',
      })) : [{ Message: 'No ghost payments detected' }]);
      XLSX.utils.book_append_sheet(wb, ws, 'Ghost Payments');
      XLSX.writeFile(wb, `Ghost_Payments_${month}.xlsx`);
      toast.success(ghosts.length ? `${ghosts.length} ghost payment flags exported` : 'No ghost payments found ✓');
    }

    else if (type === 'mode_fraud') {
      const flags = results.fraudFlags.filter(f => f.type === 'mode_fraud' || f.type === 'amount_mismatch');
      const ws = XLSX.utils.json_to_sheet(flags.length ? flags.map(f => ({
        Severity: f.severity.toUpperCase(), Type: f.type, Building: f.building,
        'Flag': f.title, 'Details': f.detail,
        'Team Explanation': notes.find(n => n.tenant_id === f.tenantId)?.team_note || 'NO EXPLANATION',
        'Status': notes.find(n => n.tenant_id === f.tenantId)?.status || 'PENDING',
      })) : [{ Message: 'No mode fraud flags detected' }]);
      XLSX.utils.book_append_sheet(wb, ws, 'Mode Fraud');
      XLSX.writeFile(wb, `Mode_Fraud_Flags_${month}.xlsx`);
      toast.success(flags.length ? `${flags.length} mode fraud flags exported` : 'No mode fraud found ✓');
    }

    else if (type === 'unmatched_bank') {
      const unmatched = results.unmatchedBank;
      const ws = XLSX.utils.json_to_sheet(unmatched.length ? unmatched.map(t => ({
        Date: t.date, Bank: t.bank, Narration: t.narration, 'Amount (₹)': t.credit,
        'Team Explanation': notes.find(n => n.bank_narration === t.narration)?.team_note || 'NO EXPLANATION',
        'Status': notes.find(n => n.bank_narration === t.narration)?.status || 'UNRESOLVED',
      })) : [{ Message: 'All bank credits matched ✓' }]);
      XLSX.utils.book_append_sheet(wb, ws, 'Bank Unmatched');
      XLSX.writeFile(wb, `Bank_Unmatched_${month}.xlsx`);
      toast.success(unmatched.length ? `${unmatched.length} unmatched credits exported` : 'All bank credits matched ✓');
    }

    else if (type === 'all_flags') {
      const ws = XLSX.utils.json_to_sheet(results.fraudFlags.map(f => ({
        Severity: f.severity.toUpperCase(), Type: f.type.replace(/_/g,' ').toUpperCase(),
        Building: f.building || '—', Title: f.title, Details: f.detail,
        'Team Note': notes.find(n => n.tenant_id === f.tenantId || n.bank_narration === f.bankNarration)?.team_note || '—',
        'Status': notes.find(n => n.tenant_id === f.tenantId || n.bank_narration === f.bankNarration)?.status || 'pending',
      })));
      XLSX.utils.book_append_sheet(wb, ws, 'All Flags');
      XLSX.writeFile(wb, `All_Audit_Flags_${month}.xlsx`);
      toast.success(`${results.fraudFlags.length} flags exported`);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Smart Audit</h1>
          <p className="text-sm text-surface-500 mt-0.5">Fraud detection · Reconciliation · Team accountability</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>setShowHistory(!showHistory)} className="btn-secondary flex items-center gap-2">
            <Clock className="w-4 h-4"/> History ({savedSessions.length})
          </button>
          {results && (<>
            <button onClick={saveSession} disabled={saving} className="btn-secondary flex items-center gap-2">
              {saving?<div className="w-4 h-4 border-2 border-surface-400 border-t-transparent rounded-full animate-spin"/>:<Save className="w-4 h-4"/>} Save
            </button>
            <div className="relative group">
              <button className="btn-secondary flex items-center gap-2">
                <Download className="w-4 h-4"/> Downloads ▾
              </button>
              <div className="hidden group-hover:flex flex-col absolute right-0 top-full mt-1 bg-white border border-surface-200 rounded-lg shadow-lg z-50 min-w-[220px] py-1">
                <button onClick={()=>generateTeamExcel(results.tenantStatus,notes,selectedMonth)} className="px-4 py-2.5 text-sm text-left hover:bg-surface-50 flex items-center gap-2">
                  <Download className="w-3.5 h-3.5 text-brand-600"/> Team Excel (fill reasons)
                </button>
                <div className="border-t border-surface-100 my-1"/>
                <button onClick={()=>downloadIssueReport('revenue_leakage','Revenue Leakage')} className="px-4 py-2.5 text-sm text-left hover:bg-red-50 text-red-700 flex items-center gap-2">
                  <Download className="w-3.5 h-3.5"/> Rent Not Paid ({results.stats.unpaidCount + results.stats.partialCount} tenants)
                </button>
                <button onClick={()=>downloadIssueReport('ghost_payments','Ghost Payments & Fraud')} className="px-4 py-2.5 text-sm text-left hover:bg-red-50 text-red-700 flex items-center gap-2">
                  <Download className="w-3.5 h-3.5"/> Ghost Payments & Mode Fraud ({results.stats.fraudHigh} high)
                </button>
                <button onClick={()=>downloadIssueReport('bank_unmatched','Bank Unmatched')} className="px-4 py-2.5 text-sm text-left hover:bg-amber-50 text-amber-700 flex items-center gap-2">
                  <Download className="w-3.5 h-3.5"/> Bank Unmatched ({results.unmatchedBank.length})
                </button>
                <button onClick={()=>downloadIssueReport('all_flags','All Flags')} className="px-4 py-2.5 text-sm text-left hover:bg-surface-50 flex items-center gap-2">
                  <Download className="w-3.5 h-3.5 text-surface-500"/> All Flags ({results.fraudFlags.length})
                </button>
                <div className="border-t border-surface-100 my-1"/>
                <button onClick={()=>downloadModeCollectionExcel(results.tenantStatus,selectedMonth)} className="px-4 py-2.5 text-sm text-left hover:bg-emerald-50 text-emerald-700 flex items-center gap-2">
                  <Download className="w-3.5 h-3.5"/> Mode Collection (Building-wise)
                </button>
                <button onClick={()=>generatePDF(results,notes,selectedMonth)} className="px-4 py-2.5 text-sm text-left hover:bg-brand-50 text-brand-700 flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5"/> Full PDF Report
                </button>
              </div>
            </div>
          </>)}
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="card p-5">
          <h3 className="font-semibold text-surface-800 mb-3 flex items-center gap-2"><Clock className="w-4 h-4"/>Saved Audit History</h3>
          {savedSessions.length===0?(
            <p className="text-sm text-surface-400">No saved audits yet. Run an audit and click Save.</p>
          ):(
            <div className="space-y-2">
              {savedSessions.map(s=>(
                <div key={s.id} className="flex items-center justify-between p-3 bg-surface-50 rounded-lg border border-surface-200">
                  <div>
                    <p className="font-semibold text-surface-800 text-sm">{s.month}</p>
                    <p className="text-xs text-surface-400">
                      {s.stats?.paidCount||0} paid · {s.stats?.unpaidCount||0} unpaid · {s.stats?.fraudHigh||0} high flags
                      · Saved {new Date(s.created_at).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <button onClick={()=>loadSession(s)} className="btn-secondary btn-sm">Load</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">1</div>
          <h3 className="font-semibold text-surface-800">Select Month</h3>
        </div>
        <select className="select w-auto" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}>
          {MONTHS.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">2</div>
            <div>
              <h3 className="font-semibold text-surface-800">Upload Bank Statements <span className="text-xs font-normal text-surface-400">.xlsx / .xls</span></h3>
              <p className="text-xs text-surface-400">Net banking → Statement → Download as Excel</p>
            </div>
          </div>
          <button onClick={()=>fileRef.current?.click()} className="btn-primary btn-sm flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>Add Files</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple onChange={addFiles} className="hidden"/>
        </div>
        {fileQueue.length===0?(
          <div onClick={()=>fileRef.current?.click()} className="border-2 border-dashed border-surface-300 hover:border-brand-400 rounded-lg p-8 text-center cursor-pointer transition-colors">
            <Upload className="w-8 h-8 text-surface-300 mx-auto mb-2"/>
            <p className="text-sm text-surface-500">Click to add HDFC or ICICI Excel statements</p>
            <p className="text-xs text-surface-400 mt-1">Multiple files supported</p>
          </div>
        ):(
          <div className="space-y-2">
            {fileQueue.map(item=>(
              <div key={item.id} className={`rounded-lg border p-3 ${item.status==='done'?'border-emerald-200 bg-emerald-50/50':item.status==='error'?'border-red-200 bg-red-50/50':'border-surface-200'}`}>
                <div className="flex items-center gap-3">
                  <FileText className={`w-4 h-4 flex-shrink-0 ${item.status==='done'?'text-emerald-600':item.status==='error'?'text-red-500':'text-surface-400'}`}/>
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
                  <button onClick={()=>setFileQueue(prev=>prev.filter(f=>f.id!==item.id))} className="btn-ghost p-1.5 text-surface-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5"/></button>
                </div>
              </div>
            ))}
            <div className="flex gap-3 pt-1 flex-wrap">
              <button onClick={()=>fileRef.current?.click()} className="btn-secondary btn-sm flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>Add More</button>
              <button onClick={parseAllFiles} disabled={parsing||fileQueue.every(f=>f.status==='done')} className="btn-primary flex items-center gap-2">
                {parsing?<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Reading…</>:<><Eye className="w-4 h-4"/>Extract Transactions</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {allTxns.length>0&&(
        <div className="card p-5 border-2 border-brand-200 bg-brand-50/30">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">3</div>
              <div>
                <h3 className="font-semibold text-surface-800">Run Smart Audit</h3>
                <p className="text-xs text-surface-500">{allTxns.length} bank transactions · Detects 5 fraud types</p>
              </div>
            </div>
            <button onClick={runAudit} disabled={analyzing} className="btn-primary flex items-center gap-2">
              {analyzing?<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Analyzing…</>:<><Zap className="w-4 h-4"/>Run Smart Audit</>}
            </button>
          </div>
        </div>
      )}

      {/* Team response upload */}
      {results&&(
        <div className="card p-4 bg-surface-50 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold text-surface-700">Upload Team Responses</p>
            <p className="text-xs text-surface-400">Download Team Excel → share with team → they fill reasons → upload back here</p>
          </div>
          <div className="flex gap-2">
            <input ref={responseRef} type="file" accept=".xlsx,.xls" onChange={async e=>{
              const file=e.target.files?.[0];if(!file)return;
              toast.loading('Importing responses…',{id:'resp'});
              try{await processTeamResponse(file,results.tenantStatus,selectedMonth,profile,loadNotes);toast.success('Responses imported',{id:'resp'});}
              catch(err){toast.error(err.message,{id:'resp'});}
              responseRef.current.value='';
            }} className="hidden"/>
            <button onClick={()=>generateTeamExcel(results.tenantStatus,notes,selectedMonth)} className="btn-secondary btn-sm flex items-center gap-1.5"><Download className="w-3.5 h-3.5"/>Download Team Excel</button>
            <button onClick={()=>responseRef.current?.click()} className="btn-primary btn-sm flex items-center gap-1.5"><Upload className="w-3.5 h-3.5"/>Upload Filled Excel</button>
          </div>
        </div>
      )}

      {results&&(
        <>
          <div className="flex border-b border-surface-200 overflow-x-auto">
            {allTabs.map(t=><button key={t.id} onClick={()=>setActiveTab(t.id)} className={`tab flex-shrink-0 ${activeTab===t.id?'active':''}`}>{t.label}</button>)}
          </div>

          {/* FLATS OVERVIEW */}
          {activeTab==='flats_overview' && propData && (
            <div className="space-y-4">
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
                  <h3 className="text-sm font-semibold text-surface-700">All Buildings — Flat Status Overview</h3>
                  <p className="text-xs text-surface-400 mt-0.5">Total potential revenue loss from vacant flats: {formatCurrency(propData.totalVacantLoss)}/month</p>
                </div>
                <table className="data-table">
                  <thead><tr><th>Building</th><th className="text-center">Total</th><th className="text-center">Occupied</th><th className="text-center">Vacant</th><th className="text-center">Demo</th><th className="text-right">Expected</th><th className="text-right">Collected</th><th className="text-right">Gap</th><th>Rate</th><th>Vacant Rev Loss</th></tr></thead>
                  <tbody>
                    {Object.values(propData.bSummary).map(b => {
                      const rate = b.expected>0?Math.round(b.collected/b.expected*100):0
                      return (
                        <tr key={b.name}>
                          <td className="font-medium text-surface-800">{b.name}</td>
                          <td className="text-center font-semibold">{b.total}</td>
                          <td className="text-center text-emerald-600 font-semibold">{b.occupied}</td>
                          <td className="text-center font-semibold" style={{color:b.vacant>0?'#dc2626':'#94a3b8'}}>{b.vacant}</td>
                          <td className="text-center text-amber-600">{b.demo||0}</td>
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
                          <td className="text-right font-mono text-red-500 text-xs">{b.vacantRevLoss>0?formatCurrency(b.vacantRevLoss):'-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-50 border-t-2 border-surface-200">
                      <td className="px-4 py-2 font-bold text-xs text-surface-600">TOTAL</td>
                      <td className="px-4 py-2 text-center font-bold">{propData.flats.length}</td>
                      <td className="px-4 py-2 text-center font-bold text-emerald-600">{propData.occupiedFlats.length}</td>
                      <td className="px-4 py-2 text-center font-bold text-red-600">{propData.vacantFlats.filter(f=>f.status==='vacant').length}</td>
                      <td className="px-4 py-2 text-center text-amber-600">{propData.vacantFlats.filter(f=>f.status==='maintenance').length}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{formatCurrency(propData.totalExpected)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(propData.totalCollected)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-red-600">{formatCurrency(propData.totalExpected-propData.totalCollected)}</td>
                      <td/>
                      <td className="px-4 py-2 text-right font-mono font-bold text-red-500">{formatCurrency(propData.totalVacantLoss)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* VACANT FLATS */}
          {activeTab==='vacant' && propData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="card p-4 border-l-4 border-red-400">
                  <p className="text-xs text-surface-500 mb-1">Vacant Flats</p>
                  <p className="text-2xl font-bold text-red-600">{propData.vacantFlats.filter(f=>f.status==='vacant').length}</p>
                </div>
                <div className="card p-4 border-l-4 border-amber-400">
                  <p className="text-xs text-surface-500 mb-1">Demo / Maintenance</p>
                  <p className="text-2xl font-bold text-amber-600">{propData.vacantFlats.filter(f=>f.status==='maintenance').length}</p>
                </div>
                <div className="card p-4 border-l-4 border-red-600">
                  <p className="text-xs text-surface-500 mb-1">Monthly Revenue Loss</p>
                  <p className="text-xl font-bold font-mono text-red-600">{formatCurrency(propData.totalVacantLoss)}</p>
                  <p className="text-xs text-surface-400">if all vacant were filled</p>
                </div>
              </div>
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100 bg-surface-50">
                  <h3 className="text-sm font-semibold text-surface-700">Vacant & Demo Flats</h3>
                  <button onClick={() => {
                    const wb = XLSX.utils.book_new()
                    const ws = XLSX.utils.json_to_sheet(propData.vacantFlats.map(f => ({
                      Building: Object.values(propData.bSummary).find(b => b.name)?.name || '—',
                      'Flat No': f.door_number, Status: f.status,
                      'Monthly Rent (₹)': f.monthly_rent, 'Revenue Loss (₹)': f.monthly_rent,
                    })))
                    XLSX.utils.book_append_sheet(wb, ws, 'Vacant Flats')
                    XLSX.writeFile(wb, `Vacant_Flats_${selectedMonth}.xlsx`)
                    toast.success('Downloaded')
                  }} className="btn-secondary btn-sm flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5"/> Download
                  </button>
                </div>
                <table className="data-table">
                  <thead><tr><th>Building</th><th>Flat No.</th><th>Status</th><th className="text-right">Potential Rent</th><th>Notes</th></tr></thead>
                  <tbody>
                    {propData.vacantFlats.map(f => {
                      const bName = Object.values(propData.bSummary).find(b => Object.keys(propData.bSummary).some(id => propData.bSummary[id].name && f.building_id === Object.keys(propData.bSummary).find(k=>propData.bSummary[k].name===propData.bSummary[id].name)))?.name
                      return (
                        <tr key={f.id} className={f.status==='vacant'?'bg-red-50/20':'bg-amber-50/20'}>
                          <td className="text-surface-600 text-xs">{Object.entries(propData.bSummary).find(([id])=>id===f.building_id)?.[1]?.name||'—'}</td>
                          <td className="font-mono font-bold text-surface-800">{f.door_number}</td>
                          <td><span className={`badge border text-xs ${f.status==='vacant'?'bg-red-50 text-red-700 border-red-200':'bg-amber-50 text-amber-700 border-amber-200'}`}>{f.status.toUpperCase()}</span></td>
                          <td className="text-right font-mono text-red-600">{f.monthly_rent>0?formatCurrency(f.monthly_rent):'—'}</td>
                          <td className="text-xs text-surface-400">—</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* UNPAID */}
          {activeTab==='unpaid' && propData && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100 bg-red-50">
                <div>
                  <p className="text-sm font-semibold text-red-800">{propData.unpaid.length} tenants with ZERO payment — {formatCurrency(propData.unpaid.reduce((s,t)=>s+t.expected,0))} outstanding</p>
                </div>
                <button onClick={() => {
                  const wb = XLSX.utils.book_new()
                  const ws = XLSX.utils.json_to_sheet(propData.unpaid.map(t => ({
                    Building:t.building, Room:t.flat, Tenant:t.full_name, Phone:t.phone,
                    'Expected (₹)':t.expected, 'Paid (₹)':t.paid, 'Balance (₹)':t.balance,
                    'Team Note': notes.find(n=>n.tenant_id===t.id)?.team_note||'No explanation',
                  })))
                  XLSX.utils.book_append_sheet(wb, ws, 'Unpaid')
                  XLSX.writeFile(wb, `Unpaid_${selectedMonth}.xlsx`)
                  toast.success('Unpaid report downloaded')
                }} className="btn-secondary btn-sm flex items-center gap-1.5 flex-shrink-0">
                  <Download className="w-3.5 h-3.5"/> Download
                </button>
              </div>
              {propData.unpaid.length===0 ? (
                <div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/><p className="text-surface-500">All tenants have made at least partial payment</p></div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Building</th><th>Room</th><th>Tenant</th><th>Phone</th><th className="text-right">Expected</th><th>Status</th><th>Team Response</th></tr></thead>
                  <tbody>
                    {propData.unpaid.map(t => {
                      const existing = notes.find(n=>n.tenant_id===t.id&&n.note_type==='unpaid')
                      return (
                        <tr key={t.id} className="bg-red-50/20">
                          <td className="text-xs text-surface-500">{t.building}</td>
                          <td className="font-mono font-bold">{t.flat}</td>
                          <td className="font-medium text-surface-800">{t.full_name}</td>
                          <td className="text-xs text-surface-500">{t.phone}</td>
                          <td className="text-right font-mono font-bold text-red-600">{formatCurrency(t.expected)}</td>
                          <td><span className="badge bg-red-50 text-red-700 border border-red-200 text-xs">UNPAID</span></td>
                          <td>
                            {existing
                              ? <button onClick={()=>openNote({type:'unpaid',tenantId:t.id,reason:`Unpaid - ${t.full_name} Room ${t.flat}`,noteId:existing.id})}
                                  className={`badge border text-xs cursor-pointer ${STATUS_CFG[existing.status]?.cls}`}>{existing.status}</button>
                              : <button onClick={()=>openNote({type:'unpaid',tenantId:t.id,reason:`Unpaid rent - ${t.full_name} Room ${t.flat} (${t.building})`})}
                                  className="btn-secondary btn-sm text-xs flex items-center gap-1"><MessageSquare className="w-3 h-3"/>Note</button>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-50 border-t border-surface-200">
                      <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-surface-500">Total Unpaid</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-red-600">{formatCurrency(propData.unpaid.reduce((s,t)=>s+t.expected,0))}</td>
                      <td colSpan={2}/>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* PARTIAL */}
          {activeTab==='partial' && propData && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100 bg-amber-50">
                <div>
                  <p className="text-sm font-semibold text-amber-800">{propData.partial.length} tenants with PARTIAL payment — {formatCurrency(propData.partial.reduce((s,t)=>s+t.balance,0))} still due</p>
                </div>
                <button onClick={() => {
                  const wb = XLSX.utils.book_new()
                  const ws = XLSX.utils.json_to_sheet(propData.partial.map(t => ({
                    Building:t.building, Room:t.flat, Tenant:t.full_name, Phone:t.phone,
                    'Expected (₹)':t.expected, 'Paid (₹)':t.paid, 'Balance (₹)':t.balance,
                    'Modes': t.modes.join(', ')||'—',
                    'Team Note': notes.find(n=>n.tenant_id===t.id)?.team_note||'No explanation',
                  })))
                  XLSX.utils.book_append_sheet(wb, ws, 'Partial Payments')
                  XLSX.writeFile(wb, `Partial_Payments_${selectedMonth}.xlsx`)
                  toast.success('Partial payments report downloaded')
                }} className="btn-secondary btn-sm flex items-center gap-1.5 flex-shrink-0">
                  <Download className="w-3.5 h-3.5"/> Download
                </button>
              </div>
              {propData.partial.length===0 ? (
                <div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/><p className="text-surface-500">No partial payments this month</p></div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Building</th><th>Room</th><th>Tenant</th><th>Phone</th><th className="text-right">Expected</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Mode</th><th>Response</th></tr></thead>
                  <tbody>
                    {propData.partial.map(t => {
                      const existing = notes.find(n=>n.tenant_id===t.id&&n.note_type==='unpaid')
                      return (
                        <tr key={t.id} className="bg-amber-50/20">
                          <td className="text-xs text-surface-500">{t.building}</td>
                          <td className="font-mono font-bold">{t.flat}</td>
                          <td className="font-medium text-surface-800">{t.full_name}</td>
                          <td className="text-xs text-surface-500">{t.phone}</td>
                          <td className="text-right font-mono">{formatCurrency(t.expected)}</td>
                          <td className="text-right font-mono text-emerald-700">{formatCurrency(t.paid)}</td>
                          <td className="text-right font-mono font-bold text-amber-700">{formatCurrency(t.balance)}</td>
                          <td className="text-xs text-surface-500">{t.modes.join(', ')||'—'}</td>
                          <td>
                            {existing
                              ? <button onClick={()=>openNote({type:'unpaid',tenantId:t.id,reason:`Partial - ${t.full_name} Room ${t.flat}`,noteId:existing.id})}
                                  className={`badge border text-xs cursor-pointer ${STATUS_CFG[existing.status]?.cls}`}>{existing.status}</button>
                              : <button onClick={()=>openNote({type:'unpaid',tenantId:t.id,reason:`Partial payment - ${t.full_name} Room ${t.flat} (${t.building}) - Balance ₹${t.balance.toLocaleString()}`})}
                                  className="btn-secondary btn-sm text-xs flex items-center gap-1"><MessageSquare className="w-3 h-3"/>Note</button>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-50 border-t border-surface-200">
                      <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-surface-500">Total Balance Due</td>
                      <td className="px-4 py-2 text-right font-mono">{formatCurrency(propData.partial.reduce((s,t)=>s+t.expected,0))}</td>
                      <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(propData.partial.reduce((s,t)=>s+t.paid,0))}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-amber-700">{formatCurrency(propData.partial.reduce((s,t)=>s+t.balance,0))}</td>
                      <td colSpan={2}/>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* SUMMARY */}
          {activeTab==='summary'&&(
            <div className="space-y-4">
              {propData && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    {l:'Total Flats',v:propData.flats.length,c:'border-surface-300',vc:'text-surface-900'},
                    {l:'Occupied',v:propData.occupiedFlats.length,c:'border-emerald-400',vc:'text-emerald-700'},
                    {l:'Vacant',v:propData.vacantFlats.filter(f=>f.status==='vacant').length,c:'border-red-400',vc:'text-red-600'},
                    {l:'Collection Rate',v:`${propData.totalExpected>0?Math.round(propData.totalCollected/propData.totalExpected*100):0}%`,c:'border-brand-500',vc:'text-brand-700'},
                  ].map(({l,v,c,vc})=>(
                    <div key={l} className={`card p-3 border-l-4 ${c}`}>
                      <p className="text-xs text-surface-500 mb-1">{l}</p>
                      <p className={`text-xl font-bold font-mono ${vc}`}>{v}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className={`card p-5 border-l-4 ${results.stats.fraudHigh>0?'border-l-red-500 bg-red-50/40':results.stats.fraudMedium>0?'border-l-amber-400':'border-l-emerald-500 bg-emerald-50/40'}`}>
                <div className="flex items-start gap-3">
                  {results.stats.fraudHigh>0?<AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0"/>:<CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0"/>}
                  <div>
                    <h3 className={`font-bold text-base ${results.stats.fraudHigh>0?'text-red-800':'text-emerald-800'}`}>
                      {results.stats.fraudHigh>0?`${results.stats.fraudHigh} High-Risk Flags — Immediate Action Required`:'Clean Audit — No High-Risk Flags'}
                    </h3>
                    <p className="text-sm text-surface-600 mt-1">{results.stats.collectionRate}% collected · {results.stats.paidCount} paid · {results.stats.unpaidCount} unpaid · {results.stats.partialCount} partial{results.stats.fraudMedium>0?` · ${results.stats.fraudMedium} medium flags`:''}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[{l:'Expected',v:formatCurrency(results.stats.totalExpected),c:'border-surface-300'},{l:'Collected',v:formatCurrency(results.stats.totalCollected),c:'border-emerald-400'},{l:'Bank Credits',v:formatCurrency(results.stats.totalBankCredits),c:'border-brand-500'},{l:'Gap',v:formatCurrency(results.stats.bankGap),c:results.stats.bankGap>1000?'border-red-400':'border-emerald-400'}].map(({l,v,c})=>(
                  <div key={l} className={`card p-4 border-l-4 ${c}`}><p className="text-xs text-surface-500 mb-1">{l}</p><p className="text-lg font-bold font-mono text-surface-900">{v}</p></div>
                ))}
              </div>

              {/* Payment status */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[
                  {l:'Paid',          v:results.stats.paidCount,    c:'text-emerald-600', b:'border-t-emerald-400'},
                  {l:'Partial',       v:results.stats.partialCount,  c:'text-amber-600',  b:'border-t-amber-400'},
                  {l:'Unpaid',        v:results.stats.unpaidCount,   c:'text-red-600',    b:'border-t-red-400'},
                  {l:'🚨 High Flags', v:results.stats.fraudHigh,    c:'text-red-700',    b:'border-t-red-600'},
                  {l:'⚠ Medium',      v:results.stats.fraudMedium,  c:'text-amber-700',  b:'border-t-amber-400'},
                  {l:'Bank Unmatched',v:results.unmatchedBank.length,c:results.unmatchedBank.length>0?'text-red-600':'text-emerald-600',b:results.unmatchedBank.length>0?'border-t-red-400':'border-t-emerald-400'},
                ].map(({l,v,c,b})=>(
                  <div key={l} className={`card p-3 text-center border-t-4 ${b}`}><p className={`text-2xl font-bold ${c}`}>{v}</p><p className="text-xs text-surface-500 mt-0.5">{l}</p></div>
                ))}
              </div>

              {/* Reconciliation summary */}
              <div className="card p-4">
                <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">Bank Reconciliation</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    {l:'✅ Matched',      v:results.stats.matchedCount,          c:'text-emerald-700', bg:'bg-emerald-50'},
                    {l:'💵 Cash Paid',    v:results.stats.cashPaidCount,         c:'text-teal-700',    bg:'bg-teal-50'},
                    {l:'⚠ Unconfirmed',  v:results.stats.paidUnconfirmedCount,  c:'text-blue-700',    bg:'bg-blue-50'},
                    {l:'🔴 Ghost',        v:results.stats.ghostCount,            c:'text-red-700',     bg:'bg-red-50'},
                    {l:'🏦 Bank Missing', v:results.stats.unmatchedBankCount,    c:'text-orange-700',  bg:'bg-orange-50'},
                  ].map(({l,v,c,bg})=>(
                    <div key={l} className={`${bg} rounded-lg p-3 text-center`}>
                      <p className={`text-xl font-bold ${c}`}>{v}</p>
                      <p className="text-xs text-surface-500 mt-0.5">{l}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment mode breakdown */}
              {results.stats.modeBreakdown && Object.keys(results.stats.modeBreakdown).length > 0 && (
                <div className="card p-4">
                  <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">Payment Mode Breakdown</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(results.stats.modeBreakdown).sort((a,b)=>b[1]-a[1]).map(([mode,count]) => {
                      const MODE_LABEL = { upi:'📱 UPI', cash:'💵 Cash', imps:'🏦 IMPS', neft:'🏦 NEFT', bank_transfer:'🏦 Bank Transfer', cheque:'📝 Cheque', credit:'💳 Credit', rentok:'🔵 RentOK' };
                      return (
                        <div key={mode} className="flex items-center gap-2 bg-surface-50 border border-surface-200 rounded-lg px-3 py-2">
                          <span className="text-sm font-semibold text-surface-800">{MODE_LABEL[mode]||mode}</span>
                          <span className="badge bg-brand-100 text-brand-700 border border-brand-200 text-xs">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="card p-4">
                <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold text-surface-700">Collection Rate</span><span className="text-lg font-bold font-mono text-brand-700">{results.stats.collectionRate}%</span></div>
                <div className="h-3 bg-surface-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{width:`${results.stats.collectionRate}%`,background:results.stats.collectionRate>=90?'#0d9488':results.stats.collectionRate>=70?'#f59e0b':'#dc2626'}}/>
                </div>
                <div className="flex justify-between text-xs text-surface-400 mt-1"><span>₹0</span><span>{formatCurrency(results.stats.totalCollected)} / {formatCurrency(results.stats.totalExpected)}</span></div>
              </div>

              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-surface-100 bg-surface-50"><h3 className="text-sm font-semibold text-surface-700">Building Overview</h3></div>
                <div className="divide-y divide-surface-100">
                  {Object.entries(results.bSummary).map(([name,b])=>{
                    const rate=b.expected>0?Math.round(b.collected/b.expected*100):0;
                    return(
                      <div key={name} className="flex items-center gap-4 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2"><p className="font-medium text-surface-800 text-sm truncate">{name}</p>{b.flags>0&&<span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">⚠ {b.flags}</span>}</div>
                          <div className="flex gap-3 mt-0.5 text-xs"><span className="text-emerald-600">{b.paid} paid</span>{b.partial>0&&<span className="text-amber-600">{b.partial} partial</span>}{b.unpaid>0&&<span className="text-red-600">{b.unpaid} unpaid</span>}</div>
                        </div>
                        <div className="text-right flex-shrink-0"><p className="font-mono text-sm font-semibold text-emerald-700">{formatCurrency(b.collected)}</p><p className="text-xs text-surface-400">of {formatCurrency(b.expected)}</p></div>
                        <div className="w-24 flex-shrink-0"><div className="h-1.5 bg-surface-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:`${rate}%`,backgroundColor:rate>=90?'#0d9488':rate>=70?'#f59e0b':'#dc2626'}}/></div><p className="text-xs font-mono text-surface-500 text-right mt-0.5">{rate}%</p></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ RECONCILIATION TAB ═══ */}
          {activeTab==='reconcile' && (() => {
            const ML = { upi:'📱 UPI', cash:'💵 Cash', imps:'🏦 IMPS', neft:'🏦 NEFT', rtgs:'🏦 RTGS', bank_transfer:'🏦 Bank', cheque:'📝 Cheque', nach:'🔄 NACH', transfer:'🏦 Transfer', unknown:'—', credit:'💳 Credit', rentok:'🔵 RentOK' };
            const RECO = {
              matched:          { label:'✅ Matched',           short:'Matched',     cls:'bg-emerald-50 text-emerald-700 border-emerald-300', pill:'bg-emerald-600 text-white', row:'' },
              cash_paid:        { label:'💵 Cash Paid',         short:'Cash Paid',   cls:'bg-teal-50 text-teal-700 border-teal-300',          pill:'bg-teal-600 text-white',    row:'' },
              paid_unconfirmed: { label:'⚠️ Paid (Unconfirmed)',short:'Unconfirmed', cls:'bg-blue-50 text-blue-700 border-blue-300',           pill:'bg-blue-600 text-white',    row:'bg-blue-50/20' },
              partial:          { label:'🟡 Partial',           short:'Partial',     cls:'bg-amber-50 text-amber-700 border-amber-300',        pill:'bg-amber-500 text-white',   row:'bg-amber-50/20' },
              ghost:            { label:'🔴 Ghost Payment',     short:'Ghost',       cls:'bg-red-100 text-red-700 border-red-400',             pill:'bg-red-600 text-white',     row:'bg-red-50/30' },
              unpaid:           { label:'⛔ Unpaid',            short:'Unpaid',      cls:'bg-red-50 text-red-600 border-red-200',              pill:'bg-red-500 text-white',     row:'bg-red-50/10' },
            };

            // All tenant rows sorted: building → room
            const allRows = [...results.tenantStatus].sort((a,b)=>
              a.building.localeCompare(b.building) || a.room.localeCompare(b.room)
            );

            const buildings = [...new Set(allRows.map(t=>t.building))].sort();

            // ── Building-wise Excel download ──────────────────────────
            function downloadBuildingWise() {
              const wb = XLSX.utils.book_new();
              const summaryData = [];

              buildings.forEach(bName => {
                const bTenants = allRows.filter(t => t.building === bName);
                const bUnmatched = results.unmatchedBank.filter(tx =>
                  tx.allHints?.some(h => bName.toLowerCase().includes(h)) || false
                );

                const rows = [
                  // Title
                  [`${bName} — Reconciliation Report — ${selectedMonth}`, '', '', '', '', '', '', '', '', '', ''],
                  // Headers
                  ['Room','Tenant','Phone','Expected (₹)','Paid (₹)','Balance (₹)','App Mode','Bank Matched','Bank Amount (₹)','Bank Mode','Reconciliation Status'],
                  // Data
                  ...bTenants.map(t => ([
                    t.room,
                    t.name,
                    t.phone||'—',
                    t.expected,
                    t.paid,
                    t.balance > 0 ? t.balance : 0,
                    t.modes.map(m => ML[m]||m).join(', ')||'—',
                    t.inBank ? 'Yes' : (t.modes.every(m=>m==='cash') ? 'Cash (Offline)' : 'No'),
                    t.bankAmount || '—',
                    t.bankMode ? (ML[t.bankMode]||t.bankMode) : '—',
                    RECO[t.recoStatus]?.label || t.recoStatus,
                  ])),
                  // Totals row
                  ['TOTAL','','',
                    bTenants.reduce((s,t)=>s+t.expected,0),
                    bTenants.reduce((s,t)=>s+t.paid,0),
                    bTenants.reduce((s,t)=>s+t.balance,0),
                    '','','','','',
                  ],
                ];

                // Add unmatched bank section if any for this building
                if (bUnmatched.length > 0) {
                  rows.push([]);
                  rows.push(['🏦 BANK CREDITS NOT IN APP','Date','Narration','Amount','Mode','','','','','','']);
                  bUnmatched.forEach(tx => {
                    rows.push(['',tx.date,tx.narration,tx.credit, ML[tx.mode||'unknown']||'—','','','','','','']);
                  });
                }

                const ws = XLSX.utils.aoa_to_sheet(rows);
                ws['!cols'] = [{wch:8},{wch:22},{wch:13},{wch:13},{wch:11},{wch:11},{wch:14},{wch:14},{wch:14},{wch:12},{wch:22}];
                ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:10}}];
                XLSX.utils.book_append_sheet(wb, ws, bName.slice(0,28));

                // Collect for summary sheet
                summaryData.push({
                  Building:   bName,
                  'Total Tenants': bTenants.length,
                  '✅ Matched':    bTenants.filter(t=>t.recoStatus==='matched').length,
                  '💵 Cash Paid':  bTenants.filter(t=>t.recoStatus==='cash_paid').length,
                  '⚠️ Unconfirmed':bTenants.filter(t=>t.recoStatus==='paid_unconfirmed').length,
                  '🟡 Partial':    bTenants.filter(t=>t.recoStatus==='partial').length,
                  '🔴 Ghost':      bTenants.filter(t=>t.recoStatus==='ghost').length,
                  '⛔ Unpaid':     bTenants.filter(t=>t.recoStatus==='unpaid').length,
                  'Expected (₹)':  bTenants.reduce((s,t)=>s+t.expected,0),
                  'Collected (₹)': bTenants.reduce((s,t)=>s+t.paid,0),
                  'Balance (₹)':   bTenants.reduce((s,t)=>s+t.balance,0),
                  'Collection %':  bTenants.reduce((s,t)=>s+t.expected,0)>0
                    ? Math.round(bTenants.reduce((s,t)=>s+t.paid,0)/bTenants.reduce((s,t)=>s+t.expected,0)*100)+'%'
                    : '—',
                  'Bank Unmatched': results.unmatchedBank.length,
                });
              });

              // Summary sheet (first)
              const sumWs = XLSX.utils.json_to_sheet(summaryData);
              sumWs['!cols'] = [{wch:28},{wch:13},{wch:11},{wch:11},{wch:13},{wch:11},{wch:10},{wch:10},{wch:14},{wch:14},{wch:13},{wch:12},{wch:14}];
              XLSX.utils.book_append_sheet(wb, sumWs, 'Summary');
              wb.SheetNames = ['Summary', ...wb.SheetNames.filter(n=>n!=='Summary')];

              // Unmatched bank credits sheet
              if (results.unmatchedBank.length > 0) {
                const umWs = XLSX.utils.json_to_sheet(results.unmatchedBank.map(tx => ({
                  Date: tx.date, Bank: tx.bank,
                  Narration: tx.narration,
                  'Detected Mode': ML[tx.mode||'unknown']||'—',
                  'Amount (₹)': tx.credit,
                  'Team Note': notes.find(n=>n.bank_narration===tx.narration)?.team_note||'No explanation',
                  Status: notes.find(n=>n.bank_narration===tx.narration)?.status||'UNRESOLVED',
                })));
                umWs['!cols'] = [{wch:12},{wch:8},{wch:55},{wch:15},{wch:12},{wch:30},{wch:12}];
                XLSX.utils.book_append_sheet(wb, umWs, 'Bank Unmatched');
              }

              XLSX.writeFile(wb, `Reconciliation_BuildingWise_${selectedMonth}.xlsx`);
              toast.success(`${buildings.length} building sheets exported`);
            }

            // ── Filter state (managed as local derived values) ────────
            const [recoFilter, setRecoFilter] = useState('all');
            const [bFilter, setBFilter]       = useState('all');

            const visible = allRows.filter(t =>
              (recoFilter === 'all' || t.recoStatus === recoFilter) &&
              (bFilter    === 'all' || t.building  === bFilter)
            );

            const counts = Object.fromEntries(
              Object.keys(RECO).map(k => [k, allRows.filter(t=>t.recoStatus===k).length])
            );
            counts.all = allRows.length;

            return (
              <div className="space-y-4">
                {/* ── Top bar ── */}
                <div className="card p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div>
                      <h3 className="font-semibold text-surface-800">Bank Reconciliation — {selectedMonth}</h3>
                      <p className="text-xs text-surface-500 mt-0.5">{allRows.length} tenants · {formatCurrency(allRows.reduce((s,t)=>s+t.expected,0))} expected · {formatCurrency(allRows.reduce((s,t)=>s+t.paid,0))} collected</p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <select value={bFilter} onChange={e=>setBFilter(e.target.value)} className="select text-sm py-1.5 w-44">
                        <option value="all">All Buildings</option>
                        {buildings.map(b=><option key={b} value={b}>{b}</option>)}
                      </select>
                      <button onClick={downloadBuildingWise} className="btn-primary flex items-center gap-1.5 text-sm">
                        <Download className="w-4 h-4"/> Building-wise Excel
                      </button>
                    </div>
                  </div>

                  {/* Status filter pills */}
                  <div className="flex gap-2 flex-wrap">
                    {[
                      {k:'all', label:`All (${counts.all})`},
                      {k:'matched',          label:`✅ Matched (${counts.matched})`},
                      {k:'cash_paid',        label:`💵 Cash (${counts.cash_paid})`},
                      {k:'paid_unconfirmed', label:`⚠️ Unconfirmed (${counts.paid_unconfirmed})`},
                      {k:'partial',          label:`🟡 Partial (${counts.partial})`},
                      {k:'ghost',            label:`🔴 Ghost (${counts.ghost})`},
                      {k:'unpaid',           label:`⛔ Unpaid (${counts.unpaid})`},
                    ].map(({k, label}) => (
                      <button key={k} onClick={()=>setRecoFilter(k)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                          recoFilter===k
                            ? (k==='all'?'bg-surface-800 text-white border-surface-800':k==='matched'||k==='cash_paid'?'bg-emerald-600 text-white border-emerald-600':k==='ghost'||k==='unpaid'?'bg-red-600 text-white border-red-600':'bg-amber-500 text-white border-amber-500')
                            : 'bg-white text-surface-600 border-surface-200 hover:border-surface-400'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Unmatched bank credits (always shown if any) ── */}
                {results.unmatchedBank.length > 0 && (recoFilter==='all') && (
                  <div className="card border-l-4 border-l-orange-500 overflow-hidden">
                    <div className="px-5 py-3 bg-orange-50 border-b border-orange-200 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-orange-800">🏦 {results.unmatchedBank.length} Bank Credits Not in App</p>
                        <p className="text-xs text-orange-600 mt-0.5">Total: {formatCurrency(results.unmatchedBank.reduce((s,t)=>s+t.credit,0))} — money received in bank but no entry in the app</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr><th>Date</th><th>Bank</th><th>Narration</th><th>Detected Mode</th><th className="text-right">Amount</th><th>Action</th></tr>
                        </thead>
                        <tbody>
                          {results.unmatchedBank.map((tx,i) => {
                            const existing = notes.find(n=>n.bank_narration===tx.narration&&n.note_type==='unmatched');
                            return (
                              <tr key={i} className="bg-orange-50/20">
                                <td className="text-xs whitespace-nowrap">{tx.date}</td>
                                <td><span className="badge bg-surface-100 text-surface-600 border text-xs">{tx.bank}</span></td>
                                <td className="text-xs text-surface-600 max-w-[260px]">
                                  <p className="truncate" title={tx.narration}>{tx.narration}</p>
                                  {tx.allHints?.length>0 && <p className="text-[10px] text-surface-400 mt-0.5">Name hints: {tx.allHints.join(', ')}</p>}
                                </td>
                                <td><span className="text-xs text-surface-500">{ML[tx.mode||'unknown']}</span></td>
                                <td className="text-right font-mono font-bold text-orange-700">{formatCurrency(tx.credit)}</td>
                                <td>
                                  {existing
                                    ? <button onClick={()=>openNote({type:'unmatched',bankNarration:tx.narration,bankAmount:tx.credit,reason:`Unmatched ₹${tx.credit}`,noteId:existing.id})} className={`badge border text-xs cursor-pointer ${STATUS_CFG[existing.status]?.cls}`}>{existing.status}</button>
                                    : <button onClick={()=>openNote({type:'unmatched',bankNarration:tx.narration,bankAmount:tx.credit,reason:`Unmatched bank credit ₹${tx.credit} on ${tx.date}`})} className="btn-secondary btn-sm flex items-center gap-1 text-xs"><MessageSquare className="w-3 h-3"/>Explain</button>
                                  }
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── Main reconciliation table ── */}
                <div className="card overflow-hidden">
                  {visible.length === 0 ? (
                    <div className="p-10 text-center">
                      <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/>
                      <p className="text-surface-500">No tenants in this filter</p>
                    </div>
                  ) : (
                    <>
                      <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
                        <p className="text-sm font-semibold text-surface-700">
                          {visible.length} tenant{visible.length!==1?'s':''} · Expected {formatCurrency(visible.reduce((s,t)=>s+t.expected,0))} · Collected {formatCurrency(visible.reduce((s,t)=>s+t.paid,0))} · Balance {formatCurrency(visible.reduce((s,t)=>s+t.balance,0))}
                        </p>
                        <p className="text-xs text-surface-400">{bFilter!=='all'?bFilter:'All buildings'} · {recoFilter!=='all'?RECO[recoFilter]?.label:'All statuses'}</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Building</th>
                              <th>Room</th>
                              <th>Tenant</th>
                              <th>Phone</th>
                              <th className="text-right">Expected</th>
                              <th className="text-right">Paid</th>
                              <th className="text-right">Balance</th>
                              <th>App Mode</th>
                              <th>Bank Amount</th>
                              <th>Bank Mode</th>
                              <th className="text-center">Match%</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              let lastBuilding = null;
                              return visible.map(t => {
                                const isNewBuilding = t.building !== lastBuilding;
                                lastBuilding = t.building;
                                return (
                                  <>
                                    {isNewBuilding && (
                                      <tr key={`hdr-${t.building}`} className="bg-surface-100 dark:bg-surface-700/50">
                                        <td colSpan={12} className="px-4 py-2 text-xs font-bold text-surface-600 dark:text-surface-300 uppercase tracking-wider">
                                          🏢 {t.building} — {visible.filter(x=>x.building===t.building).length} tenants
                                        </td>
                                      </tr>
                                    )}
                                    <tr key={t.tenantId} className={RECO[t.recoStatus]?.row||''}>
                                      <td className="text-xs text-surface-400">{t.building}</td>
                                      <td className="font-mono font-semibold text-surface-800">{t.room}</td>
                                      <td className="font-medium text-surface-800">{t.name}</td>
                                      <td className="text-xs text-surface-500">{t.phone||'—'}</td>
                                      <td className="text-right font-mono text-surface-700">{formatCurrency(t.expected)}</td>
                                      <td className="text-right font-mono text-emerald-700 font-semibold">{formatCurrency(t.paid)}</td>
                                      <td className="text-right font-mono font-bold" style={{color:t.balance>0?'#dc2626':'#94a3b8'}}>{t.balance>0?formatCurrency(t.balance):'—'}</td>
                                      <td className="text-xs">{t.modes.map(m=>ML[m]||m).join(', ')||'—'}</td>
                                      <td className="text-xs">
                                        {t.inBank
                                          ? <span className="text-emerald-700 font-mono font-semibold">₹{t.bankAmount.toLocaleString('en-IN')}</span>
                                          : t.modes.every(m=>m==='cash')
                                            ? <span className="text-surface-400">Cash</span>
                                            : t.status !== 'unpaid'
                                              ? <span className="text-red-400 text-[10px]">Not found</span>
                                              : <span className="text-surface-300">—</span>
                                        }
                                      </td>
                                      <td className="text-xs text-surface-500">{t.bankMode?ML[t.bankMode]||t.bankMode:'—'}</td>
                                      <td className="text-center">
                                        {t.matchScore > 0
                                          ? <span className={`text-xs font-mono font-bold ${t.matchScore>=80?'text-emerald-600':t.matchScore>=60?'text-amber-600':'text-orange-500'}`}>{t.matchScore}%</span>
                                          : <span className="text-surface-300 text-xs">—</span>
                                        }
                                      </td>
                                      <td>
                                        <span className={`badge border text-[10px] font-semibold ${RECO[t.recoStatus]?.cls||''}`}>
                                          {RECO[t.recoStatus]?.short||t.recoStatus}
                                        </span>
                                      </td>
                                    </tr>
                                  </>
                                );
                              });
                            })()}
                          </tbody>
                          <tfoot>
                            <tr className="bg-surface-50 dark:bg-surface-700/30 border-t-2 border-surface-200">
                              <td colSpan={4} className="px-4 py-2.5 text-xs font-bold text-surface-600 uppercase">Total — {visible.length} tenants</td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-surface-800">{formatCurrency(visible.reduce((s,t)=>s+t.expected,0))}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700">{formatCurrency(visible.reduce((s,t)=>s+t.paid,0))}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-red-600">{formatCurrency(visible.reduce((s,t)=>s+t.balance,0))}</td>
                              <td colSpan={5}/>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {/* FLAGS */}
          {activeTab==='flags'&&(
            <div className="space-y-3">
              {results.fraudFlags.length===0?(<div className="card p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/><p className="text-surface-500">No fraud flags detected</p></div>)
              :results.fraudFlags.map((flag,i)=>{
                const existing=notes.find(n=>n.tenant_id===flag.tenantId&&n.flag_reason===flag.title)||notes.find(n=>n.bank_narration===flag.bankNarration);
                return(
                  <div key={i} className={`card p-4 border-l-4 ${flagBg[flag.severity]}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`badge border text-xs font-bold ${flag.severity==='high'?'bg-red-100 text-red-700 border-red-300':flag.severity==='medium'?'bg-amber-100 text-amber-700 border-amber-300':'bg-blue-100 text-blue-700 border-blue-300'}`}>{flag.severity.toUpperCase()}</span>
                          <span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{flag.type.replace(/_/g,' ')}</span>
                        </div>
                        <p className="font-semibold text-surface-800 text-sm">{flag.title}</p>
                        <p className="text-xs text-surface-600 mt-1 leading-relaxed">{flag.detail}</p>
                        {existing&&<div className="mt-2 flex items-start gap-1.5"><CheckSquare className="w-3.5 h-3.5 text-emerald-600 mt-0.5"/><p className="text-xs text-surface-600">{existing.team_note} <span className={`badge border text-xs ml-1 ${STATUS_CFG[existing.status]?.cls}`}>{existing.status}</span></p></div>}
                      </div>
                      <button onClick={()=>openNote({type:flag.type==='unmatched_bank'?'unmatched':'mismatch',tenantId:flag.tenantId,reason:flag.title,bankNarration:flag.bankNarration,bankAmount:flag.bankAmount})} className={`btn-sm flex items-center gap-1.5 flex-shrink-0 ${existing?'btn-secondary':'btn-primary'}`}>
                        <MessageSquare className="w-3.5 h-3.5"/>{existing?'Update':'Explain'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* UNPAID */}
          {activeTab==='unpaid'&&(
            <div className="card overflow-hidden">
              {results.tenantStatus.filter(t=>t.status!=='paid').length===0?(<div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/><p className="text-surface-500">All tenants paid</p></div>):(
                <table className="data-table">
                  <thead><tr><th>Building</th><th>Room</th><th>Tenant</th><th>Phone</th><th className="text-right">Expected</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Status</th><th>Team Response</th></tr></thead>
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
                                className={`badge border text-xs cursor-pointer ${STATUS_CFG[existing.status]?.cls}`}>{existing.status}</button>
                            ):(
                              <button onClick={()=>openNote({type:'unpaid',tenantId:t.tenantId,reason:`Unpaid rent - ${t.name} Room ${t.room} (${t.building})`})}
                                className="btn-secondary btn-sm flex items-center gap-1 text-xs">
                                <MessageSquare className="w-3 h-3"/>Add Note
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
          {activeTab==='tenants'&&(
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
                        <td>{t.inBank?<span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs"><CheckCircle2 className="w-3 h-3"/>{formatCurrency(t.bankAmount)}</span>:t.modes.includes('cash')?<span className="text-xs text-surface-400">Cash</span>:t.status!=='unpaid'?<span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">Not found</span>:<span className="text-surface-300 text-xs">—</span>}</td>
                        <td><div className="flex gap-1 flex-wrap">{t.modeFlag&&<span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">Mode!</span>}{t.ghostPayment&&<span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">Ghost!</span>}{t.amountMismatch&&<span className="badge bg-amber-50 text-amber-600 border border-amber-200 text-xs">Amt!</span>}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* UNMATCHED */}
          {activeTab==='unmatched'&&(
            <div className="card overflow-hidden">
              {results.unmatchedBank.length===0?(<div className="p-10 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2"/><p className="text-surface-500">All bank credits matched</p></div>):(
                <>
                  <div className="px-5 py-3 bg-red-50 border-b border-red-200"><p className="text-sm font-semibold text-red-800">Money in bank with no app entry — {formatCurrency(results.unmatchedBank.reduce((s,t)=>s+t.credit,0))} unaccounted</p></div>
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Bank</th><th>Narration</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {results.unmatchedBank.map((t,i)=>{
                        const existing=notes.find(n=>n.bank_narration===t.narration&&n.note_type==='unmatched');
                        return(
                          <tr key={i} className="bg-red-50/20">
                            <td className="text-xs">{t.date}</td>
                            <td><span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{t.bank}</span></td>
                            <td className="text-xs text-surface-600 max-w-xs truncate">{t.narration}</td>
                            <td className="text-right font-mono font-semibold text-red-600">{formatCurrency(t.credit)}</td>
                            <td>{existing?(<button onClick={()=>openNote({type:'unmatched',bankNarration:t.narration,bankAmount:t.credit,reason:`Unmatched ₹${t.credit}`,noteId:existing.id})} className={`badge border text-xs cursor-pointer ${STATUS_CFG[existing.status]?.cls}`}>{existing.status}</button>):(<button onClick={()=>openNote({type:'unmatched',bankNarration:t.narration,bankAmount:t.credit,reason:`Unmatched bank credit ₹${t.credit} on ${t.date}`})} className="btn-secondary btn-sm flex items-center gap-1 text-xs"><MessageSquare className="w-3 h-3"/>Explain</button>)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* COLLECTORS */}
          {activeTab==='collectors'&&(
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {results.collectorStats.map(c=>{
                  const cashPct=c.total>0?Math.round(c.cash/c.total*100):0;
                  const highCash=cashPct>70&&c.cash>50000;
                  return(
                    <div key={c.name} className={`card p-4 ${highCash?'border-amber-300 bg-amber-50/30':''}`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold">{c.name.charAt(0)}</div>
                        <div><p className="font-semibold text-surface-800 text-sm">{c.name}</p><p className="text-xs text-surface-400">{c.count} payments</p></div>
                        {highCash&&<span className="ml-auto badge bg-amber-50 text-amber-700 border border-amber-200 text-xs">⚠ High cash</span>}
                      </div>
                      <p className="text-xl font-bold font-mono text-surface-900">{formatCurrency(c.total)}</p>
                      <div className="mt-3 space-y-1.5">
                        {[{l:'Cash',v:c.cash,p:cashPct,bg:'bg-amber-400',tc:'text-amber-600'},{l:'Digital',v:c.digital,p:100-cashPct,bg:'bg-blue-400',tc:'text-blue-600'}].map(({l,v,p,bg,tc})=>(
                          <div key={l} className="flex items-center gap-2 text-xs"><span className={`${tc} w-12`}>{l}</span><div className="flex-1 h-1.5 bg-surface-100 rounded-full overflow-hidden"><div className={`h-full ${bg} rounded-full`} style={{width:`${p}%`}}/></div><span className="text-surface-500 w-24 text-right">{formatCurrency(v)}</span></div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {results.dayWiseArr.length>0&&(
                <div className="card p-5">
                  <h3 className="font-semibold text-surface-800 text-sm mb-4">Day-wise Collection</h3>
                  <div className="space-y-2">
                    {results.dayWiseArr.map(d=>{
                      const max=Math.max(...results.dayWiseArr.map(x=>x.amount));
                      const pct=max>0?Math.round(d.amount/max*100):0;
                      return(
                        <div key={d.date} className="flex items-center gap-3 text-xs">
                          <span className="text-surface-500 w-24 flex-shrink-0">{d.date}</span>
                          <div className="flex-1 h-5 bg-surface-100 rounded overflow-hidden"><div className="h-full bg-brand-500 rounded flex items-center px-2" style={{width:`${Math.max(pct,2)}%`}}>{pct>15&&<span className="text-white font-mono text-xs">{formatCurrency(d.amount)}</span>}</div></div>
                          <span className="text-surface-400 w-6">{d.count}x</span>
                          {pct<=15&&<span className="text-surface-600 font-mono w-24">{formatCurrency(d.amount)}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* BUILDINGS */}
          {activeTab==='buildings'&&(
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead><tr><th>Building</th><th className="text-center">Paid</th><th className="text-center">Partial</th><th className="text-center">Unpaid</th><th className="text-right">Expected</th><th className="text-right">Collected</th><th className="text-right">Gap</th><th>Rate</th><th>Flags</th></tr></thead>
                <tbody>
                  {Object.entries(results.bSummary).map(([name,b])=>{
                    const rate=b.expected>0?Math.round(b.collected/b.expected*100):0;
                    return(<tr key={name}><td className="font-medium text-surface-800">{name}</td><td className="text-center text-emerald-600 font-semibold">{b.paid}</td><td className="text-center text-amber-600 font-semibold">{b.partial}</td><td className="text-center text-red-600 font-semibold">{b.unpaid}</td><td className="text-right font-mono">{formatCurrency(b.expected)}</td><td className="text-right font-mono text-emerald-700">{formatCurrency(b.collected)}</td><td className="text-right font-mono text-red-600">{formatCurrency(b.expected-b.collected)}</td><td><div className="flex items-center gap-2"><div className="w-16 h-1.5 bg-surface-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:`${rate}%`,backgroundColor:rate>=90?'#0d9488':rate>=70?'#f59e0b':'#dc2626'}}/></div><span className="text-xs font-mono text-surface-500">{rate}%</span></div></td><td>{b.flags>0?<span className="badge bg-red-50 text-red-600 border border-red-200 text-xs">⚠ {b.flags}</span>:<span className="text-surface-300 text-xs">—</span>}</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* NOTES */}
          {activeTab==='notes'&&(
            <div className="space-y-3">
              <div className="flex items-center justify-between"><p className="text-sm text-surface-500">{notes.length} notes for {selectedMonth}</p><button onClick={loadNotes} className="btn-ghost btn-sm flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5"/>Refresh</button></div>
              {notes.length===0?(<div className="card p-10 text-center"><MessageSquare className="w-10 h-10 text-surface-300 mx-auto mb-2"/><p className="text-surface-500 text-sm">No notes yet. Add from Flags or Unpaid tabs.</p></div>)
              :notes.map(n=>(
                <div key={n.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="badge bg-surface-100 text-surface-600 border border-surface-200 text-xs">{n.note_type}</span>
                        <span className={`badge border text-xs ${STATUS_CFG[n.status]?.cls}`}>{STATUS_CFG[n.status]?.label}</span>
                        {n.tenant&&<span className="text-xs text-surface-500">{n.tenant.full_name} · {n.flat?.door_number} · {n.building?.name}</span>}
                      </div>
                      <p className="text-xs text-surface-500 mb-1">{n.flag_reason}</p>
                      {n.team_note&&<p className="text-sm text-surface-700 bg-surface-50 rounded p-2 mt-1">{n.team_note}</p>}
                      {n.responded_at&&<p className="text-xs text-surface-400 mt-1">{n.responder?.full_name} · {new Date(n.responded_at).toLocaleDateString('en-IN')}</p>}
                    </div>
                    <button onClick={()=>openNote({type:n.note_type,tenantId:n.tenant_id,bankNarration:n.bank_narration,bankAmount:n.bank_amount,reason:n.flag_reason,noteId:n.id})} className="btn-secondary btn-sm flex items-center gap-1 text-xs flex-shrink-0"><MessageSquare className="w-3 h-3"/>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* BANK */}
          {activeTab==='bank'&&(
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center justify-between">
                <span className="text-sm font-medium text-surface-700">{allTxns.length} transactions</span>
                <div className="flex gap-4 text-xs"><span className="text-emerald-600 font-mono">Credits: {formatCurrency(allTxns.filter(t=>t.credit>0).reduce((s,t)=>s+t.credit,0))}</span><span className="text-red-600 font-mono">Debits: {formatCurrency(allTxns.filter(t=>t.debit>0).reduce((s,t)=>s+t.debit,0))}</span></div>
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
                        <td>{t.txnType==='rent'&&<span className="badge bg-brand-50 text-brand-700 border border-brand-100 text-xs">rent</span>}</td>
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

      {!results&&fileQueue.length===0&&(
        <div className="card p-10 text-center">
          <ShieldCheck className="w-12 h-12 text-surface-300 mx-auto mb-3"/>
          <h3 className="font-semibold text-surface-700 mb-1">Smart Audit Ready</h3>
          <p className="text-sm text-surface-400">Upload bank statements → Extract → Run Audit → Download reports → Get team explanations</p>
        </div>
      )}

      {/* Note Modal */}
      {noteModal&&(
        <div className="modal-overlay" onClick={()=>setNoteModal(null)}>
          <div className="modal-content max-w-md p-5" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-surface-800">{noteModal.noteId?'Update Note':'Add Explanation'}</h3><button onClick={()=>setNoteModal(null)} className="text-surface-400 hover:text-surface-600"><X className="w-5 h-5"/></button></div>
            <div className="space-y-3">
              <div className="p-3 bg-surface-50 rounded-lg text-xs text-surface-600 leading-relaxed">{noteModal.reason}</div>
              <div><label className="label">Status</label>
                <select className="select" value={noteStatus} onChange={e=>setNoteStatus(e.target.value)}>
                  {Object.entries(STATUS_CFG).map(([v,{label}])=><option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <div><label className="label">Explanation / Note</label>
                <textarea className="input" rows={4} value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Reason, expected payment date, action taken…"/>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={()=>setNoteModal(null)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={saveNote} disabled={savingNote} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {savingNote?<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>:<Send className="w-4 h-4"/>}Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
