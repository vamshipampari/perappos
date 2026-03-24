/**
 * Background update scanning for the home screen.
 *
 * Runs checkForUpdates() concurrently across all auto-update-eligible apps
 * whenever the screen gains focus. Cancels stale scans with a sequence counter
 * so that navigating away + back doesn't produce a double-update.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { checkForUpdates } from '@/lib/appUpdates';
import type { InstalledApp } from '@/types';

const UPDATE_SCAN_CONCURRENCY = 3;

export function useUpdateScanner(apps: InstalledApp[]) {
  const [updatesAvailable, setUpdatesAvailable] = useState<Record<string, boolean>>({});
  const [scanRunning, setScanRunning] = useState(false);

  const scanSeqRef = useRef(0);
  const scanRunningRef = useRef(false);
  const hasScannedForCurrentFocusRef = useRef(false);
  const latestAppsRef = useRef<InstalledApp[]>([]);

  const eligibleAutoUpdateApps = useMemo(
    () => apps.filter((a) => a.auto_update === 1 && a.source_type === 'url' && !!a.source_url),
    [apps]
  );

  useEffect(() => {
    latestAppsRef.current = apps;
  }, [apps]);

  const runBackgroundUpdateScan = useCallback(async () => {
    if (eligibleAutoUpdateApps.length === 0 || scanRunningRef.current) return;
    scanRunningRef.current = true;
    const seq = ++scanSeqRef.current;
    setScanRunning(true);

    const found: Record<string, boolean> = {};
    let cursor = 0;
    const worker = async () => {
      while (cursor < eligibleAutoUpdateApps.length) {
        const i = cursor++;
        const app = eligibleAutoUpdateApps[i];
        try {
          const result = await checkForUpdates(app);
          if (result.available) found[app.app_id] = true;
        } catch {
          // Ignore transient failures in background checks.
        }
      }
    };

    const workerCount = Math.min(UPDATE_SCAN_CONCURRENCY, eligibleAutoUpdateApps.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (seq === scanSeqRef.current) {
      setUpdatesAvailable(() => {
        const next: Record<string, boolean> = {};
        for (const app of latestAppsRef.current) {
          if (found[app.app_id]) next[app.app_id] = true;
        }
        return next;
      });
    }

    scanRunningRef.current = false;
    setScanRunning(false);
  }, [eligibleAutoUpdateApps]);

  useFocusEffect(
    useCallback(() => {
      hasScannedForCurrentFocusRef.current = false;
      return () => {
        scanSeqRef.current += 1;
        scanRunningRef.current = false;
        setScanRunning(false);
      };
    }, [])
  );

  useEffect(() => {
    if (hasScannedForCurrentFocusRef.current) return;
    hasScannedForCurrentFocusRef.current = true;
    runBackgroundUpdateScan().catch(() => {});
  }, [apps, runBackgroundUpdateScan]);

  return { updatesAvailable, setUpdatesAvailable, scanRunning, runBackgroundUpdateScan };
}
