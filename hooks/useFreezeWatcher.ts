/**
 * Watches shared_instances.is_frozen for a given instanceId and returns the
 * current frozen state. Runs an initial check on mount and stays up-to-date
 * via PowerSync's db.watch() for real-time banner show/hide.
 */

import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { log } from '@/lib/logger';

export function useFreezeWatcher(
  instanceId: string | null | undefined,
  syncDbRef: RefObject<AbstractPowerSyncDatabase>
): boolean {
  const [isFrozen, setIsFrozen] = useState(false);

  // Initial check on mount / instanceId change
  useEffect(() => {
    if (!instanceId) {
      setIsFrozen(false);
      return;
    }
    (async () => {
      try {
        const rows = await syncDbRef.current?.getAll(
          `SELECT is_frozen FROM shared_instances WHERE instance_id = ?`,
          [instanceId]
        );
        if (rows && rows.length > 0) {
          setIsFrozen((rows[0] as Record<string, unknown>).is_frozen === 1);
        }
      } catch (err) {
        log.warn('[app] freeze status initial check failed:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]); // syncDbRef is a ref — intentionally excluded

  // Live watcher — updates banner in real-time when owner's plan changes
  useEffect(() => {
    if (!instanceId) return;

    const abortController = new AbortController();

    async function watchFreezeStatus() {
      const db = syncDbRef.current;
      if (!db) return;

      try {
        for await (const result of db.watch(
          `SELECT is_frozen FROM shared_instances WHERE instance_id = ?`,
          [instanceId],
          { signal: abortController.signal, throttleMs: 500 }
        )) {
          if (abortController.signal.aborted) break;
          const rows = result.rows?._array ?? [];
          if (rows.length > 0) {
            setIsFrozen(rows[0].is_frozen === 1);
          }
        }
      } catch (err: unknown) {
        const errObj = err as { name?: string } | null;
        if (errObj?.name !== 'AbortError') {
          log.warn('[app] freeze watcher error:', err);
        }
      }
    }

    watchFreezeStatus();

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]); // syncDbRef is a ref — intentionally excluded

  return isFrozen;
}
