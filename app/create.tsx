import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import { useToast } from '@/components/Toast';
import { useTheme, type Colors } from '@/lib/theme';
import { useGenerateApp } from '@/hooks/useGenerateApp';
import { useDatabase } from '@/hooks/useDatabase';
import { posthog } from '@/src/config/posthog';
import { Sentry, toError, truncateForSentry } from '@/lib/sentry';

// ---------- Constants ----------

const LOADING_MESSAGES = [
  'Understanding your idea...',
  'Designing the interface...',
  'Writing the code...',
  'Adding the finishing touches...',
  'Publishing your app...',
];

// Estimated max chars for a full app — used to fill the progress bar.
// Capped at 95% until the job status flips to 'complete'.
const PROGRESS_MAX_CHARS = 8000;

// ---------- Types ----------

type Status = 'idle' | 'submitting' | 'generating' | 'preview' | 'error';

interface GenerateResult {
  url: string;
  appId: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}

// ---------- Styles ----------

function makeStyles(theme: Colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.groupedBackground,
    },
    flex: {
      flex: 1,
    },
    cancelBtn: {
      fontSize: 17,
      color: theme.primary,
    },

    // Generating overlay
    generatingOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    generatingCard: {
      backgroundColor: theme.surface,
      borderRadius: 20,
      padding: 32,
      alignItems: 'center',
      width: '100%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 4,
    },
    generatingEmoji: {
      fontSize: 48,
    },
    generatingMsg: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.label,
      marginTop: 20,
      textAlign: 'center',
    },
    generatingHint: {
      fontSize: 13,
      color: theme.labelSecondary,
      marginTop: 8,
    },
    progressBarTrack: {
      width: '100%',
      height: 4,
      backgroundColor: theme.separator,
      borderRadius: 2,
      marginTop: 20,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: 4,
      backgroundColor: theme.primary,
      borderRadius: 2,
    },

    // Scroll content
    scrollContent: {
      padding: 16,
      paddingBottom: 8,
      flexGrow: 1,
    },

    // Idle hero
    idleHero: {
      alignItems: 'center',
      paddingTop: 24,
      paddingBottom: 16,
      gap: 8,
    },
    heroEmoji: {
      fontSize: 56,
    },
    heroTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: theme.label,
      marginTop: 8,
      textAlign: 'center',
    },
    heroSubtitle: {
      fontSize: 15,
      color: theme.labelSecondary,
      textAlign: 'center',
      lineHeight: 21,
      paddingHorizontal: 16,
    },
    examplesCard: {
      width: '100%',
      backgroundColor: theme.surface,
      borderRadius: 14,
      overflow: 'hidden',
      marginTop: 20,
    },
    examplesLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: theme.labelSecondary,
      letterSpacing: 0.6,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
    },
    exampleRow: {
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderTopWidth: 0.5,
      borderTopColor: theme.separator,
    },
    exampleRowPressed: {
      backgroundColor: theme.groupedBackground,
    },
    exampleText: {
      fontSize: 15,
      color: theme.primary,
      lineHeight: 20,
    },

    // Error
    errorBox: {
      backgroundColor: '#FEE2E2',
      borderRadius: 14,
      padding: 20,
      marginTop: 16,
      gap: 8,
      alignItems: 'center',
    },
    errorTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#B91C1C',
    },
    errorMsg: {
      fontSize: 14,
      color: '#7F1D1D',
      textAlign: 'center',
      lineHeight: 20,
    },
    errorRetryBtn: {
      marginTop: 8,
      backgroundColor: '#B91C1C',
      paddingHorizontal: 24,
      paddingVertical: 10,
      borderRadius: 10,
    },
    errorRetryText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '600',
    },

    // Preview
    previewContainer: {
      gap: 12,
    },
    appInfoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 4,
    },
    appIconBox: {
      width: 52,
      height: 52,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 2,
    },
    appIconEmoji: {
      fontSize: 26,
    },
    appInfoText: {
      flex: 1,
      gap: 2,
    },
    appTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.label,
    },
    appDesc: {
      fontSize: 13,
      color: theme.labelSecondary,
    },
    webViewWrapper: {
      height: 420,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: theme.surface,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    webView: {
      flex: 1,
    },
    webViewLoading: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    previewErrorOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(255,255,255,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 8,
    },
    previewErrorEmoji: {
      fontSize: 36,
    },
    previewErrorTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.label,
    },
    previewErrorHint: {
      fontSize: 13,
      color: theme.labelSecondary,
      textAlign: 'center',
    },
    refineHint: {
      fontSize: 12,
      color: theme.labelSecondary,
      textAlign: 'center',
    },
    actionRow: {
      flexDirection: 'row',
      gap: 10,
    },
    shareBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1.5,
      borderColor: theme.primary,
    },
    shareBtnText: {
      color: theme.primary,
      fontSize: 16,
      fontWeight: '600',
    },
    installBtn: {
      flex: 2,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
    },
    installBtnText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600',
    },

    // Input bar
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 12,
      backgroundColor: theme.surface,
      borderTopWidth: 0.5,
      borderTopColor: theme.separator,
    },
    promptInput: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      fontSize: 16,
      color: theme.label,
      backgroundColor: theme.groupedBackground,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      lineHeight: 22,
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: {
      backgroundColor: theme.labelTertiary,
    },
    sendBtnText: {
      fontSize: 18,
      color: '#FFFFFF',
      fontWeight: '700',
    },
  });
}

// ---------- Screen ----------

export default function CreateScreen() {
  const { showToast } = useToast();
  const theme = useTheme();
  const styles = makeStyles(theme);
  const db = useDatabase();

  // "Edit with AI" entry point passes these params
  const params = useLocalSearchParams<{ mode?: string; conversationId?: string }>();
  const editConversationId = params.mode === 'modify' ? (params.conversationId ?? null) : null;

  const { generate, clearJob, activeJob, meta, isActive, isComplete, isFailed } = useGenerateApp();

  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [previewHasError, setPreviewHasError] = useState(false);
  const [isSlowGeneration, setIsSlowGeneration] = useState(false);

  // Tracks when generation started so we can compute elapsed time across re-renders.
  const generationStartRef = useRef<number | null>(null);

  const inputRef = useRef<TextInput>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track screen open
  useEffect(() => {
    posthog.capture('ai_create_screen_opened', {
      mode: editConversationId ? 'modify' : 'create',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cycle loading messages while generating
  useEffect(() => {
    if (status === 'generating') {
      setLoadingMsgIndex(0);
      intervalRef.current = setInterval(() => {
        setLoadingMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
      }, 3000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [status]);

  // Drive UI status from PowerSync job updates
  useEffect(() => {
    if (!activeJob) return;

    if (
      activeJob.status === 'pending' ||
      activeJob.status === 'generating' ||
      activeJob.status === 'deploying'
    ) {
      setStatus('generating');
    } else if (activeJob.status === 'complete') {
      // Meta arrives a fraction of a second after status=complete via the Supabase fetch in the hook
    } else if (activeJob.status === 'failed') {
      setError(activeJob.error_message ?? 'Generation failed. Please try again.');
      setStatus('error');
    }
  }, [activeJob?.status]);

  // Generation timeout — two-stage:
  // 1. After 90s with no progress: show "still working" hint but keep the PowerSync
  //    watcher alive (the CF Queue job is still running on the server).
  // 2. After 5 min total: truly give up.
  useEffect(() => {
    if (status !== 'generating' && status !== 'submitting') {
      generationStartRef.current = null;
      setIsSlowGeneration(false);
      return;
    }
    if (generationStartRef.current === null) {
      generationStartRef.current = Date.now();
    }

    const progressChars = activeJob?.progress_chars ?? 0;
    if (progressChars > 0) setIsSlowGeneration(false);

    const elapsed = Date.now() - generationStartRef.current;

    // Hard limit: 5 minutes from the start of generation.
    const hardRemaining = 5 * 60_000 - elapsed;
    if (hardRemaining <= 0) {
      clearJob();
      setError('Generation timed out — try a simpler prompt or try again later.');
      setStatus('error');
      setIsSlowGeneration(false);
      return;
    }
    const hardTimer = setTimeout(() => {
      clearJob();
      setError('Generation timed out — try a simpler prompt or try again later.');
      setStatus('error');
      setIsSlowGeneration(false);
    }, hardRemaining);

    // Soft hint: after 90s with zero progress, show "still working" message.
    const slowRemaining = 90_000 - elapsed;
    const slowTimer = slowRemaining > 0 && progressChars === 0
      ? setTimeout(() => setIsSlowGeneration(true), slowRemaining)
      : null;

    return () => {
      clearTimeout(hardTimer);
      if (slowTimer) clearTimeout(slowTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, activeJob?.progress_chars]);

  // Transition to preview once we have both complete status + metadata
  useEffect(() => {
    if (isComplete && meta && activeJob?.hosted_url) {
      setResult({
        url: activeJob.hosted_url,
        appId: activeJob.app_id ?? '',
        title: meta.title,
        description: meta.description,
        icon: meta.icon,
        color: meta.color,
      });
      setPreviewHasError(false);
      setStatus('preview');
    }
  }, [isComplete, meta, activeJob?.hosted_url, activeJob?.app_id]);

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || status === 'submitting' || status === 'generating') return;

    setStatus('submitting');
    setError(null);

    try {
      // For refinement: pass the current result's appId as conversationId.
      // For "Edit with AI" entry: pass the param conversationId.
      const conversationId = result?.appId ?? editConversationId ?? undefined;
      await generate({ prompt: trimmed, conversationId });
      setPrompt('');
      setStatus('generating');
    } catch (e) {
      Sentry.captureException(toError(e), {
        tags: { screen: 'create', feature: 'ai_generation' },
        extra: {
          conversationId: result?.appId ?? editConversationId ?? null,
          prompt: truncateForSentry(trimmed, 200),
        },
      });
      const msg = e instanceof Error ? e.message : 'Network error. Please try again.';
      setError(msg);
      setStatus('error');
    }
  };

  const handleInstall = async () => {
    if (!result) return;

    // For the "Edit with AI" modify flow: find the already-installed app by its source_url
    // and pass replace_app_id so /add updates the existing row instead of inserting a new one.
    let replaceAppId: string | undefined;
    if (editConversationId) {
      try {
        const existing = await db.getFirstAsync<{ app_id: string }>(
          'SELECT app_id FROM apps WHERE source_url = ?',
          [result.url],
        );
        if (existing?.app_id) {
          replaceAppId = existing.app_id;
        }
      } catch {
        // Best-effort — if lookup fails, fall back to normal install (may create duplicate)
      }
    }

    posthog.capture('ai_app_installed_from_preview', {
      mode: editConversationId ? 'modify' : 'create',
      app_title: result.title,
      app_id: result.appId,
    });

    router.push({
      pathname: '/add',
      params: {
        ...(replaceAppId ? { replace_app_id: replaceAppId } : {}),
        prefillUrl: result.url,
        prefillName: result.title,
        prefillEmoji: result.icon,
        prefillColor: result.color,
        // After install close the whole create+add modal stack → go straight to home
        return_to: '/(tabs)',
      },
    });
  };

  const handleShare = async () => {
    if (!result) return;
    try {
      await Share.share({
        message: `Check out "${result.title}" — a mini-app I just created!\n${result.url}`,
        url: result.url,
      });
    } catch {
      // User cancelled share sheet
    }
  };

  const handleBack = () => {
    if (isActive) {
      Alert.alert(
        'Generation in Progress',
        "Your app is still being built. It will finish even if you close this screen — you'll see it in the Add App flow when it's ready.",
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Close Anyway',
            onPress: () => {
              clearJob();
              router.dismiss();
            },
          },
        ],
      );
    } else {
      clearJob();
      router.dismiss();
    }
  };

  const progressFraction = isActive
    ? Math.min((activeJob?.progress_chars ?? 0) / PROGRESS_MAX_CHARS, 0.95)
    : isComplete
      ? 1
      : 0;

  const isInPreview = status === 'preview' && result;
  const previewUrl = result ? `${result.url}?v=${Date.now()}` : null;
  const showInputBar = status !== 'submitting' && status !== 'generating';

  return (
    <>
      <Stack.Screen
        options={{
          title: editConversationId ? 'Edit with AI' : 'Create with AI',
          headerShown: true,
          headerStyle: { backgroundColor: theme.surface },
          headerTitleStyle: { color: theme.label, fontWeight: '600' },
          headerLeft: () => (
            <TouchableOpacity onPress={handleBack} hitSlop={8} style={{ paddingHorizontal: 4 }}>
              <Text style={styles.cancelBtn}>
                {isActive ? 'Close' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          ),
        }}
      />

      <SafeAreaView edges={['bottom']} style={styles.root}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
          keyboardVerticalOffset={88}
        >
          {/* ── Generating overlay ─────────────────────────────────────── */}
          {(status === 'submitting' || status === 'generating') && (
            <View style={styles.generatingOverlay}>
              <View style={styles.generatingCard}>
                <Text style={styles.generatingEmoji}>✨</Text>
                <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 16 }} />
                <Text style={styles.generatingMsg}>
                  {isSlowGeneration
                    ? 'Still working — complex apps take a few minutes…'
                    : LOADING_MESSAGES[loadingMsgIndex]}
                </Text>
                {isSlowGeneration ? (
                  <Text style={styles.generatingHint}>
                    Running in background. You can close and come back.
                  </Text>
                ) : (activeJob?.progress_chars ?? 0) > 0 ? (
                  <Text style={styles.generatingHint}>
                    {(activeJob?.progress_chars ?? 0).toLocaleString()} chars written…
                  </Text>
                ) : (
                  <Text style={styles.generatingHint}>
                    Starting up… (this can take 10–20 s)
                  </Text>
                )}
                {/* Progress bar */}
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.round(progressFraction * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            </View>
          )}

          {/* ── Main scroll content ────────────────────────────────────── */}
          {status !== 'generating' && status !== 'submitting' && (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ── Idle: examples ───────────────────────────────────── */}
              {status === 'idle' && (
                <View style={styles.idleHero}>
                  <Text style={styles.heroEmoji}>✨</Text>
                  <Text style={styles.heroTitle}>Describe what you want</Text>
                  <Text style={styles.heroSubtitle}>
                    AI will build a fully working app in seconds.
                  </Text>

                  <View style={styles.examplesCard}>
                    <Text style={styles.examplesLabel}>EXAMPLES</Text>
                    {[
                      'Tambola game for kitty party',
                      'Expense tracker with categories',
                      'Score keeper for card games',
                      'Quick voting poll for friends',
                    ].map((ex) => (
                      <Pressable
                        key={ex}
                        onPress={() => setPrompt(ex)}
                        style={({ pressed }) => [
                          styles.exampleRow,
                          pressed && styles.exampleRowPressed,
                        ]}
                      >
                        <Text style={styles.exampleText}>"{ex}"</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {/* ── Error ─────────────────────────────────────────────── */}
              {status === 'error' && error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>⚠ Generation failed</Text>
                  <Text style={styles.errorMsg}>{error}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      clearJob();
                      setStatus(result ? 'preview' : 'idle');
                    }}
                    style={styles.errorRetryBtn}
                  >
                    <Text style={styles.errorRetryText}>Try again</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Preview ───────────────────────────────────────────── */}
              {isInPreview && (
                <View style={styles.previewContainer}>
                  {/* App info bar */}
                  <View style={styles.appInfoRow}>
                    <View style={[styles.appIconBox, { backgroundColor: result.color }]}>
                      <Text style={styles.appIconEmoji}>{result.icon}</Text>
                    </View>
                    <View style={styles.appInfoText}>
                      <Text style={styles.appTitle}>{result.title}</Text>
                      {result.description ? (
                        <Text style={styles.appDesc} numberOfLines={1}>
                          {result.description}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  {/* WebView preview */}
                  <View style={styles.webViewWrapper}>
                    <WebView
                      source={{ uri: previewUrl! }}
                      style={styles.webView}
                      javaScriptEnabled
                      domStorageEnabled
                      startInLoadingState
                      renderLoading={() => (
                        <View style={styles.webViewLoading}>
                          <ActivityIndicator color={theme.primary} />
                        </View>
                      )}
                      onError={() => setPreviewHasError(true)}
                      onMessage={(e) => {
                        try {
                          const msg = JSON.parse(e.nativeEvent.data) as { type?: string };
                          if (msg.type === 'js_error') setPreviewHasError(true);
                        } catch { /* ignore */ }
                      }}
                      injectedJavaScriptBeforeContentLoaded={
                        `(function(){window.onerror=function(m,s,l){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'js_error',message:m,line:l}));};})();true;`
                      }
                    />
                    {previewHasError && (
                      <View style={styles.previewErrorOverlay}>
                        <Text style={styles.previewErrorEmoji}>⚠️</Text>
                        <Text style={styles.previewErrorTitle}>App had errors</Text>
                        <Text style={styles.previewErrorHint}>
                          Describe what's wrong below and tap send to fix it
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Refine hint */}
                  <Text style={styles.refineHint}>
                    Type below to refine — changes overwrite the same URL
                  </Text>

                  {/* Action buttons */}
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={handleShare}
                      activeOpacity={0.8}
                      style={styles.shareBtn}
                    >
                      <Text style={styles.shareBtnText}>Share Link</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { void handleInstall(); }}
                      activeOpacity={0.8}
                      style={styles.installBtn}
                    >
                      <Text style={styles.installBtnText}>Install App</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          )}

          {/* ── Prompt input bar — hidden while generating ─────────────── */}
          {showInputBar && (
            <View style={styles.inputBar}>
              <TextInput
                ref={inputRef}
                value={prompt}
                onChangeText={setPrompt}
                placeholder={
                  status === 'preview'
                    ? 'Refine: "Make buttons bigger", "Add dark mode"...'
                    : editConversationId
                      ? 'Describe the changes you want...'
                      : 'Describe the app you want to create...'
                }
                placeholderTextColor={theme.labelTertiary}
                style={styles.promptInput}
                multiline
                returnKeyType="default"
                blurOnSubmit={false}
                maxLength={2000}
                autoCorrect={false}
                spellCheck={false}
                autoCapitalize="sentences"
              />
              <TouchableOpacity
                onPress={() => { void handleGenerate(); }}
                disabled={prompt.trim().length === 0}
                activeOpacity={0.8}
                style={[
                  styles.sendBtn,
                  prompt.trim().length === 0 && styles.sendBtnDisabled,
                ]}
              >
                <Text style={styles.sendBtnText}>
                  {status === 'preview' ? '↑' : '✨'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}
