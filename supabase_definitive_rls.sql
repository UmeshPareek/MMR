-- ================================================================
-- DEFINITIVE ORG ISOLATION
-- Based on full schema audit — every table locked to its org_id
-- Run once in Supabase SQL editor
-- ================================================================


-- ================================================================
-- STEP 1: BACKFILL org_id WHERE NULL
-- Ensures existing data is tagged before RLS locks it down
-- ================================================================

UPDATE buildings       SET org_id = (SELECT org_id FROM profiles WHERE id = buildings.created_by)       WHERE org_id IS NULL AND created_by IS NOT NULL;
UPDATE flats           SET org_id = (SELECT org_id FROM buildings WHERE id = flats.building_id)          WHERE org_id IS NULL AND building_id IS NOT NULL;
UPDATE tenants         SET org_id = (SELECT org_id FROM buildings WHERE id = tenants.building_id)        WHERE org_id IS NULL AND building_id IS NOT NULL;
UPDATE rent_collections SET org_id = (SELECT org_id FROM buildings WHERE id = rent_collections.building_id) WHERE org_id IS NULL AND building_id IS NOT NULL;
UPDATE expenses        SET org_id = (SELECT org_id FROM buildings WHERE id = expenses.building_id)       WHERE org_id IS NULL AND building_id IS NOT NULL;
UPDATE expenses        SET org_id = (SELECT org_id FROM profiles  WHERE id = expenses.paid_by)           WHERE org_id IS NULL AND paid_by IS NOT NULL;
UPDATE utility_bills   SET org_id = (SELECT org_id FROM buildings WHERE id = utility_bills.building_id)  WHERE org_id IS NULL AND building_id IS NOT NULL;
UPDATE owner_payments  SET org_id = (SELECT org_id FROM buildings WHERE id = owner_payments.building_id) WHERE org_id IS NULL AND building_id IS NOT NULL;
UPDATE security_deposits SET org_id = (SELECT org_id FROM buildings WHERE id = security_deposits.building_id) WHERE org_id IS NULL AND building_id IS NOT NULL;
UPDATE staff_salaries  SET org_id = (SELECT org_id FROM staff     WHERE id = staff_salaries.staff_id)    WHERE org_id IS NULL AND staff_id IS NOT NULL;
UPDATE staff_advances  SET org_id = (SELECT org_id FROM staff     WHERE id = staff_advances.staff_id)    WHERE org_id IS NULL AND staff_id IS NOT NULL;
UPDATE owners          SET org_id = (SELECT org_id FROM profiles  WHERE id = owners.created_by)          WHERE org_id IS NULL AND created_by IS NOT NULL;
UPDATE expense_groups  SET org_id = (SELECT org_id FROM profiles  WHERE id = expense_groups.created_by)  WHERE org_id IS NULL AND created_by IS NOT NULL;
UPDATE audit_notes     SET org_id = (SELECT org_id FROM buildings WHERE id = audit_notes.building_id)    WHERE org_id IS NULL AND building_id IS NOT NULL;


-- ================================================================
-- STEP 2: DROP EVERY EXISTING POLICY ON EVERY TABLE
-- Clean slate — no old role-based policies surviving
-- ================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;


-- ================================================================
-- STEP 3: ENABLE RLS ON EVERY TABLE
-- ================================================================

ALTER TABLE buildings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE flats                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_collections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_bills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_deposits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_salaries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_advances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE owners                ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE flat_utilities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_charges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_change_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_name_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_cash_flow     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_activity_feed     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_audit_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_counters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_instances         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_outward_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_presets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_purchase_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_vendors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_warehouses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_zones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log    ENABLE ROW LEVEL SECURITY;


-- ================================================================
-- STEP 4: CREATE UNIFORM org_id POLICIES
-- Tables with direct org_id column — one policy each
-- ================================================================

CREATE POLICY "org_isolation" ON buildings         FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON flats             FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON tenants           FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON rent_collections  FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON expenses          FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON utility_bills     FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON owner_payments    FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON security_deposits FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON staff             FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON staff_salaries    FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON staff_advances    FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON owners            FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON master_settings   FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON expense_groups    FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON audit_notes       FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON audit_sessions    FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON subscriptions     FOR ALL TO authenticated USING (org_id = auth_user_org_id());

-- inv_ tables all have direct org_id
CREATE POLICY "org_isolation" ON inv_activity_feed     FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_audit_sessions    FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_categories        FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_counters          FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_instances         FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_items             FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_outward_entries   FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_presets           FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_purchase_entries  FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_transfer_requests FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_vendors           FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_warehouses        FOR ALL TO authenticated USING (org_id = auth_user_org_id());
CREATE POLICY "org_isolation" ON inv_zones             FOR ALL TO authenticated USING (org_id = auth_user_org_id());


-- ================================================================
-- STEP 5: TABLES WITHOUT DIRECT org_id — JOIN THROUGH PARENT
-- ================================================================

-- meter_readings → buildings
CREATE POLICY "org_isolation" ON meter_readings FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- flat_utilities → buildings
CREATE POLICY "org_isolation" ON flat_utilities FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));

-- utility_charges → flats (flats has org_id)
CREATE POLICY "org_isolation" ON utility_charges FOR ALL TO authenticated
  USING (flat_id IN (SELECT id FROM flats WHERE org_id = auth_user_org_id()));

-- daily_reconciliations → staff (staff has org_id)
CREATE POLICY "org_isolation" ON daily_reconciliations FOR ALL TO authenticated
  USING (staff_id IN (SELECT id FROM staff WHERE org_id = auth_user_org_id()));

-- rent_change_log → flats
CREATE POLICY "org_isolation" ON rent_change_log FOR ALL TO authenticated
  USING (flat_id IN (SELECT id FROM flats WHERE org_id = auth_user_org_id()));

-- tenant_name_log → tenants
CREATE POLICY "org_isolation" ON tenant_name_log FOR ALL TO authenticated
  USING (tenant_id IN (SELECT id FROM tenants WHERE org_id = auth_user_org_id()));

-- monthly_cash_flow → buildings
CREATE POLICY "org_isolation" ON monthly_cash_flow FOR ALL TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));


-- ================================================================
-- STEP 6: SPECIAL TABLES
-- ================================================================

-- profiles: users see their own + their org members (needed for name lookups)
CREATE POLICY "org_isolation" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR org_id = auth_user_org_id());
CREATE POLICY "own_profile_write" ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "own_profile_update" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- organizations: users can read their own org
CREATE POLICY "org_isolation" ON organizations FOR SELECT TO authenticated
  USING (id = auth_user_org_id());

-- platform_audit_log: platform admins only
CREATE POLICY "platform_admin_only" ON platform_audit_log FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin = true));
