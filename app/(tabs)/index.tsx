import * as FileSystem from 'expo-file-system/legacy';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionSheet } from '@/components/ActionSheet';
import { AppIcon } from '@/components/AppIcon';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useToast } from '@/components/Toast';
import { useAppContextMenu } from '@/hooks/useAppContextMenu';
import { useDatabase } from '@/hooks/useDatabase';
import { useUpdateScanner } from '@/hooks/useUpdateScanner';
import type { InstalledApp } from '@/types';
import { useInstalledApps } from '@/hooks/useInstalledApps';

// ── Constants ─────────────────────────────────────────────────────────────────

const ICON_SIZE = 48;

// Scroll offset at which the large title fully collapses into the nav bar title
const COLLAPSE_START = 12;
const COLLAPSE_END = 44;

// Animated FlatList backed by Reanimated
const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList as React.ComponentType<React.ComponentProps<typeof FlatList<InstalledApp>>>
);

// ── Data export helper ────────────────────────────────────────────────────────

async function exportAppData(
  db: ReturnType<typeof useDatabase>,
  app: InstalledApp
): Promise<void> {
  const rows = await db.getAllAsync<{ key: string; value: string; updated_at: string }>(
    'SELECT key, value, updated_at FROM app_data WHERE app_id = ? ORDER BY key ASC',
    app.app_id
  );
  const payload = JSON.stringify(
    {
      app: { app_id: app.app_id, name: app.name, source_url: app.source_url },
      app_data: rows,
      exported_at: new Date().toISOString(),
    },
    null,
    2
  );

  const path = `${FileSystem.cacheDirectory}${app.app_id}-data-export.json`;
  await FileSystem.writeAsStringAsync(path, payload, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error('Sharing not available on this device');

  await Sharing.shareAsync(path, {
    mimeType: 'application/json',
    dialogTitle: `Export "${app.name}" Data`,
    UTI: 'public.json',
  });
}

// ── App list card ─────────────────────────────────────────────────────────────

function AppListCard({
  app,
  hasUpdate,
  onLongPress,
}: {
  app: InstalledApp;
  hasUpdate: boolean;
  onLongPress: (a: InstalledApp) => void;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 20, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 20, stiffness: 400 });
  };

  const subtitle = app.source_url
    ? app.source_url.replace(/^https?:\/\//, '').split('/')[0]
    : app.source_type === 'bundle'
    ? 'Local bundle'
    : 'Installed app';

  return (
    <>
      <Pressable
        onPress={() => router.push(`/app/${app.app_id}`)}
        onLongPress={() => onLongPress(app)}
        delayLongPress={320}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Animated.View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 12,
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 4,
              elevation: 2,
            },
            animatedStyle,
          ]}
        >
          {/* Icon */}
          <View style={{ marginRight: 14 }}>
            <AppIcon
              emoji={app.icon_emoji}
              bgColor={app.icon_bg_color}
              size={ICON_SIZE}
              hasUpdate={hasUpdate}
              isShared={!!app.instance_id}
            />
          </View>

          {/* Text */}
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 16, fontWeight: '600', color: '#1C1C1E' }}
            >
              {app.name}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontSize: 13, color: '#8E8E93', marginTop: 2 }}
            >
              {subtitle}
            </Text>
          </View>

          {/* Chevron */}
          <Text style={{ fontSize: 18, color: '#C7C7CC', marginLeft: 8 }}>›</Text>
        </Animated.View>
      </Pressable>
    </>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 }}>
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

// ── FAB ───────────────────────────────────────────────────────────────────────

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

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const db = useDatabase();
  const { apps, loading, refresh } = useInstalledApps();
  const { showToast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Collapsing large-title header ──────────────────────────────────────────
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const navBarTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE_START, COLLAPSE_END], [0, 1], Extrapolation.CLAMP),
  }));

  const largeTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE_START], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(scrollY.value, [0, COLLAPSE_END], [0, -8], Extrapolation.CLAMP),
      },
    ],
  }));

  // ── Update scanning ────────────────────────────────────────────────────────

  const { updatesAvailable, setUpdatesAvailable, scanRunning, runBackgroundUpdateScan } =
    useUpdateScanner(apps);

  // Refresh app list on focus
  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh])
  );

  const handlePullRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refresh();
      await runBackgroundUpdateScan();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh, runBackgroundUpdateScan]);

  // ── Context menu ───────────────────────────────────────────────────────────

  const {
    menuVisible,
    menuTargetApp,
    menuBusy,
    openContextMenu,
    closeContextMenu,
    performMenuCheckUpdate,
    performMenuReplaceCode,
    performMenuInfo,
    performMenuShare,
    performMenuExportData,
    performMenuDelete,
  } = useAppContextMenu({
    db,
    refresh,
    showToast,
    updatesAvailable,
    setUpdatesAvailable,
    exportAppData,
  });

  // ── List rendering ─────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: InstalledApp }) => (
      <AppListCard
        app={item}
        hasUpdate={!!updatesAvailable[item.app_id]}
        onLongPress={openContextMenu}
      />
    ),
    [openContextMenu, updatesAvailable]
  );

  const keyExtractor = useCallback((item: InstalledApp) => item.app_id, []);

  const listHeader = (
    <View style={{ paddingTop: 4, paddingBottom: apps.length > 0 ? 12 : 0 }}>
      <Animated.Text
        style={[
          { fontSize: 34, fontWeight: '700', color: '#1C1C1E', letterSpacing: 0.3 },
          largeTitleStyle,
        ]}
      >
        Cottix
      </Animated.Text>
      {!loading && (
        <Animated.Text
          style={[{ fontSize: 13, color: '#8E8E93', marginTop: 3 }, largeTitleStyle]}
        >
          {apps.length} app{apps.length !== 1 ? 's' : ''} installed
        </Animated.Text>
      )}
    </View>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      {/* ── Fixed nav bar: small title fades in on scroll ──────────────── */}
      <View
        style={{
          height: 44,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F2F2F7',
          paddingHorizontal: 16,
        }}
      >
        <Animated.Text
          style={[
            { fontSize: 17, fontWeight: '600', color: '#1C1C1E' },
            navBarTitleStyle,
          ]}
        >
          Cottix
        </Animated.Text>
        {scanRunning && (
          <View style={{ position: 'absolute', right: 16 }}>
            <ActivityIndicator size="small" color="#007AFF" />
          </View>
        )}
      </View>

      {/* ── Scrollable content ─────────────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        <AnimatedFlatList
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          data={apps}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={!loading ? <EmptyState /> : null}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 100,
            gap: 12,
          }}
          style={{ backgroundColor: '#F2F2F7' }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handlePullRefresh}
              tintColor="#007AFF"
            />
          }
        />

        {apps.length > 0 && <FAB />}
      </View>

      {/* ── Long-press context menu ────────────────────────────────────── */}
      <ActionSheet
        visible={menuVisible}
        title={menuTargetApp?.name ?? ''}
        onDismiss={closeContextMenu}
        actions={[
          {
            label: 'Open',
            onPress: () => menuTargetApp && router.push(`/app/${menuTargetApp.app_id}`),
          },
          ...(menuTargetApp?.instance_id
            ? [{
                label: '👥 Manage Group',
                onPress: () => {
                  closeContextMenu();
                  router.push(`/shared-instance/${menuTargetApp.instance_id}`);
                },
              }]
            : []),
          {
            label: menuTargetApp && updatesAvailable[menuTargetApp.app_id]
              ? 'Check for Update (Available!)'
              : 'Check for Update',
            onPress: performMenuCheckUpdate,
            loading: menuBusy,
            disabled: menuBusy,
          },
          { label: 'Replace App Code', onPress: performMenuReplaceCode },
          { label: 'App Info', onPress: performMenuInfo },
          {
            label: 'Export Data',
            onPress: performMenuExportData,
            disabled: menuBusy,
          },
          {
            label: 'Share App',
            onPress: performMenuShare,
            disabled: menuBusy,
          },
        ]}
        destructiveActions={[
          { label: 'Delete', onPress: performMenuDelete },
        ]}
      />
    </SafeAreaView>
  );
}
