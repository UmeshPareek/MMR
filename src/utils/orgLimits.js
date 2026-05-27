import { supabase } from '@/lib/supabase'

export async function getOrgLimits(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, organizations(id, name, plan_id, status, max_buildings, max_tenants, max_users, trial_ends_at)')
    .eq('id', userId)
    .single()

  return profile?.organizations || null
}

export async function checkBuildingLimit(userId) {
  const org = await getOrgLimits(userId)
  if (!org) return { allowed: true }

  if (org.status === 'suspended') return { allowed: false, reason: 'Your account is suspended. Contact support.' }
  if (org.status === 'trial') {
    const daysLeft = Math.ceil((new Date(org.trial_ends_at) - new Date()) / 86400000)
    if (daysLeft < 0) return { allowed: false, reason: 'Your trial has expired. Upgrade to continue.' }
  }

  if (!org.max_buildings || org.max_buildings === 9999) return { allowed: true }

  const { count } = await supabase
    .from('buildings')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.id)
    .eq('is_active', true)

  if ((count || 0) >= org.max_buildings) {
    return {
      allowed: false,
      reason: `Your ${org.plan_id || 'current'} plan allows up to ${org.max_buildings} building${org.max_buildings === 1 ? '' : 's'}. Upgrade to add more.`,
    }
  }
  return { allowed: true }
}

export async function checkTenantLimit(userId) {
  const org = await getOrgLimits(userId)
  if (!org) return { allowed: true }

  if (org.status === 'suspended') return { allowed: false, reason: 'Your account is suspended. Contact support.' }
  if (org.status === 'trial') {
    const daysLeft = Math.ceil((new Date(org.trial_ends_at) - new Date()) / 86400000)
    if (daysLeft < 0) return { allowed: false, reason: 'Your trial has expired. Upgrade to continue.' }
  }

  if (!org.max_tenants || org.max_tenants === 9999) return { allowed: true }

  const { count } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.id)
    .eq('status', 'active')

  if ((count || 0) >= org.max_tenants) {
    return {
      allowed: false,
      reason: `Your ${org.plan_id || 'current'} plan allows up to ${org.max_tenants} active tenants. Upgrade to add more.`,
    }
  }
  return { allowed: true }
}

export async function reportError(title, message, metadata = {}, organizationId = null) {
  try {
    await supabase.from('platform_notifications').insert({
      type: 'error', title, message,
      metadata,
      organization_id: organizationId,
    })
  } catch { /* fail silently */ }
}
