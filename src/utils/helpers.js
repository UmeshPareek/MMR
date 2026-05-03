import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns'
import * as XLSX from 'xlsx'

// ─── Currency formatting ───────────────────────────────────────────────────
export function formatCurrency(amount, compact = false) {
  const num = parseFloat(amount || 0)
  if (compact) {
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`
    if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

// ─── Date helpers ──────────────────────────────────────────────────────────
export function fmtDate(date) {
  if (!date) return '—'
  try {
    return format(typeof date === 'string' ? parseISO(date) : date, 'dd MMM yyyy')
  } catch { return date }
}

export function fmtMonth(yyyyMM) {
  if (!yyyyMM) return '—'
  try {
    return format(parseISO(`${yyyyMM}-01`), 'MMM yyyy')
  } catch { return yyyyMM }
}

export function currentMonth() {
  return format(new Date(), 'yyyy-MM')
}

export function monthRange(yyyyMM) {
  const d = parseISO(`${yyyyMM}-01`)
  return { start: startOfMonth(d), end: endOfMonth(d) }
}

export function lastNMonths(n = 6) {
  const months = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    months.push(format(d, 'yyyy-MM'))
  }
  return months
}

// ─── Payment mode labels ───────────────────────────────────────────────────
export const PAYMENT_MODES = {
  cash: { label: 'Cash', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  upi: { label: 'UPI', color: 'text-blue-400', bg: 'bg-blue-400/10' },
  bank_transfer: { label: 'Bank Transfer', color: 'text-green-400', bg: 'bg-green-400/10' },
  rentok: { label: 'RentOK', color: 'text-purple-400', bg: 'bg-purple-400/10' },
  crib: { label: 'Crib', color: 'text-pink-400', bg: 'bg-pink-400/10' },
  cheque: { label: 'Cheque', color: 'text-orange-400', bg: 'bg-orange-400/10' },
  online: { label: 'Online', color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  card: { label: 'Card', color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
  other: { label: 'Other', color: 'text-gray-400', bg: 'bg-gray-400/10' },
}

export const EXPENSE_CATEGORIES = [
  { value: 'marketing', label: 'Marketing', icon: '📣' },
  { value: 'wifi', label: 'WiFi / Internet', icon: '📶' },
  { value: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { value: 'cleaning', label: 'Cleaning', icon: '🧹' },
  { value: 'transport', label: 'Transport', icon: '🚗' },
  { value: 'office', label: 'Office', icon: '🏢' },
  { value: 'legal', label: 'Legal', icon: '⚖️' },
  { value: 'misc', label: 'Miscellaneous', icon: '📦' },
]

export const FLAT_STATUSES = {
  occupied: { label: 'Occupied', color: 'text-green-400', bg: 'bg-green-400/10' },
  vacant: { label: 'Vacant', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  maintenance: { label: 'Maintenance', color: 'text-red-400', bg: 'bg-red-400/10' },
}

// ─── Excel export ──────────────────────────────────────────────────────────
export function exportToExcel(data, sheetName = 'Sheet1', fileName = 'export.xlsx') {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  // Auto-width columns
  const maxWidths = {}
  data.forEach(row => {
    Object.entries(row).forEach(([key, val]) => {
      const len = Math.max(String(key).length, String(val ?? '').length)
      if (!maxWidths[key] || len > maxWidths[key]) maxWidths[key] = len
    })
  })
  ws['!cols'] = Object.values(maxWidths).map(w => ({ wch: Math.min(w + 2, 50) }))
  XLSX.writeFile(wb, fileName)
}

export function exportMultiSheet(sheets, fileName = 'report.xlsx') {
  const wb = XLSX.utils.book_new()
  sheets.forEach(({ data, name }) => {
    const ws = XLSX.utils.json_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, name)
  })
  XLSX.writeFile(wb, fileName)
}

// ─── Misc ──────────────────────────────────────────────────────────────────
export function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function initials(name = '') {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export function debounce(fn, ms = 300) {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => fn(...args), ms)
  }
}
