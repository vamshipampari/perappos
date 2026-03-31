import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { log } from '@/lib/logger';
import { supabase } from '@/services/supabase';
import { useTheme, type Colors } from '@/lib/theme';

// ---------- Constants ----------

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const LOADING_MESSAGES = [
  'Understanding your idea...',
  'Designing the interface...',
  'Writing the code...',
  'Adding the finishing touches...',
  'Publishing your app...',
];

// ---------- Types ----------

type Status = 'idle' | 'generating' | 'preview' | 'error';

interface GenerateResult {
  url: string;
  appId: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  htmlSize: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
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

  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [charsGenerated, setCharsGenerated] = useState(0);

  const inputRef = useRef<TextInput>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || status === 'generating') return;

    setStatus('generating');
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setError('Please sign in to create apps.');
        setStatus('error');
        return;
      }

      const body: Record<string, unknown> = { prompt: trimmed };
      if (result?.appId) body.appId = result.appId;
      if (conversationHistory.length > 0) body.conversationHistory = conversationHistory;

      log.info('[create] fetching generate-app (SSE), userId:', session.user.id);
      setCharsGenerated(0);

      // React Native's fetch polyfill doesn't expose response.body as a ReadableStream.
      // Use XMLHttpRequest which supports incremental responseText via onprogress.
      const finalResult = await new Promise<GenerateResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${SUPABASE_URL}/functions/v1/generate-app`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
        xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
        xhr.timeout = 150_000;

        let processedLen = 0;
        let sseBuffer = '';
        let currentEvent = '';
        let doneResult: GenerateResult | null = null;

        const processSSEChunk = (newText: string) => {
          sseBuffer += newText;
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const raw = line.slice(6).trim();
              try {
                const payload = JSON.parse(raw);
                if (currentEvent === 'progress') {
                  setCharsGenerated(payload.chars ?? 0);
                } else if (currentEvent === 'done') {
                  doneResult = payload as GenerateResult;
                } else if (currentEvent === 'error') {
                  reject(new Error(payload.message ?? 'Generation failed'));
                }
              } catch {
                // ignore SSE JSON parse noise
              }
              currentEvent = '';
            }
          }
        };

        xhr.onprogress = () => {
          const newText = xhr.responseText.slice(processedLen);
          processedLen = xhr.responseText.length;
          processSSEChunk(newText);
        };

        xhr.onload = () => {
          if (xhr.status !== 200) {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error ?? `Server error ${xhr.status}`));
            } catch {
              reject(new Error(`Server error ${xhr.status}`));
            }
            return;
          }
          // Flush any remaining buffered text
          const remaining = xhr.responseText.slice(processedLen);
          if (remaining) processSSEChunk(remaining);

          if (doneResult) resolve(doneResult);
          else reject(new Error('Generation ended without a result'));
        };

        xhr.onerror = () => reject(new Error('Network error. Please check your connection.'));
        xhr.ontimeout = () => reject(new Error('Request timed out. Try a simpler prompt.'));

        xhr.send(JSON.stringify(body));
      });

      setResult(finalResult);
      setConversationHistory((prev) => [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: `[Generated: ${finalResult!.title}]` },
      ]);
      setPrompt('');
      setStatus('preview');
    } catch (e) {
      log.error('[create] error:', e);
      const msg = e instanceof Error ? e.message : 'Network error. Please try again.';
      setError(msg);
      setStatus('error');
    }
  };

  const handleInstall = () => {
    if (!result) return;
    router.push({
      pathname: '/add',
      params: {
        prefillUrl: result.url,
        prefillName: result.title,
        prefillEmoji: result.icon,
        prefillColor: result.color,
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

  const isInPreview = status === 'preview' && result;
  const previewUrl = result
    ? `${result.url}?v=${Date.now()}`
    : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Create with AI',
          headerShown: true,
          headerStyle: { backgroundColor: theme.surface },
          headerTitleStyle: { color: theme.label, fontWeight: '600' },
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
          keyboardVerticalOffset={88}
        >
          {/* ── Generating overlay ─────────────────────────────────────── */}
          {status === 'generating' && (
            <View style={styles.generatingOverlay}>
              <View style={styles.generatingCard}>
                <Text style={styles.generatingEmoji}>✨</Text>
                <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 16 }} />
                <Text style={styles.generatingMsg}>
                  {LOADING_MESSAGES[loadingMsgIndex]}
                </Text>
                {charsGenerated > 0 ? (
                  <Text style={styles.generatingHint}>
                    {charsGenerated.toLocaleString()} chars written…
                  </Text>
                ) : (
                  <Text style={styles.generatingHint}>Starting up…</Text>
                )}
              </View>
            </View>
          )}

          {/* ── Main content ───────────────────────────────────────────── */}
          {status !== 'generating' && (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ── Idle: prompt inspiration ──────────────────────────── */}
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
                        style={({ pressed }) => [styles.exampleRow, pressed && styles.exampleRowPressed]}
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
                    onPress={() => setStatus(result ? 'preview' : 'idle')}
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

                  {/* WebView */}
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
                    />
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
                      onPress={handleInstall}
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

          {/* ── Prompt input — always at bottom ───────────────────────── */}
          {status !== 'generating' && (
            <View style={styles.inputBar}>
              <TextInput
                ref={inputRef}
                value={prompt}
                onChangeText={setPrompt}
                placeholder={
                  status === 'preview'
                    ? 'Refine: "Make buttons bigger", "Add dark mode"...'
                    : 'Describe the app you want to create...'
                }
                placeholderTextColor={theme.labelTertiary}
                style={styles.promptInput}
                multiline
                returnKeyType="default"
                blurOnSubmit={false}
                maxLength={2000}
              />
              <TouchableOpacity
                onPress={handleGenerate}
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
