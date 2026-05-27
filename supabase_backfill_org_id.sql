-- ================================================================
-- BACKFILL: Set profiles.org_id for existing team members
-- ================================================================
-- Root cause: CashMyRent-Admin's add-org-member API was setting
-- the user's role in profiles but not their org_id. This left
-- profiles.org_id = NULL, which caused RLS INSERT checks to fail
-- on all financial tables (expenses, rent_collections, etc.)
-- because: NULL = auth_user_org_id() → NULL → WITH CHECK fails.
--
-- Run once in the Supabase SQL editor.
-- Safe to re-run — only updates rows where org_id IS NULL.
-- ================================================================

-- Step 1: Backfill org_id from organization_members → profiles
UPDATE public.profiles p
SET org_id = om.organization_id
FROM public.organization_members om
WHERE om.user_id = p.id
  AND p.org_id IS NULL;

-- Step 2: Confirm — should return 0 rows if all fixed
-- (run this separately to verify)
-- SELECT id, email, role, org_id
-- FROM public.profiles
-- WHERE org_id IS NULL AND role IN ('team', 'admin', 'super_admin');
