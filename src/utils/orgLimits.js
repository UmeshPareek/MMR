import { supabase } from '@/lib/supabase'

export async function getOrgLimits(userId) {
  const { data: member } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations(id, name, plan, status, max_buildings, max_tenants, max_users, trial_ends_at)')
    .eq('user_id', userId)
    .single()

  if (!member?.organizations) return null
  return member.organizations
}

export async function checkBuildingLimit(userId) {
  const org = await getOrgLimits(userId)
  if (!org) return { allowed: true }

  if (org.status === 'suspended') return { allowed: false, reason: 'Your account is suspended. Contact support.' }
  if (org.status === 'trial') {
    const daysLeft = Math.ceil((new Date(org.trial_ends_at) - new Date()) / 86400000)
    if (daysLeft < 0) return { allowed: false, reason: 'Your trial has expired. Please subscribe to continue.' }
  }

  const { count } = await supabase
    .from('buildings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)
    .eq('is_active', true)

  if (org.max_buildings !== 9999 && (count || 0) >= org.max_buildings) {
    return {
      allowed: false,
      reason: `Your ${org.plan} plan allows up to ${org.max_buildings} buildings. Upgrade to add more.`,
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
    if (daysLeft < 0) return { allowed: false, reason: 'Your trial has expired. Please subscribe to continue.' }
  }

  const { count } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)
    .eq('status', 'active')

  if (org.max_tenants !== 9999 && (count || 0) >= org.max_tenants) {
    return {
      allowed: false,
      reason: `Your ${org.plan} plan allows up to ${org.max_tenants} active tenants. Upgrade to add more.`,
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
  } catch (_) { /* fail silently — don't block the user */ }
}
