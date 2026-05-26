-- ================================================================
-- SECURITY HARDENING MIGRATION
-- Run once in the Supabase SQL editor (Dashboard → SQL editor)
-- Safe to re-run — all statements are idempotent
-- ================================================================


-- ================================================================
-- TASK 8: Harden handle_new_user trigger
-- Hardcodes 'team' role — prevents privilege escalation via
-- signup metadata manipulation through the Supabase API
-- ================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.email,
    'team'  -- hardcoded: no user can self-assign admin/super_admin at signup
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure trigger is attached (no-op if already exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ================================================================
-- TASK 9: Helper function — current user's role
-- Used in RLS policies below to enforce role-based write/delete
-- ================================================================

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;


-- ================================================================
-- TASK 9: Split RLS policies — DELETE requires admin or super_admin
-- Strategy:
--   SELECT / INSERT / UPDATE → any authenticated org member (unchanged)
--   DELETE → only admin or super_admin in the same org
--
-- This prevents team-role field staff from deleting financial records
-- while preserving their ability to log payments, check-ins, etc.
-- ================================================================

-- Drop only the "org_isolation" FOR ALL policies on financial tables,
-- then replace them with separate per-operation policies.

DO $$
DECLARE
  t TEXT;
  financial_tables TEXT[] := ARRAY[
    'tenants', 'rent_collections', 'expenses', 'utility_bills',
    'owner_payments', 'security_deposits', 'staff', 'staff_salaries',
    'staff_advances', 'meter_readings', 'owners', 'buildings', 'flats',
    'audit_notes', 'audit_sessions', 'daily_reconciliations',
    'rent_change_log', 'tenant_name_log'
  ];
BEGIN
  FOREACH t IN ARRAY financial_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "org_isolation" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org_select" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org_insert" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org_update" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org_delete" ON %I', t);
  END LOOP;
END $$;


-- ── TENANTS ─────────────────────────────────────────────────────
CREATE POLICY "org_select" ON tenants FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON tenants FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON tenants FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON tenants FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── RENT COLLECTIONS ────────────────────────────────────────────
CREATE POLICY "org_select" ON rent_collections FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON rent_collections FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON rent_collections FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON rent_collections FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── EXPENSES ────────────────────────────────────────────────────
CREATE POLICY "org_select" ON expenses FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON expenses FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON expenses FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON expenses FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── UTILITY BILLS ───────────────────────────────────────────────
CREATE POLICY "org_select" ON utility_bills FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON utility_bills FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON utility_bills FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON utility_bills FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── OWNER PAYMENTS ──────────────────────────────────────────────
CREATE POLICY "org_select" ON owner_payments FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON owner_payments FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON owner_payments FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON owner_payments FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── SECURITY DEPOSITS ───────────────────────────────────────────
CREATE POLICY "org_select" ON security_deposits FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON security_deposits FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON security_deposits FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON security_deposits FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── STAFF ───────────────────────────────────────────────────────
CREATE POLICY "org_select" ON staff FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON staff FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON staff FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON staff FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── STAFF SALARIES ──────────────────────────────────────────────
CREATE POLICY "org_select" ON staff_salaries FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON staff_salaries FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON staff_salaries FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON staff_salaries FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── STAFF ADVANCES ──────────────────────────────────────────────
CREATE POLICY "org_select" ON staff_advances FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON staff_advances FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON staff_advances FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON staff_advances FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── BUILDINGS ───────────────────────────────────────────────────
CREATE POLICY "org_select" ON buildings FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON buildings FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON buildings FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON buildings FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── FLATS ───────────────────────────────────────────────────────
CREATE POLICY "org_select" ON flats FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON flats FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON flats FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON flats FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── OWNERS ──────────────────────────────────────────────────────
CREATE POLICY "org_select" ON owners FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON owners FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON owners FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON owners FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── AUDIT NOTES / SESSIONS ──────────────────────────────────────
CREATE POLICY "org_select" ON audit_notes FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON audit_notes FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON audit_notes FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON audit_notes FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "org_select" ON audit_sessions FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());
CREATE POLICY "org_insert" ON audit_sessions FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_update" ON audit_sessions FOR UPDATE TO authenticated
  USING (org_id = auth_user_org_id()) WITH CHECK (org_id = auth_user_org_id());
CREATE POLICY "org_delete" ON audit_sessions FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id() AND auth_user_role() IN ('admin', 'super_admin'));

-- ── METER READINGS (join-based) ──────────────────────────────────
CREATE POLICY "org_select" ON meter_readings FOR SELECT TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_insert" ON meter_readings FOR INSERT TO authenticated
  WITH CHECK (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_update" ON meter_readings FOR UPDATE TO authenticated
  USING (building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_delete" ON meter_readings FOR DELETE TO authenticated
  USING (
    building_id IN (SELECT id FROM buildings WHERE org_id = auth_user_org_id())
    AND auth_user_role() IN ('admin', 'super_admin')
  );

-- ── DAILY RECONCILIATIONS (join-based) ─────────────────────────
CREATE POLICY "org_select" ON daily_reconciliations FOR SELECT TO authenticated
  USING (staff_id IN (SELECT id FROM staff WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_insert" ON daily_reconciliations FOR INSERT TO authenticated
  WITH CHECK (staff_id IN (SELECT id FROM staff WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_update" ON daily_reconciliations FOR UPDATE TO authenticated
  USING (staff_id IN (SELECT id FROM staff WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_delete" ON daily_reconciliations FOR DELETE TO authenticated
  USING (
    staff_id IN (SELECT id FROM staff WHERE org_id = auth_user_org_id())
    AND auth_user_role() IN ('admin', 'super_admin')
  );

-- ── RENT CHANGE LOG (join-based) ────────────────────────────────
CREATE POLICY "org_select" ON rent_change_log FOR SELECT TO authenticated
  USING (flat_id IN (SELECT id FROM flats WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_insert" ON rent_change_log FOR INSERT TO authenticated
  WITH CHECK (flat_id IN (SELECT id FROM flats WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_update" ON rent_change_log FOR UPDATE TO authenticated
  USING (flat_id IN (SELECT id FROM flats WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_delete" ON rent_change_log FOR DELETE TO authenticated
  USING (
    flat_id IN (SELECT id FROM flats WHERE org_id = auth_user_org_id())
    AND auth_user_role() IN ('admin', 'super_admin')
  );

-- ── TENANT NAME LOG (join-based) ────────────────────────────────
CREATE POLICY "org_select" ON tenant_name_log FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT id FROM tenants WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_insert" ON tenant_name_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT id FROM tenants WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_update" ON tenant_name_log FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT id FROM tenants WHERE org_id = auth_user_org_id()));
CREATE POLICY "org_delete" ON tenant_name_log FOR DELETE TO authenticated
  USING (
    tenant_id IN (SELECT id FROM tenants WHERE org_id = auth_user_org_id())
    AND auth_user_role() IN ('admin', 'super_admin')
  );


-- ================================================================
-- VERIFICATION QUERIES (run after applying to confirm)
-- ================================================================

-- Check all policies were created:
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND policyname IN ('org_select','org_insert','org_update','org_delete')
-- ORDER BY tablename, cmd;

-- Verify the trigger function is hardened:
-- SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';
