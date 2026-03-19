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

import { useToast } from '@/components/Toast';
import { useDatabase } from '@/hooks/useDatabase';
import { useGatekeeper } from '@/hooks/useGatekeeper';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { Haptics, safeNotificationAsync } from '@/lib/haptics';
import { supabase } from '@/services/supabase';

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

const BUNDLE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

const PLATFORM_PATTERNS: Array<{ pattern: RegExp; label: string; color: string }> = [
  { pattern: /\.lovable\.(dev|app)(\/|$)/i, label: 'Lovable', color: '#7C3AED' },
  { pattern: /\.bolt\.host(\/|$)/i, label: 'Bolt', color: '#F97316' },
  { pattern: /\.vercel\.app(\/|$)/i, label: 'Vercel', color: '#000000' },
  { pattern: /\.netlify\.app(\/|$)/i, label: 'Netlify', color: '#00BFA5' },
  { pattern: /\.replit\.dev(\/|$)/i, label: 'Replit', color: '#0A6BEF' },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'input' | 'processing' | 'details' | 'installing';

interface ParsedBundle {
  appId: string;
  html: string | null;
  name: string;
  hash: string | null;
  size: number;
  sourceType: 'url' | 'zip';
  sourceUrl?: string;
  /** Filesystem path WITHOUT file:// prefix and WITHOUT trailing slash. */
  bundlePath: string;
}

// ── Platform detection ────────────────────────────────────────────────────────

function detectPlatform(url: string): { label: string; color: string } | null {
  for (const p of PLATFORM_PATTERNS) {
    if (p.pattern.test(url)) return { label: p.label, color: p.color };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { label: 'Web App', color: '#8E8E93' };
  }
  return null;
}

// ── URL / asset helpers ───────────────────────────────────────────────────────

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

/** Returns true for file types that should be written as Base64 (binary). */
function isBinaryExt(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|otf|pdf|avif)(\?.*)?$/i.test(path);
}

function extractFaviconUrl(html: string, baseUrl: string): string | null {
  const iconLinks: string[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1] ?? '';
    if (!/\bicon\b/i.test(rel)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href) iconLinks.push(href);
  }

  const candidates = iconLinks.length > 0 ? iconLinks : ['/favicon.ico'];
  for (const href of candidates) {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      // keep trying fallback candidates
    }
  }
  return null;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUrlMetadata(
  pageUrl: string,
  onStatus: (s: string) => void
): Promise<{ name: string; faviconUrl: string | null; hash: string; size: number }> {
  onStatus('Fetching app metadata…');

  let res: Response;
  try {
    res = await fetchWithTimeout(pageUrl, 30_000);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    throw new Error(
      msg.toLowerCase().includes('abort')
        ? 'Request timed out after 30 seconds'
        : `Cannot reach app: ${msg}`
    );
  }
  if (!res.ok) throw new Error(`Server returned ${res.status} ${res.statusText}`);

  onStatus('Extracting title and icon…');
  const rawHtml = await res.text();
  const name = extractTitle(rawHtml) || new URL(pageUrl).hostname;
  const faviconUrl = extractFaviconUrl(rawHtml, pageUrl);
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawHtml);

  return {
    name,
    faviconUrl,
    hash,
    size: rawHtml.length,
  };
}

// ── ZIP → local bundle ────────────────────────────────────────────────────────

async function extractAndBundle(
  fileUri: string,
  appId: string,
  onStatus: (s: string) => void
): Promise<ParsedBundle> {
  const JSZip = (await import('jszip')).default;

  onStatus('Reading ZIP…');
  const b64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  onStatus('Extracting…');
  const zip = await JSZip.loadAsync(b64, { base64: true });

  // Locate index.html (root or one directory level deep)
  let indexEntry = zip.file('index.html') as import('jszip').JSZipObject | null;
  if (!indexEntry) {
    zip.forEach((path, file) => {
      if (!indexEntry && !file.dir && /^[^/]+\/index\.html$/i.test(path)) {
        indexEntry = file;
      }
    });
  }
  if (!indexEntry) throw new Error('No index.html found in this ZIP');

  const rawIndex = await (indexEntry as import('jszip').JSZipObject).async('string');
  const detectedName = extractTitle(rawIndex) || 'My App';

  // If ZIP nests everything inside a single directory (e.g. myapp/index.html),
  // strip that prefix so {appDir}/index.html is at the root.
  const indexPath: string = (indexEntry as any).name ?? 'index.html';
  const indexDir = indexPath.includes('/')
    ? indexPath.slice(0, indexPath.lastIndexOf('/') + 1)
    : '';

  const appDir = `${FileSystem.documentDirectory}apps/${appId}/`;
  await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });

  // Write all ZIP entries to filesystem
  let totalSize = rawIndex.length;
  const writeTasks: Promise<void>[] = [];

  zip.forEach((relativePath, file) => {
    if (file.dir) return;

    // Normalise path — strip the indexDir prefix if present
    const normalised =
      indexDir && relativePath.startsWith(indexDir)
        ? relativePath.slice(indexDir.length)
        : relativePath;

    if (!normalised) return;

    const isBin = isBinaryExt(normalised);
    const localPath = `${appDir}${normalised}`;
    const dir = localPath.slice(0, localPath.lastIndexOf('/') + 1);

    writeTasks.push(
      (isBin
        ? file.async('base64' as any)
        : file.async('string' as any)
      )
        .then(async (content: string) => {
          totalSize += content.length;
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
          await FileSystem.writeAsStringAsync(localPath, content, {
            encoding: isBin
              ? FileSystem.EncodingType.Base64
              : FileSystem.EncodingType.UTF8,
          });
        })
        .catch(() => {})
    );
  });

  onStatus('Writing files…');
  await Promise.all(writeTasks);

  // Rewrite absolute paths in index.html so they resolve against file://
  //   src="/assets/x.js"  →  src="./assets/x.js"
  //   href="/assets/x.css" → href="./assets/x.css"
  let modifiedHtml = rawIndex
    .replace(/\bsrc="\/(?!\/)/g, 'src="./')
    .replace(/\bsrc='\/(?!\/)/g, "src='./")
    .replace(/\bhref="\/(?!\/)/g, 'href="./')
    .replace(/\bhref='\/(?!\/)/g, "href='./");

  await FileSystem.writeAsStringAsync(`${appDir}index.html`, modifiedHtml, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (totalSize > BUNDLE_SIZE_LIMIT) {
    Alert.alert(
      'Large ZIP',
      `This ZIP is ${(totalSize / 1024 / 1024).toFixed(1)} MB. App installed but performance may be affected.`,
      [{ text: 'OK' }]
    );
  }

  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawIndex
  );

  return {
    appId,
    html: modifiedHtml,
    name: detectedName,
    hash,
    size: totalSize,
    sourceType: 'zip',
    bundlePath: appDir.replace(/^file:\/\//, '').replace(/\/$/, ''),
  };
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
    console.error('[AddScreen] Unhandled render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.boundaryRoot} edges={['bottom']}>
          <View style={styles.boundaryCard}>
            <Text style={styles.boundaryTitle}>Something went wrong</Text>
            <Text style={styles.boundaryBody}>
              Please reopen Add App and try again.
            </Text>
            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.8}
              style={styles.boundaryBtn}
            >
              <Text style={styles.boundaryBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

function AddScreenContent() {
  const params = useLocalSearchParams<{ replace_app_id?: string; replace_url?: string }>();
  const db = useDatabase();
  const { refresh } = useInstalledApps();
  const { showToast } = useToast();
  const { gateAppInstall } = useGatekeeper();
  const replaceAppId =
    typeof params.replace_app_id === 'string' ? params.replace_app_id : null;
  const replaceUrlParam =
    typeof params.replace_url === 'string' ? params.replace_url : null;

  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState('');
  const [processingMsg, setProcessingMsg] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Populated after successful fetch/extract
  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [appName, setAppName] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('📱');
  const [selectedBg, setSelectedBg] = useState('#DBEAFE');

  const platform = detectPlatform(url);

  useEffect(() => {
    if (replaceUrlParam && url.length === 0) {
      setUrl(String(replaceUrlParam));
    }
  }, [replaceUrlParam, url.length]);

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

      try {
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
      } catch (metadataError) {
        throw metadataError;
      }
    } catch (e) {
      console.error('[AddScreen] URL import flow failed:', e);
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

  const handleInstall = async () => {
    if (!bundle || step === 'installing') return;

    // Gate new installs (skip for replacements/updates)
    if (!replaceAppId && !gateAppInstall()) return;

    setStep('installing');

    try {
      const finalName = appName.trim() || bundle.name || 'My App';

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
          bundle.bundlePath,
          bundle.html,     // local-mode HTML payload (null for URL apps)
          bundle.sourceType,
          bundle.sourceUrl ?? null,
          bundle.hash,
          bundle.size,
          replaceAppId
        );
      } else {
        await db.runAsync(
          `INSERT INTO apps
             (app_id, name, icon_emoji, icon_bg_color, bundle_path, bundle_html,
              source_type, source_url, bundle_hash, bundle_size, installed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          bundle.appId,
          finalName,
          selectedEmoji,
          selectedBg,
          bundle.bundlePath,
          bundle.html,     // local-mode HTML payload (null for URL apps)
          bundle.sourceType,
          bundle.sourceUrl ?? null,
          bundle.hash,
          bundle.size
        );
      }

      await refresh();

      // Increment app count for new installs (fire-and-forget)
      if (!replaceAppId) {
        void supabase.rpc('increment_app_count', { delta: 1 }).then(undefined, () => {});
      }

      void safeNotificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(replaceAppId ? 'App updated ✓' : 'App installed ✓', 'success');
      setTimeout(() => {
        try {
          router.back();
        } catch (navErr) {
          console.error('[AddScreen] router.back() failed after install:', navErr);
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
            <ActivityIndicator size="large" color="#007AFF" />
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
                      placeholderTextColor="#C7C7CC"
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

              {/* ── Section 2: From ZIP ──────────────────────────────────── */}
              {step === 'input' && (
                <View style={styles.section}>
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <TouchableOpacity
                    onPress={handleSelectZip}
                    activeOpacity={0.8}
                    style={styles.outlineBtn}
                  >
                    <Text style={styles.outlineBtnText}>Upload ZIP File</Text>
                  </TouchableOpacity>
                  <Text style={styles.zipHint}>
                    ZIP must contain an index.html at root or one level deep
                  </Text>
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
                        placeholderTextColor="#C7C7CC"
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
                      <View style={styles.emojiGrid}>
                        {EMOJI_OPTIONS.map((emoji) => (
                          <TouchableOpacity
                            key={emoji}
                            onPress={() => setSelectedEmoji(emoji)}
                            style={[
                              styles.emojiCell,
                              { backgroundColor: selectedBg },
                              selectedEmoji === emoji && styles.emojiCellSelected,
                            ]}
                          >
                            <Text style={styles.emojiChar}>{emoji}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {/* Color picker */}
                    <View style={[styles.fieldGroup, styles.fieldGroupBorder]}>
                      <Text style={styles.fieldLabel}>Background</Text>
                      <View style={styles.colorRow}>
                        {BG_COLOR_OPTIONS.map((color) => (
                          <TouchableOpacity
                            key={color}
                            onPress={() => setSelectedBg(color)}
                            style={[
                              styles.colorSwatch,
                              { backgroundColor: color },
                              selectedBg === color
                                ? styles.colorSwatchSelected
                                : styles.colorSwatchUnselected,
                            ]}
                          />
                        ))}
                      </View>
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

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  dragHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#D1D1D6',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
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

  cancelBtn: {
    fontSize: 17,
    color: '#007AFF',
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
    color: '#3C3C43',
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
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 4,
    marginBottom: 2,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },

  urlInput: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
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
    backgroundColor: '#007AFF',
    margin: 12,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryBtnDisabled: {
    backgroundColor: '#C7C7CC',
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
    backgroundColor: '#C7C7CC',
  },
  dividerText: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '500',
  },

  outlineBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#007AFF',
  },
  outlineBtnText: {
    color: '#007AFF',
    fontSize: 17,
    fontWeight: '600',
  },
  zipHint: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  fieldGroup: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fieldGroupBorder: {
    borderTopWidth: 0.5,
    borderTopColor: '#E5E5EA',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  nameInput: {
    fontSize: 16,
    color: '#1C1C1E',
    borderWidth: 0.5,
    borderColor: '#E5E5EA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9F9F9',
  },

  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emojiCell: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  emojiCellSelected: {
    borderColor: '#007AFF',
  },
  emojiChar: {
    fontSize: 24,
  },

  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorSwatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  colorSwatchSelected: {
    borderWidth: 3,
    borderColor: '#007AFF',
  },
  colorSwatchUnselected: {
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
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
    color: '#1C1C1E',
    flex: 1,
  },
});
