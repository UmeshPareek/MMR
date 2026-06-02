-- ================================================================
-- FIX: Allow flat deletion by making FK references safe
--
-- Problem: rent_collections.flat_id is NOT NULL with a FK to flats.
-- Deleting a flat fails because:
--   1. Cannot SET NULL (column is NOT NULL)
--   2. Cannot delete flat while references exist (FK violation)
--
-- Solution: Change FK constraints to ON DELETE SET NULL.
-- Postgres will automatically null out flat_id in all child tables
-- when a flat is deleted — no application code needed.
--
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- ── rent_collections ──────────────────────────────────────────────
-- First make the column nullable, then re-add FK with ON DELETE SET NULL
ALTER TABLE rent_collections ALTER COLUMN flat_id DROP NOT NULL;

ALTER TABLE rent_collections
  DROP CONSTRAINT IF EXISTS rent_collections_flat_id_fkey;

ALTER TABLE rent_collections
  ADD CONSTRAINT rent_collections_flat_id_fkey
  FOREIGN KEY (flat_id) REFERENCES flats(id) ON DELETE SET NULL;

-- ── tenants ───────────────────────────────────────────────────────
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_flat_id_fkey;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_flat_id_fkey
  FOREIGN KEY (flat_id) REFERENCES flats(id) ON DELETE SET NULL;

-- ── security_deposits ─────────────────────────────────────────────
ALTER TABLE security_deposits
  DROP CONSTRAINT IF EXISTS security_deposits_flat_id_fkey;

ALTER TABLE security_deposits
  ADD CONSTRAINT security_deposits_flat_id_fkey
  FOREIGN KEY (flat_id) REFERENCES flats(id) ON DELETE SET NULL;

-- ── utility_charges ───────────────────────────────────────────────
ALTER TABLE utility_charges
  DROP CONSTRAINT IF EXISTS utility_charges_flat_id_fkey;

ALTER TABLE utility_charges
  ADD CONSTRAINT utility_charges_flat_id_fkey
  FOREIGN KEY (flat_id) REFERENCES flats(id) ON DELETE SET NULL;

-- ── meter_readings (if flat_id exists) ───────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='meter_readings' AND column_name='flat_id'
  ) THEN
    ALTER TABLE meter_readings
      DROP CONSTRAINT IF EXISTS meter_readings_flat_id_fkey;
    ALTER TABLE meter_readings
      ADD CONSTRAINT meter_readings_flat_id_fkey
      FOREIGN KEY (flat_id) REFERENCES flats(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Verify: show all FK constraints on flats ─────────────────────
SELECT
  tc.table_name,
  kcu.column_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.key_column_usage kcu2
  ON rc.unique_constraint_name = kcu2.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND kcu2.table_name = 'flats'
ORDER BY tc.table_name;
