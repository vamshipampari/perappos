import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

export default function DiscoverScreen() {
  const theme = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ fontSize: 34, fontWeight: '700', color: theme.label, letterSpacing: 0.3 }}>
          Discover
        </Text>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 0 }}>
        {/* Soft illustration placeholder */}
        <View
          style={{
            width: 100,
            height: 100,
            borderRadius: 28,
            backgroundColor: theme.background,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <Text style={{ fontSize: 52 }}>🔮</Text>
        </View>

        <Text style={{ fontSize: 20, fontWeight: '600', color: theme.label, textAlign: 'center', marginBottom: 10 }}>
          Coming soon
        </Text>
        <Text style={{ fontSize: 15, color: theme.labelSecondary, textAlign: 'center', lineHeight: 22 }}>
          Browse and share app templates with the Cottix community.
        </Text>
      </View>
    </SafeAreaView>
  );
}
