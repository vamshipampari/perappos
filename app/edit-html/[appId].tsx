import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import { useDatabase } from '@/hooks/useDatabase';
import { deployHtml } from '@/services/htmlDeployer';
import { log } from '@/lib/logger';
import { useTheme, type Colors } from '@/lib/theme';
import type { InstalledApp } from '@/types';

// ── CodeMirror editor HTML ────────────────────────────────────────────────────

const EDITOR_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/theme/material-darker.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #212121; overflow: hidden; }
    .CodeMirror {
      height: 100vh;
      font-size: 13px;
      font-family: 'Courier New', Courier, monospace;
      line-height: 1.5;
    }
    .CodeMirror-scroll { padding-bottom: 120px; }
  </style>
</head>
<body>
  <textarea id="editor"></textarea>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/xml/xml.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/javascript/javascript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/css/css.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/htmlmixed/htmlmixed.min.js"></script>
  <script>
    var editor = CodeMirror.fromTextArea(document.getElementById('editor'), {
      mode: 'htmlmixed',
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: true,
      indentWithTabs: false,
      tabSize: 2,
      autofocus: false,
    });
    window.__editor = editor;

    function handleMessage(data) {
      try {
        var msg = JSON.parse(data);
        if (msg.type === 'SET_CONTENT') {
          editor.setValue(msg.html);
          editor.clearHistory();
          editor.refresh();
        } else if (msg.type === 'GET_CONTENT') {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CONTENT',
            html: editor.getValue(),
          }));
        }
      } catch(e) {}
    }

    document.addEventListener('message', function(e) { handleMessage(e.data); });
    window.addEventListener('message', function(e) { handleMessage(e.data); });
  </script>
</body>
</html>`;

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(theme: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: '#212121' },
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
    headerBtnText: { fontSize: 22, color: theme.primary, lineHeight: 26 },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 16, fontWeight: '600', color: theme.label },
    headerSubtitle: { fontSize: 11, color: theme.labelSecondary, marginTop: 1 },
    saveBtn: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      backgroundColor: theme.primary,
      borderRadius: 8,
      marginRight: 8,
      minWidth: 70,
      alignItems: 'center',
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      backgroundColor: '#212121',
    },
    centerText: { fontSize: 15, color: '#AAAAAA' },
    webView: { flex: 1, backgroundColor: '#212121' },
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function EditHtmlScreen() {
  const { appId } = useLocalSearchParams<{ appId: string }>();
  const db = useDatabase();
  const theme = useTheme();
  const styles = makeStyles(theme);

  const webViewRef = useRef<WebView>(null);
  const pendingContentRef = useRef<((html: string) => void) | null>(null);

  const [app, setApp] = useState<InstalledApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [editorReady, setEditorReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  // ── Load app + initial HTML ───────────────────────────────────────────────

  useEffect(() => {
    if (!appId) return;

    db.getFirstAsync<InstalledApp>('SELECT * FROM apps WHERE app_id = ?', appId)
      .then(async (row) => {
        if (!row) { setLoading(false); return; }
        setApp(row);
        setLoading(false);
      })
      .catch((err) => {
        log.error('[EditHtml] load error:', err);
        setLoading(false);
      });
  }, [appId, db]);

  // Once editor is ready, send the HTML content to CodeMirror
  const sendInitialContent = useCallback(async (row: InstalledApp) => {
    let html = row.bundle_html ?? '';

    // If there's a live source URL, prefer fetching the latest from Cloudflare
    if (row.source_url) {
      try {
        const res = await fetch(row.source_url);
        if (res.ok) html = await res.text();
      } catch {
        // fallback to local bundle_html
      }
    }

    webViewRef.current?.injectJavaScript(
      `window.ReactNativeWebView && window.ReactNativeWebView.postMessage; ` +
      `(function(){` +
      `var msg = ${JSON.stringify(JSON.stringify({ type: 'SET_CONTENT', html }))};` +
      `document.dispatchEvent(new MessageEvent('message',{data:msg}));` +
      `})(); true;`
    );
  }, []);

  const handleWebViewLoad = useCallback(() => {
    setEditorReady(true);
    if (app) void sendInitialContent(app);
  }, [app, sendInitialContent]);

  // ── Get editor content via postMessage ────────────────────────────────────

  const getEditorContent = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      pendingContentRef.current = resolve;
      webViewRef.current?.injectJavaScript(
        `(function(){` +
        `var html = window.__editor ? window.__editor.getValue() : '';` +
        `window.ReactNativeWebView.postMessage(JSON.stringify({type:'CONTENT',html:html}));` +
        `})(); true;`
      );
    });
  }, []);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type: string; html?: string };
      if (msg.type === 'CONTENT' && pendingContentRef.current) {
        pendingContentRef.current(msg.html ?? '');
        pendingContentRef.current = null;
      }
    } catch {
      // ignore non-JSON
    }
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!app || saving) return;

    const html = await getEditorContent();
    const trimmed = html.trim();

    if (trimmed.length === 0) {
      Alert.alert('Empty', 'The editor is empty.');
      return;
    }
    if (!trimmed.includes('<html') && !trimmed.includes('<!DOCTYPE')) {
      Alert.alert('Invalid HTML', 'Content does not look like a valid HTML document.');
      return;
    }

    setSaving(true);
    try {
      const { url: cfUrl } = await deployHtml(app.app_id, trimmed);

      // Update local SQLite record
      await db.runAsync(
        `UPDATE apps SET bundle_html = ?, source_url = ?, updated_at = datetime('now') WHERE app_id = ?`,
        trimmed,
        cfUrl,
        app.app_id
      );

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (err) {
      log.error('[EditHtml] save error:', err);
      Alert.alert('Save Failed', err instanceof Error ? err.message : 'Could not update the app.');
    } finally {
      setSaving(false);
    }
  }, [app, db, getEditorContent, saving]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (!app) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.surface }]} edges={['top', 'bottom']}>
        <Text style={[styles.centerText, { color: theme.labelSecondary }]}>App not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: theme.primary }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{app.name}</Text>
          <Text style={styles.headerSubtitle}>Edit HTML</Text>
        </View>

        <TouchableOpacity
          onPress={() => { void handleSave(); }}
          disabled={saving || !editorReady}
          style={[styles.saveBtn, (saving || !editorReady) && styles.saveBtnDisabled]}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveBtnText}>
              {saveStatus === 'saved' ? 'Saved ✓' : 'Save'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── CodeMirror WebView ───────────────────────────────────────────── */}
      {!editorReady && (
        <View style={[styles.center, StyleSheet.absoluteFillObject, { top: 44 }]}>
          <ActivityIndicator size="large" color="#888" />
          <Text style={styles.centerText}>Loading editor…</Text>
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ html: EDITOR_HTML, baseUrl: 'https://cdnjs.cloudflare.com' }}
        style={[styles.webView, !editorReady && { opacity: 0 }]}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        allowFileAccess
        allowUniversalAccessFromFileURLs
        webviewDebuggingEnabled={__DEV__}
        {...({ automaticallyAdjustKeyboardInsets: true } as object)}
        contentInsetAdjustmentBehavior="never"
        keyboardDisplayRequiresUserAction={false}
        onLoad={handleWebViewLoad}
        onMessage={handleMessage}
        onError={(e) => {
          log.error('[EditHtml] webview error:', e.nativeEvent.description);
        }}
      />
    </SafeAreaView>
  );
}
