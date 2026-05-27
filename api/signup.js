import { createClient } from '@supabase/supabase-js'

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Simple in-memory rate limiter — 5 signups per IP per 10 minutes
const attempts = new Map()
function isRateLimited(ip) {
  const now = Date.now()
  const window = 10 * 60 * 1000
  const max = 5
  const entry = attempts.get(ip) || { count: 0, start: now }
  if (now - entry.start > window) { attempts.set(ip, { count: 1, start: now }); return false }
  if (entry.count >= max) return true
  attempts.set(ip, { ...entry, count: entry.count + 1 })
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many signup attempts. Try again in 10 minutes.' })

  const { email, password, full_name, company_name, phone } = req.body || {}

  if (!email || !password || !full_name || !company_name)
    return res.status(400).json({ error: 'Name, company, email and password are all required.' })

  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Enter a valid email address.' })

  // 1. Create auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (authError) {
    if (authError.message.includes('already registered') || authError.message.includes('already been registered'))
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' })
    return res.status(400).json({ error: authError.message })
  }

  const userId = authData.user.id
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const slug = company_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  // 2. Create organization with 14-day trial
  const { data: org, error: orgError } = await adminClient.from('organizations').insert({
    name: company_name,
    slug: slug || `org-${Date.now()}`,
    contact_name: full_name,
    contact_email: email,
    contact_phone: phone || null,
    plan_id: 'trial',
    status: 'trial',
    max_buildings: 1,
    max_tenants: 25,
    max_users: 3,
    trial_ends_at: trialEndsAt,
    onboarded_at: new Date().toISOString(),
  }).select().single()

  if (orgError) {
    // Rollback: delete the auth user we just created
    await adminClient.auth.admin.deleteUser(userId)
    return res.status(500).json({ error: 'Failed to create organisation. Please try again.' })
  }

  // 3. Set profile: org_id + super_admin role (overrides trigger's 'team' default)
  const { error: profileError } = await adminClient.from('profiles').upsert({
    id: userId,
    email,
    full_name,
    role: 'super_admin',
    org_id: org.id,
  })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId)
    await adminClient.from('organizations').delete().eq('id', org.id)
    return res.status(500).json({ error: 'Failed to save profile. Please try again.' })
  }

  return res.status(200).json({ success: true, orgId: org.id })
}
