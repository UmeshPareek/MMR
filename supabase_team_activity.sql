-- ================================================================
-- TEAM ACTIVITY LOG
-- Tracks every INSERT and UPDATE made by any team member across
-- financial tables. Admin can review the monthly changes report
-- in Settings → Activity.
--
-- Run once in the Supabase SQL editor.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.team_activity_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      text        NOT NULL CHECK (action IN ('created', 'edited')),
  entity      text        NOT NULL,   -- 'payment' | 'expense' | 'owner_payment' | 'salary' | 'advance' | 'utility'
  entity_id   uuid,
  summary     text        NOT NULL,   -- human-readable one-liner
  for_month   text        NOT NULL,   -- 'YYYY-MM' — used for monthly filtering
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for fast monthly lookups per org
CREATE INDEX IF NOT EXISTS idx_team_activity_log_org_month
  ON public.team_activity_log (org_id, for_month, created_at DESC);

-- RLS
ALTER TABLE public.team_activity_log ENABLE ROW LEVEL SECURITY;

-- Anyone in the org can read the log
CREATE POLICY "org_select" ON public.team_activity_log FOR SELECT TO authenticated
  USING (org_id = auth_user_org_id());

-- Anyone in the org can insert their own entries (frontend logs on save)
CREATE POLICY "org_insert" ON public.team_activity_log FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_user_org_id() AND user_id = auth.uid());

-- No updates or deletes — log is append-only
