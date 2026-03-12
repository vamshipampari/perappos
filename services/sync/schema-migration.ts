/**
 * services/sync/schema-migration.ts
 *
 * Adds the merge-related columns to the existing shared_app_data table
 * in your PowerSync schema.
 *
 * HOW TO USE:
 *
 * Your PowerSync schema is defined in services/sync/schema.ts.
 * You need to add three columns to your existing shared_app_data table definition:
 *
 *   - version (integer, default 0)
 *   - last_write_id (text, nullable)
 *   - last_merge_strategy (text, nullable)
 *   - last_conflict_count (integer, default 0)
 *
 * In PowerSync, schema changes are defined in code (not SQL migrations).
 * Update your schema.ts to include the new columns.
 *
 * ALSO: You need to add these columns in Supabase (Postgres) so they sync:
 *
 *   ALTER TABLE shared_app_data ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
 *   ALTER TABLE shared_app_data ADD COLUMN IF NOT EXISTS last_write_id TEXT;
 *   ALTER TABLE shared_app_data ADD COLUMN IF NOT EXISTS last_merge_strategy TEXT;
 *   ALTER TABLE shared_app_data ADD COLUMN IF NOT EXISTS last_conflict_count INTEGER NOT NULL DEFAULT 0;
 *
 * And update your PowerSync sync rules to include these columns.
 */

// ─── Updated shared_app_data columns for schema.ts ──────────────────
//
// Find your existing shared_app_data table in services/sync/schema.ts
// and add the new columns. It should look something like this:
//
//   new Table({
//     name: 'shared_app_data',
//     columns: [
//       new Column({ name: 'instance_id', type: ColumnType.TEXT }),
//       new Column({ name: 'app_id', type: ColumnType.TEXT }),
//       new Column({ name: 'key', type: ColumnType.TEXT }),
//       new Column({ name: 'value', type: ColumnType.TEXT }),
//       new Column({ name: 'updated_by', type: ColumnType.TEXT }),
//       new Column({ name: 'updated_at', type: ColumnType.TEXT }),
//       // ─── NEW: merge support columns ───
//       new Column({ name: 'version', type: ColumnType.INTEGER }),
//       new Column({ name: 'last_write_id', type: ColumnType.TEXT }),
//       new Column({ name: 'last_merge_strategy', type: ColumnType.TEXT }),
//       new Column({ name: 'last_conflict_count', type: ColumnType.INTEGER }),
//     ],
//   }),

// ─── Supabase SQL to run ────────────────────────────────────────────

export const SUPABASE_MIGRATION_SQL = `
-- Run this in Supabase SQL Editor

ALTER TABLE shared_app_data ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shared_app_data ADD COLUMN IF NOT EXISTS last_write_id TEXT;
ALTER TABLE shared_app_data ADD COLUMN IF NOT EXISTS last_merge_strategy TEXT;
ALTER TABLE shared_app_data ADD COLUMN IF NOT EXISTS last_conflict_count INTEGER NOT NULL DEFAULT 0;

-- Optional: index for faster version lookups during conflict detection
CREATE INDEX IF NOT EXISTS idx_shared_app_data_version 
  ON shared_app_data (instance_id, app_id, key, version);
`;

// ─── PowerSync sync rules update ────────────────────────────────────

export const POWERSYNC_SYNC_RULES_NOTE = `
Update your PowerSync sync rules (in PowerSync dashboard or YAML) to include
the new columns. The shared_app_data table's SELECT should include:

  SELECT id, instance_id, app_id, key, value, updated_by, updated_at,
         version, last_write_id, last_merge_strategy, last_conflict_count
  FROM shared_app_data
  WHERE instance_id IN (
    SELECT instance_id FROM instance_members WHERE user_id = token_parameters.user_id
  )
`;

// ─── SupabaseConnector.uploadData() update ──────────────────────────

export const UPLOAD_DATA_NOTE = `
In services/sync/SupabaseConnector.ts, your uploadData() method processes
the CRUD queue. For shared_app_data writes, it already attaches updated_by.

You also need to make sure it passes through the new columns:
  - version
  - last_write_id
  - last_merge_strategy  
  - last_conflict_count

These should already flow through if your uploadData() does a generic
column pass-through (spreading all record columns into the upsert).
If it cherry-picks columns, add the new ones.
`;
