/**
 * Web stub for the mini-app viewer.
 * react-native-webview has no web implementation, so this route is
 * native-only. Metro picks this file for web builds instead of [id].tsx.
 */
import { router } from 'expo-router';
import { Text, TouchableOpacity, View } from 'react-native';

export default function AppScreenWeb() {
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}
    >
      <Text style={{ fontSize: 32 }}>📱</Text>
      <Text style={{ fontSize: 20, fontWeight: '600', color: '#1C1C1E', textAlign: 'center' }}>
        Open in the Cottix app
      </Text>
      <Text style={{ fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 22 }}>
        Mini-apps run inside native WebViews and are not available in the browser.
      </Text>
      <TouchableOpacity
        onPress={() => router.back()}
        style={{
          marginTop: 8,
          backgroundColor: '#007AFF',
          borderRadius: 10,
          paddingHorizontal: 24,
          paddingVertical: 12,
        }}
      >
        <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 16 }}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}
