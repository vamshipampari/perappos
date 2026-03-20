/**
 * State machine for the WebView app runner screen.
 *
 * Manages:
 * - App row loading from SQLite
 * - Shim JS construction (personal or shared sync shim)
 * - Bundle HTML loading from filesystem
 * - Auth session tracking
 * - ownWriteIds pruning interval
 *
 * IMPORTANT: loadShimPayload has empty useCallback deps by design — syncDbRef is
 * a ref so reads always get the latest value without re-triggering effects.
 * See learning.md #15.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import type WebView from 'react-native-webview';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { buildVaultShim } from '@/lib/vaultShim';
import { buildSyncShim } from '@/lib/vaultShimSync';
import { log } from '@/lib/logger';
import { DEMO_HTML_BY_NAME } from '@/utils/demoAppsHtml';
import { supabase } from '@/services/supabase';
import type { InstalledApp, Phase } from '@/types';

interface UseWebViewAppResult {
  phase: Phase;
  app: InstalledApp | null;
  setApp: (app: InstalledApp) => void;
  shimJS: string;
  setShimJS: (js: string) => void;
  bundleHtml: string | null;
  signedInUserId: string | null;
  /** Stable reference — empty deps. See learning.md #15. */
  loadShimPayload: (target: InstalledApp) => Promise<{
    shim: string;
    preloadSource: 'shared' | 'personal-fallback' | 'local';
  }>;
  rebuildShimForApp: (target: InstalledApp) => Promise<void>;
  webViewRef: RefObject<WebView | null>;
  hasLoadedOnceRef: RefObject<boolean>;
  ownWriteIds: RefObject<Set<string>>;
}

export function useWebViewApp(
  id: string | undefined,
  db: SQLiteDatabase,
  syncDbRef: RefObject<AbstractPowerSyncDatabase>
): UseWebViewAppResult {
  const webViewRef = useRef<WebView>(null);
  const hasLoadedOnceRef = useRef(false);
  // Track clientWriteIds that originated from THIS device so the live sync
  // push watcher can skip them (prevents echo feedback loops).
  const ownWriteIds = useRef<Set<string>>(new Set());

  const [phase, setPhase] = useState<Phase>('loading');
  const [app, setApp] = useState<InstalledApp | null>(null);
  const [shimJS, setShimJS] = useState('');
  const [bundleHtml, setBundleHtml] = useState<string | null>(null);
  const [signedInUserId, setSignedInUserId] = useState<string | null>(null);

  const loadShimPayload = useCallback(
    async (target: InstalledApp): Promise<{
      shim: string;
      preloadSource: 'shared' | 'personal-fallback' | 'local';
    }> => {
      const db = syncDbRef.current;
      const preloadedData: Record<string, string> = {};
      const preloadedVersions: Record<string, number> = {};

      if (target.instance_id) {
        const sharedRows = await db.getAll<{ key: string; value: string; version: number | null }>(
          `SELECT key, value, COALESCE(version, 0) as version
           FROM shared_app_data
           WHERE instance_id = ? AND app_id = ?
           ORDER BY version DESC`,
          [target.instance_id, target.app_id]
        );

        for (const row of sharedRows) {
          if (row.key in preloadedData) continue;
          preloadedData[row.key] = row.value;
          preloadedVersions[row.key] = row.version ?? 0;
        }

        if (Object.keys(preloadedData).length === 0) {
          // Local shared_app_data is empty — PowerSync cleared it after upload.
          // Query Supabase directly so the shim starts with correct data.
          try {
            const { data: remoteRows } = await supabase
              .from('shared_app_data')
              .select('key, value, version')
              .eq('instance_id', target.instance_id)
              .eq('app_id', target.app_id);
            for (const row of (remoteRows ?? [])) {
              preloadedData[row.key] = row.value;
              preloadedVersions[row.key] = (row.version as number | null) ?? 0;
            }
          } catch {
            // Network unavailable — fall through to personal-fallback
          }

          if (Object.keys(preloadedData).length > 0) {
            return {
              shim: buildSyncShim(target.app_id, preloadedData, preloadedVersions),
              preloadSource: 'shared',
            };
          }

          // Supabase also has nothing (brand new instance) → seed from personal data
          const personalRows = await db.getAll<{ key: string; value: string }>(
            `SELECT key, value FROM app_data WHERE app_id = ?`,
            [target.app_id]
          );
          for (const row of personalRows) {
            preloadedData[row.key] = row.value;
            preloadedVersions[row.key] = 0;
          }

          return {
            shim: buildSyncShim(target.app_id, preloadedData, preloadedVersions),
            preloadSource: 'personal-fallback',
          };
        }

        return {
          shim: buildSyncShim(target.app_id, preloadedData, preloadedVersions),
          preloadSource: 'shared',
        };
      }

      const localRows = await db.getAll<{ key: string; value: string }>(
        'SELECT key, value FROM app_data WHERE app_id = ?',
        [target.app_id]
      );
      for (const row of localRows) {
        preloadedData[row.key] = row.value;
      }

      return {
        shim: buildVaultShim(target.app_id, preloadedData),
        preloadSource: 'local',
      };
    },
    // Empty deps: syncDbRef.current is always up-to-date; stable reference
    // prevents the initial load useEffect from re-firing on every PowerSync sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const foundApp = await db.getFirstAsync<InstalledApp>(
          'SELECT * FROM apps WHERE app_id = ?',
          id
        );

        if (!foundApp) {
          setPhase('not_found');
          return;
        }

        const isShared = !!foundApp.instance_id;
        const { shim: generatedShimJS, preloadSource } = await loadShimPayload(foundApp);

        // Record open (non-blocking)
        db.runAsync(
          `UPDATE apps SET last_opened = datetime('now'), open_count = open_count + 1
           WHERE app_id = ?`,
          id
        ).catch(() => {});

        if (foundApp.source_type !== 'url') {
          const normalized = foundApp.bundle_path.replace(/^file:\/\//, '').replace(/\/$/, '');
          const htmlPath = normalized.toLowerCase().endsWith('.html')
            ? normalized
            : `${normalized}/index.html`;

          let html: string | null = null;
          try {
            html = await FileSystem.readAsStringAsync(htmlPath, {
              encoding: FileSystem.EncodingType.UTF8,
            });
          } catch {
            html =
              foundApp.bundle_html ??
              (foundApp.source_type === 'demo'
                ? DEMO_HTML_BY_NAME[foundApp.name] ?? null
                : null);
          }
          if (html) setBundleHtml(html);
        } else {
          setBundleHtml(null);
        }

        setApp(foundApp);
        setShimJS(generatedShimJS);
        log.info('[webview] using shim:', isShared ? 'SYNC' : 'LOCAL', 'preload:', preloadSource);
        setPhase('ready');
      } catch (e) {
        log.error('[AppScreen] load error:', e);
        setPhase('not_found');
      }
    })();
  }, [id, db, loadShimPayload]);

  // ── Auth session tracking ─────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedInUserId(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Prune ownWriteIds every 10 minutes — writes older than that will have
  // long since synced and won't appear in the watcher again.
  useEffect(() => {
    const interval = setInterval(() => {
      ownWriteIds.current.clear();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const rebuildShimForApp = useCallback(
    async (target: InstalledApp) => {
      const { shim, preloadSource } = await loadShimPayload(target);
      setShimJS(shim);
      log.info(
        '[webview] using shim:',
        target.instance_id ? 'SYNC' : 'LOCAL',
        'preload:',
        preloadSource
      );
    },
    [loadShimPayload]
  );

  return {
    phase,
    app,
    setApp,
    shimJS,
    setShimJS,
    bundleHtml,
    signedInUserId,
    loadShimPayload,
    rebuildShimForApp,
    webViewRef,
    hasLoadedOnceRef,
    ownWriteIds,
  };
}
