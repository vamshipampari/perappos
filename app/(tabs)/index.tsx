import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { FlatList, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps, InstalledApp } from '@/hooks/useInstalledApps';
import { seedDemoApps } from '@/lib/demoApps';

const NUM_COLUMNS = 3;
const ITEM_HORIZONTAL_PADDING = 16;
const ITEM_GAP = 12;
const ICON_SIZE = 60;

function AppGridItem({ app }: { app: InstalledApp }) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.95, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  const handlePress = () => {
    router.push(`/app/${app.app_id}`);
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}
    >
      <Animated.View style={animatedStyle}>
        <View
          style={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            borderRadius: 14,
            backgroundColor: app.icon_bg_color,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.08,
            shadowRadius: 4,
            elevation: 2,
          }}
        >
          <Text style={{ fontSize: 28 }}>{app.icon_emoji}</Text>
        </View>
        <Text
          numberOfLines={2}
          style={{
            marginTop: 6,
            fontSize: 12,
            color: '#1C1C1E',
            textAlign: 'center',
            lineHeight: 15,
            width: ICON_SIZE + 8,
          }}
        >
          {app.name}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: '#F2F2F7',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Text style={{ fontSize: 36 }}>⊞</Text>
      </View>
      <Text
        style={{
          fontSize: 20,
          fontWeight: '600',
          color: '#1C1C1E',
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        Your personal app home
      </Text>
      <Text
        style={{
          fontSize: 15,
          color: '#8E8E93',
          textAlign: 'center',
          lineHeight: 22,
          marginBottom: 28,
        }}
      >
        Add apps built with Lovable, Bolt, Claude, or any web tool
      </Text>
      <TouchableOpacity
        onPress={() => router.push('/add')}
        style={{
          backgroundColor: '#007AFF',
          borderRadius: 12,
          paddingHorizontal: 24,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
        activeOpacity={0.8}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>
          + Add Your First App
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function FAB() {
  return (
    <TouchableOpacity
      onPress={() => router.push('/add')}
      activeOpacity={0.85}
      style={{
        position: 'absolute',
        bottom: 28,
        right: 20,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#007AFF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#007AFF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 6,
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 28, lineHeight: 30, fontWeight: '300' }}>+</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const { apps, loading, refresh } = useInstalledApps();
  const db = useDatabase();
  const seeded = useRef(false);

  // On first load, if no apps exist, seed the demo apps then refresh.
  useEffect(() => {
    if (!loading && apps.length === 0 && !seeded.current) {
      seeded.current = true;
      seedDemoApps(db).then(() => refresh());
    }
  }, [loading, apps.length, db, refresh]);

  // Re-query whenever the tab comes into focus (e.g. after deleting an app
  // in the viewer screen and navigating back).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const renderItem = useCallback(
    ({ item }: { item: InstalledApp }) => <AppGridItem app={item} />,
    []
  );

  const keyExtractor = useCallback((item: InstalledApp) => item.app_id, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <View style={{ flex: 1 }}>
        {/* Large title header */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 12,
            borderBottomWidth: apps.length > 0 ? 0.5 : 0,
            borderBottomColor: '#E5E5EA',
          }}
        >
          <Text
            style={{
              fontSize: 34,
              fontWeight: '700',
              color: '#1C1C1E',
              letterSpacing: 0.3,
            }}
          >
            Perappos
          </Text>
        </View>

        {/* Content */}
        {!loading && apps.length === 0 ? (
          <EmptyState />
        ) : (
          <FlatList
            data={apps}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            numColumns={NUM_COLUMNS}
            contentContainerStyle={{
              paddingHorizontal: ITEM_HORIZONTAL_PADDING,
              paddingTop: 16,
              paddingBottom: 100,
            }}
            columnWrapperStyle={{ gap: ITEM_GAP }}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* FAB — only shown when apps exist */}
        {apps.length > 0 && <FAB />}
      </View>
    </SafeAreaView>
  );
}
