-- ================================================================
-- Add trial / plan limit columns to organizations
-- Run once in Supabase SQL editor before deploying self-serve signup
-- ================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at   TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_buildings    INTEGER DEFAULT 2;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_tenants      INTEGER DEFAULT 50;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_users        INTEGER DEFAULT 5;

-- Ensure status column has the right default
ALTER TABLE organizations ALTER COLUMN status SET DEFAULT 'trial';

-- Seed limits for existing active orgs that have no limits set
UPDATE organizations
SET max_buildings = 9999, max_tenants = 9999, max_users = 9999
WHERE status = 'active' AND max_buildings IS NULL;

-- Verify
SELECT id, name, status, plan_id, max_buildings, max_tenants, trial_ends_at
FROM organizations
ORDER BY created_at DESC
LIMIT 20;
