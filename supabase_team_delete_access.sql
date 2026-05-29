-- ================================================================
-- TEAM DELETE ACCESS
-- Allows all authenticated team members (not just admin/super_admin)
-- to delete records within their own organisation.
--
-- Why: The "org_delete" policies in supabase_security_hardening.sql
-- restricted DELETE to admin/super_admin only. This caused silent
-- failures for team members — Supabase returned "success" but
-- deleted 0 rows because the RLS USING clause evaluated to false.
--
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- ── RENT COLLECTIONS (Payments page) ─────────────────────────────
DROP POLICY IF EXISTS "org_delete" ON rent_collections;
CREATE POLICY "org_delete" ON rent_collections
  FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id());

-- ── EXPENSES ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_delete" ON expenses;
CREATE POLICY "org_delete" ON expenses
  FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id());

-- ── UTILITY BILLS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_delete" ON utility_bills;
CREATE POLICY "org_delete" ON utility_bills
  FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id());

-- ── OWNER PAYMENTS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_delete" ON owner_payments;
CREATE POLICY "org_delete" ON owner_payments
  FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id());

-- ── STAFF ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_delete" ON staff;
CREATE POLICY "org_delete" ON staff
  FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id());

-- ── STAFF SALARIES ────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_delete" ON staff_salaries;
CREATE POLICY "org_delete" ON staff_salaries
  FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id());

-- ── STAFF ADVANCES ────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_delete" ON staff_advances;
CREATE POLICY "org_delete" ON staff_advances
  FOR DELETE TO authenticated
  USING (org_id = auth_user_org_id());

-- ── METER READINGS (Utility Bills page) ──────────────────────────
DROP POLICY IF EXISTS "org_delete" ON meter_readings;
CREATE POLICY "org_delete" ON meter_readings
  FOR DELETE TO authenticated
  USING (
    flat_id IN (SELECT id FROM flats WHERE org_id = auth_user_org_id())
  );

-- ── VERIFY: check all delete policies are now role-free ──────────
SELECT
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'DELETE'
  AND tablename IN (
    'rent_collections','expenses','utility_bills',
    'owner_payments','staff','staff_salaries','staff_advances','meter_readings'
  )
ORDER BY tablename;
