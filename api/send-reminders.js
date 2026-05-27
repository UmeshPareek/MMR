import { createClient } from '@supabase/supabase-js'

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Called by Vercel Cron (Authorization: Bearer CRON_SECRET)
// or manually by an admin via the Settings page
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Accept either cron secret or a valid admin user token
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')
  const isCron = token === process.env.CRON_SECRET

  if (!isCron) {
    // Verify admin session
    const { data: { user }, error } = await adminClient.auth.getUser(token)
    if (error || !user) return res.status(401).json({ error: 'Unauthorized' })
    const { data: profile } = await adminClient
      .from('profiles').select('role, is_platform_admin').eq('id', user.id).single()
    if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
      return res.status(403).json({ error: 'Admin access required' })
    }
  }

  const orgId = req.body?.org_id || null  // null = run for all orgs (cron mode)
  const currentMonth = new Date().toISOString().slice(0, 7) // e.g. "2025-06"
  const results = []

  try {
    // Load active tenants — filter by org if specified
    let tenantsQuery = adminClient
      .from('tenants')
      .select('id, full_name, phone, email, monthly_rent, org_id, building_id, flat_id, buildings(name), flats(door_number)')
      .eq('status', 'active')
    if (orgId) tenantsQuery = tenantsQuery.eq('org_id', orgId)
    const { data: tenants } = await tenantsQuery

    if (!tenants?.length) return res.status(200).json({ sent: 0, overdue: [] })

    // Find which tenants have already paid this month
    const tenantIds = tenants.map(t => t.id)
    const { data: paid } = await adminClient
      .from('rent_collections')
      .select('tenant_id')
      .in('tenant_id', tenantIds)
      .eq('for_month', currentMonth)

    const paidSet = new Set((paid || []).map(p => p.tenant_id))
    const overdue = tenants.filter(t => !paidSet.has(t.id))

    if (!overdue.length) return res.status(200).json({ sent: 0, overdue: [] })

    // Group by org so we send one summary per org admin
    const byOrg = {}
    overdue.forEach(t => {
      if (!byOrg[t.org_id]) byOrg[t.org_id] = []
      byOrg[t.org_id].push(t)
    })

    for (const [oId, tenantList] of Object.entries(byOrg)) {
      // Get org admin email
      const { data: admin } = await adminClient
        .from('profiles')
        .select('email, full_name')
        .eq('org_id', oId)
        .eq('role', 'super_admin')
        .single()

      if (!admin?.email) continue

      const totalOverdue = tenantList.reduce((s, t) => s + (t.monthly_rent || 0), 0)
      const emailSent = await sendSummaryEmail(admin, tenantList, currentMonth, totalOverdue)

      // Record notification regardless of email success
      await adminClient.from('platform_notifications').insert({
        type: 'reminder',
        title: `Rent overdue: ${tenantList.length} tenant${tenantList.length === 1 ? '' : 's'}`,
        message: `${tenantList.length} tenant${tenantList.length === 1 ? ' has' : 's have'} not paid rent for ${currentMonth}. Total: ₹${totalOverdue.toLocaleString('en-IN')}`,
        organization_id: oId,
        metadata: { month: currentMonth, count: tenantList.length, total: totalOverdue },
      }).catch(() => {})

      results.push({ org_id: oId, overdue: tenantList.length, emailSent })
    }

    return res.status(200).json({ sent: results.length, results, overdue: overdue.map(t => ({ id: t.id, name: t.full_name, phone: t.phone, rent: t.monthly_rent })) })
  } catch (e) {
    return res.status(500).json({ error: 'Reminder processing failed' })
  }
}

async function sendSummaryEmail(admin, tenants, month, total) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false  // no email provider configured — skip silently

  const monthLabel = new Date(month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
  const rows = tenants
    .map(t => `<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${t.full_name}</td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${t.phone || '—'}</td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">₹${(t.monthly_rent||0).toLocaleString('en-IN')}</td></tr>`)
    .join('')

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#0f172a;margin-bottom:4px">Rent Overdue — ${monthLabel}</h2>
      <p style="color:#64748b;margin-top:0">Hi ${admin.full_name?.split(' ')[0] || 'there'}, ${tenants.length} tenant${tenants.length === 1 ? ' has' : 's have'} not paid rent yet.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#f8fafc"><th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600">Tenant</th><th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600">Phone</th><th style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;font-weight:600">Rent Due</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:#f8fafc"><td colspan="2" style="padding:10px 12px;font-weight:600">Total Outstanding</td><td style="padding:10px 12px;text-align:right;font-weight:700;color:#dc2626">₹${total.toLocaleString('en-IN')}</td></tr></tfoot>
      </table>
      <p style="color:#94a3b8;font-size:12px">Sent by CashMyRent · <a href="https://app.cashmyrent.com" style="color:#0d9488">Open dashboard</a></p>
    </div>`

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'CashMyRent <reminders@cashmyrent.com>',
        to: admin.email,
        subject: `⚠️ ${tenants.length} tenant${tenants.length === 1 ? '' : 's'} overdue — ${monthLabel}`,
        html,
      }),
    })
    return r.ok
  } catch { return false }
}
