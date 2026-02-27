import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps } from '@/hooks/useInstalledApps';

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const { apps, recordOpen } = useInstalledApps();
  const webViewRef = useRef<WebView>(null);

  const app = apps.find((a) => a.app_id === id);

  useEffect(() => {
    if (id) {
      recordOpen(id);
    }
  }, [id]);

  if (!app) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text style={{ fontSize: 20, fontWeight: '600', color: '#1C1C1E' }}>App not found</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ fontSize: 16, color: '#007AFF' }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const uri = app.source_url ?? `file://${app.bundle_path}/index.html`;

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      {/* Header bar */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#1C1C1E' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 12,
          }}
        >
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Text style={{ fontSize: 17, color: '#007AFF' }}>✕</Text>
          </TouchableOpacity>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              backgroundColor: app.icon_bg_color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 14 }}>{app.icon_emoji}</Text>
          </View>
          <Text
            style={{ flex: 1, fontSize: 16, fontWeight: '600', color: '#FFFFFF' }}
            numberOfLines={1}
          >
            {app.name}
          </Text>
          <TouchableOpacity
            onPress={() => webViewRef.current?.reload()}
            hitSlop={8}
          >
            <Text style={{ fontSize: 17, color: '#007AFF' }}>↻</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri }}
        style={{ flex: 1 }}
        startInLoadingState
        renderLoading={() => (
          <View
            style={{
              position: 'absolute',
              inset: 0,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#FFFFFF',
            }}
          >
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        )}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}
