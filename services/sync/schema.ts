import { column, Schema, Table } from '@powersync/react-native';

const appData = new Table({
  user_id: column.text,
  app_id: column.text,
  key: column.text,
  value: column.text,
  updated_at: column.text,
}, { indexes: { by_app: ['app_id'] } });

const installedApps = new Table({
  app_id: column.text,
  name: column.text,
  icon_emoji: column.text,
  icon_bg_color: column.text,
  source_type: column.text,
  source_url: column.text,
  bundle_hash: column.text,
  installed_at: column.text,
  updated_at: column.text,
}, { indexes: { by_app_id: ['app_id'] } });

const sessionData = new Table({
  app_id: column.text,
  session_id: column.text,
  key: column.text,
  value: column.text,
  created_at: column.text,
}, { indexes: { by_session: ['app_id', 'session_id'] } });

export const PowerSyncSchema = new Schema({
  app_data: appData,
  installed_apps: installedApps,
  session_data: sessionData,
});
