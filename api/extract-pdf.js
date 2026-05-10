import * as XLSX from 'xlsx';

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

function parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    const y = raw.getFullYear(), m = raw.getMonth()+1, d = raw.getDate();
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const s = String(raw).trim();
  // DD/MM/YY or DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{2})[\/\-\.](\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  return null;
}

function parseAmount(raw) {
  if (!raw && raw !== 0) return 0;
  return parseFloat(String(raw).replace(/,/g, '').trim()) || 0;
}

function findHeaderRow(rows) {
  // Scan ALL rows to find the header — HDFC header can be at row 20+
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(c => String(c || '').toLowerCase().trim());
    const hasDate = row.some(c => c === 'date' || c === 'txn date' || c === 'transaction date' || c === 'value date');
    const hasNar = row.some(c => c === 'narration' || c.includes('description') || c.includes('remark') || c.includes('particulars'));
    const hasAmt = row.some(c => c.includes('withdrawal') || c.includes('deposit') || c.includes('debit') || c.includes('credit'));
    if (hasDate && hasNar && hasAmt) return i;
  }
  return 0;
}

function parseExcel(rows, bank) {
  const txns = [];
  const headerIdx = findHeaderRow(rows);
  const header = rows[headerIdx].map(c => String(c || '').toLowerCase().trim());

  const dateIdx = header.findIndex(h => h === 'date' || h === 'txn date' || h === 'transaction date' || (h.includes('date') && !h.includes('value')));
  const narIdx = header.findIndex(h => h === 'narration' || h.includes('description') || h.includes('remark') || h.includes('particulars'));
  const withdrawIdx = header.findIndex(h => h.includes('withdrawal') || (h.includes('debit') && !h.includes('credit')));
  const depositIdx = header.findIndex(h => h.includes('deposit') || (h.includes('credit') && !h.includes('debit')));

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c)) continue;
    // Skip separator rows like ****
    if (String(row[0] || '').includes('***')) continue;

    const date = parseDate(row[dateIdx]);
    if (!date) continue;

    const narration = String(row[narIdx] || '').trim();
    if (!narration) continue;

    const debit = parseAmount(row[withdrawIdx]);
    const credit = parseAmount(row[depositIdx]);
    if (credit === 0 && debit === 0) continue;

    // HDFC: pattern is RATN-XXXXXXXX0820-NAME+ROOM+TYPE (note: R before ATN)
    const atnMatch = narration.match(/R?ATN-[A-Z0-9]+-([A-Z]+)(\d{3,4})(RENT|OTHERS|ELECTRICI|WATER|DEPOSIT)?/i);
    const upiName = narration.match(/UPI\/([A-Za-z]+)/i);

    txns.push({
      date, narration, credit, debit,
      tenantHint: atnMatch?.[1]?.toLowerCase() || upiName?.[1]?.toLowerCase() || null,
      roomHint: atnMatch?.[2] || null,
      txnType: atnMatch?.[3]?.toLowerCase().includes('rent') ? 'rent'
        : narration.match(/RENTAL/i) ? 'rent'
        : credit > 0 ? 'credit' : 'debit',
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
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

    if (!rows || rows.length < 2) {
      return res.status(422).json({ error: 'File appears empty or invalid' });
    }

    const txns = parseExcel(rows, bank);

    if (txns.length === 0) {
      return res.status(422).json({ 
        error: `No transactions found. Header detected at row ${findHeaderRow(rows)}. Check bank type is HDFC or ICICI.`
      });
    }

    return res.status(200).json({ txns });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to parse: ' + err.message });
  }
}
