import { column, Schema, Table } from "@powersync/react-native";

const appData = new Table(
  {
    user_id: column.text,
    app_id: column.text,
    key: column.text,
    value: column.text,
    updated_at: column.text,
  },
  { indexes: { by_app: ["app_id"] } },
);

const installedApps = new Table(
  {
    app_id: column.text,
    name: column.text,
    icon_emoji: column.text,
    icon_bg_color: column.text,
    source_type: column.text,
    source_url: column.text,
    bundle_hash: column.text,
    installed_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_app_id: ["app_id"] } },
);

const sessionData = new Table(
  {
    app_id: column.text,
    session_id: column.text,
    key: column.text,
    value: column.text,
    created_at: column.text,
  },
  { indexes: { by_session: ["app_id", "session_id"] } },
);

const sharedInstances = new Table(
  {
    instance_id: column.text,
    app_id: column.text,
    app_name: column.text,
    app_source_url: column.text,
    owner_id: column.text,
    invite_code: column.text,
    created_at: column.text,
    // ─── Freeze support ───
    is_frozen: column.integer,  // PowerSync uses integer for boolean (0 = false, 1 = true)
    frozen_at: column.text,
    frozen_reason: column.text,
  },
  { indexes: { by_app: ["app_id"] } },
);

const instanceMembers = new Table(
  {
    instance_id: column.text,
    user_id: column.text,
    role: column.text,
    joined_at: column.text,
  },
  { indexes: { by_instance: ["instance_id"] } },
);

const sharedAppData = new Table(
  {
    instance_id: column.text,
    app_id: column.text,
    key: column.text,
    value: column.text,
    updated_by: column.text,
    updated_at: column.text,
    // ─── Merge support columns ───
    version: column.integer,
    last_write_id: column.text,
    last_merge_strategy: column.text,
    last_conflict_count: column.integer,
    // ─── Attribution columns ───
    last_editor_user_id: column.text,
    last_editor_display_name: column.text,
  },
  { indexes: { by_instance_app: ["instance_id", "app_id"] } },
);

// Append-only audit log — members read it offline; writes come from SupabaseConnector.
const sharedAppDataHistory = new Table(
  {
    instance_id: column.text,
    app_id: column.text,
    key: column.text,
    value: column.text,
    editor_user_id: column.text,
    editor_display_name: column.text,
    written_at: column.text,
    merge_strategy: column.text,
    version: column.integer,
  },
  { indexes: { by_instance_time: ["instance_id", "written_at"] } },
);

export const PowerSyncSchema = new Schema({
  app_data: appData,
  installed_apps: installedApps,
  session_data: sessionData,
  shared_instances: sharedInstances,
  instance_members: instanceMembers,
  shared_app_data: sharedAppData,
  shared_app_data_history: sharedAppDataHistory,
});
