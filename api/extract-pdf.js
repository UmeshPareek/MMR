// Vercel serverless function — parses HDFC/ICICI Excel bank statements
// Accepts .xlsx or .xls files encoded as base64

import * as XLSX from 'xlsx';

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

function parseHDFCExcel(rows) {
  const txns = [];
  // Find header row
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(c => String(c || '').toLowerCase());
    if (row.some(c => c.includes('date')) && row.some(c => c.includes('narration') || c.includes('description'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const header = rows[headerIdx].map(c => String(c || '').toLowerCase().trim());
  const dateIdx = header.findIndex(h => h.includes('date') && !h.includes('value'));
  const narIdx = header.findIndex(h => h.includes('narration') || h.includes('description') || h.includes('particulars'));
  const withdrawIdx = header.findIndex(h => h.includes('withdrawal') || h.includes('debit'));
  const depositIdx = header.findIndex(h => h.includes('deposit') || h.includes('credit'));

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[dateIdx]) continue;

    // Parse date — Excel serial or string
    let date = '';
    const rawDate = row[dateIdx];
    if (typeof rawDate === 'number') {
      const d = XLSX.SSF.parse_date_code(rawDate);
      date = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } else {
      const s = String(rawDate).trim();
      // DD/MM/YY or DD/MM/YYYY or DD-MM-YYYY
      const m = s.match(/(\d{1,2})[\/\-](\d{2})[\/\-](\d{2,4})/);
      if (m) {
        const yr = m[3].length === 2 ? '20' + m[3] : m[3];
        date = `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      } else continue;
    }

    const narration = String(row[narIdx] || '').trim();
    const debit = parseFloat(String(row[withdrawIdx] || '0').replace(/,/g, '')) || 0;
    const credit = parseFloat(String(row[depositIdx] || '0').replace(/,/g, '')) || 0;

    if (!narration || (credit === 0 && debit === 0)) continue;

    // Parse ATN pattern for HDFC
    const atnMatch = narration.match(/ATN-[A-Z0-9]+-([A-Z]+)(\d{3,4})(RENT|OTHERS|ELECTRICI|WATER|DEPOSIT)?/i);
    txns.push({
      date, narration, credit, debit,
      tenantHint: atnMatch?.[1]?.toLowerCase() || null,
      roomHint: atnMatch?.[2] || null,
      txnType: atnMatch?.[3]?.toLowerCase().includes('rent') ? 'rent' : credit > 0 ? 'credit' : 'debit',
    });
  }
  return txns;
}

function parseICICIExcel(rows) {
  const txns = [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(c => String(c || '').toLowerCase());
    if (row.some(c => c.includes('date')) && row.some(c => c.includes('remark') || c.includes('narration') || c.includes('description'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const header = rows[headerIdx].map(c => String(c || '').toLowerCase().trim());
  const dateIdx = header.findIndex(h => h.includes('date') && !h.includes('value'));
  const narIdx = header.findIndex(h => h.includes('remark') || h.includes('narration') || h.includes('description') || h.includes('particulars'));
  const withdrawIdx = header.findIndex(h => h.includes('withdrawal') || h.includes('debit'));
  const depositIdx = header.findIndex(h => h.includes('deposit') || h.includes('credit'));

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[dateIdx]) continue;

    let date = '';
    const rawDate = row[dateIdx];
    if (typeof rawDate === 'number') {
      const d = XLSX.SSF.parse_date_code(rawDate);
      date = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } else {
      const s = String(rawDate).trim();
      const m = s.match(/(\d{1,2})[\/\-\.](\d{2})[\/\-\.](\d{2,4})/);
      if (m) {
        const yr = m[3].length === 2 ? '20' + m[3] : m[3];
        date = `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      } else continue;
    }

    const narration = String(row[narIdx] || '').trim();
    const debit = parseFloat(String(row[withdrawIdx] || '0').replace(/,/g, '')) || 0;
    const credit = parseFloat(String(row[depositIdx] || '0').replace(/,/g, '')) || 0;

    if (!narration || (credit === 0 && debit === 0)) continue;

    const upiName = narration.match(/UPI\/([A-Za-z]+)/i);
    txns.push({
      date, narration, credit, debit,
      tenantHint: upiName?.[1]?.toLowerCase() || null,
      roomHint: null,
      txnType: narration.match(/RENTAL/i) ? 'rent' : credit > 0 ? 'credit' : 'debit',
    });
  }
  return txns;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fileBase64, bank, filename } = req.body;
  if (!fileBase64) return res.status(400).json({ error: 'No file data' });

  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (!rows || rows.length < 2) {
      return res.status(422).json({ error: 'Excel file appears empty or invalid' });
    }

    const txns = bank === 'icici' ? parseICICIExcel(rows) : parseHDFCExcel(rows);

    if (txns.length === 0) {
      return res.status(422).json({ error: 'No transactions found. Check bank type (HDFC/ICICI) is correct.' });
    }

    return res.status(200).json({ txns, rows: rows.length });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to parse Excel: ' + err.message });
  }
}
