import { router, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import WebView from 'react-native-webview';

import { useDatabase } from '@/hooks/useDatabase';
import type { InstalledApp } from '@/hooks/useInstalledApps';
import { usePowerSync } from '../../services/sync/PowerSyncProvider';
import { createSharedInstanceForApp } from '../../services/collaborationService';
import {
  applyUrlAppUpdate,
  checkForUpdates,
  getLatestBackup,
  revertToPreviousVersion,
} from '@/lib/appUpdates';
import { handleVaultMessage } from '@/lib/vaultBridge';
import { buildVaultShim } from '@/lib/vaultShim';
import { buildSyncShim } from '@/lib/vaultShimSync';
import { DEMO_HTML_BY_NAME } from '@/utils/demoAppsHtml';
import { supabase } from '@/services/supabase';

// ── Android keyboard fix ──────────────────────────────────────────────────────
// Sets interactive-widget=resizes-content so the WebView viewport shrinks
// (rather than panning or doing nothing) when the software keyboard appears.
const ANDROID_KEYBOARD_FIX_JS = `
  (function() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.content = 'width=device-width, initial-scale=1, interactive-widget=resizes-content';
    }
  })();
`;

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'loading' | 'ready' | 'not_found';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const { db: syncDb } = usePowerSync();
  // Stable ref so loadShimPayload's useCallback can have empty deps.
  // Without this, every PowerSync sync event creates a new syncDb reference →
  // loadShimPayload gets a new ref → the initial load useEffect re-fires →
  // shared_app_data is empty → WebView reloads with wrong personal-fallback data.
  const syncDbRef = useRef(syncDb);
  syncDbRef.current = syncDb;
  const webViewRef = useRef<WebView>(null);
  const hasLoadedOnceRef = useRef(false);
  // Track clientWriteIds that originated from THIS device so the watcher
  // can skip them (prevents feedback loops where our own write triggers a push).
  const ownWriteIds = useRef<Set<string>>(new Set());

  const [phase, setPhase] = useState<Phase>('loading');
  const [app, setApp] = useState<InstalledApp | null>(null);
  const [shimJS, setShimJS] = useState('');
  const [bundleHtml, setBundleHtml] = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [webCanGoBack, setWebCanGoBack] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [signedInUserId, setSignedInUserId] = useState<string | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);

  // WebView fades in from 0 → 1 once the page finishes loading
  const webOpacity = useSharedValue(0);
  const webViewAnimStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity: webOpacity.value,
  }));

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
          // Dedup: first row per key wins (highest version due to ORDER BY version DESC)
          if (row.key in preloadedData) continue;
          preloadedData[row.key] = row.value;
          preloadedVersions[row.key] = row.version ?? 0;
        }

        if (Object.keys(preloadedData).length === 0) {
          // Local shared_app_data is empty — PowerSync cleared it after upload,
          // before the sync service re-delivered the row. Query Supabase directly
          // so the shim starts with correct data and versions.
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

  // ── Initial load: fetch app row + all KV data from SQLite ─────────────────
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const foundApp = await db.getFirstAsync<InstalledApp>('SELECT * FROM apps WHERE app_id = ?', id);

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
            // Fallback for legacy demo rows or missing bundle files.
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
        console.log('[webview] using shim:', isShared ? 'SYNC' : 'LOCAL', 'preload:', preloadSource);

        // ── Freeze status check ──
        if (foundApp.instance_id) {
          try {
            const instanceRows = await syncDbRef.current?.getAll(
              `SELECT is_frozen FROM shared_instances WHERE instance_id = ?`,
              [foundApp.instance_id]
            );
            if (instanceRows && instanceRows.length > 0 && instanceRows[0].is_frozen === 1) {
              setIsFrozen(true);
            }
          } catch (err) {
            console.warn('[app] freeze status check failed:', err);
          }
        }

        setPhase('ready');
      } catch (e) {
        console.error('[AppScreen] load error:', e);
        setPhase('not_found');
      }
    })();
  }, [id, db, loadShimPayload]);

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

  // Buffer for remote updates that arrive before the WebView has finished
  // loading. Flushed in the onLoadEnd handler below.
  const pendingRemoteUpdates = useRef<Array<{ key: string; value: string; version: number }>>([]);

  // ── Live sync push: watch PowerSync shared_app_data for remote changes ────
  // When another device writes data, PowerSync delivers it locally. This effect
  // watches the table and injects the changes into the running WebView via
  // window._VaultSyncPush so the UI updates without a full reload.
  //
  // IMPORTANT: syncDbRef and webViewRef are refs — do NOT add them to deps.
  // Adding syncDb to deps would recreate this effect on every PowerSync sync
  // cycle (learning.md #15), tearing down and restarting the async iterable.
  useEffect(() => {
    const isShared = !!app?.instance_id;
    const instanceId = app?.instance_id;
    const appId = app?.app_id;

    if (!isShared || !instanceId || !appId) return;

    const abortController = new AbortController();

    // Track last-pushed version per key to skip duplicate full-result-set emissions.
    const lastPushedVersions = new Map<string, number>();

    // Debounce: 50ms — batches rapid multi-key writes, keeps latency low.
    let pendingUpdates: Array<{ key: string; value: string; version: number }> = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function flushUpdates() {
      debounceTimer = null;
      if (pendingUpdates.length === 0) return;

      if (!webViewRef.current) {
        // WebView not ready yet — buffer for onLoadEnd
        console.log('[live-push] WebView not ready — buffering', pendingUpdates.length, 'update(s)');
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
        console.warn('[live-push] syncDbRef.current is null — watcher not started');
        return;
      }

      try {
        const watchQuery = `
          SELECT key, value, COALESCE(version, 0) as version, last_write_id
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

          let skippedOwn = 0;
          let skippedSameVersion = 0;

          for (const row of rows) {
            // Skip own writes (prevent feedback loop)
            if (row.last_write_id && ownWriteIds.current.has(row.last_write_id)) {
              skippedOwn++;
              continue;
            }

            // Skip if we already pushed this version
            const lastPushed = lastPushedVersions.get(row.key) ?? 0;
            if (row.version <= lastPushed) {
              skippedSameVersion++;
              continue;
            }

            lastPushedVersions.set(row.key, row.version);
            pendingUpdates.push({
              key: row.key,
              value: row.value,
              version: row.version,
            });
          }

          if (pendingUpdates.length > 0 && !debounceTimer) {
            debounceTimer = setTimeout(flushUpdates, 50);
          }
        }
      } catch (err: unknown) {
        const errObj = err as { name?: string } | null;
        if (errObj?.name !== 'AbortError') {
          console.error('[live-push] watcher error:', err);
        }
      }
    }

    startWatching();

    return () => {
      console.log('[live-push] watcher teardown for instanceId:', instanceId);
      abortController.abort();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.instance_id, app?.app_id]); // syncDbRef + webViewRef are refs — intentionally excluded

  // ── Live freeze status watcher ────────────────────────────────────────────
  // Watches shared_instances for is_frozen changes so the banner appears /
  // disappears in real-time when the owner's plan expires or is restored.
  useEffect(() => {
    const instanceId = app?.instance_id;
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
          console.warn('[app] freeze watcher error:', err);
        }
      }
    }

    watchFreezeStatus();

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.instance_id]); // syncDbRef is a ref — intentionally excluded

  const rebuildShimForApp = useCallback(
    async (target: InstalledApp) => {
      const { shim, preloadSource } = await loadShimPayload(target);
      setShimJS(shim);
      console.log('[webview] using shim:', target.instance_id ? 'SYNC' : 'LOCAL', 'preload:', preloadSource);
    },
    [loadShimPayload]
  );

  // ── Bridge: WebView → native ──────────────────────────────────────────────
  const handleMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      if (!app) return;
      const rawData = event.nativeEvent.data;
      try {
        const parsed = JSON.parse(rawData) as {
          type?: string;
          message?: string;
          line?: number;
          error?: string;
          stack?: string;
          clientWriteId?: string;
        };
        if (parsed.type === 'js_error') {
          console.error('[webview] js error:', parsed.message, 'line:', parsed.line);
          return;
        }
        if (parsed.type === 'shim_error') {
          console.error('[webview] shim error:', parsed.error, parsed.stack ?? '');
          return;
        }
        // Track own writes so the PowerSync watcher can skip them (no echo).
        // We register before the async bridge call — the watcher can't fire
        // until PowerSync processes the write, which is always after this.
        if (parsed.type === 'ls_set_sync' && parsed.clientWriteId) {
          ownWriteIds.current.add(parsed.clientWriteId);
        }
      } catch {
        // non-JSON messages continue to bridge handler
      }

      await handleVaultMessage(rawData, db, syncDb, webViewRef, {
        app_id: app.app_id,
        name: app.name,
        source_url: app.source_url,
        installed_at: app.installed_at,
        open_count: app.open_count,
        instance_id: app.instance_id,
      });
    },
    [db, syncDb, app]
  );

  // ── Android hardware back button ─────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (webCanGoBack) {
        webViewRef.current?.goBack();
      } else {
        router.back();
      }
      return true; // always consume — we handle it ourselves
    });
    return () => sub.remove();
  }, [webCanGoBack]);

  const refreshWebView = useCallback(() => {
    setMenuVisible(false);
    setWebError(null);
    setWebLoading(true);
    hasLoadedOnceRef.current = false;
    webOpacity.value = 0;
    webViewRef.current?.reload();
  }, [webOpacity]);

  const handleCollaborate = useCallback(async () => {
    if (!app) return;
    if (!signedInUserId) {
      setMenuVisible(false);
      Alert.alert('Sign in required', 'You must sign in before creating a shared app.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.push('/auth') },
      ]);
      return;
    }
    if (app.instance_id) {
      setMenuVisible(false);
      Alert.alert('Already shared', 'This app is already in shared mode.');
      return;
    }

    // Check shared instance limit before proceeding
    try {
      const { data: profileData } = await supabase.rpc('get_user_profile');
      if (profileData) {
        const plan = (profileData as { plan: string }).plan;
        const count = (profileData as { shared_instance_count: number }).shared_instance_count;
        const isFree = plan === 'free';
        if (isFree) {
          setMenuVisible(false);
          Alert.alert(
            'Upgrade Required',
            'Sharing apps requires a Pro or Beta plan. Redeem a promo code in Settings to unlock this feature.',
            [{ text: 'OK' }]
          );
          return;
        }
        const limit = plan === 'team' ? Infinity : 5;
        if (count >= limit) {
          setMenuVisible(false);
          Alert.alert(
            'Shared Instance Limit Reached',
            `Your plan allows up to ${limit} shared instances. Upgrade to Team for unlimited.`,
            [{ text: 'OK' }]
          );
          return;
        }
      }
    } catch {
      // If profile check fails, allow the action (don't block on network errors)
    }

    setMenuVisible(false);
    Alert.alert(
      'Create Shared App?',
      `Create a shared version of "${app.name}"?\n\nOther people can join with an invite code and you'll all share the same data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create Shared App',
          onPress: async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.user?.id) {
                Alert.alert('Sign in required', 'You must sign in before creating a shared app.');
                return;
              }
              // Use RPC — avoids direct select on shared_instances hitting RLS.
              const { data: existingData, error: existingError } = await supabase.rpc(
                'get_own_shared_instance',
                { p_app_id: app.app_id, p_user_id: session.user.id }
              );
              if (existingError) throw existingError;
              const existing = (existingData as { instance_id: string; invite_code: string }[] | null)?.[0] ?? null;

              if (existing) {
                const inviteCode = String(existing.invite_code).toUpperCase();
                await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
                  existing.instance_id,
                  app.app_id,
                ]);
                const updatedApp = { ...app, instance_id: String(existing.instance_id) };
                setApp(updatedApp);
                await rebuildShimForApp(updatedApp);
                setTimeout(() => refreshWebView(), 0);
                Alert.alert(
                  'Existing shared instance found',
                  `Invite code: ${inviteCode}\n\nSpaced: ${inviteCode.split('').join(' ')}`,
                  [
                    {
                      text: 'Copy Code',
                      onPress: () => {
                        void Share.share({ message: inviteCode });
                      },
                    },
                    {
                      text: 'Share via Message',
                      onPress: () => {
                        void Share.share({
                          message:
                            `Join my "${app.name}" on Perappos!\n` +
                            `Open Perappos -> Settings -> Join Shared App -> Enter code: ${inviteCode}`,
                        });
                      },
                    },
                    { text: 'Done' },
                  ]
                );
                return;
              }

              const result = await createSharedInstanceForApp(db, syncDb, app);
              if (result.created) {
                void supabase.rpc('increment_shared_instance_count', { delta: 1 }).then(undefined, () => {});
              }
              const inviteCode = result.inviteCode.toUpperCase();
              const updatedApp = { ...app, instance_id: result.instanceId };
              setApp(updatedApp);
              await rebuildShimForApp(updatedApp);
              console.log('[share] shim rebuilt for shared instance, reloading WebView');
              // Reload immediately so the WebView picks up the sync shim.
              // Use setTimeout(0) to let React commit the new shimJS prop before reload.
              setTimeout(() => refreshWebView(), 0);
              Alert.alert(
                'Shared app created',
                `Invite code: ${inviteCode}\n\nSpaced: ${inviteCode.split('').join(' ')}`,
                [
                  {
                    text: 'Copy Code',
                    onPress: async () => {
                      await Share.share({ message: inviteCode });
                    },
                  },
                  {
                    text: 'Share via Message',
                    onPress: async () => {
                      await Share.share({
                        message:
                          `Join my "${app.name}" on Perappos!\n` +
                          `Open Perappos -> Settings -> Join Shared App -> Enter code: ${inviteCode}`,
                      });
                    },
                  },
                  { text: 'Done' },
                ]
              );
            } catch (error) {
              console.error('[collaborate] error:', error);
              Alert.alert(
                'Could not check existing shared instance',
                error instanceof Error ? error.message : String(error)
              );
            }
          },
        },
      ]
    );
  }, [app, db, rebuildShimForApp, refreshWebView, signedInUserId, syncDb]);

  const handleManageGroup = useCallback(() => {
    if (!app?.instance_id) return;
    setMenuVisible(false);
    router.push(`/shared-instance/${app.instance_id}`);
  }, [app]);

  // ── Menu actions ──────────────────────────────────────────────────────────

  const handleCheckUpdate = useCallback(async () => {
    if (!app || checkingUpdate) return;
    if (app.source_type !== 'url') {
      setMenuVisible(false);
      Alert.alert('No Updates', 'Updates are only available for URL apps.');
      return;
    }

    setCheckingUpdate(true);
    try {
      const result = await checkForUpdates(app);
      if (!result.available) {
        setMenuVisible(false);
        Alert.alert('Already up to date', 'Already up to date ✓');
        return;
      }

      setMenuVisible(false);
      Alert.alert('Update available!', 'Download now?', [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            try {
              const latest = await db.getFirstAsync<InstalledApp>(
                'SELECT * FROM apps WHERE app_id = ?',
                app.app_id
              );
              if (!latest) return;
              const applied = await applyUrlAppUpdate(db, latest, result.newHash);
              if (!applied.updated) {
                Alert.alert('Already up to date', 'Already up to date ✓');
                return;
              }

              const refreshed = await db.getFirstAsync<InstalledApp>(
                'SELECT * FROM apps WHERE app_id = ?',
                app.app_id
              );
              if (refreshed) setApp(refreshed);
              Alert.alert('Success', 'Updated to latest version ✓');
            } catch {
              Alert.alert('Update failed', 'Could not apply update.');
            }
          },
        },
      ]);
    } catch {
      setMenuVisible(false);
      Alert.alert('Update check failed', 'Please try again.');
    } finally {
      setCheckingUpdate(false);
    }
  }, [app, checkingUpdate, db]);

  const handleAppInfo = useCallback(async () => {
    if (!app) return;
    setMenuVisible(false);
    try {
      const [countRow, backup] = await Promise.all([
        app.instance_id
          ? syncDb.getOptional<{ n: number }>(
              'SELECT COUNT(*) AS n FROM shared_app_data WHERE instance_id = ? AND app_id = ?',
              [app.instance_id, app.app_id]
            )
          : syncDb.getOptional<{ n: number }>(
              'SELECT COUNT(*) AS n FROM app_data WHERE app_id = ?',
              [app.app_id]
            ),
        getLatestBackup(db, app.app_id),
      ]);
      const entries = countRow?.n ?? 0;
      const installed = new Date(app.installed_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      Alert.alert(
        app.name,
        [
          `Source: ${app.source_url ?? app.bundle_path}`,
          `Type: ${app.source_type === 'url' ? 'Web URL' : 'Local bundle'}`,
          `Installed: ${installed}`,
          `Opened: ${app.open_count} time${app.open_count === 1 ? '' : 's'}`,
          `Stored data: ${entries} entr${entries === 1 ? 'y' : 'ies'}`,
        ].join('\n'),
        [
          { text: 'Close' },
          ...(backup
            ? [{
                text: 'Revert to Previous Version',
                onPress: async () => {
                  try {
                    const ok = await revertToPreviousVersion(db, app.app_id);
                    if (!ok) {
                      Alert.alert('No backup', 'No previous version is available.');
                      return;
                    }
                    const refreshed = await db.getFirstAsync<InstalledApp>(
                      'SELECT * FROM apps WHERE app_id = ?',
                      app.app_id
                    );
                    if (refreshed) setApp(refreshed);
                    Alert.alert('Restored', 'Reverted to previous version ✓');
                  } catch {
                    Alert.alert('Revert failed', 'Could not restore previous version.');
                  }
                },
              } as const]
            : []),
        ]
      );
    } catch {
      // non-critical
    }
  }, [app, db, syncDb]);

  const handleDelete = useCallback(() => {
    if (!app) return;
    setMenuVisible(false);
    Alert.alert(
      `Delete "${app.name}"?`,
      'This will permanently remove the app and all its stored data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await db.runAsync('UPDATE apps SET instance_id = NULL WHERE app_id = ?', app.app_id);
              await syncDb.execute('DELETE FROM app_data WHERE app_id = ?', [app.app_id]);
              await db.runAsync('DELETE FROM apps WHERE app_id = ?', app.app_id);
              void supabase.rpc('increment_app_count', { delta: -1 }).then(undefined, () => {});
            } catch {
              // ignore
            }
            router.back();
          },
        },
      ]
    );
  }, [app, db, syncDb]);

  // ── Render: initial loading ───────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (phase === 'not_found' || !app) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>App not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Render: viewer ────────────────────────────────────────────────────────

  // Source resolution for v1:
  //   'url' + source_url → load live from internet (online mode)
  //   everything else     → load local HTML string (local mode)
  const webViewSource =
    app.source_type === 'url' && app.source_url
      ? { uri: app.source_url }
      : bundleHtml
        ? { html: bundleHtml, baseUrl: '' as const }
        : { html: '<!doctype html><html><body></body></html>', baseUrl: '' as const };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.headerBtn}
        >
          <Text style={styles.headerBtnText}>←</Text>
        </TouchableOpacity>

        {/* App identity */}
        <View style={styles.headerCenter}>
          <View
            style={[styles.headerIcon, { backgroundColor: app.icon_bg_color }]}
          >
            <Text style={{ fontSize: 12 }}>{app.icon_emoji}</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {app.name}
          </Text>
          {app.instance_id ? (
            <TouchableOpacity
              onPress={() => router.push(`/shared-instance/${app.instance_id}`)}
              hitSlop={8}
              activeOpacity={0.7}
            >
              <View style={styles.sharedPill}>
                <Text style={styles.sharedPillText}>👥 Shared</Text>
              </View>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={() => setMenuVisible(true)}
          hitSlop={10}
          style={[styles.headerBtn, styles.headerBtnRight]}
        >
          <Text style={styles.menuDots}>•••</Text>
        </TouchableOpacity>
      </View>

      {/* ── Frozen banner ────────────────────────────────────────────────── */}
      {isFrozen && (
        <View style={styles.frozenBanner}>
          <Text style={styles.frozenBannerText}>
            🔒 This shared app is read-only. The owner's plan has expired.
          </Text>
        </View>
      )}

      {/* ── WebView + overlays ──────────────────────────────────────────── */}
      <View style={styles.webContainer}>
        {webError ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 36, marginBottom: 16 }}>⚠️</Text>
            <Text style={styles.errorTitle}>Couldn't load this app</Text>
            <Text style={styles.errorDetail}>{webError}</Text>
            <TouchableOpacity onPress={refreshWebView} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Animated.View style={webViewAnimStyle}>
            <WebView
              ref={webViewRef}
              source={webViewSource}
              style={styles.webView}
              /* Shim: runs before any page script — makes localStorage sync */
              injectedJavaScriptBeforeContentLoaded={
                Platform.OS === 'android' ? shimJS + ANDROID_KEYBOARD_FIX_JS : shimJS
              }
              injectedJavaScript={`
                window.onerror = function(msg, url, line, col, error) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'js_error',
                    message: msg,
                    line: line
                  }));
                };
                if (window.__SHIM_ERROR) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'shim_error',
                    error: window.__SHIM_ERROR
                  }));
                }
                true;
              `}
              onMessage={handleMessage}
              /* Permissions */
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              originWhitelist={['*']}
              /* Media */
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              /* Loading / error */
              onNavigationStateChange={(navState) => setWebCanGoBack(navState.canGoBack)}
              onLoadStart={() => {
                if (!hasLoadedOnceRef.current) setWebLoading(true);
                setWebError(null);
              }}
              onLoadEnd={() => {
                hasLoadedOnceRef.current = true;
                setWebLoading(false);
                webOpacity.value = withTiming(1, { duration: 380 });
                // Flush any remote updates that arrived before the WebView was ready
                if (pendingRemoteUpdates.current.length > 0 && webViewRef.current) {
                  console.log('[live-push] onLoadEnd flushing', pendingRemoteUpdates.current.length, 'buffered update(s)');
                  const payload = JSON.stringify(pendingRemoteUpdates.current);
                  webViewRef.current.injectJavaScript(
                    `window._VaultSyncPush && window._VaultSyncPush(${payload});true;`
                  );
                  pendingRemoteUpdates.current = [];
                }
              }}
              onError={(e) => {
                console.error('[webview] error:', e.nativeEvent.description);
                hasLoadedOnceRef.current = true;
                setWebLoading(false);
                setWebError(e.nativeEvent.description ?? 'Failed to load');
              }}
              onHttpError={(e) => {
                hasLoadedOnceRef.current = true;
                setWebLoading(false);
                setWebError(`HTTP ${e.nativeEvent.statusCode} — ${e.nativeEvent.url}`);
              }}
            />
          </Animated.View>
        )}

        {/* App-themed splash — shows icon + name while WebView loads, then cross-fades out */}
        {webLoading && !webError && (
          <View style={styles.splashOverlay}>
            <View style={[styles.splashIcon, { backgroundColor: app.icon_bg_color }]}>
              <Text style={{ fontSize: 32 }}>{app.icon_emoji}</Text>
            </View>
            <Text style={styles.splashName}>{app.name}</Text>
            <ActivityIndicator style={{ marginTop: 20 }} color="#C7C7CC" />
          </View>
        )}
      </View>

      {/* ── Three-dot action sheet ──────────────────────────────────────── */}
      <ActionSheet
        visible={menuVisible}
        title={app.name}
        onDismiss={() => setMenuVisible(false)}
        actions={[
          { label: 'Refresh', onPress: refreshWebView },
          ...(!app.instance_id
            ? [{ label: 'Collaborate', onPress: handleCollaborate }]
            : []),
          ...(app.instance_id
            ? [{ label: 'Manage Group', onPress: () => { void handleManageGroup(); } }]
            : []),
          {
            label: checkingUpdate ? 'Checking for Update…' : 'Check for Update',
            onPress: handleCheckUpdate,
            loading: checkingUpdate,
            disabled: checkingUpdate,
          },
          { label: 'App Info', onPress: handleAppInfo },
        ]}
        destructiveActions={[
          { label: 'Delete App', onPress: handleDelete },
        ]}
      />
    </SafeAreaView>
  );
}

// ── ActionSheet ───────────────────────────────────────────────────────────────
// Cross-platform iOS-style bottom action sheet using Modal.

interface SheetAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

function ActionSheet({
  visible,
  title,
  actions,
  destructiveActions = [],
  onDismiss,
}: {
  visible: boolean;
  title: string;
  actions: SheetAction[];
  destructiveActions?: SheetAction[];
  onDismiss: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={sheet.wrapper}>
        {/* Tap-away backdrop */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

        <View style={sheet.container}>
          {/* Title card */}
          <View style={sheet.group}>
            <View style={sheet.titleRow}>
              <Text style={sheet.titleText} numberOfLines={1}>
                {title}
              </Text>
            </View>
          </View>

          {/* Normal actions */}
          <View style={sheet.group}>
            {actions.map((action, i) => (
              <View key={action.label}>
                <TouchableOpacity
                  onPress={action.onPress}
                  disabled={action.disabled}
                  activeOpacity={0.55}
                  style={[sheet.row, action.disabled && { opacity: 0.55 }]}
                >
                  <View style={sheet.rowInner}>
                    {action.loading ? (
                      <ActivityIndicator size="small" color="#007AFF" />
                    ) : null}
                    <Text style={sheet.rowText}>{action.label}</Text>
                  </View>
                </TouchableOpacity>
                {i < actions.length - 1 && <View style={sheet.separator} />}
              </View>
            ))}
          </View>

          {/* Destructive actions */}
          {destructiveActions.length > 0 && (
            <View style={sheet.group}>
              {destructiveActions.map((action, i) => (
                <View key={action.label}>
                  <TouchableOpacity
                    onPress={action.onPress}
                    activeOpacity={0.55}
                    style={sheet.row}
                  >
                    <Text style={[sheet.rowText, sheet.destructiveText]}>
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                  {i < destructiveActions.length - 1 && (
                    <View style={sheet.separator} />
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Cancel */}
          <View style={sheet.group}>
            <TouchableOpacity
              onPress={onDismiss}
              activeOpacity={0.55}
              style={sheet.row}
            >
              <Text style={[sheet.rowText, sheet.cancelText]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    gap: 12,
    padding: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    textAlign: 'center',
  },
  errorDetail: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 18,
  },
  link: {
    fontSize: 16,
    color: '#007AFF',
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },

  // Header
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
    paddingHorizontal: 4,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnRight: {
    alignItems: 'flex-end',
    paddingRight: 10,
  },
  headerBtnText: {
    fontSize: 22,
    color: '#007AFF',
    lineHeight: 26,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  headerIcon: {
    width: 22,
    height: 22,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    flexShrink: 1,
  },
  sharedPill: {
    marginLeft: 6,
    backgroundColor: '#E8F1FF',
    borderWidth: 1,
    borderColor: '#BBD7FF',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sharedPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#007AFF',
  },
  menuDots: {
    fontSize: 16,
    color: '#007AFF',
    letterSpacing: 1.5,
    lineHeight: 20,
  },

  // Frozen instance banner
  frozenBanner: {
    backgroundColor: '#FEF3C7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F59E0B',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  frozenBannerText: {
    fontSize: 13,
    color: '#92400E',
    textAlign: 'center',
    lineHeight: 18,
  },

  // WebView layer
  webContainer: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },

  // App-themed splash shown while the WebView loads
  splashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 16,
  },
  splashName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
  },
});

const sheet = StyleSheet.create({
  wrapper: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  container: {
    paddingHorizontal: 8,
    paddingBottom: 34, // accommodate home indicator
    gap: 8,
  },
  group: {
    backgroundColor: '#FFFFFF',
    borderRadius: 13,
    overflow: 'hidden',
  },
  titleRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  titleText: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '500',
  },
  row: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rowText: {
    fontSize: 17,
    color: '#007AFF',
  },
  destructiveText: {
    color: '#FF3B30',
  },
  cancelText: {
    fontWeight: '600',
  },
  separator: {
    height: 0.5,
    backgroundColor: '#E5E5EA',
    marginLeft: 0,
  },
});
