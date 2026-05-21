import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const anonClient = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
  )
  const { data: { user: caller }, error: authError } = await anonClient.auth.getUser(token)
  if (authError || !caller) return res.status(401).json({ error: 'Invalid session' })

  const { data: callerProfile } = await anonClient
    .from('profiles').select('role, org_id, is_platform_admin').eq('id', caller.id).single()

  if (!callerProfile || !['admin', 'super_admin'].includes(callerProfile.role) && !callerProfile.is_platform_admin) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }

  const { userId, newRole } = req.body
  if (!userId || !newRole) return res.status(400).json({ error: 'userId and newRole required' })

  const adminClient = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Non-platform-admins can only update users in their own org
  if (!callerProfile.is_platform_admin) {
    const { data: targetProfile } = await adminClient
      .from('profiles').select('org_id').eq('id', userId).single()
    if (!targetProfile || targetProfile.org_id !== callerProfile.org_id) {
      return res.status(403).json({ error: 'Cannot update users outside your org' })
    }
    if (newRole === 'super_admin') {
      return res.status(403).json({ error: 'Only platform admin can grant super_admin' })
    }
  }

  const { error } = await adminClient
    .from('profiles').update({ role: newRole }).eq('id', userId)
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ success: true })
}
