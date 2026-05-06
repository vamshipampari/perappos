import { router, useLocalSearchParams } from 'expo-router';
import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

export default function ShareCodeScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const theme = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.groupedBackground }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 42, marginBottom: 12 }}>🔗</Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: theme.label, marginBottom: 8 }}>
          Shared Link
        </Text>
        <Text style={{ fontSize: 15, lineHeight: 22, textAlign: 'center', color: theme.labelSecondary }}>
          This link format is deprecated. Use Settings, then Join Shared App, and enter the invite code{code ? `: ${code}` : ''}.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/join-shared-app')}
          style={{
            marginTop: 18,
            backgroundColor: theme.primary,
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
