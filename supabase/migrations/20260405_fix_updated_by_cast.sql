-- Fix: cast p_updated_by TEXT → UUID in upsert_shared_app_data_versioned
-- The shared_app_data.updated_by column is UUID but the RPC param was TEXT with no cast,
-- causing Postgres error 42804 on every shared_app_data upload.

DROP FUNCTION IF EXISTS public.upsert_shared_app_data_versioned(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
);
DROP FUNCTION IF EXISTS public.upsert_shared_app_data_versioned(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.upsert_shared_app_data_versioned(
  p_id                       TEXT,
  p_instance_id              TEXT,
  p_app_id                   TEXT,
  p_key                      TEXT,
  p_value                    TEXT,
  p_version                  INTEGER,
  p_updated_by               TEXT,
  p_updated_at               TEXT,
  p_last_write_id            TEXT,
  p_last_merge_strategy      TEXT,
  p_last_conflict_count      INTEGER,
  p_last_editor_user_id      TEXT    DEFAULT NULL,
  p_last_editor_display_name TEXT    DEFAULT NULL
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
    p_updated_by::uuid, p_updated_at::timestamptz, p_last_write_id,
    p_last_merge_strategy, p_last_conflict_count,
    p_last_editor_user_id, p_last_editor_display_name
  )
  ON CONFLICT ON CONSTRAINT shared_app_data_natural_key
  DO UPDATE SET
    id                       = EXCLUDED.id,
    value                    = EXCLUDED.value,
    version                  = EXCLUDED.version,
    updated_by               = EXCLUDED.updated_by,
    updated_at               = EXCLUDED.updated_at,
    last_write_id            = EXCLUDED.last_write_id,
    last_merge_strategy      = EXCLUDED.last_merge_strategy,
    last_conflict_count      = EXCLUDED.last_conflict_count,
    last_editor_user_id      = EXCLUDED.last_editor_user_id,
    last_editor_display_name = EXCLUDED.last_editor_display_name
  WHERE EXCLUDED.version >= shared_app_data.version;
END;
$$;
