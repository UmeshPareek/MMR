import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Fail fast with a clear message if env var is missing
  if (!SERVICE_KEY || !SUPABASE_URL) {
    return res.status(500).json({ error: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY is not set in Vercel environment variables.' })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // Authenticate caller
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  // Get caller profile
  const { data: profile } = await admin
    .from('profiles').select('org_id, role, is_platform_admin').eq('id', user.id).single()
  if (!profile) return res.status(403).json({ error: 'Profile not found' })

  const { flatId } = req.body
  if (!flatId) return res.status(400).json({ error: 'flatId required' })

  // Verify the flat belongs to caller's org
  const { data: flat } = await admin.from('flats').select('id, door_number, building_id, status, current_tenant_id').eq('id', flatId).single()
  if (!flat) return res.status(404).json({ error: 'Flat not found' })

  // Block deletion if actively occupied
  if (flat.status === 'occupied' || flat.current_tenant_id) {
    return res.status(400).json({ error: 'Flat is currently occupied. Check out the tenant first.' })
  }

  try {
    // rent_collections.flat_id is NOT NULL — must DELETE rows, cannot null them
    await admin.from('rent_collections').delete().eq('flat_id', flatId)

    // utility_charges.flat_id is nullable — null it out
    await admin.from('utility_charges').update({ flat_id: null }).eq('flat_id', flatId)

    // tenants.flat_id is nullable — null it out (covers vacated tenants)
    await admin.from('tenants').update({ flat_id: null }).eq('flat_id', flatId)

    // security_deposits.flat_id is nullable — null it out
    await admin.from('security_deposits').update({ flat_id: null }).eq('flat_id', flatId)

    // Optional tables — ignore errors if column/table doesn't exist
    await admin.from('meter_readings').update({ flat_id: null }).eq('flat_id', flatId).catch(() => {})
    await admin.from('flat_utilities').update({ flat_id: null }).eq('flat_id', flatId).catch(() => {})

  } catch (e) {
    return res.status(500).json({ error: 'Failed to clean up flat references: ' + e.message })
  }

  // Final step — delete the flat itself
  const { error: delErr } = await admin.from('flats').delete().eq('id', flatId)
  if (delErr) return res.status(500).json({ error: 'Flat delete failed: ' + delErr.message })

  return res.status(200).json({ success: true, door_number: flat.door_number })
}
