import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatCurrency, lastNMonths, fmtMonth } from '../utils/helpers'
import toast from 'react-hot-toast'
import { Download, RefreshCw, Building2, CheckCircle2, XCircle, AlertCircle, Filter, FileSpreadsheet, FileText } from 'lucide-react'
import ExcelJS from 'exceljs'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function Reports() {
  const months = lastNMonths(6)
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1])
  const [buildings, setBuildings] = useState([])
  const [selectedBuilding, setSelectedBuilding] = useState('all')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { loadBuildings() }, [])
  useEffect(() => { loadReport() }, [selectedMonth, selectedBuilding])

  async function loadBuildings() {
    const { data } = await supabase.from('buildings').select('id, name').order('name')
    setBuildings(data || [])
  }

  async function loadReport() {
    setLoading(true)
    setError(null)
    try {
      let q = supabase
        .from('flats')
        .select('id, door_number, floor_number, monthly_rent, building_id, buildings(name)')
        .eq('status', 'occupied')
      if (selectedBuilding !== 'all') q = q.eq('building_id', selectedBuilding)
      const { data: flats, error: flatErr } = await q
      if (flatErr) throw flatErr

      const flatIds = (flats || []).map(f => f.id)
      let tenantMap = {}
      let collMap = {}

      if (flatIds.length > 0) {
        const { data: tenants } = await supabase
          .from('tenants')
          .select('id, full_name, phone, flat_id')
          .eq('status', 'active')
          .in('flat_id', flatIds)
        ;(tenants || []).forEach(t => { tenantMap[t.flat_id] = t })

        const { data: collections } = await supabase
          .from('rent_collections')
          .select('flat_id, amount, payment_mode')
          .eq('for_month', selectedMonth)
          .in('flat_id', flatIds)
        ;(collections || []).forEach(c => {
          if (!collMap[c.flat_id]) collMap[c.flat_id] = { total: 0, modes: [] }
          collMap[c.flat_id].total += Number(c.amount) || 0
          if (c.payment_mode) collMap[c.flat_id].modes.push(c.payment_mode)
        })
      }

      const result = (flats || []).map(flat => {
        const tenant = tenantMap[flat.id]
        const coll = collMap[flat.id] || { total: 0, modes: [] }
        const expected = Number(flat.monthly_rent) || 0
        const paid = coll.total
        const balance = expected - paid
        let status = 'unpaid'
        if (paid >= expected && expected > 0) status = 'paid'
        else if (paid > 0) status = 'partial'
        return {
          id: String(flat.id),
          building: flat.buildings ? String(flat.buildings.name || '') : '—',
          doorNo: String(flat.door_number || '—'),
          tenant: tenant ? String(tenant.full_name || '—') : '—',
          phone: tenant ? String(tenant.phone || '') : '',
          expected,
          paid,
          balance,
          status,
          modes: Array.isArray(coll.modes) ? coll.modes.map(String) : [],
        }
      })

      result.sort((a, b) => a.building.localeCompare(b.building) || a.doorNo.localeCompare(b.doorNo))
      setRows(result)
    } catch (e) {
      console.error('Report error:', e)
      setError(String(e.message || 'Failed to load'))
    } finally {
      setLoading(false)
    }
  }

  async function handleExcelExport() {
    if (!rows.length) return toast.error('No data to export')
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'CashMyRent'
      wb.created = new Date()

      const ws = wb.addWorksheet('Rent Status', { views: [{ state: 'frozen', ySplit: 5 }] })

      // ── Summary header block ──────────────────────────────────────────────
      ws.mergeCells('A1:H1')
      ws.getCell('A1').value = 'CashMyRent — Rent Collection Report'
      ws.getCell('A1').font = { name: 'Calibri', bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
      ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2E4A' } }
      ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' }
      ws.getRow(1).height = 28

      ws.mergeCells('A2:H2')
      ws.getCell('A2').value = `Period: ${fmtMonth(selectedMonth)}   |   Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
      ws.getCell('A2').font = { name: 'Calibri', size: 10, color: { argb: 'FFCBD5E1' } }
      ws.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF243347' } }
      ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' }
      ws.getRow(2).height = 20

      // ── Summary stats row ─────────────────────────────────────────────────
      const statLabels = ['Total Flats', 'Fully Paid', 'Partial', 'Unpaid', 'Expected', 'Collected', 'Balance', 'Collection %']
      const paidCount = rows.filter(r => r.status === 'paid').length
      const partialCount = rows.filter(r => r.status === 'partial').length
      const unpaidCount = rows.filter(r => r.status === 'unpaid').length
      const totalExpected = rows.reduce((s, r) => s + r.expected, 0)
      const totalPaid = rows.reduce((s, r) => s + r.paid, 0)
      const totalBalance = totalExpected - totalPaid
      const collRate = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0
      const statValues = [rows.length, paidCount, partialCount, unpaidCount, totalExpected, totalPaid, totalBalance, collRate + '%']

      const lblRow = ws.addRow(statLabels)
      lblRow.height = 18
      lblRow.eachCell(cell => {
        cell.font = { name: 'Calibri', bold: true, size: 9, color: { argb: 'FF94A3B8' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      })

      const valRow = ws.addRow(statValues)
      valRow.height = 22
      valRow.eachCell((cell, colIdx) => {
        cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        if (colIdx === 6) cell.font = { ...cell.font, color: { argb: 'FF4ADE80' } }
        if (colIdx === 7) cell.font = { ...cell.font, color: { argb: 'FFFBBF24' } }
        if (colIdx === 8) cell.numFmt = '0%'
      })

      // ── Table header ──────────────────────────────────────────────────────
      const headers = ['Building', 'Door No', 'Tenant', 'Phone', 'Expected (₹)', 'Paid (₹)', 'Balance (₹)', 'Status', 'Payment Mode']
      const hRow = ws.addRow(headers)
      hRow.height = 22
      hRow.eachCell(cell => {
        cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FF14B8A6' } }
        }
      })

      // ── Data rows ─────────────────────────────────────────────────────────
      const STATUS_COLORS = {
        paid:    { fg: 'FFD1FAE5', font: 'FF065F46', badge: 'PAID' },
        partial: { fg: 'FFFEF3C7', font: 'FF92400E', badge: 'PARTIAL' },
        unpaid:  { fg: 'FFFEE2E2', font: 'FF991B1B', badge: 'UNPAID' },
      }

      rows.forEach((r, i) => {
        const rowData = [
          r.building, r.doorNo, r.tenant, r.phone,
          r.expected, r.paid, r.balance > 0 ? r.balance : 0,
          STATUS_COLORS[r.status]?.badge || r.status.toUpperCase(),
          r.modes.join(', ') || '—',
        ]
        const dataRow = ws.addRow(rowData)
        dataRow.height = 20
        const rowBg = i % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF'

        dataRow.eachCell((cell, colIdx) => {
          cell.font = { name: 'Calibri', size: 10 }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } }
          cell.alignment = { vertical: 'middle' }
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }

          if (colIdx === 8) {
            const sc = STATUS_COLORS[r.status]
            if (sc) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.fg } }
              cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: sc.font } }
              cell.alignment = { horizontal: 'center', vertical: 'middle' }
            }
          }
          if ([5, 6, 7].includes(colIdx)) {
            cell.numFmt = '#,##0'
            cell.alignment = { horizontal: 'right', vertical: 'middle' }
            if (colIdx === 6 && r.paid > 0) cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF059669' } }
            if (colIdx === 7 && r.balance > 0) cell.font = { name: 'Calibri', size: 10, color: { argb: 'FFDC2626' } }
          }
        })
      })

      // ── Totals row ────────────────────────────────────────────────────────
      const totRow = ws.addRow(['', '', '', 'TOTAL', totalExpected, totalPaid, totalBalance > 0 ? totalBalance : 0, '', ''])
      totRow.height = 22
      totRow.eachCell((cell, colIdx) => {
        cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
        cell.alignment = { vertical: 'middle' }
        if ([5, 6, 7].includes(colIdx)) {
          cell.numFmt = '#,##0'
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
        }
        if (colIdx === 4) cell.alignment = { horizontal: 'right', vertical: 'middle' }
        cell.border = { top: { style: 'thin', color: { argb: 'FF0F766E' } } }
      })

      // ── Column widths ─────────────────────────────────────────────────────
      ws.columns = [
        { width: 22 }, { width: 10 }, { width: 24 }, { width: 16 },
        { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 18 },
      ]

      // ── Auto-filter on header ──────────────────────────────────────────────
      ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: 9 } }

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `rent-report-${selectedMonth}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      toast.success('Excel exported!')
    } catch (e) {
      console.error(e)
      toast.error('Excel export failed')
    }
  }

  function handlePdfExport() {
    if (!rows.length) return toast.error('No data to export')
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()

      // ── Header band ───────────────────────────────────────────────────────
      doc.setFillColor(26, 46, 74)
      doc.rect(0, 0, pageW, 22, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text('CashMyRent', 14, 10)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(148, 163, 184)
      doc.text('Rent Collection Report', 14, 17)
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(10)
      doc.text(`Period: ${fmtMonth(selectedMonth)}`, pageW - 14, 10, { align: 'right' })
      doc.setFontSize(8)
      doc.setTextColor(148, 163, 184)
      doc.text(`Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, pageW - 14, 17, { align: 'right' })

      // ── Summary cards ─────────────────────────────────────────────────────
      const paidCount = rows.filter(r => r.status === 'paid').length
      const partialCount = rows.filter(r => r.status === 'partial').length
      const unpaidCount = rows.filter(r => r.status === 'unpaid').length
      const totalExpected = rows.reduce((s, r) => s + r.expected, 0)
      const totalPaid = rows.reduce((s, r) => s + r.paid, 0)
      const collRate = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0

      const cards = [
        { label: 'Total Flats', value: String(rows.length), color: [15, 118, 110] },
        { label: 'Fully Paid', value: String(paidCount), color: [5, 150, 105] },
        { label: 'Partial', value: String(partialCount), color: [217, 119, 6] },
        { label: 'Unpaid', value: String(unpaidCount), color: [220, 38, 38] },
        { label: 'Expected', value: formatCurrency(totalExpected), color: [51, 65, 85] },
        { label: 'Collected', value: formatCurrency(totalPaid), color: [5, 150, 105] },
        { label: 'Collection Rate', value: collRate + '%', color: [15, 118, 110] },
      ]

      const cardW = (pageW - 28) / cards.length
      cards.forEach((card, i) => {
        const x = 14 + i * cardW
        doc.setFillColor(30, 41, 59)
        doc.roundedRect(x, 26, cardW - 2, 16, 2, 2, 'F')
        doc.setFontSize(7)
        doc.setTextColor(148, 163, 184)
        doc.setFont('helvetica', 'normal')
        doc.text(card.label, x + (cardW - 2) / 2, 31, { align: 'center' })
        doc.setFontSize(10)
        doc.setTextColor(...card.color)
        doc.setFont('helvetica', 'bold')
        doc.text(card.value, x + (cardW - 2) / 2, 38, { align: 'center' })
      })

      // ── Table ─────────────────────────────────────────────────────────────
      const STATUS_STYLES = {
        paid:    { textColor: [5, 150, 105],  fillColor: [209, 250, 229] },
        partial: { textColor: [146, 64,  14],  fillColor: [254, 243, 199] },
        unpaid:  { textColor: [153, 27,  27],  fillColor: [254, 226, 226] },
      }

      autoTable(doc, {
        startY: 46,
        head: [['Building', 'Door No', 'Tenant', 'Phone', 'Expected (₹)', 'Paid (₹)', 'Balance (₹)', 'Status', 'Mode']],
        body: rows.map(r => [
          r.building, r.doorNo, r.tenant, r.phone,
          r.expected.toLocaleString('en-IN'),
          r.paid.toLocaleString('en-IN'),
          r.balance > 0 ? r.balance.toLocaleString('en-IN') : '—',
          r.status.toUpperCase(),
          r.modes.join(', ') || '—',
        ]),
        foot: [['', '', '', 'TOTAL',
          totalExpected.toLocaleString('en-IN'),
          totalPaid.toLocaleString('en-IN'),
          (totalExpected - totalPaid > 0 ? (totalExpected - totalPaid) : 0).toLocaleString('en-IN'),
          '', '']],
        headStyles: {
          fillColor: [15, 118, 110],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
          halign: 'center',
        },
        footStyles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        columnStyles: {
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'center' },
        },
        bodyStyles: { fontSize: 8, cellPadding: 2.5 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didParseCell(data) {
          if (data.section === 'body' && data.column.index === 7) {
            const raw = rows[data.row.index]
            const st = STATUS_STYLES[raw?.status]
            if (st) {
              data.cell.styles.fillColor = st.fillColor
              data.cell.styles.textColor = st.textColor
              data.cell.styles.fontStyle = 'bold'
            }
          }
          if (data.section === 'body' && data.column.index === 5) {
            const raw = rows[data.row.index]
            if (raw?.paid > 0) data.cell.styles.textColor = [5, 150, 105]
          }
          if (data.section === 'body' && data.column.index === 6) {
            const raw = rows[data.row.index]
            if (raw?.balance > 0) data.cell.styles.textColor = [220, 38, 38]
          }
        },
        margin: { left: 14, right: 14 },
        tableLineColor: [226, 232, 240],
        tableLineWidth: 0.1,
      })

      // ── Footer on each page ───────────────────────────────────────────────
      const pageCount = doc.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFillColor(15, 23, 42)
        doc.rect(0, doc.internal.pageSize.getHeight() - 8, pageW, 8, 'F')
        doc.setFontSize(7)
        doc.setTextColor(100, 116, 139)
        doc.setFont('helvetica', 'normal')
        doc.text('CashMyRent Platform — Confidential', 14, doc.internal.pageSize.getHeight() - 3)
        doc.text(`Page ${i} of ${pageCount}`, pageW - 14, doc.internal.pageSize.getHeight() - 3, { align: 'right' })
      }

      doc.save(`rent-report-${selectedMonth}.pdf`)
      toast.success('PDF exported!')
    } catch (e) {
      console.error(e)
      toast.error('PDF export failed')
    }
  }

  const totalExpected = rows.reduce((s, r) => s + r.expected, 0)
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0)
  const paidCount = rows.filter(r => r.status === 'paid').length
  const partialCount = rows.filter(r => r.status === 'partial').length
  const unpaidCount = rows.filter(r => r.status === 'unpaid').length
  const collRate = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-surface-900">Reports</h1>
          <p className="text-surface-400 text-sm mt-0.5">Building-wise rent collection status</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExcelExport} className="btn-secondary flex items-center gap-2">
            <FileSpreadsheet size={15} className="text-emerald-500" /> Export Excel
          </button>
          <button onClick={handlePdfExport} className="btn-primary flex items-center gap-2">
            <FileText size={15} /> Export PDF
          </button>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap gap-4 items-end">
        <Filter className="w-4 h-4 text-surface-400 self-center" />
        <div>
          <label className="label text-xs mb-1">Month</label>
          <select className="select" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs mb-1">Building</label>
          <select className="select" value={selectedBuilding} onChange={e => setSelectedBuilding(e.target.value)}>
            <option value="all">All Buildings</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button onClick={loadReport} className="btn-ghost flex items-center gap-1.5 text-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-brand-500" /><span className="text-xs text-surface-400">Total Flats</span></div>
          <p className="text-2xl font-display font-bold text-surface-900">{rows.length}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><CheckCircle2 className="w-4 h-4 text-green-400" /><span className="text-xs text-surface-400">Fully Paid</span></div>
          <p className="text-2xl font-display font-bold text-green-400">{paidCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><AlertCircle className="w-4 h-4 text-amber-400" /><span className="text-xs text-surface-400">Partial</span></div>
          <p className="text-2xl font-display font-bold text-amber-400">{partialCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><XCircle className="w-4 h-4 text-red-400" /><span className="text-xs text-surface-400">Unpaid</span></div>
          <p className="text-2xl font-display font-bold text-red-400">{unpaidCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Expected</p>
          <p className="text-xl font-display font-bold text-surface-900">{formatCurrency(totalExpected)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Collected</p>
          <p className="text-xl font-display font-bold text-green-400">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-400 mb-1">Collection Rate</p>
          <div className="flex items-baseline gap-2">
            <p className="text-xl font-display font-bold text-brand-500">{collRate}%</p>
            <p className="text-xs text-surface-500">{formatCurrency(totalPaid)} / {formatCurrency(totalExpected)}</p>
          </div>
          <div className="mt-2 h-1.5 bg-surface-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: collRate + '%', background: collRate >= 80 ? '#10b981' : collRate >= 50 ? '#f59e0b' : '#ef4444' }}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-4 border border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm font-mono">{error}</p>
          <button onClick={loadReport} className="text-xs text-red-300 underline mt-1">Retry</button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-200 flex items-center justify-between">
          <h3 className="font-semibold text-surface-700">Flat-wise Rent Status</h3>
          <span className="text-xs text-surface-500">{rows.length} flats · {fmtMonth(selectedMonth)}</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 && !error ? (
          <div className="text-center py-16">
            <Building2 className="w-10 h-10 text-surface-500 mx-auto mb-3" />
            <p className="text-surface-400 text-sm">No occupied flats found for this period</p>
            <p className="text-surface-500 text-xs mt-1">Add buildings, flats and tenants first</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th>Door No</th>
                  <th>Tenant</th>
                  <th className="text-right">Expected</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Balance</th>
                  <th>Status</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="font-medium text-surface-700">{row.building}</td>
                    <td className="font-mono text-sm">{row.doorNo}</td>
                    <td>
                      <div className="text-surface-700">{row.tenant}</div>
                      {row.phone && <div className="text-xs text-surface-400">{row.phone}</div>}
                    </td>
                    <td className="text-right font-mono text-sm">{formatCurrency(row.expected)}</td>
                    <td className="text-right font-mono text-sm text-green-500">{formatCurrency(row.paid)}</td>
                    <td className="text-right font-mono text-sm" style={{ color: row.balance > 0 ? '#ef4444' : '#94a3b8' }}>
                      {row.balance > 0 ? formatCurrency(row.balance) : '—'}
                    </td>
                    <td>
                      {row.status === 'paid' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                          <CheckCircle2 size={10} /> PAID
                        </span>
                      )}
                      {row.status === 'partial' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                          <AlertCircle size={10} /> PARTIAL
                        </span>
                      )}
                      {row.status === 'unpaid' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
                          <XCircle size={10} /> UNPAID
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-surface-400">{row.modes.length > 0 ? row.modes.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-surface-200 bg-surface-50">
                  <td colSpan="3" className="px-4 py-3 text-surface-500 text-sm font-semibold">Total ({rows.length} flats)</td>
                  <td className="px-4 py-3 text-right font-bold text-surface-800 font-mono text-sm">{formatCurrency(totalExpected)}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-500 font-mono text-sm">{formatCurrency(totalPaid)}</td>
                  <td className="px-4 py-3 text-right font-bold font-mono text-sm" style={{ color: totalExpected - totalPaid > 0 ? '#ef4444' : '#94a3b8' }}>
                    {totalExpected - totalPaid > 0 ? formatCurrency(totalExpected - totalPaid) : '—'}
                  </td>
                  <td colSpan="2" className="px-4 py-3 text-surface-500 text-sm">{collRate}% collected</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
