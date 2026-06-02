import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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

  // Step 1 — null out flat_id on ALL referencing tables (service role bypasses RLS)
  const steps = [
    admin.from('tenants').update({ flat_id: null }).eq('flat_id', flatId),
    admin.from('rent_collections').update({ flat_id: null }).eq('flat_id', flatId),
    admin.from('security_deposits').update({ flat_id: null }).eq('flat_id', flatId),
    admin.from('meter_readings').update({ flat_id: null }).eq('flat_id', flatId),
    admin.from('flat_utilities').update({ flat_id: null }).eq('flat_id', flatId).catch(() => null),
    admin.from('utility_charges').update({ flat_id: null }).eq('flat_id', flatId).catch(() => null),
  ]

  await Promise.all(steps)

  // Step 2 — delete the flat
  const { error: delErr } = await admin.from('flats').delete().eq('id', flatId)
  if (delErr) return res.status(500).json({ error: delErr.message })

  return res.status(200).json({ success: true, door_number: flat.door_number })
}
