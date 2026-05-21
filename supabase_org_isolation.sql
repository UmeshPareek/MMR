-- ============================================================
-- ORG ISOLATION MIGRATION
-- Run this once in Supabase SQL editor
-- ============================================================

-- 1. Add missing columns to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id TEXT DEFAULT 'growth';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_price INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ DEFAULT NOW();

-- Update existing orgs to have active status
UPDATE organizations SET status = 'active' WHERE status IS NULL;

-- 2. master_settings: add org_id column
ALTER TABLE master_settings ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- Backfill existing settings to the first/only org
UPDATE master_settings
SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
WHERE org_id IS NULL;

-- Drop old unique constraint (was on setting_key alone) and add per-org constraint
ALTER TABLE master_settings DROP CONSTRAINT IF EXISTS master_settings_setting_key_key;
ALTER TABLE master_settings DROP CONSTRAINT IF EXISTS master_settings_org_key_unique;
ALTER TABLE master_settings ADD CONSTRAINT master_settings_org_key_unique UNIQUE (org_id, setting_key);

-- Enable RLS and add policies
ALTER TABLE master_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_settings_read" ON master_settings;
DROP POLICY IF EXISTS "org_settings_write" ON master_settings;
CREATE POLICY "org_settings_read" ON master_settings
  FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_settings_write" ON master_settings
  FOR ALL TO authenticated
  USING (org_id = auth_user_org_id());

-- 3. owners: add org_id column
ALTER TABLE owners ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- Backfill existing owners to the first/only org
UPDATE owners
SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_owners_org ON owners(org_id);

-- Enable RLS and add policies
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_owners_read" ON owners;
DROP POLICY IF EXISTS "org_owners_write" ON owners;
CREATE POLICY "org_owners_read" ON owners
  FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_owners_write" ON owners
  FOR ALL TO authenticated
  USING (org_id = auth_user_org_id());
