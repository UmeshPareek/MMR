import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return res.status(500).json({
      error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Vercel environment variables. Go to Vercel → Settings → Environment Variables and add it, then redeploy.'
    })
  }

  const admin = createClient(url, key)

  // Verify caller is authenticated
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  const { flatId } = req.body
  if (!flatId) return res.status(400).json({ error: 'flatId is required' })

  // Check flat exists and is not occupied
  const { data: flat, error: flatErr } = await admin
    .from('flats')
    .select('id, door_number, status, current_tenant_id')
    .eq('id', flatId)
    .single()

  if (flatErr || !flat) return res.status(404).json({ error: 'Flat not found' })

  if (flat.status === 'occupied' || flat.current_tenant_id) {
    return res.status(400).json({ error: 'Flat is occupied. Check out the tenant first.' })
  }

  // Delete the flat — Postgres ON DELETE SET NULL handles all FK references automatically
  // (after running supabase_flat_delete_fix.sql in Supabase dashboard)
  const { error: delErr } = await admin.from('flats').delete().eq('id', flatId)

  if (delErr) return res.status(500).json({ error: delErr.message })

  return res.status(200).json({ success: true, door_number: flat.door_number })
}
