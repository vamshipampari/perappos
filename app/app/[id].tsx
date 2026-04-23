import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/services/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import WebView from 'react-native-webview';

import { ActionSheet } from '@/components/ActionSheet';
import { AppIcon } from '@/components/AppIcon';
import { useToast } from '@/components/Toast';
import { useDatabase } from '@/hooks/useDatabase';
import { useWebViewApp } from '@/hooks/useWebViewApp';
import { useLiveSyncPush } from '@/hooks/useLiveSyncPush';
import { useFreezeWatcher } from '@/hooks/useFreezeWatcher';
import { useAppMenuActions } from '@/hooks/useAppMenuActions';
import { enableOffline, disableOffline } from '@/lib/offlineBundle';
import { getLatestBackup, revertToPreviousVersion } from '@/lib/appUpdates';
import type { InstalledApp } from '@/types';
import { usePowerSync } from '@/services/sync/PowerSyncProvider';
import { handleVaultMessage, safeInjectJson } from '@/lib/vaultBridge';
import { log } from '@/lib/logger';
import { track } from '@/services/analytics';
import { posthog } from '../../src/config/posthog';
import { useTheme, type Colors } from '@/lib/theme';

// ── CSP injection (permissive v1) ────────────────────────────────────────────
// Injected before content loads so it applies to the full page lifecycle.
// Policy rationale:
//   default-src * data: blob: 'unsafe-inline' 'unsafe-eval'
//     Permissive — vibe-coded apps need eval + inline scripts and call arbitrary
//     external APIs (OpenAI, custom backends). Tighten connect-src in v2 once
//     an allowlist UI is built (S3 / Phase 6).
//   object-src 'none'  → blocks Flash / Java plugin embeds (real attack surface).
//   base-uri 'self'    → prevents <base href="attacker.com"> injection.
// Only injected when the page has no existing CSP (respects apps that set their own).
const CSP_JS = `(function(){
  if (!document.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
    var m = document.createElement('meta');
    m.setAttribute('http-equiv', 'Content-Security-Policy');
    m.setAttribute('content', "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'self';");
    var h = document.head || document.querySelector('head');
    if (h) h.insertBefore(m, h.firstChild);
  }
})();`;

// ── Viewport fix (all platforms) ─────────────────────────────────────────────
// • Creates the viewport meta if missing (external apps often omit it)
// • maximum-scale=1.0 + user-scalable=no → prevents iOS auto-zoom on input focus
// • viewport-fit=cover → respects safe areas
// • Android only: interactive-widget=resizes-content → keyboard shrinks WebView
//   instead of panning the viewport
const VIEWPORT_FIX_JS = (() => {
  const base =
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
  const content =
    Platform.OS === 'android' ? `${base}, interactive-widget=resizes-content` : base;
  return (
    `(function(){` +
    `var m=document.querySelector('meta[name="viewport"]');` +
    `if(!m){m=document.createElement('meta');m.setAttribute('name','viewport');` +
    `document.head&&document.head.appendChild(m);}` +
    `m&&m.setAttribute('content','${content}');` +
    `})();`
  );
})();

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(theme: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.surface },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      gap: 12,
      padding: 24,
    },
    errorTitle: { fontSize: 18, fontWeight: '600', color: theme.label, textAlign: 'center' },
    errorDetail: { fontSize: 13, color: theme.labelSecondary, textAlign: 'center', lineHeight: 18 },
    link: { fontSize: 16, color: theme.primary },
    retryBtn: {
      marginTop: 8,
      backgroundColor: theme.primary,
      borderRadius: 10,
      paddingHorizontal: 28,
      paddingVertical: 12,
    },
    retryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

    header: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.separator,
      paddingHorizontal: 4,
    },
    headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerBtnRight: { alignItems: 'flex-end', paddingRight: 10 },
    headerBtnText: { fontSize: 22, color: theme.primary, lineHeight: 26 },
    headerCenter: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 4,
    },
    headerTitle: { fontSize: 16, fontWeight: '600', color: theme.label, flexShrink: 1 },
    sharedPill: {
      marginLeft: 6,
      backgroundColor: '#E8F1FF',
      borderWidth: 1,
      borderColor: '#BBD7FF',
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    sharedPillText: { fontSize: 11, fontWeight: '600', color: theme.primary },
    menuDots: { fontSize: 16, color: theme.primary, letterSpacing: 1.5, lineHeight: 20 },

    frozenBanner: {
      backgroundColor: '#FEF3C7',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: '#F59E0B',
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    frozenBannerText: { fontSize: 13, color: '#92400E', textAlign: 'center', lineHeight: 18 },

    webContainer: { flex: 1 },
    webView: { flex: 1 },
    splashOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.surface,
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
    splashName: { fontSize: 17, fontWeight: '600', color: theme.label },

    // Stale bundle banner
    staleBanner: {
      backgroundColor: '#EFF6FF',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: '#93C5FD',
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    staleBannerText: { fontSize: 13, color: '#1D4ED8', textAlign: 'center' },

    // App Info modal
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    infoSheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: theme.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 36,
      maxHeight: '80%',
    },
    infoSheetPill: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.separator,
      alignSelf: 'center',
      marginTop: 8,
      marginBottom: 4,
    },
    infoSheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.separator,
    },
    infoSheetTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: theme.label },
    infoSheetClose: { fontSize: 17, color: theme.labelSecondary, padding: 4 },
    infoGroup: {
      marginHorizontal: 16,
      marginTop: 12,
      backgroundColor: theme.groupedBackground,
      borderRadius: 12,
      overflow: 'hidden',
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    infoRowLabel: { fontSize: 15, color: theme.label },
    infoRowValue: { fontSize: 15, color: theme.labelSecondary, maxWidth: '55%', textAlign: 'right' },
    infoRowValueSmall: { fontSize: 12 },
    infoSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.separator,
      marginLeft: 16,
    },
    offlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    offlineLabel: { fontSize: 16, color: theme.label },
    offlineSubLabel: { fontSize: 12, color: theme.labelSecondary, marginTop: 2 },
    revertBtn: {
      marginHorizontal: 16,
      marginTop: 12,
      paddingVertical: 14,
      backgroundColor: theme.groupedBackground,
      borderRadius: 12,
      alignItems: 'center',
    },
    revertBtnText: { fontSize: 16, color: '#F59E0B', fontWeight: '500' },
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const { db: syncDb } = usePowerSync();
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { showToast } = useToast();

  // Stable ref so loadShimPayload's useCallback can have empty deps.
  // See learning.md #15.
  const syncDbRef = useRef(syncDb);
  syncDbRef.current = syncDb;

  // WebView-specific UI state
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState<string | null>(null);
  const [webCanGoBack, setWebCanGoBack] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  // App Info modal state
  const [appInfoVisible, setAppInfoVisible] = useState(false);
  const [infoEntries, setInfoEntries] = useState<number | null>(null);
  const [infoHasBackup, setInfoHasBackup] = useState(false);
  const [offlineEnabled, setOfflineEnabled] = useState(false);
  const [offlineLoading, setOfflineLoading] = useState(false);

  // Stale offline bundle detection
  const [hasStaleBundle, setHasStaleBundle] = useState(false);

  // True during the ~8-second window after WebView load where we accept a
  // late PowerSync sync as a reason to silently reload the WebView.
  // Prevents spurious reloads after the user has started interacting.
  const dataWatchWindowRef = useRef(false);

  // Buffer for remote updates that arrive before the WebView has loaded
  const pendingRemoteUpdates = useRef<Array<{
    key: string;
    value: string;
    version: number;
    lastEditorUserId?: string | null;
    lastEditorDisplayName?: string | null;
    writtenAt?: string | null;
  }>>([]);

  // WebView fades in from 0 → 1 once the page finishes loading
  const webOpacity = useSharedValue(0);
  const webViewAnimStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity: webOpacity.value,
  }));

  // ── Hooks ─────────────────────────────────────────────────────────────────

  const {
    phase,
    app,
    setApp,
    shimJS,
    bundleHtml,
    signedInUserId,
    hadEmptyPreload,
    rebuildShimForApp,
    webViewRef,
    hasLoadedOnceRef,
    ownWriteIds,
  } = useWebViewApp(id, db, syncDbRef);

  const isFrozen = useFreezeWatcher(app?.instance_id, syncDbRef);

  const refreshWebView = useCallback(() => {
    setMenuVisible(false);
    setWebError(null);
    setWebLoading(true);
    hasLoadedOnceRef.current = false;
    webOpacity.value = 0;
    webViewRef.current?.reload();
  }, [hasLoadedOnceRef, webOpacity, webViewRef]);

  useLiveSyncPush(
    app?.instance_id,
    app?.app_id,
    syncDbRef,
    webViewRef,
    ownWriteIds,
    pendingRemoteUpdates
  );

  const {
    checkingUpdate,
    handleCollaborate,
    handleManageGroup,
    handleCheckUpdate,
    handleAppInfo,
    handleClearData,
    handleDelete,
  } = useAppMenuActions({
    app,
    db,
    syncDb,
    signedInUserId,
    setApp,
    setMenuVisible,
    setAppInfoVisible,
    rebuildShimForApp,
    refreshWebView,
    showToast,
  });

  // ── App Info modal: load data when it opens ───────────────────────────────
  useEffect(() => {
    if (!appInfoVisible || !app) return;
    setOfflineEnabled(app.offline_enabled === 1);
    setInfoEntries(null);
    setInfoHasBackup(false);

    (async () => {
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
      setInfoEntries(countRow?.n ?? 0);
      setInfoHasBackup(backup !== null);
    })();
  }, [appInfoVisible, app, db, syncDb]);

  // ── Offline toggle handler ────────────────────────────────────────────────
  const handleToggleOffline = useCallback(async (val: boolean) => {
    if (!app || !app.source_url) return;
    setOfflineLoading(true);
    try {
      if (val) {
        await enableOffline(app.app_id, app.source_url, db);
      } else {
        await disableOffline(app.app_id, db);
      }
      setOfflineEnabled(val);
      if (val) setHasStaleBundle(false);
      const refreshed = await db.getFirstAsync<InstalledApp>(
        'SELECT * FROM apps WHERE app_id = ?',
        app.app_id
      );
      if (refreshed) {
        setApp(refreshed);
        void rebuildShimForApp(refreshed);
      }
    } catch (e) {
      setOfflineEnabled(!val); // revert toggle
      Alert.alert(
        val ? 'Could not download app for offline use' : 'Could not remove offline copy',
        e instanceof Error ? e.message : 'Please try again.'
      );
    } finally {
      setOfflineLoading(false);
    }
  }, [app, db, setApp, rebuildShimForApp]);

  // ── Revert to previous version (from App Info modal) ─────────────────────
  const handleRevertVersion = useCallback(async () => {
    if (!app) return;
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
      setAppInfoVisible(false);
      Alert.alert('Restored', 'Reverted to previous version ✓');
    } catch {
      Alert.alert('Revert failed', 'Could not restore previous version.');
    }
  }, [app, db, setApp]);

  // ── Edit with AI ──────────────────────────────────────────────────────────
  const handleEditWithAI = async () => {
    if (!app) return;
    posthog.capture('edit_with_ai_tapped', {
      app_id: app.app_id,
      app_name: app.name,
    });
    const { data } = await supabase
      .from('generated_apps')
      .select('app_id, html_content')
      .eq('hosted_url', app.source_url ?? '')
      .single();

    if (!data?.html_content) {
      Alert.alert(
        'Not Available',
        "This app was generated before HTML backup was enabled. Regenerate it first using Create with AI.",
      );
      return;
    }

    router.push({
      pathname: '/create',
      params: { mode: 'modify', conversationId: data.app_id as string },
    });
  };

  // ── Android hardware back button ──────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (webCanGoBack) {
        webViewRef.current?.goBack();
      } else {
        router.back();
      }
      return true;
    });
    return () => sub.remove();
  }, [webCanGoBack, webViewRef]);

  // ── Late-sync recovery watcher ───────────────────────────────────────────
  // When the shim was built with zero preloaded keys for a personal app, it
  // means PowerSync hadn't delivered the data yet at load time (cold-start
  // gap, learning.md #3). This watcher listens for rows to arrive in
  // app_data. If they appear within the watch window (opened in onLoadEnd
  // and kept open for 8 s), we rebuild the shim and silently reload so the
  // app gets its data without the user having to redo onboarding.
  useEffect(() => {
    if (!hadEmptyPreload || !app || app.instance_id || app.source_type === 'url') return;
    const controller = new AbortController();
    (async () => {
      try {
        for await (const result of syncDb.watch(
          'SELECT key, value FROM app_data WHERE app_id = ? LIMIT 1',
          [app.app_id],
          { signal: controller.signal }
        )) {
          const rows = (result.rows?._array ?? []) as { key: string; value: string }[];
          if (rows.length > 0 && dataWatchWindowRef.current) {
            log.info('[webview] late-sync recovery: data arrived, rebuilding shim + reloading');
            controller.abort();
            await rebuildShimForApp(app);
            // Small delay so React re-renders with the new shimJS before reload.
            setTimeout(() => { webViewRef.current?.reload(); }, 50);
            return;
          }
        }
      } catch {
        // AbortError on cleanup — expected.
      }
    })();
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hadEmptyPreload, app?.app_id]);

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
          log.error('[webview] js error:', parsed.message, 'line:', parsed.line);
          if (app?.source_url?.includes('apps.cottix.co')) {
            showToast('App has errors — try "Edit with AI" to fix it', 'error');
          }
          return;
        }
        if (parsed.type === 'shim_error') {
          log.error('[webview] shim error:', parsed.error, parsed.stack ?? '');
          return;
        }
        // Track own writes so the PowerSync watcher can skip them (no echo).
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
    [db, syncDb, app, ownWriteIds, webViewRef]
  );

  // ── Render: loading / not found ───────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
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

  // Priority:
  // 1. URL apps (source_type === 'url') → always load from network URI
  // 2. HTML/ZIP apps with a local bundle → load from device (offline-capable)
  // 3. HTML apps with a Cloudflare source_url but no local bundle
  //    (e.g. a shared-app joiner, or the owner's bundle_html was cleared)
  //    → fall back to the cloud URL so shared users always see the app
  const webViewSource =
    app.source_type === 'url' && app.source_url
      ? { uri: app.source_url }
      : bundleHtml
        ? { html: bundleHtml, baseUrl: 'http://localhost/' as const }
        : app.source_url
          ? { uri: app.source_url }
          : { html: '<!doctype html><html><body></body></html>', baseUrl: 'http://localhost/' as const };

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

        <View style={styles.headerCenter}>
          <AppIcon emoji={app.icon_emoji} bgColor={app.icon_bg_color} size={22} />
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

      {/* ── Stale offline bundle banner ──────────────────────────────────── */}
      {hasStaleBundle && (
        <TouchableOpacity
          style={styles.staleBanner}
          onPress={async () => {
            if (!app.source_url) return;
            setHasStaleBundle(false);
            setOfflineLoading(true);
            try {
              await enableOffline(app.app_id, app.source_url, db);
              const refreshed = await db.getFirstAsync<InstalledApp>(
                'SELECT * FROM apps WHERE app_id = ?',
                app.app_id
              );
              if (refreshed) { setApp(refreshed); void rebuildShimForApp(refreshed); }
            } catch {
              setHasStaleBundle(true);
            } finally {
              setOfflineLoading(false);
            }
          }}
        >
          <Text style={styles.staleBannerText}>
            {offlineLoading ? 'Updating…' : 'A newer version is available — tap to update.'}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── WebView + overlays ───────────────────────────────────────────── */}
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
              injectedJavaScriptBeforeContentLoaded={shimJS + VIEWPORT_FIX_JS + CSP_JS}
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
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              originWhitelist={['*']}
              allowsInlineMediaPlayback
              webviewDebuggingEnabled={__DEV__}
              mediaPlaybackRequiresUserAction={false}
              {...({ automaticallyAdjustKeyboardInsets: true, backgroundColor: '#000000' } as object)}
              contentInsetAdjustmentBehavior="never"
              overScrollMode="never"
              scalesPageToFit={false}
              onNavigationStateChange={(navState) => setWebCanGoBack(navState.canGoBack)}
              onLoadStart={() => {
                if (!hasLoadedOnceRef.current) setWebLoading(true);
                setWebError(null);
              }}
              onLoadEnd={() => {
                hasLoadedOnceRef.current = true;
                setWebLoading(false);
                webOpacity.value = withTiming(1, { duration: 380 });
                if (app) {
                  void track('app_opened_webview', { app_id: app.app_id });
                  posthog.capture('app_opened_webview', { app_id: app.app_id, source_type: app.source_type });
                }
                // Background stale-bundle check — fire-and-forget, never blocks load
                if (app?.offline_enabled === 1 && app.source_url) {
                  (async () => {
                    try {
                      const headRes = await fetch(app.source_url!, { method: 'HEAD' });
                      const contentLength = headRes.headers.get('content-length');
                      if (contentLength && parseInt(contentLength, 10) !== app.bundle_size) {
                        setHasStaleBundle(true);
                      }
                    } catch {
                      // Network failure — silent. Offline is the whole point.
                    }
                  })();
                }

                // Flush buffered remote updates that arrived before WebView was ready
                if (pendingRemoteUpdates.current.length > 0 && webViewRef.current) {
                  log.info('[live-push] onLoadEnd flushing', pendingRemoteUpdates.current.length, 'buffered update(s)');
                  webViewRef.current.injectJavaScript(
                    `window._VaultSyncPush && window._VaultSyncPush(${safeInjectJson(pendingRemoteUpdates.current)});true;`
                  );
                  pendingRemoteUpdates.current = [];
                }
                // Open the late-sync recovery window for 8 seconds.
                // If PowerSync delivers missing data within this window the
                // recovery watcher will rebuild the shim and reload silently.
                // After 8 s we assume the user is actively using the app.
                if (hadEmptyPreload) {
                  dataWatchWindowRef.current = true;
                  setTimeout(() => { dataWatchWindowRef.current = false; }, 8000);
                }
              }}
              onError={(e) => {
                log.error('[webview] error:', e.nativeEvent.description);
                hasLoadedOnceRef.current = true;
                setWebLoading(false);
                setWebError(e.nativeEvent.description ?? 'Failed to load');
                posthog.capture('webview_load_error', {
                  app_id: app.app_id,
                  app_name: app.name,
                  url: app.source_url ?? app.bundle_path,
                  error_description: e.nativeEvent.description ?? 'Failed to load',
                });
              }}
              onHttpError={(e) => {
                hasLoadedOnceRef.current = true;
                setWebLoading(false);
                setWebError(`HTTP ${e.nativeEvent.statusCode} — ${e.nativeEvent.url}`);
              }}
            />
          </Animated.View>
        )}

        {/* Splash — shows icon + name while WebView loads, then cross-fades out */}
        {webLoading && !webError && (
          <View style={styles.splashOverlay}>
            <View style={[styles.splashIcon, { backgroundColor: app.icon_bg_color }]}>
              <Text style={{ fontSize: 32 }}>{app.icon_emoji}</Text>
            </View>
            <Text style={styles.splashName}>{app.name}</Text>
            <ActivityIndicator style={{ marginTop: 20 }} color={theme.labelTertiary} />
          </View>
        )}
      </View>

      {/* ── Three-dot action sheet ───────────────────────────────────────── */}
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
          ...(app.source_url?.includes('apps.cottix.co')
            ? [{ label: 'Edit with AI', onPress: () => { setMenuVisible(false); void handleEditWithAI(); } }]
            : []),
          ...(app.source_type === 'html'
            ? [{ label: 'Edit HTML', onPress: () => { setMenuVisible(false); router.push(`/edit-html/${app.app_id}`); } }]
            : []),
        ]}
        destructiveActions={[
          { label: 'Clear App Data', onPress: handleClearData },
          { label: 'Delete App', onPress: handleDelete },
        ]}
      />

      {/* ── App Info modal ───────────────────────────────────────────────── */}
      <Modal
        visible={appInfoVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAppInfoVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setAppInfoVisible(false)}
        />
        <View style={styles.infoSheet}>
          {/* Drag pill */}
          <View style={styles.infoSheetPill} />

          {/* Header */}
          <View style={styles.infoSheetHeader}>
            <AppIcon emoji={app.icon_emoji} bgColor={app.icon_bg_color} size={28} />
            <Text style={styles.infoSheetTitle} numberOfLines={1}>{app.name}</Text>
            <TouchableOpacity onPress={() => setAppInfoVisible(false)} hitSlop={8}>
              <Text style={styles.infoSheetClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            {/* Info rows */}
            <View style={styles.infoGroup}>
              <View style={styles.infoRow}>
                <Text style={styles.infoRowLabel}>Type</Text>
                <Text style={styles.infoRowValue} numberOfLines={1}>
                  {app.source_type === 'html' ? 'AI-generated' : app.source_type === 'url' ? 'Web URL' : 'Local bundle'}
                </Text>
              </View>
              <View style={styles.infoSeparator} />
              <View style={styles.infoRow}>
                <Text style={styles.infoRowLabel}>Source</Text>
                <Text style={[styles.infoRowValue, styles.infoRowValueSmall]} numberOfLines={2}>
                  {app.source_url ?? app.bundle_path}
                </Text>
              </View>
              <View style={styles.infoSeparator} />
              <View style={styles.infoRow}>
                <Text style={styles.infoRowLabel}>Installed</Text>
                <Text style={styles.infoRowValue}>
                  {new Date(app.installed_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </Text>
              </View>
              <View style={styles.infoSeparator} />
              <View style={styles.infoRow}>
                <Text style={styles.infoRowLabel}>Opened</Text>
                <Text style={styles.infoRowValue}>
                  {app.open_count} time{app.open_count === 1 ? '' : 's'}
                </Text>
              </View>
              {infoEntries !== null && (
                <>
                  <View style={styles.infoSeparator} />
                  <View style={styles.infoRow}>
                    <Text style={styles.infoRowLabel}>Stored data</Text>
                    <Text style={styles.infoRowValue}>
                      {infoEntries} entr{infoEntries === 1 ? 'y' : 'ies'}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Available Offline toggle — only for html-type apps */}
            {app.source_type === 'html' && (
              <View style={styles.infoGroup}>
                <View style={styles.offlineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.offlineLabel}>Available Offline</Text>
                    {offlineEnabled && app.bundle_size > 0 && (
                      <Text style={styles.offlineSubLabel}>
                        {formatBytes(app.bundle_size)} stored locally
                      </Text>
                    )}
                  </View>
                  {offlineLoading ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                  ) : (
                    <Switch
                      value={offlineEnabled}
                      onValueChange={(val) => { void handleToggleOffline(val); }}
                      disabled={offlineLoading}
                    />
                  )}
                </View>
              </View>
            )}

            {/* Revert to previous version */}
            {infoHasBackup && (
              <TouchableOpacity
                style={styles.revertBtn}
                onPress={() => { void handleRevertVersion(); }}
              >
                <Text style={styles.revertBtnText}>Revert to Previous Version</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
