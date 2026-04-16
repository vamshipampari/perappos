import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ColorPicker } from '@/components/ColorPicker';
import { EmojiPicker } from '@/components/EmojiPicker';
import { useToast } from '@/components/Toast';
import { useDatabase } from '@/hooks/useDatabase';
import { useGatekeeper } from '@/hooks/useGatekeeper';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { HTML_SIZE_LIMIT, deployHtml, parseHtmlMeta } from '@/services/htmlDeployer';
import { Haptics, safeNotificationAsync } from '@/lib/haptics';
import { log } from '@/lib/logger';
import { supabase } from '@/services/supabase';
import { track } from '@/services/analytics';
import { posthog } from '../src/config/posthog';
import { powerSyncDb } from '@/services/sync/PowerSyncProvider';
import { detectPlatform, fetchUrlMetadata } from '@/services/urlFetcher';
import { type ParsedBundle, extractAndBundle } from '@/services/zipInstaller';
import { useTheme, type Colors } from '@/lib/theme';

// ── Constants ─────────────────────────────────────────────────────────────────

const EMOJI_OPTIONS = ['📱', '💪', '✅', '💰', '📊', '🎯', '📝', '🛒', '🎨', '🔧', '📚', '🎮'];

const BG_COLOR_OPTIONS = [
  '#DBEAFE', // blue
  '#D1FAE5', // green
  '#FEF3C7', // yellow
  '#FCE7F3', // pink
  '#E0E7FF', // indigo
  '#FEE2E2', // red
  '#F3E8FF', // purple
  '#E5E7EB', // gray
];

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'input' | 'processing' | 'details' | 'installing';

// ── Styles ────────────────────────────────────────────────────────────────────

// Static styles for the class-based ErrorBoundary (can't use hooks in classes).
const boundaryStyles = StyleSheet.create({
  boundaryRoot: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  boundaryCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 10,
  },
  boundaryTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  boundaryBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#3C3C43',
    textAlign: 'center',
  },
  boundaryBtn: {
    marginTop: 6,
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  boundaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

function makeStyles(theme: Colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.groupedBackground,
    },
    dragHandle: {
      width: 36,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: theme.labelTertiary,
      alignSelf: 'center',
      marginTop: 8,
      marginBottom: 4,
    },

    cancelBtn: {
      fontSize: 17,
      color: theme.primary,
    },

    // Processing overlay
    processingOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
      paddingHorizontal: 32,
    },
    processingMsg: {
      fontSize: 16,
      color: theme.labelSecondary,
      textAlign: 'center',
    },

    scrollContent: {
      padding: 20,
      gap: 8,
      paddingBottom: 40,
    },

    section: {
      gap: 8,
    },
    sectionHeader: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.labelSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      paddingHorizontal: 4,
      marginBottom: 2,
    },

    card: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      overflow: 'hidden',
    },

    urlInput: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: theme.label,
      lineHeight: 22,
    },

    badgeRow: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      flexDirection: 'row',
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
    },
    badgeDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    badgeText: {
      fontSize: 13,
      fontWeight: '600',
    },

    errorBox: {
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: '#FEE2E2',
      borderRadius: 8,
      padding: 10,
    },
    errorText: {
      fontSize: 13,
      color: '#B91C1C',
      lineHeight: 18,
    },

    primaryBtn: {
      backgroundColor: theme.primary,
      margin: 12,
      borderRadius: 12,
      paddingVertical: 15,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
    },
    primaryBtnDisabled: {
      backgroundColor: theme.labelTertiary,
    },
    primaryBtnText: {
      color: '#FFFFFF',
      fontSize: 17,
      fontWeight: '600',
    },

    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 4,
      marginVertical: 4,
    },
    dividerLine: {
      flex: 1,
      height: 0.5,
      backgroundColor: theme.labelTertiary,
    },
    dividerText: {
      fontSize: 13,
      color: theme.labelSecondary,
      fontWeight: '500',
    },

    outlineBtn: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      paddingVertical: 15,
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: theme.primary,
    },
    outlineBtnText: {
      color: theme.primary,
      fontSize: 17,
      fontWeight: '600',
    },
    zipHint: {
      fontSize: 12,
      color: theme.labelSecondary,
      textAlign: 'center',
      paddingHorizontal: 8,
    },

    fieldGroup: {
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    fieldGroupBorder: {
      borderTopWidth: 0.5,
      borderTopColor: theme.separator,
    },
    fieldLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.labelSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10,
    },

    nameInput: {
      fontSize: 16,
      color: theme.label,
      borderWidth: 0.5,
      borderColor: theme.separator,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: theme.inputBackground,
    },

    previewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    previewIcon: {
      width: 56,
      height: 56,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 2,
    },
    previewEmoji: {
      fontSize: 26,
    },
    previewName: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.label,
      flex: 1,
    },

    // Create with AI card
    aiCard: {
      backgroundColor: '#F5F3FF',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: '#DDD6FE',
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    aiCardEmoji: {
      fontSize: 28,
    },
    aiCardText: {
      flex: 1,
      gap: 2,
    },
    aiCardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.label,
    },
    aiCardSubtitle: {
      fontSize: 13,
      color: theme.labelSecondary,
      lineHeight: 18,
    },
    aiCardChevron: {
      fontSize: 22,
      color: theme.labelTertiary,
      fontWeight: '300',
    },
    aiCardDisabled: {
      opacity: 0.6,
    },
    comingSoonBadge: {
      backgroundColor: '#E0E7FF',
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    comingSoonText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#6366F1',
    },
    // ── HTML add flow ─────────────────────────────────────────────────────────
    htmlFileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
    },
    htmlFileName: {
      flex: 1,
      fontSize: 13,
      color: theme.labelSecondary,
    },
    htmlFileBtn: {
      backgroundColor: theme.groupedBackground,
      borderRadius: 8,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderWidth: 0.5,
      borderColor: theme.separator,
    },
    htmlFileBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.primary,
    },
    htmlInnerDivider: {
      height: 0.5,
      backgroundColor: theme.separator,
      marginHorizontal: 16,
    },
    htmlInput: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 13,
      color: theme.label,
      lineHeight: 20,
      minHeight: 120,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      textAlignVertical: 'top',
    },
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AddScreen() {
  return (
    <AddScreenErrorBoundary>
      <AddScreenContent />
    </AddScreenErrorBoundary>
  );
}

interface AddScreenErrorBoundaryProps {
  children: ReactNode;
}

interface AddScreenErrorBoundaryState {
  hasError: boolean;
}

class AddScreenErrorBoundary extends Component<
  AddScreenErrorBoundaryProps,
  AddScreenErrorBoundaryState
> {
  state: AddScreenErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AddScreenErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error('[AddScreen] Unhandled render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={boundaryStyles.boundaryRoot} edges={['bottom']}>
          <View style={boundaryStyles.boundaryCard}>
            <Text style={boundaryStyles.boundaryTitle}>Something went wrong</Text>
            <Text style={boundaryStyles.boundaryBody}>
              Please reopen Add App and try again.
            </Text>
            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.8}
              style={boundaryStyles.boundaryBtn}
            >
              <Text style={boundaryStyles.boundaryBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

function AddScreenContent() {
  const params = useLocalSearchParams<{
    replace_app_id?: string;
    replace_url?: string;
    prefillUrl?: string;
    prefillName?: string;
    prefillEmoji?: string;
    prefillColor?: string;
    return_to?: string;   // If set, navigate here after install instead of router.back()
  }>();
  const db = useDatabase();
  const { refresh, apps } = useInstalledApps();
  const { showToast } = useToast();
  const { gateAppInstall } = useGatekeeper();
  const theme = useTheme();
  const styles = makeStyles(theme);

  const replaceAppId =
    typeof params.replace_app_id === 'string' ? params.replace_app_id : null;
  const replaceUrlParam =
    typeof params.replace_url === 'string' ? params.replace_url : null;
  const prefillUrl = typeof params.prefillUrl === 'string' ? params.prefillUrl : null;
  const prefillName = typeof params.prefillName === 'string' ? params.prefillName : null;
  const prefillEmoji = typeof params.prefillEmoji === 'string' ? params.prefillEmoji : null;
  const prefillColor = typeof params.prefillColor === 'string' ? params.prefillColor : null;
  const returnTo = typeof params.return_to === 'string' ? params.return_to : null;

  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState('');
  const [processingMsg, setProcessingMsg] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Populated after successful fetch/extract
  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [appName, setAppName] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('📱');
  const [selectedBg, setSelectedBg] = useState('#DBEAFE');

  // HTML add flow
  const [htmlContent, setHtmlContent] = useState('');
  const [htmlFileName, setHtmlFileName] = useState<string | null>(null);

  const platform = detectPlatform(url);

  useEffect(() => {
    if (replaceUrlParam && url.length === 0) {
      setUrl(String(replaceUrlParam));
    }
  }, [replaceUrlParam, url.length]);

  // Auto-import when coming from the Create with AI screen
  useEffect(() => {
    if (!prefillUrl) return;
    setUrl(prefillUrl);
    if (prefillName) setAppName(prefillName);
    if (prefillEmoji) setSelectedEmoji(prefillEmoji);
    if (prefillColor) setSelectedBg(prefillColor);
    const trimmedUrl = prefillUrl.trim();
    if (!trimmedUrl.startsWith('http')) return;
    setError(null);

    // When all metadata is already provided (e.g. from Create with AI), skip
    // fetchUrlMetadata entirely. That call does a 30-second network round-trip
    // just to get a title and hash we already have — if the Cloudflare URL
    // hasn't propagated yet it throws and leaves the user stuck on the input step.
    if (prefillName && prefillEmoji && prefillColor) {
      const appId = Crypto.randomUUID();
      setBundle({
        appId,
        html: null,
        name: prefillName,
        hash: '',
        size: 0,
        sourceType: 'url',
        sourceUrl: trimmedUrl,
        bundlePath: '',
      });
      setStep('details');
      return;
    }

    // Partial prefill (prefillUrl only) — fetch metadata from the URL.
    setStep('processing');
    const appId = Crypto.randomUUID();
    fetchUrlMetadata(trimmedUrl, setProcessingMsg)
      .then((metadata) => {
        setBundle({
          appId,
          html: null,
          name: prefillName || metadata.name,
          hash: metadata.hash,
          size: metadata.size,
          sourceType: 'url',
          sourceUrl: trimmedUrl,
          bundlePath: '',
        });
        if (!prefillName) setAppName(metadata.name);
        setStep('details');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to read app metadata');
        setStep('input');
      });
  // Only run once on mount when prefillUrl is present
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!replaceAppId) return;
    (async () => {
      try {
        const existing = await db.getFirstAsync<{
          name: string;
          icon_emoji: string;
          icon_bg_color: string;
          source_url: string | null;
        }>('SELECT name, icon_emoji, icon_bg_color, source_url FROM apps WHERE app_id = ?', replaceAppId);
        if (!existing) return;
        setAppName(existing.name);
        setSelectedEmoji(existing.icon_emoji ?? '📱');
        setSelectedBg(existing.icon_bg_color ?? '#DBEAFE');
        if (!replaceUrlParam && existing.source_url) {
          setUrl(existing.source_url);
        }
      } catch {
        // non-critical
      }
    })();
  }, [db, replaceAppId, replaceUrlParam]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleAddFromUrl = async () => {
    try {
      const trimmedUrl = url.trim();
      if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
        Alert.alert('Invalid URL', 'Please enter a URL starting with http:// or https://');
        return;
      }

      setError(null);
      setStep('processing');
      const appId = replaceAppId ?? Crypto.randomUUID();

      const metadata = await fetchUrlMetadata(trimmedUrl, setProcessingMsg);
      setBundle({
        appId,
        html: null,
        name: metadata.name,
        hash: metadata.hash,
        size: metadata.size,
        sourceType: 'url',
        sourceUrl: trimmedUrl,
        bundlePath: '',
      });
      setAppName(metadata.name);
      if (metadata.faviconUrl) setSelectedEmoji('🌐');
      setStep('details');
    } catch (e) {
      log.error('[AddScreen] URL import flow failed:', e);
      setError(e instanceof Error ? e.message : 'Failed to read app metadata');
      setStep('input');
    }
  };

  const handleSelectZip = async () => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
    } catch {
      return;
    }

    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    if (asset.name && !asset.name.toLowerCase().endsWith('.zip')) {
      Alert.alert('Wrong File Type', 'Please select a .zip file.');
      return;
    }

    setError(null);
    setStep('processing');
    const appId = Crypto.randomUUID();

    try {
      const result = await extractAndBundle(asset.uri, appId, setProcessingMsg);
      setBundle(result);
      setAppName(result.name);
      setStep('details');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to extract ZIP');
      setStep('input');
    }
  };

  const handleSelectHtml = async () => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: ['text/html', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
    } catch {
      return;
    }

    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    if (asset.name && !asset.name.toLowerCase().endsWith('.html')) {
      Alert.alert('Wrong File Type', 'Please select a .html file.');
      return;
    }

    try {
      const content = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      setHtmlContent(content);
      setHtmlFileName(asset.name ?? 'file.html');
    } catch {
      Alert.alert('Read Error', 'Could not read the selected file.');
    }
  };

  const handleHtmlNext = async () => {
    const trimmed = htmlContent.trim();

    if (trimmed.length === 0) {
      Alert.alert('No HTML', 'Please paste HTML code or select a .html file.');
      return;
    }

    const htmlBytes = new TextEncoder().encode(trimmed).length;
    if (htmlBytes > HTML_SIZE_LIMIT) {
      Alert.alert(
        'File Too Large',
        `HTML must be under 5 MB. This file is ${(htmlBytes / 1024 / 1024).toFixed(1)} MB.`
      );
      return;
    }

    if (!trimmed.includes('<html') && !trimmed.includes('<!DOCTYPE')) {
      Alert.alert('Invalid HTML', 'The content does not look like a valid HTML document.');
      return;
    }

    setError(null);

    const meta = parseHtmlMeta(trimmed);
    const appId = replaceAppId ?? Crypto.randomUUID();
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      trimmed
    );

    setBundle({
      appId,
      html: trimmed,
      name: meta.title,
      hash,
      size: htmlBytes,
      sourceType: 'html',
      sourceUrl: undefined,
      bundlePath: '',
    });
    setAppName(meta.title);
    if (meta.icon !== '✨') setSelectedEmoji(meta.icon);
    if (meta.color !== '#E0E7FF') setSelectedBg(meta.color);

    setStep('details');
  };

  const handleInstall = async () => {
    if (!bundle || step === 'installing') return;

    // Gate new installs (skip for replacements/updates).
    // Pass local non-demo count as source of truth to avoid false "limit reached"
    // errors caused by the Supabase counter drifting after a device/user-switch wipe.
    const nonDemoCount = apps.filter(a => a.source_type !== 'demo').length;
    if (!replaceAppId && !gateAppInstall(nonDemoCount)) return;

    setStep('installing');

    try {
      const finalName = appName.trim() || bundle.name || 'My App';

      // For HTML apps, deploy to Cloudflare before writing to SQLite so the
      // source_url is available for sharing. Without a cloud URL, other users
      // who join a shared version of this app will get a blank screen.
      let finalBundle = bundle;
      if (bundle.sourceType === 'html' && bundle.html) {
        const { data: { session } } = await supabase.auth.getSession();
        log.info('[AddScreen] HTML deploy — session:', session ? `uid=${session.user.id}` : 'NONE');

        if (!session) {
          // Not signed in — install locally. The lazy-deploy path in
          // handleCollaborate will deploy when they first try to share.
          log.info('[AddScreen] Skipping cloud deploy — not signed in');
          showToast('Saved locally. Sign in to enable sharing.', 'success');
        } else {
          try {
            log.info('[AddScreen] Deploying HTML to Cloudflare, appId:', bundle.appId);
            const { url: cfUrl } = await deployHtml(bundle.appId, bundle.html);
            finalBundle = { ...bundle, sourceUrl: cfUrl };
            log.info('[AddScreen] HTML deployed successfully:', cfUrl);
          } catch (deployErr) {
            const reason = deployErr instanceof Error ? deployErr.message : String(deployErr);
            log.warn('[AddScreen] Cloudflare deploy failed:', reason);
            await new Promise<void>((resolve) => {
              Alert.alert(
                'Cloud Deploy Failed',
                `The app was saved on this device but could not be deployed to the cloud.\n\nReason: ${reason}\n\nSharing won't work until redeployed. Tap "Edit HTML" from the app menu to retry.`,
                [{ text: 'OK', onPress: () => resolve() }]
              );
            });
          }
        }
      }

      if (replaceAppId) {
        await db.runAsync(
          `UPDATE apps
              SET name = ?, icon_emoji = ?, icon_bg_color = ?, bundle_path = ?, bundle_html = ?,
                  source_type = ?, source_url = ?, bundle_hash = ?, bundle_size = ?,
                  updated_at = datetime('now')
            WHERE app_id = ?`,
          finalName,
          selectedEmoji,
          selectedBg,
          finalBundle.bundlePath,
          finalBundle.html,
          finalBundle.sourceType,
          finalBundle.sourceUrl ?? null,
          finalBundle.hash,
          finalBundle.size,
          replaceAppId
        );
      } else {
        await db.runAsync(
          `INSERT INTO apps
             (app_id, name, icon_emoji, icon_bg_color, bundle_path, bundle_html,
              source_type, source_url, bundle_hash, bundle_size, installed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          finalBundle.appId,
          finalName,
          selectedEmoji,
          selectedBg,
          finalBundle.bundlePath,
          finalBundle.html,
          finalBundle.sourceType,
          finalBundle.sourceUrl ?? null,
          finalBundle.hash,
          finalBundle.size
        );
      }

      await refresh();

      // Mirror metadata to PowerSync installed_apps for cross-device sync.
      // Use INSERT OR REPLACE so updates (replaceAppId flow) overwrite the existing row.
      void powerSyncDb.execute(
        `INSERT OR REPLACE INTO installed_apps
           (id, app_id, name, icon_emoji, icon_bg_color, source_type, source_url,
            bundle_hash, installed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          finalBundle.appId, finalBundle.appId, finalName, selectedEmoji, selectedBg,
          finalBundle.sourceType, finalBundle.sourceUrl ?? null, finalBundle.hash ?? null,
        ]
      ).catch(() => {}); // fire-and-forget, non-critical

      // Increment app count for new installs. Backend enforces the limit and
      // returns an error object if it is exceeded (e.g. client-side gate drifted).
      if (!replaceAppId) {
        supabase.rpc('increment_app_count', { delta: 1 }).then(({ data }) => {
          const result = data as { error?: string; limit?: number } | null;
          if (result?.error === 'app_limit_exceeded') {
            Alert.alert(
              'App Limit Reached',
              `Your plan allows up to ${result.limit} apps. Redeem a promo code or upgrade for unlimited apps.`,
              [{ text: 'OK' }]
            );
          }
        }, () => {});
      }

      if (!replaceAppId) {
        void track('app_installed', { source_type: finalBundle.sourceType });
        posthog.capture('app_installed', { source_type: finalBundle.sourceType });
      }
      void safeNotificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(replaceAppId ? 'App updated ✓' : 'App installed ✓', 'success');
      setTimeout(() => {
        try {
          if (returnTo) {
            // Caller (e.g. create.tsx) wants us to go straight to home after install,
            // dismissing the whole create+add modal stack in one shot.
            router.dismissAll();
          } else {
            router.back();
          }
        } catch (navErr) {
          log.error('[AddScreen] router.back() failed after install:', navErr);
          router.push('/(tabs)');
        }
      }, 300);
    } catch {
      setStep('details');
      void safeNotificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast('Could not install app', 'error');
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={8}
              style={{ paddingHorizontal: 4 }}
            >
              <Text style={styles.cancelBtn}>Cancel</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <SafeAreaView edges={['bottom']} style={styles.root}>
        {/* ── Drag handle (iOS sheet indicator) ──────────────────────────── */}
        <View style={styles.dragHandle} />

        {/* ── Processing overlay ─────────────────────────────────────────── */}
        {step === 'processing' && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.processingMsg}>{processingMsg}</Text>
          </View>
        )}

        {step !== 'processing' && (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >

              {/* ── Section 1: From URL ──────────────────────────────────── */}
              {(step === 'input' || step === 'details') && (
                <View style={styles.section}>
                  <Text style={styles.sectionHeader}>FROM URL</Text>
                  <View style={styles.card}>
                    <TextInput
                      value={url}
                      onChangeText={(text) => {
                        // Normalise locale-specific punctuation to ASCII equivalents.
                        // Some keyboards (e.g. Hindi/Marathi) emit the Devanagari danda
                        // character (।, U+0964) instead of a period when the URL keyboard
                        // is active, turning "netlify.app" into "netlify।app".
                        const normalised = text
                          .replace(/।/g, '.')   // Devanagari danda → period
                          .replace(/॥/g, '.')   // double danda → period
                          .replace(/['']/g, "'") // curly apostrophes → straight
                          .replace(/[""]/g, '"'); // curly quotes → straight
                        setUrl(normalised);
                      }}
                      placeholder="Paste app URL (lovable.dev, bolt.host, vercel.app…)"
                      placeholderTextColor={theme.labelTertiary}
                      style={styles.urlInput}
                      keyboardType="url"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="go"
                      onSubmitEditing={step === 'input' ? handleAddFromUrl : undefined}
                      editable={step === 'input'}
                    />

                    {/* Platform badge */}
                    {platform && url.length > 0 && (
                      <View style={styles.badgeRow}>
                        <View
                          style={[
                            styles.badge,
                            {
                              backgroundColor:
                                platform.color === '#000000'
                                  ? '#1C1C1E'
                                  : platform.color + '20',
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.badgeDot,
                              {
                                backgroundColor:
                                  platform.color === '#000000' ? '#FFFFFF' : platform.color,
                              },
                            ]}
                          />
                          <Text
                            style={[
                              styles.badgeText,
                              {
                                color:
                                  platform.color === '#000000' ? '#FFFFFF' : platform.color,
                              },
                            ]}
                          >
                            {platform.label}
                          </Text>
                        </View>
                      </View>
                    )}

                    {/* Error */}
                    {error && step === 'input' && (
                      <View style={styles.errorBox}>
                        <Text style={styles.errorText}>⚠ {error}</Text>
                      </View>
                    )}

                    {step === 'input' && (
                      <TouchableOpacity
                        onPress={handleAddFromUrl}
                        disabled={url.trim().length === 0}
                        activeOpacity={0.8}
                        style={[
                          styles.primaryBtn,
                          url.trim().length === 0 && styles.primaryBtnDisabled,
                        ]}
                      >
                        <Text style={styles.primaryBtnText}>
                          {replaceAppId ? 'Prepare Replacement' : 'Add App'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {/* ── Section 2: From HTML ─────────────────────────────────── */}
              {step === 'input' && (
                <View style={styles.section}>
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <Text style={styles.sectionHeader}>FROM HTML</Text>
                  <View style={styles.card}>
                    {/* File picker row */}
                    <View style={styles.htmlFileRow}>
                      <Text style={styles.htmlFileName} numberOfLines={1}>
                        {htmlFileName ?? 'No file selected'}
                      </Text>
                      <TouchableOpacity
                        onPress={handleSelectHtml}
                        activeOpacity={0.8}
                        style={styles.htmlFileBtn}
                      >
                        <Text style={styles.htmlFileBtnText}>Select .html file</Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      onPress={handleHtmlNext}
                      disabled={htmlContent.trim().length === 0}
                      activeOpacity={0.8}
                      style={[
                        styles.primaryBtn,
                        htmlContent.trim().length === 0 && styles.primaryBtnDisabled,
                        { marginBottom: 8 },
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>Next</Text>
                    </TouchableOpacity>

                    <View style={styles.htmlInnerDivider} />

                    {/* Paste area */}
                    <TextInput
                      value={htmlContent}
                      onChangeText={(text) => {
                        setHtmlContent(text);
                        if (htmlFileName) setHtmlFileName(null);
                      }}
                      placeholder={'Or paste HTML code here…\n\n<!DOCTYPE html>\n<html>…'}
                      placeholderTextColor={theme.labelTertiary}
                      style={styles.htmlInput}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                    />
                  </View>
                </View>
              )}

              {/* ── Create with AI card ──────────────────────────────────── */}
              {step === 'input' && (
                <View style={styles.section}>
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <TouchableOpacity
                    onPress={() => { router.push('/create'); }}
                    activeOpacity={0.7}
                    style={styles.aiCard}
                  >
                    <Text style={styles.aiCardEmoji}>✨</Text>
                    <View style={styles.aiCardText}>
                      <Text style={styles.aiCardTitle}>Create with AI</Text>
                      <Text style={styles.aiCardSubtitle}>
                        Describe what you want — get an app in seconds
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Section 3: App Details ───────────────────────────────── */}
              {(step === 'details' || step === 'installing') && bundle && (
                <View style={styles.section}>
                  <Text style={styles.sectionHeader}>APP DETAILS</Text>
                  <View style={styles.card}>
                    {/* Name */}
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Name</Text>
                      <TextInput
                        value={appName}
                        onChangeText={setAppName}
                        placeholder="App name"
                        placeholderTextColor={theme.labelTertiary}
                        style={styles.nameInput}
                        autoCapitalize="words"
                        autoCorrect={false}
                        spellCheck={false}
                        returnKeyType="done"
                      />
                    </View>

                    {/* Icon picker */}
                    <View style={[styles.fieldGroup, styles.fieldGroupBorder]}>
                      <Text style={styles.fieldLabel}>Icon</Text>
                      <EmojiPicker
                        options={EMOJI_OPTIONS}
                        selected={selectedEmoji}
                        bgColor={selectedBg}
                        onSelect={setSelectedEmoji}
                      />
                    </View>

                    {/* Color picker */}
                    <View style={[styles.fieldGroup, styles.fieldGroupBorder]}>
                      <Text style={styles.fieldLabel}>Background</Text>
                      <ColorPicker
                        options={BG_COLOR_OPTIONS}
                        selected={selectedBg}
                        onSelect={setSelectedBg}
                      />
                    </View>

                    {/* Preview */}
                    <View style={[styles.fieldGroup, styles.fieldGroupBorder]}>
                      <Text style={styles.fieldLabel}>Preview</Text>
                      <View style={styles.previewRow}>
                        <View
                          style={[styles.previewIcon, { backgroundColor: selectedBg }]}
                        >
                          <Text style={styles.previewEmoji}>{selectedEmoji}</Text>
                        </View>
                        <Text style={styles.previewName} numberOfLines={2}>
                          {appName || bundle.name || 'My App'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Install button */}
                  <TouchableOpacity
                    onPress={handleInstall}
                    disabled={step === 'installing'}
                    activeOpacity={0.8}
                    style={[
                      styles.primaryBtn,
                      step === 'installing' && styles.primaryBtnDisabled,
                      { marginTop: 8 },
                    ]}
                  >
                    {step === 'installing' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.primaryBtnText}>
                        {replaceAppId ? 'Replace App Code' : 'Install App'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </>
  );
}
