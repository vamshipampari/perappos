-- ============================================================
-- Migration: Write Attribution for Shared Instance Data
-- Date: 2026-03-30
-- ============================================================
-- Run this in Supabase → SQL Editor (Project → SQL Editor → New query)
-- DO NOT apply automatically — review each statement before running.
-- ============================================================


-- ── Step 1: Add attribution columns to shared_app_data ──────────────────────

ALTER TABLE public.shared_app_data
  ADD COLUMN IF NOT EXISTS last_editor_user_id TEXT,
  ADD COLUMN IF NOT EXISTS last_editor_display_name TEXT;


-- ── Step 2: Create append-only audit log table ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.shared_app_data_history (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id          TEXT        NOT NULL,
  app_id               TEXT        NOT NULL,
  key                  TEXT        NOT NULL,
  value                TEXT        NOT NULL,
  editor_user_id       TEXT        NOT NULL,
  editor_display_name  TEXT        NOT NULL,
  written_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  merge_strategy       TEXT,
  version              INTEGER     NOT NULL
);

CREATE INDEX IF NOT EXISTS shared_app_data_history_key_time_idx
  ON public.shared_app_data_history (instance_id, app_id, key, written_at DESC);

CREATE INDEX IF NOT EXISTS shared_app_data_history_instance_time_idx
  ON public.shared_app_data_history (instance_id, written_at DESC);


-- ── Step 3: RLS on shared_app_data_history ───────────────────────────────────
-- Members of the instance can SELECT history (read audit log).
-- Writes go through the service role / upsert RPC only.

ALTER TABLE public.shared_app_data_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read shared_app_data_history" ON public.shared_app_data_history;
CREATE POLICY "Members can read shared_app_data_history"
  ON public.shared_app_data_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.instance_members
      WHERE instance_members.instance_id = shared_app_data_history.instance_id
        AND instance_members.user_id = auth.uid()  -- auth.uid() is uuid, no ::text cast
    )
  );

-- Allow authenticated users to insert history rows for instances they belong to.
-- (The mobile app inserts directly via service role. This policy covers the anon key path.)
DROP POLICY IF EXISTS "Members can insert shared_app_data_history" ON public.shared_app_data_history;
CREATE POLICY "Members can insert shared_app_data_history"
  ON public.shared_app_data_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.instance_members
      WHERE instance_members.instance_id = shared_app_data_history.instance_id
        AND instance_members.user_id = auth.uid()
    )
  );


-- ── Step 4: Update upsert_shared_app_data_versioned RPC ──────────────────────
-- Drop + recreate with the two new attribution params.
-- The function only updates the row if p_version >= the existing version
-- (preventing stale CRUD entries from overwriting newer remote writes).

DROP FUNCTION IF EXISTS public.upsert_shared_app_data_versioned(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
);

CREATE OR REPLACE FUNCTION public.upsert_shared_app_data_versioned(
  p_id                    TEXT,
  p_instance_id           TEXT,
  p_app_id                TEXT,
  p_key                   TEXT,
  p_value                 TEXT,
  p_version               INTEGER,
  p_updated_by            TEXT,
  p_updated_at            TEXT,
  p_last_write_id         TEXT,
  p_last_merge_strategy   TEXT,
  p_last_conflict_count   INTEGER,
  p_last_editor_user_id   TEXT    DEFAULT NULL,
  p_last_editor_display_name TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.shared_app_data (
    id, instance_id, app_id, key, value, version,
    updated_by, updated_at, last_write_id,
    last_merge_strategy, last_conflict_count,
    last_editor_user_id, last_editor_display_name
  )
  VALUES (
    p_id, p_instance_id, p_app_id, p_key, p_value, p_version,
    p_updated_by, p_updated_at::timestamptz, p_last_write_id,
    p_last_merge_strategy, p_last_conflict_count,
    p_last_editor_user_id, p_last_editor_display_name
  )
  ON CONFLICT ON CONSTRAINT shared_app_data_natural_key
  DO UPDATE SET
    id                      = EXCLUDED.id,
    value                   = EXCLUDED.value,
    version                 = EXCLUDED.version,
    updated_by              = EXCLUDED.updated_by,
    updated_at              = EXCLUDED.updated_at,
    last_write_id           = EXCLUDED.last_write_id,
    last_merge_strategy     = EXCLUDED.last_merge_strategy,
    last_conflict_count     = EXCLUDED.last_conflict_count,
    last_editor_user_id     = EXCLUDED.last_editor_user_id,
    last_editor_display_name = EXCLUDED.last_editor_display_name
  WHERE EXCLUDED.version >= shared_app_data.version;
END;
$$;


-- ── Step 5: PowerSync sync rules reminder ────────────────────────────────────
-- After applying this migration, update your PowerSync sync rules on the
-- PowerSync dashboard to:
--
-- 1. Add to the shared_app_data table projection:
--      last_editor_user_id
--      last_editor_display_name
--
-- 2. Add a new synced table for shared_app_data_history:
--    table: shared_app_data_history
--    parameters: instance_id from instance_members WHERE user_id = token_parameters.user_id
--    columns: id, instance_id, app_id, key, value, editor_user_id,
--             editor_display_name, written_at, merge_strategy, version
--
-- IMPORTANT: Never use table aliases in PowerSync sync rules.
-- Use full table names in JOINs.
