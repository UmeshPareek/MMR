import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, fmtDate } from '@/utils/helpers'
import { Modal, Spinner, EmptyState, ConfirmDialog } from '@/components/ui'
import { LogOut, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function getFloor(doorNumber) {
  if (!doorNumber) return 'Ground / Other'
  const num = doorNumber.toString().replace(/[^0-9]/g, '')
  if (!num) return doorNumber.toString().charAt(0).toUpperCase() + ' Block'
  const floorNum = Math.floor(parseInt(num) / 100)
  if (floorNum === 0) return 'Ground Floor'
  return 'Floor ' + floorNum
}

export default function CheckOut() {
  const { profile, org } = useAuth()
  const channelRef = useRef(null)
  const [tenants, setTenants] = useState([])
  const [recentExits, setRecentExits] = useState([])
  const [tab, setTab] = useState('active')
  const [loading, setLoading] = useState(true)
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0,7))
  const [stats, setStats] = useState({ totalExits:0, normalExits:0, runaways:0, depositHeld:0, deductions:0, refunds:0 })
  const [modal, setModal] = useState(false)
  const [selected, setSelected] = useState(null)
  const [coType, setCoType] = useState('good')
  const [form, setForm] = useState({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })
  const [saving, setSaving] = useState(false)
  const [outstandingRent, setOutstandingRent] = useState(0)
  const [loadingOutstanding, setLoadingOutstanding] = useState(false)
  const [filterBuilding, setFilterBuilding] = useState('')
  const [buildings, setBuildings] = useState([])
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [orgContact, setOrgContact] = useState({ phone: '—', email: '—', website: '—' })

  useEffect(() => {
    supabase.from('master_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['org_phone', 'org_email', 'org_website'])
      .then(({ data }) => {
        if (data?.length) {
          const m = {}
          data.forEach(r => { m[r.setting_key] = r.setting_value })
          setOrgContact({ phone: m.org_phone || '—', email: m.org_email || '—', website: m.org_website || '—' })
        }
      })
  }, [])

  useEffect(() => {
    loadAll()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase.channel('checkout-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flats' }, () => loadAll())
      .subscribe()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [filterMonth])

  async function loadAll() {
    setLoading(true)
    try {
      // Use same pattern as working Tenants page — select * then join manually
      const [{ data: b }, { data: t }, { data: ex }, { data: allFlats }, { data: allBuildings }] = await Promise.all([
        supabase.from('buildings').select('id,name').eq('is_active', true).order('name'),
        supabase.from('tenants').select('*').eq('status','active').order('building_id').order('full_name'),
        supabase.from('tenants').select('*').eq('status','vacated').order('move_out_date', { ascending: false }).limit(50),
        supabase.from('flats').select('id,door_number'),
        supabase.from('buildings').select('id,name'),
      ])

      const flatMap = {}
      ;(allFlats||[]).forEach(f => { flatMap[f.id] = f })
      const buildingMap = {}
      ;(allBuildings||[]).forEach(b => { buildingMap[b.id] = b })

      const enrich = arr => (arr||[]).map(t => ({
        ...t,
        flat: flatMap[t.flat_id] || null,
        building: buildingMap[t.building_id] || null,
      }))

      setBuildings(b || [])
      setTenants(enrich(t))
      const enrichedExits = enrich(ex)
      setRecentExits(enrichedExits)

      // Compute monthly stats from exits
      const monthExits = enrichedExits.filter(t => t.move_out_date?.slice(0,7) === filterMonth)
      const runaways = monthExits.filter(t => t.notes?.includes('RUNAWAY'))
      const depositTotal = monthExits.reduce((s,t) => s + (parseFloat(t.security_deposit_paid)||0), 0)
      setStats({
        totalExits: monthExits.length,
        normalExits: monthExits.length - runaways.length,
        runaways: runaways.length,
        depositHeld: depositTotal,
      })
    } catch {
      toast.error('Failed to load tenants')
    }
    setLoading(false)
  }

  function deleteExit(t) {
    setConfirmDialog({
      title: 'Undo Exit?',
      message: `Restore ${t.full_name} as active tenant? Their flat will be marked occupied again.`,
      danger: false,
      onConfirm: async () => {
        const { error } = await supabase.from('tenants').update({ status:'active', move_out_date: null, notes: null }).eq('id', t.id)
        if (error) { toast.error(error.message); return }
        if (t.flat_id) {
          const { data: currentFlat } = await supabase.from('flats').select('current_tenant_id, status').eq('id', t.flat_id).single()
          if (currentFlat && (currentFlat.status === 'vacant' || currentFlat.current_tenant_id === null)) {
            await supabase.from('flats').update({ status:'occupied', current_tenant_id: t.id }).eq('id', t.flat_id)
          } else {
            toast.error('Flat has already been re-assigned — please update manually')
          }
        }
        toast.success('Exit reversed — tenant restored as active ✓')
        setConfirmDialog(null)
        loadAll()
      }
    })
  }

  function deleteCheckin(t) {
    setConfirmDialog({
      title: 'Remove Tenant Record?',
      message: `Mark ${t.full_name} as vacated? Their flat will be restored to vacant. The record is preserved for audit.`,
      danger: true,
      onConfirm: async () => {
        const today = new Date().toISOString().slice(0, 10)
        const { error } = await supabase.from('tenants')
          .update({ status: 'vacated', move_out_date: today, notes: 'Removed via checkout page' })
          .eq('id', t.id)
        if (error) { toast.error(error.message); return }
        if (t.flat_id) await supabase.from('flats').update({ status: 'vacant', current_tenant_id: null }).eq('id', t.flat_id)
        toast.success('Tenant marked vacated — record preserved for audit ✓')
        setConfirmDialog(null)
        loadAll()
      }
    })
  }

  async function fetchOutstandingRent(tenantId) {
    setLoadingOutstanding(true)
    const currentMonth = new Date().toISOString().slice(0,7)
    const prevMonth = new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,7)
    // Check if rent collected for current and previous month
    const { data: paid } = await supabase.from('rent_collections')
      .select('amount, for_month')
      .eq('tenant_id', tenantId)
      .in('for_month', [currentMonth, prevMonth])
    const { data: tenant } = await supabase.from('tenants').select('monthly_rent').eq('id', tenantId).single()
    const monthlyRent = parseFloat(tenant?.monthly_rent || 0)
    // Calculate unpaid months
    const paidMonths = new Set((paid||[]).map(p => p.for_month))
    let unpaid = 0
    if (!paidMonths.has(currentMonth)) unpaid += monthlyRent
    if (!paidMonths.has(prevMonth)) unpaid += monthlyRent
    setOutstandingRent(unpaid)
    setLoadingOutstanding(false)
    return unpaid
  }

  function openCheckout(t) {
    setSelected(t)
    setCoType('good')
    setOutstandingRent(0)
    setModal(true)
    // Async fetch outstanding rent and auto-fill
    fetchOutstandingRent(t.id).then(unpaid => {
      setForm(p => ({ ...p, outstanding_rent: String(unpaid) }))
    })
    setForm({ cleaning:'0', painting:'0', repair:'0', other:'0', outstanding_rent:'0', collected_at_exit:'0', exit_date: new Date().toISOString().slice(0,10), notes:'' })
  }

  async function saveCheckout() {
    if (!selected) return
    setSaving(true)
    const deductions = ['cleaning','painting','repair','other','outstanding_rent'].reduce((s,k)=>s+(parseFloat(form[k])||0),0)
    const deposit = parseFloat(selected.security_deposit_paid)||0
    const netRefund = deposit - deductions
    const exitNotes = `TYPE:${coType==='bad'?'RUNAWAY':'Normal'}|Date:${form.exit_date}|Deposit:${deposit}|Deductions:${deductions}|Net:${netRefund}|Collected:${form.collected_at_exit}|${form.notes}`
    
    const { error } = await supabase.from('tenants').update({ status:'vacated', move_out_date: form.exit_date, notes: exitNotes }).eq('id', selected.id)
    if (error) { setSaving(false); return toast.error(error.message) }

    // Free the flat
    await supabase.from('flats').update({ status:'vacant', current_tenant_id: null }).eq('id', selected.flat_id)

    // Insert a refund/settlement record in security_deposits page
    await supabase.from('security_deposits').insert({
      tenant_id: selected.id,
      flat_id: selected.flat_id || null,
      building_id: selected.building_id,
      amount: Math.abs(netRefund),
      payment_mode: 'adjustment',
      deposit_date: form.exit_date,
      deposit_type: 'refund',
      notes: `EXIT SETTLEMENT | Deposit held: ₹${(selected.security_deposit_paid||0).toLocaleString('en-IN')} | Deductions: ₹${deductions.toLocaleString('en-IN')} | Net: ${netRefund >= 0 ? 'Refund' : 'Loss'} ₹${Math.abs(netRefund).toLocaleString('en-IN')} | ${form.notes || ''}`.trim(),
      collected_by: null,
      org_id: selected.org_id,
    })

    setSaving(false)
    const msg = netRefund >= 0
      ? `Checkout done ✓ — Refund ₹${netRefund.toLocaleString('en-IN')} to tenant`
      : `Checkout done ✓ — Net loss ₹${Math.abs(netRefund).toLocaleString('en-IN')} (deposit forfeited)`
    toast.success(msg)
    if (coType === 'bad') generateLegalNotice(
      {
        ...selected,
        outstanding_rent:  form.outstanding_rent,
        cleaning_charge:   form.cleaning,
        repair_charge:     form.painting,
        other_charge:      form.other,
      },
      deductions,
      netRefund
    )
    setModal(false); setSelected(null); loadAll()
  }

  function generateLegalNotice(t, totalDue, netRefund) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = 210, H = 297
    const margin = 16
    const orgName = org?.name || 'Rent N Stay'
    const today = new Date()
    const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    const refNum = `LN-${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}-${Math.floor(1000+Math.random()*9000)}`
    const deposit = parseFloat(t.security_deposit_paid) || 0

    // ── Colours ────────────────────────────────────────────────────
    const NAVY   = [15, 40, 80]
    const CRIMSON= [180, 20, 20]
    const LGRAY  = [245, 246, 248]
    const MGRAY  = [200, 205, 215]
    const DKGRAY = [60, 65, 75]

    // ── HEADER BAND ────────────────────────────────────────────────
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, W, 30, 'F')

    // Thin gold accent line under header
    doc.setFillColor(180, 140, 40)
    doc.rect(0, 30, W, 1.2, 'F')

    // "LEGAL NOTICE" text
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.text('LEGAL NOTICE', W / 2, 16, { align: 'center' })

    // Subtitle
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(180, 200, 230)
    doc.text('NOTICE OF OUTSTANDING DUES AND DEMAND FOR PAYMENT', W / 2, 24, { align: 'center' })

    // ── ORG BRAND BLOCK (top-right inside header) ──────────────────
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    // (already centred — org name goes in the meta block below)

    // ── META ROW (ref + date) ──────────────────────────────────────
    let y = 40
    doc.setFillColor(...LGRAY)
    doc.rect(margin, y, W - margin * 2, 14, 'F')
    doc.setDrawColor(...MGRAY)
    doc.rect(margin, y, W - margin * 2, 14, 'S')

    doc.setTextColor(...DKGRAY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(`REF NO: ${refNum}`, margin + 4, y + 5.5)
    doc.setFont('helvetica', 'normal')
    doc.text(`Date of Issue: ${dateStr}`, margin + 4, y + 11)

    doc.setFont('helvetica', 'bold')
    doc.text('Mode of Service: Registered Post / WhatsApp', W - margin - 4, y + 5.5, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.text(`Property: Flat ${t.flat?.door_number || '—'}, ${t.building?.name || '—'}`, W - margin - 4, y + 11, { align: 'right' })

    y += 22

    // ── FROM / TO COLUMNS ──────────────────────────────────────────
    const colW = (W - margin * 2 - 8) / 2

    // FROM box
    doc.setFillColor(...NAVY)
    doc.roundedRect(margin, y, colW, 6, 1, 1, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('FROM (SENDER)', margin + 4, y + 4.2)

    doc.setFillColor(250, 251, 253)
    doc.setDrawColor(...MGRAY)
    doc.roundedRect(margin, y + 6, colW, 30, 1, 1, 'FD')
    doc.setTextColor(...DKGRAY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(orgName, margin + 4, y + 13)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text('Property Management Services', margin + 4, y + 19)
    if (orgContact.phone !== '—') doc.text(`Ph: ${orgContact.phone}`, margin + 4, y + 25)
    if (orgContact.email !== '—') doc.text(`E: ${orgContact.email}`, margin + 4, y + 31)
    if (orgContact.website !== '—' && orgContact.website !== orgName) doc.text(`W: ${orgContact.website}`, margin + 4, y + 37)

    // TO box
    const col2X = margin + colW + 8
    doc.setFillColor(...CRIMSON)
    doc.roundedRect(col2X, y, colW, 6, 1, 1, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('TO (RECIPIENT)', col2X + 4, y + 4.2)

    doc.setFillColor(255, 250, 250)
    doc.setDrawColor(220, 150, 150)
    doc.roundedRect(col2X, y + 6, colW, 30, 1, 1, 'FD')
    doc.setTextColor(...DKGRAY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(t.full_name, col2X + 4, y + 13)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(`Flat ${t.flat?.door_number || '—'}, ${t.building?.name || '—'}`, col2X + 4, y + 19)
    if (t.phone) doc.text(`Ph: ${t.phone}`, col2X + 4, y + 25)
    if (t.email) doc.text(`E: ${t.email}`, col2X + 4, y + 31)

    y += 44

    // ── SUBJECT LINE ───────────────────────────────────────────────
    doc.setFillColor(255, 243, 205)
    doc.setDrawColor(200, 160, 40)
    doc.roundedRect(margin, y, W - margin * 2, 10, 1, 1, 'FD')
    doc.setTextColor(100, 60, 0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.text(
      `SUBJECT: Outstanding Dues & Unauthorized Vacation — Flat ${t.flat?.door_number || '—'}, ${t.building?.name || '—'}`,
      margin + 4, y + 6.8
    )

    y += 17

    // ── OPENING BODY ───────────────────────────────────────────────
    doc.setTextColor(...DKGRAY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    const openPara = [
      `This legal notice is issued by ${orgName} (hereinafter referred to as "the Management") on`,
      `behalf of the landlord/property owner of the above-mentioned premises.`,
      ``,
      `It is hereby brought to your notice that you, ${t.full_name}, a former tenant at Flat`,
      `${t.flat?.door_number || '—'}, ${t.building?.name || '—'}, have VACATED the said premises WITHOUT PROPER`,
      `NOTICE and WITHOUT CLEARING the outstanding dues as detailed below.`,
    ]
    openPara.forEach(line => {
      doc.text(line, margin, y)
      y += 5.5
    })

    y += 4

    // ── FINANCIAL STATEMENT TABLE ──────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...NAVY)
    doc.text('FINANCIAL STATEMENT OF DUES', margin, y)
    y += 3

    const tableRows = [
      ['Security Deposit Received', `₹${deposit.toLocaleString('en-IN')}`, 'Amount held by Management'],
      ['Outstanding Rent', `₹${(parseFloat(t.outstanding_rent || 0)).toLocaleString('en-IN')}`, 'Unpaid rent dues'],
      ['Cleaning / Maintenance', `₹${(parseFloat(t.cleaning_charge || 0)).toLocaleString('en-IN')}`, 'Property cleaning post-vacation'],
      ['Painting & Repairs', `₹${(parseFloat(t.repair_charge || 0)).toLocaleString('en-IN')}`, 'Damage restoration'],
      ['Other Deductions', `₹${(parseFloat(t.other_charge || 0)).toLocaleString('en-IN')}`, 'Miscellaneous dues'],
    ]

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Description', 'Amount (INR)', 'Remarks']],
      body: tableRows,
      foot: [[
        { content: `NET AMOUNT PAYABLE BY YOU`, styles: { fontStyle: 'bold', textColor: [180, 20, 20] } },
        { content: `₹${Math.abs(netRefund).toLocaleString('en-IN')}`, styles: { fontStyle: 'bold', textColor: [180, 20, 20] } },
        { content: 'To be paid within 15 days', styles: { fontStyle: 'bold', textColor: [180, 20, 20] } },
      ]],
      headStyles: {
        fillColor: NAVY,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      bodyStyles: { fontSize: 8.5, textColor: DKGRAY },
      footStyles: {
        fillColor: [255, 235, 235],
        fontSize: 9,
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: LGRAY },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 38, halign: 'right' },
        2: { cellWidth: 'auto' },
      },
      tableLineColor: MGRAY,
      tableLineWidth: 0.3,
    })

    y = doc.lastAutoTable.finalY + 8

    // ── DEMAND NOTICE BOX ──────────────────────────────────────────
    doc.setFillColor(255, 240, 240)
    doc.setDrawColor(...CRIMSON)
    doc.roundedRect(margin, y, W - margin * 2, 20, 2, 2, 'FD')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...CRIMSON)
    doc.text('DEMAND NOTICE', margin + 4, y + 7)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(80, 20, 20)
    const demandText = `You are hereby legally directed to pay ₹${Math.abs(netRefund).toLocaleString('en-IN')} (Rupees ${numberToWords(Math.abs(netRefund))} Only) to ${orgName} within FIFTEEN (15) DAYS from the date of receipt of this notice.`
    const demandLines = doc.splitTextToSize(demandText, W - margin * 2 - 8)
    doc.text(demandLines, margin + 4, y + 14)
    y += demandLines.length * 5 + 18

    // ── CONSEQUENCES ───────────────────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...NAVY)
    doc.text('CONSEQUENCES OF NON-COMPLIANCE', margin, y)
    y += 5

    const consequences = [
      'Filing of a First Information Report (FIR) for cheating, fraud and breach of rental contract under applicable IPC sections.',
      'Institution of civil proceedings for recovery of dues along with 18% per annum interest and full legal costs.',
      'Reporting to CIBIL, credit bureaus and national tenant-blacklist databases maintained by rental networks.',
      'Issuance of notice to your employer, guarantors and emergency contacts as applicable.',
      'Further legal action including attachment of assets as deemed appropriate under Indian law.',
    ]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.8)
    doc.setTextColor(...DKGRAY)
    consequences.forEach((c, i) => {
      const lines = doc.splitTextToSize(`${i+1}.  ${c}`, W - margin * 2 - 6)
      doc.text(lines, margin + 4, y)
      y += lines.length * 5 + 1.5
    })

    y += 4

    // ── WITHOUT PREJUDICE FOOTER LINE ─────────────────────────────
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 130)
    const woPara = `This notice is issued strictly without prejudice to all legal rights and remedies available to ${orgName} and the property owner under applicable laws of India. If payment or a satisfactory response is not received within the stipulated period, further legal action will be initiated without any further notice.`
    const woLines = doc.splitTextToSize(woPara, W - margin * 2)
    doc.text(woLines, margin, y)
    y += woLines.length * 4.5 + 6

    // ── SIGNATURE BLOCK ────────────────────────────────────────────
    doc.setDrawColor(...MGRAY)
    doc.line(margin, y, W - margin, y)
    y += 6

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...DKGRAY)
    doc.text('Yours faithfully,', margin, y)
    y += 12
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text(`For ${orgName}`, margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...DKGRAY)
    doc.text('Authorised Signatory / Property Manager', margin, y)
    y += 4
    if (orgContact.phone !== '—') doc.text(`Ph: ${orgContact.phone}  |  E: ${orgContact.email}`, margin, y)

    // ── FOOTER BAND ────────────────────────────────────────────────
    doc.setFillColor(...NAVY)
    doc.rect(0, H - 14, W, 14, 'F')
    doc.setTextColor(160, 180, 210)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(`${orgName}  ·  Legal Notice  ·  Ref: ${refNum}  ·  Generated: ${dateStr}`, W / 2, H - 5.5, { align: 'center' })

    // ── "LEGAL NOTICE" DIAGONAL WATERMARK ─────────────────────────
    doc.setTextColor(225, 230, 240)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(54)
    doc.setGState(doc.GState({ opacity: 0.06 }))
    doc.text('LEGAL NOTICE', W / 2, H / 2 + 20, { align: 'center', angle: 45 })
    doc.setGState(doc.GState({ opacity: 1 }))

    doc.save(`LegalNotice_${refNum}_${t.full_name.replace(/\s+/g,'_')}.pdf`)
    toast.success('Legal notice PDF generated ✓')
  }

  // ── Helper: number to words (Indian) ──────────────────────────
  function numberToWords(num) {
    if (!num || isNaN(num)) return 'Zero'
    const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
      'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
    const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
    function convert(n) {
      if (n < 20) return ones[n]
      if (n < 100) return tens[Math.floor(n/10)] + (n%10?' '+ones[n%10]:'')
      if (n < 1000) return ones[Math.floor(n/100)]+' Hundred'+(n%100?' '+convert(n%100):'')
      if (n < 100000) return convert(Math.floor(n/1000))+' Thousand'+(n%1000?' '+convert(n%1000):'')
      if (n < 10000000) return convert(Math.floor(n/100000))+' Lakh'+(n%100000?' '+convert(n%100000):'')
      return convert(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+convert(n%10000000):'')
    }
    const n = Math.floor(num)
    const paise = Math.round((num - n) * 100)
    return convert(n) + (paise > 0 ? ` and ${convert(paise)} Paise` : '')
  }

  const totalDed = ['cleaning','painting','repair','other','outstanding_rent'].reduce((s,k)=>s+(parseFloat(form[k])||0),0)
  const netRefund = selected ? ((parseFloat(selected.security_deposit_paid)||0) - totalDed) : 0
  const filtered = filterBuilding ? tenants.filter(t=>t.building_id===filterBuilding) : tenants

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Check Out</h2>
          <p className="text-surface-500 text-sm mt-1">{tenants.length} active tenants · {recentExits.length} past exits</p>
        </div>
        <select className="select py-1.5 text-sm w-48" value={filterBuilding} onChange={e=>setFilterBuilding(e.target.value)}>
          <option value="">All Buildings</option>
          {buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="flex border-b border-surface-200">
        {[['active',`Active (${tenants.length})`],['exits',`Exits (${recentExits.length})`]].map(([k,l])=>(
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'active' && (() => {
        // Group by building
        const byBuilding = {}
        filtered.forEach(t => {
          const bName = t.building?.name || 'Unknown'
          if (!byBuilding[bName]) byBuilding[bName] = []
          byBuilding[bName].push(t)
        })
        return (
          <div className="space-y-4">
            {loading ? <div className="py-12 flex justify-center"><Spinner /></div>
            : filtered.length === 0 ? <div className="card py-12 text-center text-surface-400">No active tenants</div>
            : Object.entries(byBuilding).map(([bName, bTenants]) => {
              // Group by floor within each building
              const byFloor = {}
              bTenants.forEach(t => {
                const floor = getFloor(t.flat?.door_number)
                if (!byFloor[floor]) byFloor[floor] = []
                byFloor[floor].push(t)
              })
              // Sort floors
              const sortedFloors = Object.keys(byFloor).sort((a,b) => {
                const na = parseInt(a.replace(/\D/g,'')) || 0
                const nb = parseInt(b.replace(/\D/g,'')) || 0
                return na - nb
              })

              return (
                <div key={bName} className="card overflow-hidden border border-brand-100">
                  {/* Building header */}
                  <div className="px-5 py-3 bg-brand-600 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-white opacity-70"></div>
                      <h3 className="font-bold text-white">{bName}</h3>
                      <span className="text-xs text-brand-100 bg-brand-500 px-2 py-0.5 rounded-full">{bTenants.length} tenants</span>
                    </div>
                    <span className="text-xs text-brand-100 font-mono">
                      Total Deposit: {formatCurrency(bTenants.reduce((s,t)=>s+(parseFloat(t.security_deposit_paid)||0),0))}
                    </span>
                  </div>

                  {/* Floor-wise sections */}
                  {sortedFloors.map(floor => (
                    <div key={floor}>
                      {/* Floor sub-header */}
                      <div className="px-5 py-2 bg-surface-50 border-y border-surface-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">{floor}</span>
                          <span className="text-xs text-surface-400">— {byFloor[floor].length} unit{byFloor[floor].length > 1 ? 's' : ''}</span>
                        </div>
                        <span className="text-xs font-mono text-surface-400">
                          {formatCurrency(byFloor[floor].reduce((s,t)=>s+(parseFloat(t.monthly_rent)||0),0))}/mo
                        </span>
                      </div>
                      <table className="data-table">
                        <tbody>
                          {byFloor[floor].map(t => (
                            <tr key={t.id}>
                              <td style={{width:32}} className="pl-4 pr-0">
                                <div className="w-7 h-7 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 text-xs flex-shrink-0">{t.full_name.charAt(0)}</div>
                              </td>
                              <td>
                                <p className="font-medium text-surface-800 text-sm">{t.full_name}</p>
                                <p className="text-xs text-surface-400">{t.phone}</p>
                              </td>
                              <td className="font-mono font-bold text-surface-700">{t.flat?.door_number||'—'}</td>
                              <td className="text-xs text-surface-500">{fmtDate(t.move_in_date)}</td>
                              <td className="font-mono text-sm">{formatCurrency(t.monthly_rent)}</td>
                              <td className="font-mono text-sm text-emerald-700">{formatCurrency(t.security_deposit_paid||0)}</td>
                              <td>
                                <div className="flex items-center gap-2">
                                  <button onClick={()=>openCheckout(t)} className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 flex items-center gap-1">
                                    <LogOut className="w-3.5 h-3.5"/> Check Out
                                  </button>
                                  <button onClick={() => deleteCheckin(t)} title="Delete wrong entry"
                                    className="p-1.5 text-surface-300 hover:text-red-500 transition-colors rounded">
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )
      })()}

      {tab === 'exits' && (
        <div className="space-y-4">
          {/* Month filter + stats */}
          <div className="flex items-center gap-3 flex-wrap">
            <input type="month" className="input py-1.5 text-sm w-40"
              value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
            <div className="flex gap-3 flex-wrap">
              {[
                { label:'Total Exits', value: stats.totalExits, color:'text-surface-800' },
                { label:'Normal', value: stats.normalExits, color:'text-emerald-700' },
                { label:'Runaway', value: stats.runaways, color:'text-red-600' },
              ].map(({label,value,color}) => (
                <div key={label} className="card px-4 py-2 flex items-center gap-3">
                  <span className="text-xs text-surface-400">{label}</span>
                  <span className={`font-bold text-lg font-mono ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden">
          {recentExits.filter(t => t.move_out_date?.slice(0,7) === filterMonth).length === 0
            ? <EmptyState icon={LogOut} title="No exits this month" description="Change the month filter to see past exits" />
          : (
            <table className="data-table">
              <thead><tr><th>Tenant</th><th>Building</th><th>Flat</th><th>Exit Date</th><th>Exit Type</th></tr></thead>
              <tbody>
                {recentExits.filter(t => t.move_out_date?.slice(0,7) === filterMonth).map(t=>(
                  <tr key={t.id}>
                    <td><p className="font-medium">{t.full_name}</p><p className="text-xs text-surface-400">{t.phone}</p></td>
                    <td className="text-sm text-surface-500">{t.building?.name||'—'}</td>
                    <td className="font-mono">{t.flat?.door_number||'—'}</td>
                    <td className="text-xs text-surface-500">{fmtDate(t.move_out_date)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={`badge border text-xs ${t.notes?.includes('RUNAWAY')?'bg-red-50 text-red-700 border-red-200':'bg-surface-100 text-surface-600 border-surface-200'}`}>{t.notes?.includes('RUNAWAY')?'Runaway':'Normal'}</span>
                        <button onClick={() => deleteExit(t)} title="Undo exit / delete record"
                          className="btn-ghost p-1 text-red-400 hover:text-red-600">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        onConfirm={confirmDialog?.onConfirm}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        danger={confirmDialog?.danger}
      />

      {/* CHECKOUT MODAL */}
      <Modal open={modal} onClose={()=>setModal(false)} title={`Check Out — ${selected?.full_name}`} size="lg">
        {selected && (
          <>
            <div className="px-6 pt-5 space-y-4">
              <div className="p-3 bg-surface-50 border border-surface-200 rounded-xl flex items-center gap-4">
                <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center font-bold text-brand-700 flex-shrink-0">{selected.full_name.charAt(0)}</div>
                <div className="flex-1">
                  <p className="font-semibold">{selected.full_name}</p>
                  <p className="text-xs text-surface-400">{selected.flat?.door_number} · {selected.building?.name} · {selected.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-surface-400">Deposit Held</p>
                  <p className="font-mono font-bold text-emerald-700">{formatCurrency(selected.security_deposit_paid||0)}</p>
                </div>
              </div>
              <div className="flex gap-3">
                {[['good',<><CheckCircle2 className="w-4 h-4"/> Normal Exit</>,'emerald'],['bad',<><AlertTriangle className="w-4 h-4"/> Runaway / Bad</>,'red']].map(([v,l,col])=>(
                  <button key={v} onClick={()=>setCoType(v)} className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium flex items-center justify-center gap-2 transition-all ${coType===v?`border-${col}-400 bg-${col}-50 text-${col}-700`:'border-surface-200 text-surface-500'}`}>{l}</button>
                ))}
              </div>
              {coType==='bad'&&<div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">⚠️ Legal notice PDF auto-generated with 15-day deadline + police complaint warning.</div>}
              {/* Outstanding rent auto-detected banner */}
              {loadingOutstanding && <div className="p-3 bg-surface-50 rounded-lg text-xs text-surface-500 animate-pulse">Checking outstanding rent...</div>}
              {!loadingOutstanding && outstandingRent > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Auto-detected <strong>{formatCurrency(outstandingRent)}</strong> outstanding rent (last 2 months) — pre-filled below</span>
                </div>
              )}
              {!loadingOutstanding && outstandingRent === 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">✓ No outstanding rent detected</div>
              )}
            </div>
            <div className="px-6 pt-4 grid sm:grid-cols-2 gap-4">
              {[['exit_date','Exit Date','date'],['outstanding_rent','Outstanding Rent (₹)','number'],['cleaning','Cleaning Charges (₹)','number'],['painting','Painting Charges (₹)','number'],['repair','Repair Charges (₹)','number'],['other','Other Deductions (₹)','number'],['collected_at_exit','Collected at Exit (₹)','number']].map(([k,l,type])=>(
                <div key={k} className="form-group">
                  <label className="label">{l}</label>
                  <input type={type} className="input" value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={type==='number'?'0':''} />
                </div>
              ))}
              <div className="form-group"><label className="label">Notes</label><input className="input" value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} /></div>
              <div className="col-span-2 p-4 rounded-xl bg-surface-50 border-2 border-surface-200">
                <p className="text-sm font-semibold text-surface-700 mb-3">Settlement Summary</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-surface-500">Deposit Held</span><span className="font-mono text-emerald-700">{formatCurrency(selected.security_deposit_paid||0)}</span></div>
                  <div className="flex justify-between"><span className="text-surface-500">Total Deductions</span><span className="font-mono text-red-600">−{formatCurrency(totalDed)}</span></div>
                  <div className="border-t border-surface-200 pt-2 flex justify-between">
                    <span className="font-bold">{netRefund>=0?'Refund to Tenant':'Amount to Collect'}</span>
                    <span className={`font-mono font-bold text-lg ${netRefund>=0?'text-emerald-700':'text-red-600'}`}>{formatCurrency(Math.abs(netRefund))}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3 justify-end mt-2">
              <button className="btn-secondary" onClick={()=>setModal(false)}>Cancel</button>
              <button onClick={saveCheckout} disabled={saving}
                className={`px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 text-white ${coType==='bad'?'bg-red-600 hover:bg-red-700':'bg-brand-600 hover:bg-brand-700'}`}>
                {saving?<Spinner size={16}/>:<><LogOut className="w-4 h-4"/>{coType==='bad'?'Checkout + Legal Notice':'Confirm Checkout'}</>}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
