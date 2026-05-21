-- ================================================================
-- FULL ORG ISOLATION — RLS on all core tables
-- Run this once in Supabase SQL editor
-- ================================================================

-- buildings (org_id already exists from earlier migration)
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_buildings" ON buildings;
CREATE POLICY "org_buildings" ON buildings
  FOR ALL TO authenticated
  USING (org_id = auth_user_org_id());

-- flats (building_id → buildings.org_id)
ALTER TABLE flats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_flats" ON flats;
CREATE POLICY "org_flats" ON flats
  FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- tenants (has direct building_id column)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_tenants" ON tenants;
CREATE POLICY "org_tenants" ON tenants
  FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- rent_collections
ALTER TABLE rent_collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_rent_collections" ON rent_collections;
CREATE POLICY "org_rent_collections" ON rent_collections
  FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- expenses (building_id can be NULL — fall back to paid_by's org)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_expenses" ON expenses;
CREATE POLICY "org_expenses" ON expenses
  FOR ALL TO authenticated
  USING (
    (building_id IS NOT NULL AND building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()))
    OR
    (building_id IS NULL AND paid_by IN (SELECT id FROM profiles WHERE org_id = auth_user_org_id()))
  );

-- utility_bills
ALTER TABLE utility_bills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_utility_bills" ON utility_bills;
CREATE POLICY "org_utility_bills" ON utility_bills
  FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- owner_payments
ALTER TABLE owner_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_owner_payments" ON owner_payments;
CREATE POLICY "org_owner_payments" ON owner_payments
  FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- meter_readings
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_meter_readings" ON meter_readings;
CREATE POLICY "org_meter_readings" ON meter_readings
  FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- security_deposits
ALTER TABLE security_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_security_deposits" ON security_deposits;
CREATE POLICY "org_security_deposits" ON security_deposits
  FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- staff_salaries (via staff.org_id)
ALTER TABLE staff_salaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_staff_salaries" ON staff_salaries;
CREATE POLICY "org_staff_salaries" ON staff_salaries
  FOR ALL TO authenticated
  USING (staff_id IN (SELECT id FROM staff WHERE org_id = auth_user_org_id()));

-- expense_groups: add org_id column, backfill from creator's profile, add RLS
ALTER TABLE expense_groups ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
UPDATE expense_groups
  SET org_id = (SELECT p.org_id FROM profiles p WHERE p.id = expense_groups.created_by LIMIT 1)
  WHERE org_id IS NULL AND created_by IS NOT NULL;
ALTER TABLE expense_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_expense_groups" ON expense_groups;
CREATE POLICY "org_expense_groups" ON expense_groups
  FOR ALL TO authenticated
  USING (org_id = auth_user_org_id());

-- rent_change_log (audit trail via flat → building)
ALTER TABLE rent_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_rent_change_log" ON rent_change_log;
CREATE POLICY "org_rent_change_log" ON rent_change_log
  FOR ALL TO authenticated
  USING (flat_id IN (
    SELECT f.id FROM flats f
    INNER JOIN buildings b ON b.id = f.building_id
    WHERE b.org_id = auth_user_org_id()
  ));

-- profiles: allow org members to see each other's names
-- (needed for "collected_by", "paid_by" joins across pages)
DROP POLICY IF EXISTS "users can read own profile" ON profiles;
DROP POLICY IF EXISTS "org members read profiles" ON profiles;
CREATE POLICY "org members read profiles" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR org_id = auth_user_org_id());
CREATE POLICY "users update own profile" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid());
