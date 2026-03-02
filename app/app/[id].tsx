import { router, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Pressable,
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
import {
  applyUrlAppUpdate,
  checkForUpdates,
  getLatestBackup,
  revertToPreviousVersion,
} from '@/lib/appUpdates';
import { handleVaultMessage } from '@/lib/vaultBridge';
import { buildVaultShim } from '@/lib/vaultShim';
import { DEMO_HTML_BY_NAME } from '@/utils/demoAppsHtml';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'loading' | 'ready' | 'not_found';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const webViewRef = useRef<WebView>(null);
  const hasLoadedOnceRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('loading');
  const [app, setApp] = useState<InstalledApp | null>(null);
  const [shimJS, setShimJS] = useState('');
  const [bundleHtml, setBundleHtml] = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [webCanGoBack, setWebCanGoBack] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // WebView fades in from 0 → 1 once the page finishes loading
  const webOpacity = useSharedValue(0);
  const webViewAnimStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity: webOpacity.value,
  }));

  // ── Initial load: fetch app row + all KV data from SQLite ─────────────────
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [foundApp, kvRows] = await Promise.all([
          db.getFirstAsync<InstalledApp>('SELECT * FROM apps WHERE app_id = ?', id),
          db.getAllAsync<{ key: string; value: string }>(
            'SELECT key, value FROM app_data WHERE app_id = ?',
            id
          ),
        ]);

        if (!foundApp) {
          setPhase('not_found');
          return;
        }

        // Build preloaded KV map — embedded in shim so reads are synchronous
        const preloadedKV: Record<string, string> = {};
        for (const row of kvRows) preloadedKV[row.key] = row.value;

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
        setShimJS(buildVaultShim(foundApp.app_id, preloadedKV));
        setPhase('ready');
      } catch (e) {
        console.error('[AppScreen] load error:', e);
        setPhase('not_found');
      }
    })();
  }, [id, db]);

  // ── Bridge: WebView → native ──────────────────────────────────────────────
  const handleMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      if (!app) return;
      await handleVaultMessage(event.nativeEvent.data, db, webViewRef, {
        app_id: app.app_id,
        name: app.name,
        source_url: app.source_url,
        installed_at: app.installed_at,
        open_count: app.open_count,
      });
    },
    [db, app]
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

  // ── Menu actions ──────────────────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    setMenuVisible(false);
    setWebError(null);
    setWebLoading(true);
    hasLoadedOnceRef.current = false;
    webOpacity.value = 0;
    webViewRef.current?.reload();
  }, [webOpacity]);

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
        db.getFirstAsync<{ n: number }>(
          'SELECT COUNT(*) AS n FROM app_data WHERE app_id = ?',
          app.app_id
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
  }, [app, db]);

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
              await db.runAsync('DELETE FROM app_data WHERE app_id = ?', app.app_id);
              await db.runAsync('DELETE FROM apps WHERE app_id = ?', app.app_id);
            } catch {
              // ignore
            }
            router.back();
          },
        },
      ]
    );
  }, [app, db]);

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
        </View>

        <TouchableOpacity
          onPress={() => setMenuVisible(true)}
          hitSlop={10}
          style={[styles.headerBtn, styles.headerBtnRight]}
        >
          <Text style={styles.menuDots}>•••</Text>
        </TouchableOpacity>
      </View>

      {/* ── WebView + overlays ──────────────────────────────────────────── */}
      <View style={styles.webContainer}>
        {webError ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 36, marginBottom: 16 }}>⚠️</Text>
            <Text style={styles.errorTitle}>Couldn't load this app</Text>
            <Text style={styles.errorDetail}>{webError}</Text>
            <TouchableOpacity onPress={handleRefresh} style={styles.retryBtn}>
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
              injectedJavaScriptBeforeContentLoaded={shimJS}
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
              }}
              onError={(e) => {
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
          { label: 'Refresh', onPress: handleRefresh },
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
  menuDots: {
    fontSize: 16,
    color: '#007AFF',
    letterSpacing: 1.5,
    lineHeight: 20,
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
