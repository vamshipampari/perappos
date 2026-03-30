import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
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

import { ActionSheet } from '@/components/ActionSheet';
import { AppIcon } from '@/components/AppIcon';
import { useDatabase } from '@/hooks/useDatabase';
import { useWebViewApp } from '@/hooks/useWebViewApp';
import { useLiveSyncPush } from '@/hooks/useLiveSyncPush';
import { useFreezeWatcher } from '@/hooks/useFreezeWatcher';
import { useAppMenuActions } from '@/hooks/useAppMenuActions';
import { usePowerSync } from '@/services/sync/PowerSyncProvider';
import { handleVaultMessage } from '@/lib/vaultBridge';
import { log } from '@/lib/logger';
import { track } from '@/services/analytics';

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

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const { db: syncDb } = usePowerSync();

  // Stable ref so loadShimPayload's useCallback can have empty deps.
  // See learning.md #15.
  const syncDbRef = useRef(syncDb);
  syncDbRef.current = syncDb;

  // WebView-specific UI state
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState<string | null>(null);
  const [webCanGoBack, setWebCanGoBack] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

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
    handleDelete,
  } = useAppMenuActions({
    app,
    db,
    syncDb,
    signedInUserId,
    setApp,
    setMenuVisible,
    rebuildShimForApp,
    refreshWebView,
  });

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
              injectedJavaScriptBeforeContentLoaded={shimJS + VIEWPORT_FIX_JS}
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
              {...({ automaticallyAdjustKeyboardInsets: true } as object)}
              contentInsetAdjustmentBehavior="never"
              overScrollMode="never"
              onNavigationStateChange={(navState) => setWebCanGoBack(navState.canGoBack)}
              onLoadStart={() => {
                if (!hasLoadedOnceRef.current) setWebLoading(true);
                setWebError(null);
              }}
              onLoadEnd={() => {
                hasLoadedOnceRef.current = true;
                setWebLoading(false);
                webOpacity.value = withTiming(1, { duration: 380 });
                if (app) void track('app_opened_webview', { app_id: app.app_id });
                // Flush buffered remote updates that arrived before WebView was ready
                if (pendingRemoteUpdates.current.length > 0 && webViewRef.current) {
                  log.info('[live-push] onLoadEnd flushing', pendingRemoteUpdates.current.length, 'buffered update(s)');
                  const payload = JSON.stringify(pendingRemoteUpdates.current);
                  webViewRef.current.injectJavaScript(
                    `window._VaultSyncPush && window._VaultSyncPush(${payload});true;`
                  );
                  pendingRemoteUpdates.current = [];
                }
              }}
              onError={(e) => {
                log.error('[webview] error:', e.nativeEvent.description);
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

        {/* Splash — shows icon + name while WebView loads, then cross-fades out */}
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
        ]}
        destructiveActions={[
          { label: 'Delete App', onPress: handleDelete },
        ]}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    gap: 12,
    padding: 24,
  },
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#1C1C1E', textAlign: 'center' },
  errorDetail: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 18 },
  link: { fontSize: 16, color: '#007AFF' },
  retryBtn: {
    marginTop: 8,
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  retryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
    paddingHorizontal: 4,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerBtnRight: { alignItems: 'flex-end', paddingRight: 10 },
  headerBtnText: { fontSize: 22, color: '#007AFF', lineHeight: 26 },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#1C1C1E', flexShrink: 1 },
  sharedPill: {
    marginLeft: 6,
    backgroundColor: '#E8F1FF',
    borderWidth: 1,
    borderColor: '#BBD7FF',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sharedPillText: { fontSize: 11, fontWeight: '600', color: '#007AFF' },
  menuDots: { fontSize: 16, color: '#007AFF', letterSpacing: 1.5, lineHeight: 20 },

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
  splashName: { fontSize: 17, fontWeight: '600', color: '#1C1C1E' },
});
