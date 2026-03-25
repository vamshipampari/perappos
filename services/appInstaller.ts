/**
 * Installs a URL-based app into the local SQLite apps table.
 * Shared by add.tsx (via manual install) and app/share/[code].tsx (via share link).
 * Does not fetch metadata — caller supplies name/icon so no network round-trip is needed.
 */

import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { supabase } from './supabase';
import { powerSyncDb } from './sync/PowerSyncProvider';

export interface InstallUrlOptions {
  url: string;
  name: string;
  iconEmoji: string;
  iconBgColor: string;
  appId?: string;
}

/**
 * Inserts a new URL app row and returns the generated app_id.
 * For URL apps the WebView loads live from the network, so no bundle
 * needs to be written to disk — bundle_path is stored as '' and
 * bundle_html as NULL.
 */
export async function installUrlApp(
  db: SQLiteDatabase,
  options: InstallUrlOptions
): Promise<string> {
  const appId = options.appId ?? Crypto.randomUUID();

  await db.runAsync(
    `INSERT INTO apps
       (app_id, name, icon_emoji, icon_bg_color, bundle_path, bundle_html,
        source_type, source_url, bundle_hash, bundle_size, installed_at, updated_at)
     VALUES (?, ?, ?, ?, '', NULL, 'url', ?, NULL, 0, datetime('now'), datetime('now'))`,
    appId,
    options.name,
    options.iconEmoji,
    options.iconBgColor,
    options.url
  );

  // Mirror to PowerSync installed_apps so the app list syncs cross-device
  void powerSyncDb.execute(
    `INSERT OR REPLACE INTO installed_apps
       (id, app_id, name, icon_emoji, icon_bg_color, source_type, source_url,
        bundle_hash, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'url', ?, NULL, datetime('now'), datetime('now'))`,
    [appId, appId, options.name, options.iconEmoji, options.iconBgColor, options.url]
  ).catch(() => {}); // fire-and-forget, non-critical

  // Increment app count (fire-and-forget)
  void supabase.rpc('increment_app_count', { delta: 1 }).then(undefined, () => {});

  return appId;
}
