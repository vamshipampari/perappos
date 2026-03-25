/**
 * Restores a user's app list on a new device by reading from the PowerSync
 * `installed_apps` table (synced from Supabase) and inserting any missing
 * apps into the local SQLite `apps` table.
 *
 * Only runs when:
 *   1. The user has no non-demo apps locally (fresh device / after wipe)
 *   2. PowerSync has synced at least one `installed_apps` row from the server
 *
 * Uses db.watch() so it fires reactively when PowerSync first downloads
 * the user's app list — no polling needed.
 *
 * URL apps restore fully (load from source_url). HTML/ZIP apps restore
 * their tile metadata but require the user to re-import the bundle to open.
 */

import { useEffect, useRef } from 'react';

import { useToast } from '@/components/Toast';
import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { log } from '@/lib/logger';
import { usePowerSync } from '@/services/sync/PowerSyncProvider';

interface SyncedAppRow {
  id: string;
  app_id: string;
  name: string | null;
  icon_emoji: string | null;
  icon_bg_color: string | null;
  source_type: string | null;
  source_url: string | null;
  bundle_hash: string | null;
  installed_at: string | null;
}

export function useRestoreApps() {
  const db = useDatabase();
  const { db: syncDb } = usePowerSync();
  const { apps, refresh } = useInstalledApps();
  const { showToast } = useToast();
  const restoredRef = useRef(false);

  useEffect(() => {
    // If the user already has non-demo apps locally, nothing to restore.
    const localNonDemo = apps.filter((a) => a.source_type !== 'demo').length;
    if (localNonDemo > 0 || restoredRef.current) return;

    const controller = new AbortController();

    const doRestore = async (rows: SyncedAppRow[]) => {
      if (rows.length === 0 || restoredRef.current) return;
      restoredRef.current = true;
      controller.abort(); // stop watching once we've restored

      let restored = 0;
      for (const row of rows) {
        try {
          await db.runAsync(
            `INSERT OR IGNORE INTO apps
               (app_id, name, icon_emoji, icon_bg_color, source_type, source_url,
                bundle_hash, bundle_size, bundle_html, bundle_path, installed_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, '', ?, datetime('now'))`,
            [
              row.app_id,
              row.name ?? 'My App',
              row.icon_emoji ?? '📱',
              row.icon_bg_color ?? '#DBEAFE',
              row.source_type ?? 'url',
              row.source_url ?? null,
              row.bundle_hash ?? null,
              row.installed_at ?? new Date().toISOString(),
            ]
          );
          restored++;
        } catch (err) {
          log.warn('[useRestoreApps] skipping row:', row.app_id, err);
        }
      }

      if (restored > 0) {
        await refresh();
        showToast(`${restored} app${restored !== 1 ? 's' : ''} restored`, 'success');
        log.info(`[useRestoreApps] restored ${restored} apps from PowerSync`);
      }
    };

    // Watch the PowerSync installed_apps table.
    // Fires immediately with current data, then again whenever PowerSync syncs.
    (async () => {
      try {
        for await (const result of syncDb.watch(
          'SELECT id, app_id, name, icon_emoji, icon_bg_color, source_type, source_url, bundle_hash, installed_at FROM installed_apps ORDER BY installed_at ASC',
          [],
          { signal: controller.signal, throttleMs: 500 }
        )) {
          if (controller.signal.aborted) break;
          const rows: SyncedAppRow[] = result.rows?._array ?? [];
          if (rows.length > 0) {
            await doRestore(rows);
            break; // restore once then exit
          }
        }
      } catch {
        // AbortError is expected when controller.abort() is called — ignore silently
      }
    })();

    return () => controller.abort();
  // Re-evaluate if app count changes (e.g. user installs an app manually)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps.length]);
}
