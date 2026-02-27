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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text style={{ fontSize: 36 }}>✦</Text>
        <Text style={{ fontSize: 20, fontWeight: '600', color: '#1C1C1E' }}>Coming soon</Text>
        <Text style={{ fontSize: 15, color: '#8E8E93', textAlign: 'center', paddingHorizontal: 32 }}>
          Browse and install curated mini-apps from the community.
        </Text>
      </View>
    </SafeAreaView>
  );
}
