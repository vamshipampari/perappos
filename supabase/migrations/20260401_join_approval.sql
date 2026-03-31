-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Join Approval for shared instances
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add status column to instance_members.
--    DEFAULT 'active' keeps all existing approved members working.
--    New join requests are inserted with status='pending' by the client.
ALTER TABLE instance_members
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
  CHECK (status IN ('pending', 'active', 'rejected'));

-- 2. Update RLS on shared_app_data: only allow access for ACTIVE members.
--    These replace the existing read/write policies (drop + recreate).

-- Read policy
DROP POLICY IF EXISTS "Members can read shared_app_data" ON shared_app_data;
CREATE POLICY "Members can read shared_app_data"
  ON shared_app_data FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM instance_members im
      WHERE im.instance_id = shared_app_data.instance_id
        AND im.user_id = auth.uid()
        AND im.status = 'active'
    )
  );

-- Write policy
DROP POLICY IF EXISTS "Members can write shared_app_data" ON shared_app_data;
CREATE POLICY "Members can write shared_app_data"
  ON shared_app_data FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM instance_members im
      WHERE im.instance_id = shared_app_data.instance_id
        AND im.user_id = auth.uid()
        AND im.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM instance_members im
      WHERE im.instance_id = shared_app_data.instance_id
        AND im.user_id = auth.uid()
        AND im.status = 'active'
    )
  );

-- 3. Allow pending members to INSERT their own pending row
--    (the client does a direct insert since RLS is DISABLED on instance_members).
--    No RLS change needed for instance_members — RLS is already DISABLED.
--    Confirm: SELECT relrowsecurity FROM pg_class WHERE relname = 'instance_members';
--    Should return 'f' (false).
