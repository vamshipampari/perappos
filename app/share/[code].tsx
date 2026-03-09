import { router, useLocalSearchParams } from 'expo-router';
import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ShareCodeScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F2F2F7' }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 42, marginBottom: 12 }}>🔗</Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#1C1C1E', marginBottom: 8 }}>
          Shared Link
        </Text>
        <Text style={{ fontSize: 15, lineHeight: 22, textAlign: 'center', color: '#636366' }}>
          This link format is deprecated. Use Settings, then Join Shared App, and enter the invite code{code ? `: ${code}` : ''}.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/join-shared-app' as any)}
          style={{
            marginTop: 18,
            backgroundColor: '#007AFF',
            paddingHorizontal: 18,
            paddingVertical: 12,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Join Shared App</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
