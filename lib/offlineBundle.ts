/**
 * Offline bundle helpers for HTML-type apps.
 *
 * enableOffline  — downloads the HTML from the cloud URL, writes it to the
 *                  local file system, and marks the app as offline-capable.
 * disableOffline — deletes the local copy and reverts the app to loading
 *                  from the network URL.
 *
 * Follows the exact same patterns as lib/appUpdates.ts:
 * same imports, same directory layout (documentDirectory/apps/{appId}/),
 * same bundle_path normalisation, same bundle_size convention (html.length).
 */

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

function getAppDir(appId: string): string {
  return `${FileSystem.documentDirectory}apps/${appId}/`;
}

/**
 * Downloads the HTML from sourceUrl, writes it to the local file system,
 * and updates the apps row:
 *   offline_enabled = 1
 *   bundle_path     = local file-system path (stripped of file:// prefix)
 *   bundle_html     = full HTML content
 *   bundle_hash     = SHA-256 of the HTML
 *   bundle_size     = html.length (character count, consistent with appUpdates.ts)
 */
export async function enableOffline(
  appId: string,
  sourceUrl: string,
  db: SQLiteDatabase,
): Promise<void> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, html);
  const appDir = getAppDir(appId);
  await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });
  await FileSystem.writeAsStringAsync(`${appDir}index.html`, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // Normalise path: strip file:// prefix and trailing slash (mirrors appUpdates.ts)
  const bundlePath = appDir.replace(/^file:\/\//, '').replace(/\/$/, '');

  await db.runAsync(
    `UPDATE apps
       SET offline_enabled = 1,
           bundle_path     = ?,
           bundle_html     = ?,
           bundle_hash     = ?,
           bundle_size     = ?,
           updated_at      = datetime('now')
     WHERE app_id = ?`,
    bundlePath,
    html,
    hash,
    html.length,
    appId,
  );
}

/**
 * Deletes the local bundle directory and resets the apps row:
 *   offline_enabled = 0
 *   bundle_html     = NULL  (WebView falls back to loading source_url over network)
 *   bundle_hash     = NULL
 *   bundle_path     = ''
 */
export async function disableOffline(appId: string, db: SQLiteDatabase): Promise<void> {
  const appDir = getAppDir(appId);
  await FileSystem.deleteAsync(appDir, { idempotent: true });

  await db.runAsync(
    `UPDATE apps
       SET offline_enabled = 0,
           bundle_path     = '',
           bundle_html     = NULL,
           bundle_hash     = NULL,
           updated_at      = datetime('now')
     WHERE app_id = ?`,
    appId,
  );
}
