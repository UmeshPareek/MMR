import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Verify caller is authenticated with a valid Supabase session
  const authHeader = req.headers.authorization
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  // Use anon client to verify the caller's session
  const anonClient = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
  )
  const { data: { user: caller }, error: authError } = await anonClient.auth.getUser(token)
  if (authError || !caller) return res.status(401).json({ error: 'Invalid session' })

  // Check caller's profile is admin or super_admin
  const { data: callerProfile } = await anonClient
    .from('profiles').select('role, is_platform_admin').eq('id', caller.id).single()
  if (!callerProfile || !['admin', 'super_admin'].includes(callerProfile.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }

  const { email, password, full_name, role } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

  // Block non-platform-admins from creating super_admin accounts
  if (role === 'super_admin' && !callerProfile.is_platform_admin) {
    return res.status(403).json({ error: 'Only platform admin can create super_admin accounts' })
  }

  // Use service role client for admin operations
  const adminClient = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name || '' },
  })
  if (error) return res.status(400).json({ error: error.message })

  // Insert profile
  const { error: profileError } = await adminClient.from('profiles').upsert({
    id: data.user.id,
    email,
    full_name: full_name || '',
    role: role || 'team',
  })
  if (profileError) return res.status(500).json({ error: profileError.message })

  return res.status(200).json({ success: true, userId: data.user.id })
}
