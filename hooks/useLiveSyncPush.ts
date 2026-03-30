/**
 * Watches PowerSync shared_app_data for remote changes and pushes them
 * into the running WebView via window._VaultSyncPush.
 *
 * IMPORTANT: syncDbRef and webViewRef are refs — they must NOT be in the
 * dependency array. Adding syncDb to deps would restart this effect on every
 * PowerSync sync cycle (learning.md #15), tearing down the async iterable.
 *
 * ownWriteIds is checked on each emission to skip writes that originated
 * from this device, preventing echo feedback loops (learning.md #18).
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { log } from '@/lib/logger';

interface PendingUpdate {
  key: string;
  value: string;
  version: number;
  lastEditorUserId?: string | null;
  lastEditorDisplayName?: string | null;
  writtenAt?: string | null;
}

export function useLiveSyncPush(
  instanceId: string | null | undefined,
  appId: string | undefined,
  syncDbRef: RefObject<AbstractPowerSyncDatabase>,
  webViewRef: RefObject<WebView | null>,
  ownWriteIds: RefObject<Set<string>>,
  pendingRemoteUpdates: RefObject<PendingUpdate[]>
): void {
  useEffect(() => {
    if (!instanceId || !appId) return;

    const abortController = new AbortController();

    // Track last-pushed version per key to skip duplicate full-result-set emissions.
    const lastPushedVersions = new Map<string, number>();

    // Debounce: 50ms — batches rapid multi-key writes, keeps latency low.
    let pendingUpdates: PendingUpdate[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function flushUpdates() {
      debounceTimer = null;
      if (pendingUpdates.length === 0) return;

      if (!webViewRef.current) {
        // WebView not ready yet — buffer for onLoadEnd
        log.info('[live-push] WebView not ready — buffering', pendingUpdates.length, 'update(s)');
        pendingRemoteUpdates.current.push(...pendingUpdates);
        pendingUpdates = [];
        return;
      }

      const payload = JSON.stringify(pendingUpdates);
      webViewRef.current.injectJavaScript(
        `window._VaultSyncPush && window._VaultSyncPush(${payload});true;`
      );
      pendingUpdates = [];
    }

    async function startWatching() {
      const db = syncDbRef.current;
      if (!db) {
        log.warn('[live-push] syncDbRef.current is null — watcher not started');
        return;
      }

      try {
        const watchQuery = `
          SELECT key, value, COALESCE(version, 0) as version, last_write_id,
                 last_editor_user_id, last_editor_display_name, updated_at
          FROM shared_app_data
          WHERE instance_id = ? AND app_id = ?
        `;

        // db.watch() returns AsyncIterable<QueryResult>.
        // Each emission is the FULL result set (not a delta).
        // throttleMs: 30ms is the PowerSync default — explicit here for clarity.
        for await (const result of db.watch(
          watchQuery,
          [instanceId, appId],
          { signal: abortController.signal, throttleMs: 30 }
        )) {
          if (abortController.signal.aborted) break;

          const rows = result.rows?._array ?? [];

          for (const row of rows) {
            // Skip own writes (prevent feedback loop)
            if (row.last_write_id && ownWriteIds.current.has(row.last_write_id)) {
              continue;
            }

            // Skip if we already pushed this version
            const lastPushed = lastPushedVersions.get(row.key) ?? 0;
            if (row.version <= lastPushed) {
              continue;
            }

            lastPushedVersions.set(row.key, row.version);
            pendingUpdates.push({
              key: row.key,
              value: row.value,
              version: row.version,
              lastEditorUserId: (row.last_editor_user_id as string | null) ?? null,
              lastEditorDisplayName: (row.last_editor_display_name as string | null) ?? null,
              writtenAt: (row.updated_at as string | null) ?? null,
            });
          }

          if (pendingUpdates.length > 0 && !debounceTimer) {
            debounceTimer = setTimeout(flushUpdates, 50);
          }
        }
      } catch (err: unknown) {
        const errObj = err as { name?: string } | null;
        if (errObj?.name !== 'AbortError') {
          log.error('[live-push] watcher error:', err);
        }
      }
    }

    startWatching();

    return () => {
      log.info('[live-push] watcher teardown for instanceId:', instanceId);
      abortController.abort();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, appId]); // syncDbRef, webViewRef, ownWriteIds, pendingRemoteUpdates are refs — intentionally excluded
}
