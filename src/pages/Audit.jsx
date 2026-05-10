import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, lastNMonths } from '../utils/helpers';
import toast from 'react-hot-toast';
import {
  ShieldCheck, Upload, Download, AlertTriangle, CheckCircle2,
  XCircle, FileText, Plus, Trash2, MessageSquare,
  X, RefreshCw, Zap, Send, CheckSquare, Save, Clock,
  ChevronDown, ChevronRight, Eye, BarChart2, Users,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MONTHS = lastNMonths(8);

// ── Helpers ─────────────────────────────────────────────
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
  const upi = n.match(/UPI\/([A-Za-z]+)/i);
  return { tenantHint:atn?.[1]?.toLowerCase()||upi?.[1]?.toLowerCase()||null, roomHint:atn?.[2]||null, txnType:atn?.[3]?.toLowerCase().includes('rent')?'rent':'credit' };
}
function parseICICINarration(n) {
  const upi = n.match(/UPI\/([A-Za-z]+)/i);
  return { tenantHint:upi?.[1]?.toLowerCase()||null, roomHint:null, txnType:n.match(/RENTAL/i)?'rent':'credit' };
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
        await supabase.from('audit_notes').insert({month:selectedMonth, note_type:'unpaid', tenant_id:tenant.tenantId, flag_reason:`Unpaid - ${tenant.name} Room ${tenant.room}`, team_note:note, status:'explained', created_by:profile?.id, responded_by:profile?.id, responded_at:new Date().toISOString()});
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
  const { stats, tenantStatus, fraudFlags, bSummary, collectorStats, dayWiseArr } = results;
  const teal = [13,148,136], red=[185,28,28], amber=[180,83,9], dark=[30,41,59], light=[248,250,252];

  const addPage = (title) => {
    doc.addPage();
    doc.setFillColor(...teal);
    doc.rect(0,0,210,12,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text(`MMR — ${month} Audit`, 10, 8);
    doc.text(title, 105, 8, {align:'center'});
    doc.text(`Page ${doc.internal.getNumberOfPages()}`, 200, 8, {align:'right'});
    doc.setTextColor(...dark);
    return 20;
  };

  // ── Cover Page ─────────────────────────────────────────
  doc.setFillColor(...teal);
  doc.rect(0,0,210,80,'F');
  doc.setFillColor(255,255,255); doc.setGState(doc.GState({opacity:0.05}));
  doc.circle(170,20,60,'F'); doc.circle(40,70,40,'F');
  doc.setGState(doc.GState({opacity:1}));

  doc.setTextColor(255,255,255);
  doc.setFontSize(28); doc.setFont('helvetica','bold');
  doc.text('MMR', 20, 35);
  doc.setFontSize(13); doc.setFont('helvetica','normal');
  doc.text('Rent N Stay — Monthly Audit Report', 20, 45);
  doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.text(month, 20, 58);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'long',year:'numeric'})}`, 20, 68);
  doc.text(`Buildings: ${Object.keys(bSummary).length} | Active Tenants: ${tenantStatus.length}`, 20, 75);

  // Fraud banner
  if (stats.fraudHigh > 0) {
    doc.setFillColor(...red); doc.rect(0,82,210,20,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(12); doc.setFont('helvetica','bold');
    doc.text(`⚠  ${stats.fraudHigh} HIGH-RISK FLAGS — IMMEDIATE ACTION REQUIRED`, 105, 92, {align:'center'});
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text(`${stats.fraudMedium} Medium severity · ${stats.fraudLow} Low severity`, 105, 99, {align:'center'});
  } else {
    doc.setFillColor(16,185,129); doc.rect(0,82,210,16,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('✓  Clean Audit — No High-Risk Flags Detected', 105, 92, {align:'center'});
  }

  // KPI boxes on cover
  let y = 115;
  doc.setTextColor(...dark);
  doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text('Executive Summary', 20, y); y += 8;

  const kpis = [
    {label:'Expected Revenue', value:formatCurrency(stats.totalExpected), color:teal},
    {label:'Collected in App', value:formatCurrency(stats.totalCollected), color:[16,185,129]},
    {label:'Bank Credits', value:formatCurrency(stats.totalBankCredits), color:[99,102,241]},
    {label:'App vs Bank Gap', value:formatCurrency(stats.bankGap), color:stats.bankGap>1000?red:teal},
    {label:'Collection Rate', value:`${stats.collectionRate}%`, color:stats.collectionRate>=90?teal:stats.collectionRate>=70?[180,83,9]:red},
    {label:'Tenants Paid', value:`${stats.paidCount}/${tenantStatus.length}`, color:teal},
    {label:'Unpaid Tenants', value:`${stats.unpaidCount}`, color:stats.unpaidCount>0?red:teal},
    {label:'Partial Payment', value:`${stats.partialCount}`, color:stats.partialCount>0?amber:teal},
  ];

  kpis.forEach((kpi, i) => {
    const col = i % 4, row = Math.floor(i/4);
    const x = 10 + col * 48, ky = y + row * 28;
    doc.setFillColor(...light); doc.roundedRect(x, ky, 44, 24, 2, 2, 'F');
    doc.setDrawColor(...kpi.color); doc.setLineWidth(0.5);
    doc.roundedRect(x, ky, 44, 24, 2, 2, 'S');
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139);
    doc.text(kpi.label, x+4, ky+7);
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(...kpi.color);
    doc.text(kpi.value, x+4, ky+18);
  });
  y += 70;

  // Collection rate bar
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...dark);
  doc.text('Collection Rate', 10, y+4);
  doc.setFillColor(226,232,240); doc.roundedRect(10, y+7, 130, 6, 3, 3, 'F');
  const rate = stats.collectionRate;
  const barColor = rate>=90?teal:rate>=70?[245,158,11]:red;
  doc.setFillColor(...barColor); doc.roundedRect(10, y+7, Math.max(rate*1.3,2), 6, 3, 3, 'F');
  doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...barColor);
  doc.text(`${rate}%`, 145, y+12);

  // ── Page 2: Fraud Flags ────────────────────────────────
  if (fraudFlags.length > 0) {
    y = addPage('Fraud & Anomaly Flags');
    const highFlags = fraudFlags.filter(f=>f.severity==='high');
    const medFlags = fraudFlags.filter(f=>f.severity==='medium');
    const lowFlags = fraudFlags.filter(f=>f.severity==='low');

    [[highFlags,'HIGH','HIGH-RISK FLAGS',[185,28,28]],[medFlags,'MEDIUM','MEDIUM FLAGS',[180,83,9]],[lowFlags,'LOW','LOW FLAGS',[37,99,235]]].forEach(([flags,sev,title,color])=>{
      if (!flags.length) return;
      doc.setFillColor(...color); doc.rect(10,y,190,7,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(9); doc.setFont('helvetica','bold');
      doc.text(`${title} (${flags.length})`, 14, y+5);
      y += 10;
      autoTable(doc, {
        startY:y, margin:{left:10,right:10},
        body: flags.map(f=>[f.type.replace(/_/g,' ').toUpperCase(), f.detail]),
        styles:{fontSize:8, cellPadding:3},
        columnStyles:{0:{cellWidth:40, fontStyle:'bold'},1:{cellWidth:148}},
        alternateRowStyles:{fillColor:[249,250,251]},
        tableLineColor:[220,220,220], tableLineWidth:0.1,
      });
      y = doc.lastAutoTable.finalY + 6;
    });

    // Notes/resolutions
    const resolvedNotes = notes.filter(n=>n.status==='resolved'||n.status==='explained');
    if (resolvedNotes.length > 0) {
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
      doc.text('Team Responses & Resolutions', 10, y); y+=4;
      autoTable(doc,{
        startY:y, margin:{left:10,right:10},
        head:[['Type','Issue','Team Response','Status']],
        body:resolvedNotes.map(n=>[n.note_type,n.flag_reason?.slice(0,30)||'—',n.team_note?.slice(0,60)||'—',n.status.toUpperCase()]),
        styles:{fontSize:8}, headStyles:{fillColor:[...teal]},
        alternateRowStyles:{fillColor:[240,253,250]},
      });
    }
  }

  // ── Page 3: Unpaid & Dues ─────────────────────────────
  const unpaid = tenantStatus.filter(t=>t.status!=='paid');
  if (unpaid.length > 0) {
    y = addPage('Unpaid & Dues');
    const totalDue = unpaid.reduce((s,t)=>s+t.balance,0);
    doc.setFillColor(254,226,226); doc.roundedRect(10,y,190,12,2,2,'F');
    doc.setTextColor(...red); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text(`Total Outstanding: ${formatCurrency(totalDue)} across ${unpaid.length} tenants`, 14, y+8);
    y += 18;

    autoTable(doc,{
      startY:y, margin:{left:10,right:10},
      head:[['Building','Room','Tenant','Phone','Expected','Paid','Balance','Status','Team Note']],
      body: unpaid.map(t=>{
        const note=notes.find(n=>n.tenant_id===t.tenantId&&n.note_type==='unpaid');
        return [t.building,t.room,t.name,t.phone||'—',`₹${t.expected.toLocaleString()}`,`₹${t.paid.toLocaleString()}`,`₹${t.balance.toLocaleString()}`,t.status.toUpperCase(),note?.team_note?.slice(0,40)||'—'];
      }),
      styles:{fontSize:8}, headStyles:{fillColor:[...red]},
      alternateRowStyles:{fillColor:[255,250,250]},
      columnStyles:{7:{fontStyle:'bold'},8:{fontSize:7,textColor:[100,116,139]}},
      didParseCell:(d)=>{
        if(d.column.index===7){
          if(d.cell.raw==='UNPAID') d.cell.styles.textColor=[...red];
          if(d.cell.raw==='PARTIAL') d.cell.styles.textColor=[...amber];
        }
        if(d.column.index===6) d.cell.styles.textColor=[...red];
      }
    });
  }

  // ── Page 4: Building Performance ─────────────────────
  y = addPage('Building-wise Performance');
  autoTable(doc,{
    startY:y, margin:{left:10,right:10},
    head:[['Building','Expected','Collected','Gap','Rate','Paid','Partial','Unpaid','Flags']],
    body: Object.entries(bSummary).map(([name,b])=>{
      const rate=b.expected>0?Math.round(b.collected/b.expected*100):0;
      return [name,`₹${b.expected.toLocaleString()}`,`₹${b.collected.toLocaleString()}`,`₹${(b.expected-b.collected).toLocaleString()}`,`${rate}%`,b.paid,b.partial,b.unpaid,b.flags>0?`⚠ ${b.flags}`:'✓'];
    }),
    styles:{fontSize:8,cellPadding:3}, headStyles:{fillColor:[...teal]},
    alternateRowStyles:{fillColor:[240,253,250]},
    didParseCell:(d)=>{
      if(d.column.index===4){
        const r=parseInt(d.cell.raw);
        d.cell.styles.textColor=r>=90?teal:r>=70?amber:red;
        d.cell.styles.fontStyle='bold';
      }
      if(d.column.index===8&&d.cell.raw!=='✓') d.cell.styles.textColor=[...red];
    }
  });
  y = doc.lastAutoTable.finalY + 10;

  // Day-wise bar (simple table version)
  if (results.dayWiseArr?.length > 0) {
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
    doc.text('Day-wise Collection Pattern', 10, y); y+=6;
    const maxAmt = Math.max(...results.dayWiseArr.map(d=>d.amount));
    autoTable(doc,{
      startY:y, margin:{left:10,right:10},
      body: results.dayWiseArr.map(d=>[d.date,`₹${d.amount.toLocaleString()}`,d.count,`${maxAmt>0?Math.round(d.amount/maxAmt*100):0}%`]),
      styles:{fontSize:8}, columnStyles:{0:{cellWidth:25},1:{cellWidth:40,fontStyle:'bold'},2:{cellWidth:15},3:{cellWidth:20}},
      alternateRowStyles:{fillColor:[240,253,250]},
    });
  }

  // ── Page 5: Collector Analysis ────────────────────────
  if (collectorStats?.length > 0) {
    y = addPage('Collector Analysis');
    autoTable(doc,{
      startY:y, margin:{left:10,right:10},
      head:[['Collector','Total Collected','Cash','Digital','Transactions','Cash %','Risk']],
      body: collectorStats.map(c=>{
        const cashPct=c.total>0?Math.round(c.cash/c.total*100):0;
        return [c.name,`₹${c.total.toLocaleString()}`,`₹${c.cash.toLocaleString()}`,`₹${c.digital.toLocaleString()}`,c.count,`${cashPct}%`,cashPct>70&&c.cash>50000?'HIGH CASH':'Normal'];
      }),
      styles:{fontSize:9,cellPadding:4}, headStyles:{fillColor:[...teal]},
      alternateRowStyles:{fillColor:[240,253,250]},
      didParseCell:(d)=>{
        if(d.column.index===6&&d.cell.raw==='HIGH CASH'){d.cell.styles.textColor=[...red];d.cell.styles.fontStyle='bold';}
      }
    });
    y = doc.lastAutoTable.finalY + 10;

    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139);
    doc.text('Note: Collectors handling >70% cash with >₹50,000 are flagged as HIGH CASH risk. Verify physically.', 10, y);
  }

  // ── Page 6: Bank Reconciliation ───────────────────────
  y = addPage('Bank Reconciliation Summary');
  const unmatchedTotal = results.unmatchedBank.reduce((s,t)=>s+t.credit,0);
  if (results.unmatchedBank.length > 0) {
    doc.setFillColor(254,226,226); doc.roundedRect(10,y,190,14,2,2,'F');
    doc.setTextColor(...red); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text(`${results.unmatchedBank.length} unmatched bank credits totalling ${formatCurrency(unmatchedTotal)}`, 14, y+9);
    y += 20;
    autoTable(doc,{
      startY:y, margin:{left:10,right:10},
      head:[['Date','Bank','Narration','Amount','Note']],
      body: results.unmatchedBank.map(t=>{
        const note=notes.find(n=>n.bank_narration===t.narration);
        return [t.date,t.bank,t.narration.slice(0,60),`₹${t.credit.toLocaleString()}`,note?.team_note?.slice(0,40)||'UNEXPLAINED'];
      }),
      styles:{fontSize:8}, headStyles:{fillColor:[...red]},
      columnStyles:{4:{fontStyle:'bold'}},
      didParseCell:(d)=>{if(d.column.index===4&&d.cell.raw==='UNEXPLAINED')d.cell.styles.textColor=[...red];}
    });
  } else {
    doc.setFillColor(240,253,250); doc.roundedRect(10,y,190,20,2,2,'F');
    doc.setTextColor(...teal); doc.setFontSize(12); doc.setFont('helvetica','bold');
    doc.text('✓ All bank credits matched to collection entries', 105, y+13, {align:'center'});
  }

  // ── Footer all pages ──────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let i=1;i<=pageCount;i++) {
    doc.setPage(i);
    doc.setFillColor(248,250,252); doc.rect(0,285,210,12,'F');
    doc.setDrawColor(226,232,240); doc.setLineWidth(0.3); doc.line(0,285,210,285);
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(148,163,184);
    doc.text('CONFIDENTIAL — MMR / Rent N Stay — Internal Audit Document', 10, 291);
    doc.text(`${month} | ${new Date().toLocaleDateString('en-IN')} | Page ${i} of ${pageCount}`, 200, 291, {align:'right'});
  }

  doc.save(`MMR_Audit_${month}.pdf`);
  toast.success('Professional PDF report downloaded');
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

  const allTxns = fileQueue.flatMap(f=>f.txns||[]);

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
        const resp=await fetch('/api/extract-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileBase64:base64,bank:updated[i].bank,filename:updated[i].file.name})});
        if (!resp.ok){const e=await resp.json();throw new Error(e.error||'Server error');}
        const data=await resp.json();
        const enriched=(data.txns||[]).map(t=>{
          const p=updated[i].bank==='hdfc'?parseHDFCNarration(t.narration):parseICICINarration(t.narration);
          return {...t,credit:Number(t.credit)||0,debit:Number(t.debit)||0,bank:updated[i].bank.toUpperCase(),...p};
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

      const tenantStatus=enrichedTenants.map(t=>{
        const colls=collByTenant[t.id]||[];
        const paid=colls.reduce((s,c)=>s+Number(c.amount),0);
        const expected=Number(t.monthly_rent);
        const modes=[...new Set(colls.map(c=>c.payment_mode))];
        const bankMatch=creditTxns.find(tx=>{
          if(tx.roomHint&&t.flat?.door_number){const room=t.flat.door_number.replace(/\D/g,'');if(tx.roomHint===room)return nameScore(tx.tenantHint,t.full_name.split(' ')[0])>40;}
          return nameScore(tx.tenantHint,t.full_name.split(' ')[0])>70&&Math.abs(tx.credit-expected)<expected*0.15;
        });
        return {
          tenantId:t.id, name:t.full_name, phone:t.phone||'', room:t.flat?.door_number||'—', building:t.building?.name||'—',
          expected, paid, balance:expected-paid, modes,
          status:paid>=expected?'paid':paid>0?'partial':'unpaid',
          inSystem:colls.length>0, inBank:!!bankMatch,
          bankAmount:bankMatch?.credit||0, bankNarration:bankMatch?.narration||'',
          modeFlag:!!(bankMatch&&modes.includes('cash')),
          ghostPayment:!!(paid>0&&!modes.includes('cash')&&!bankMatch),
          amountMismatch:!!(bankMatch&&Math.abs(bankMatch.credit-paid)>200),
          colls,
        };
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

      const unmatchedBank=creditTxns.filter(tx=>!tenantStatus.some(t=>{if(tx.roomHint&&t.room!=='—')return tx.roomHint===t.room.replace(/\D/g,'')&&nameScore(tx.tenantHint,t.name.split(' ')[0])>40;return nameScore(tx.tenantHint,t.name.split(' ')[0])>70;}));
      unmatchedBank.forEach(tx=>fraudFlags.push({severity:'high',type:'unmatched_bank',title:'Unmatched Bank Credit',detail:`₹${tx.credit.toLocaleString()} on ${tx.date} — "${tx.narration.slice(0,60)}" — in bank but NOT in app.`,bankNarration:tx.narration,bankAmount:tx.credit}));

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
        stats:{totalExpected,totalCollected,totalBankCredits,bankGap:Math.abs(totalBankCredits-totalCollected),
          paidCount:tenantStatus.filter(t=>t.status==='paid').length,
          partialCount:tenantStatus.filter(t=>t.status==='partial').length,
          unpaidCount:tenantStatus.filter(t=>t.status==='unpaid').length,
          fraudHigh:fraudFlags.filter(f=>f.severity==='high').length,
          fraudMedium:fraudFlags.filter(f=>f.severity==='medium').length,
          fraudLow:fraudFlags.filter(f=>f.severity==='low').length,
          collectionRate:totalExpected>0?Math.round(totalCollected/totalExpected*100):0,
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
        await supabase.from('audit_notes').insert({month:selectedMonth,note_type:noteModal.type,tenant_id:noteModal.tenantId||null,flag_reason:noteModal.reason,bank_narration:noteModal.bankNarration||null,bank_amount:noteModal.bankAmount||null,team_note:noteText,status:noteStatus,created_by:profile?.id,responded_by:profile?.id,responded_at:new Date().toISOString()});
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

  const tabs=results?[
    {id:'summary',label:'Summary'},
    {id:'flags',label:`🚨 Flags (${results.fraudFlags.length})`},
    {id:'unpaid',label:`Unpaid (${results.stats.unpaidCount+results.stats.partialCount})`},
    {id:'tenants',label:`All Tenants`},
    {id:'unmatched',label:`Bank Unmatched (${results.unmatchedBank.length})`},
    {id:'collectors',label:'Collectors'},
    {id:'buildings',label:'By Building'},
    {id:'notes',label:`Notes (${notes.length})`},
    {id:'bank',label:`Bank (${allTxns.length})`},
  ]:[];

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
            <button onClick={()=>generateTeamExcel(results.tenantStatus,notes,selectedMonth)} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4"/> Team Excel
            </button>
            <button onClick={()=>generatePDF(results,notes,selectedMonth)} className="btn-primary flex items-center gap-2">
              <FileText className="w-4 h-4"/> PDF Report
            </button>
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
            {tabs.map(t=><button key={t.id} onClick={()=>setActiveTab(t.id)} className={`tab flex-shrink-0 ${activeTab===t.id?'active':''}`}>{t.label}</button>)}
          </div>

          {/* SUMMARY */}
          {activeTab==='summary'&&(
            <div className="space-y-4">
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

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[{l:'Paid',v:results.stats.paidCount,c:'text-emerald-600',b:'border-t-emerald-400'},{l:'Partial',v:results.stats.partialCount,c:'text-amber-600',b:'border-t-amber-400'},{l:'Unpaid',v:results.stats.unpaidCount,c:'text-red-600',b:'border-t-red-400'},{l:'🚨 High',v:results.stats.fraudHigh,c:'text-red-700',b:'border-t-red-600'},{l:'⚠ Medium',v:results.stats.fraudMedium,c:'text-amber-700',b:'border-t-amber-400'},{l:'Bank Gap',v:results.unmatchedBank.length,c:results.unmatchedBank.length>0?'text-red-600':'text-emerald-600',b:results.unmatchedBank.length>0?'border-t-red-400':'border-t-emerald-400'}].map(({l,v,c,b})=>(
                  <div key={l} className={`card p-3 text-center border-t-4 ${b}`}><p className={`text-2xl font-bold ${c}`}>{v}</p><p className="text-xs text-surface-500 mt-0.5">{l}</p></div>
                ))}
              </div>

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
