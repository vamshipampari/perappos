import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function DiscoverScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ fontSize: 34, fontWeight: '700', color: '#1C1C1E', letterSpacing: 0.3 }}>
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
            backgroundColor: '#F2F2F7',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <Text style={{ fontSize: 52 }}>🔮</Text>
        </View>

        <Text style={{ fontSize: 20, fontWeight: '600', color: '#1C1C1E', textAlign: 'center', marginBottom: 10 }}>
          Coming soon
        </Text>
        <Text style={{ fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 22 }}>
          Browse and share app templates with the Cottix community.
        </Text>
      </View>
    </SafeAreaView>
  );
}
