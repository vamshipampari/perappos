import { ActionSheet } from '@/components/ActionSheet';
import { AppIcon } from '@/components/AppIcon';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/Toast';
import { useAppContextMenu } from '@/hooks/useAppContextMenu';
import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { useFolders, getAllFolders } from '@/hooks/useFolders';
import { usePendingJoinApproval } from '@/hooks/usePendingJoinApproval';
import { useRestoreApps } from '@/hooks/useRestoreApps';
import { useUpdateScanner } from '@/hooks/useUpdateScanner';
import { useTheme, type Colors } from '@/lib/theme';
import type { Folder, InstalledApp } from '@/types';

// ── Constants ─────────────────────────────────────────────────────────────────

const ICON_SIZE = 48;
const COLLAPSE_START = 12;
const COLLAPSE_END = 44;

type ListItem =
  | { type: 'folder'; data: Folder }
  | { type: 'app'; data: InstalledApp };

const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList as React.ComponentType<React.ComponentProps<typeof FlatList<ListItem>>>
);

// ── Data export helper ────────────────────────────────────────────────────────

async function exportAppData(db: ReturnType<typeof useDatabase>, app: InstalledApp): Promise<void> {
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
  await FileSystem.writeAsStringAsync(path, payload, { encoding: FileSystem.EncodingType.UTF8 });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error('Sharing not available on this device');

  await Sharing.shareAsync(path, {
    mimeType: 'application/json',
    dialogTitle: `Export "${app.name}" Data`,
    UTI: 'public.json',
  });
}

// ── Folder card ───────────────────────────────────────────────────────────────

function FolderCard({
  folder,
  onPress,
  onLongPress,
  theme,
}: {
  folder: Folder;
  onPress: (f: Folder) => void;
  onLongPress: (f: Folder) => void;
  theme: Colors;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={() => onPress(folder)}
      onLongPress={() => onLongPress(folder)}
      delayLongPress={320}
      onPressIn={() => { scale.value = withSpring(0.98, { damping: 20, stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 20, stiffness: 400 }); }}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: theme.surface,
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
        <View
          style={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            borderRadius: 14,
            backgroundColor: '#E8F1FF',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 14,
          }}
        >
          <Text style={{ fontSize: 26 }}>{folder.icon_emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: theme.label }}>
            {folder.name}
          </Text>
          <Text style={{ fontSize: 13, color: theme.labelSecondary, marginTop: 2 }}>Folder</Text>
        </View>
        <Text style={{ fontSize: 18, color: theme.labelTertiary, marginLeft: 8 }}>›</Text>
      </Animated.View>
    </Pressable>
  );
}

// ── App list card ─────────────────────────────────────────────────────────────

function AppListCard({
  app,
  hasUpdate,
  onLongPress,
  theme,
}: {
  app: InstalledApp;
  hasUpdate: boolean;
  onLongPress: (a: InstalledApp) => void;
  theme: Colors;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const subtitle = app.source_url
    ? app.source_url.replace(/^https?:\/\//, '').split('/')[0]
    : app.source_type === 'bundle'
      ? 'Local bundle'
      : 'Installed app';

  return (
    <Pressable
      onPress={() => router.push(`/app/${app.app_id}`)}
      onLongPress={() => onLongPress(app)}
      delayLongPress={320}
      onPressIn={() => { scale.value = withSpring(0.98, { damping: 20, stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 20, stiffness: 400 }); }}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: theme.surface,
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
        <View style={{ marginRight: 14 }}>
          <AppIcon
            emoji={app.icon_emoji}
            bgColor={app.icon_bg_color}
            size={ICON_SIZE}
            hasUpdate={hasUpdate}
            isShared={!!app.instance_id}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: theme.label }}>
            {app.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: theme.labelSecondary, marginTop: 2 }}>
            {subtitle}
          </Text>
        </View>
        <Text style={{ fontSize: 18, color: theme.labelTertiary, marginLeft: 8 }}>›</Text>
      </Animated.View>
    </Pressable>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ isFolder, theme }: { isFolder: boolean; theme: Colors }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: theme.background,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Text style={{ fontSize: 36 }}>{isFolder ? '📁' : '⊞'}</Text>
      </View>
      <Text style={{ fontSize: 20, fontWeight: '600', color: theme.label, textAlign: 'center', marginBottom: 8 }}>
        {isFolder ? 'Empty folder' : 'Your personal app home'}
      </Text>
      <Text style={{ fontSize: 15, color: theme.labelSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 28 }}>
        {isFolder
          ? 'Move apps here using the long-press menu'
          : 'Add apps built with Lovable, Bolt, Claude, or any web tool'}
      </Text>
      {!isFolder && (
        <TouchableOpacity
          onPress={() => router.push('/add')}
          style={{
            backgroundColor: theme.primary,
            borderRadius: 12,
            paddingHorizontal: 24,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
          activeOpacity={0.8}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>+ Add Your First App</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── FAB ───────────────────────────────────────────────────────────────────────

function FAB({ theme }: { theme: Colors }) {
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
        backgroundColor: theme.primary,
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

// ── Folder name input modal ───────────────────────────────────────────────────

function FolderNameModal({
  visible,
  mode,
  initialValue,
  onConfirm,
  onDismiss,
  theme,
}: {
  visible: boolean;
  mode: 'create' | 'rename';
  initialValue: string;
  onConfirm: (name: string) => void;
  onDismiss: () => void;
  theme: Colors;
}) {
  const [value, setValue] = useState(initialValue);

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
    card: {
      width: '82%',
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.15,
      shadowRadius: 16,
      elevation: 8,
    },
    title: { fontSize: 17, fontWeight: '600', color: theme.label, marginBottom: 14 },
    input: {
      borderWidth: 1.5,
      borderColor: theme.separator,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: theme.label,
      backgroundColor: theme.inputBackground,
      marginBottom: 16,
    },
    row: { flexDirection: 'row', gap: 10 },
    btn: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    cancelBtn: { backgroundColor: theme.groupedBackground },
    confirmBtn: { backgroundColor: theme.primary },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{mode === 'create' ? 'New Folder' : 'Rename Folder'}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder="Folder name"
            placeholderTextColor={theme.labelTertiary}
            autoFocus
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => { if (value.trim()) onConfirm(value.trim()); }}
          />
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={onDismiss} activeOpacity={0.7}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: theme.labelSecondary }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.confirmBtn, !value.trim() && { opacity: 0.5 }]}
              onPress={() => { if (value.trim()) onConfirm(value.trim()); }}
              disabled={!value.trim()}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF' }}>
                {mode === 'create' ? 'Create' : 'Rename'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Move-to-folder picker modal ───────────────────────────────────────────────

function MoveFolderModal({
  visible,
  folders,
  currentFolderId,
  onSelect,
  onDismiss,
  theme,
}: {
  visible: boolean;
  folders: Folder[];
  currentFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onDismiss: () => void;
  theme: Colors;
}) {
  const options: Array<{ label: string; folderId: string | null }> = [
    { label: '🏠 Home (no folder)', folderId: null },
    ...folders.map((f) => ({ label: `${f.icon_emoji} ${f.name}`, folderId: f.folder_id })),
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onDismiss}>
        <Pressable
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingBottom: 32,
          }}
          onPress={() => {}}
        >
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: theme.label }}>Move to Folder</Text>
          </View>
          {options
            .filter((o) => o.folderId !== currentFolderId)
            .map((opt) => (
              <TouchableOpacity
                key={opt.folderId ?? '__root__'}
                onPress={() => onSelect(opt.folderId)}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.separator,
                }}
              >
                <Text style={{ fontSize: 16, color: theme.label }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          <TouchableOpacity
            onPress={onDismiss}
            activeOpacity={0.7}
            style={{
              marginHorizontal: 20,
              marginTop: 12,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: theme.groupedBackground,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '500', color: theme.labelSecondary }}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const db = useDatabase();
  const { apps, loading: appsLoading, refresh: refreshApps } = useInstalledApps();
  const { showToast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const theme = useTheme();

  // ── Folder navigation state ──────────────────────────────────────────────
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(null);

  const {
    folders,
    loading: foldersLoading,
    refresh: refreshFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    deleteFolderAndContents,
    moveAppToFolder,
  } = useFolders(currentFolderId);

  const loading = appsLoading || foldersLoading;

  const refresh = useCallback(async () => {
    await Promise.all([refreshApps(), refreshFolders()]);
  }, [refreshApps, refreshFolders]);

  // Apps visible in current folder
  const currentApps = useMemo<InstalledApp[]>(() => {
    if (currentFolderId === null) {
      return apps.filter((a) => a.folder_id == null);
    }
    return apps.filter((a) => a.folder_id === currentFolderId);
  }, [apps, currentFolderId]);

  // Combined list: folders first, then apps
  const listData = useMemo<ListItem[]>(() => [
    ...folders.map((f): ListItem => ({ type: 'folder', data: f })),
    ...currentApps.map((a): ListItem => ({ type: 'app', data: a })),
  ], [folders, currentApps]);

  // Restore apps from PowerSync on a fresh device
  useRestoreApps();

  // Auto-detect join approvals and complete install silently
  const { pendingJoins } = usePendingJoinApproval();

  // ── Collapsing header ──────────────────────────────────────────────────────
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({ onScroll: (e) => { scrollY.value = e.contentOffset.y; } });

  const navBarTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE_START, COLLAPSE_END], [0, 1], Extrapolation.CLAMP),
  }));

  const largeTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE_START], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [0, COLLAPSE_END], [0, -8], Extrapolation.CLAMP) }],
  }));

  // ── Update scanning ────────────────────────────────────────────────────────
  const { updatesAvailable, setUpdatesAvailable, scanRunning, runBackgroundUpdateScan } =
    useUpdateScanner(apps);

  useFocusEffect(
    useCallback(() => {
      void refresh();
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

  // ── App context menu ────────────────────────────────────────────────────────
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
    performMenuClearData,
    performMenuCollaborate,
    performMenuDelete,
  } = useAppContextMenu({
    db,
    refresh,
    showToast,
    updatesAvailable,
    setUpdatesAvailable,
    exportAppData,
  });

  // ── Folder context menu ─────────────────────────────────────────────────────
  const [folderMenuVisible, setFolderMenuVisible] = useState(false);
  const [folderMenuTarget, setFolderMenuTarget] = useState<Folder | null>(null);

  const openFolderMenu = useCallback((folder: Folder) => {
    setFolderMenuTarget(folder);
    setFolderMenuVisible(true);
  }, []);

  // ── Folder name input modal ─────────────────────────────────────────────────
  const [folderInputVisible, setFolderInputVisible] = useState(false);
  const [folderInputMode, setFolderInputMode] = useState<'create' | 'rename'>('create');
  const [folderInputInitial, setFolderInputInitial] = useState('');

  const handleNewFolder = useCallback(() => {
    setFolderInputMode('create');
    setFolderInputInitial('');
    setFolderInputVisible(true);
  }, []);

  const handleFolderNameConfirm = useCallback(
    async (name: string) => {
      setFolderInputVisible(false);
      if (folderInputMode === 'create') {
        await createFolder(name, currentFolderId);
        showToast(`Folder "${name}" created`, 'success');
      } else if (folderMenuTarget) {
        await renameFolder(folderMenuTarget.folder_id, name);
        showToast('Folder renamed', 'success');
        setFolderMenuTarget(null);
      }
    },
    [folderInputMode, folderMenuTarget, createFolder, renameFolder, currentFolderId, showToast]
  );

  const handleFolderDelete = useCallback(
    (folder: Folder) => {
      setFolderMenuVisible(false);
      const doDelete = async () => {
        const result = await deleteFolder(folder.folder_id);
        if (result === 'deleted') {
          showToast('Folder deleted', 'success');
          return;
        }
        const msg =
          result === 'has_subfolders'
            ? 'This folder contains sub-folders. Delete everything inside?'
            : 'This folder contains apps. Deleting it will also delete all apps inside.';
        Alert.alert(`Delete "${folder.name}"?`, msg, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete Everything',
            style: 'destructive',
            onPress: async () => {
              await deleteFolderAndContents(folder.folder_id);
              await refreshApps();
              showToast('Folder and contents deleted', 'success');
            },
          },
        ]);
      };
      void doDelete();
    },
    [deleteFolder, deleteFolderAndContents, refreshApps, showToast]
  );

  // ── Move-to-folder picker ───────────────────────────────────────────────────
  const [movePickerVisible, setMovePickerVisible] = useState(false);
  const [movePickerAllFolders, setMovePickerAllFolders] = useState<Folder[]>([]);
  // Capture the target app before closeContextMenu() nulls out menuTargetApp.
  const moveTargetAppRef = useRef<InstalledApp | null>(null);

  const handleOpenMovePicker = useCallback(async () => {
    moveTargetAppRef.current = menuTargetApp; // save before menu closes
    closeContextMenu();
    const all = await getAllFolders(db);
    setMovePickerAllFolders(all);
    setMovePickerVisible(true);
  }, [db, closeContextMenu, menuTargetApp]);

  const handleMoveConfirm = useCallback(
    async (targetFolderId: string | null) => {
      setMovePickerVisible(false);
      const app = moveTargetAppRef.current;
      if (!app) return;
      await moveAppToFolder(app.app_id, targetFolderId);
      await refresh();
      const label = targetFolderId
        ? movePickerAllFolders.find((f) => f.folder_id === targetFolderId)?.name ?? 'folder'
        : 'Home';
      showToast(`Moved to "${label}"`, 'success');
      moveTargetAppRef.current = null;
    },
    [moveAppToFolder, refresh, movePickerAllFolders, showToast]
  );

  // ── Navigation ──────────────────────────────────────────────────────────────

  const handleEnterFolder = useCallback((folder: Folder) => {
    setCurrentFolderId(folder.folder_id);
    setCurrentFolderName(folder.name);
  }, []);

  const handleGoBack = useCallback(() => {
    setCurrentFolderId(null);
    setCurrentFolderName(null);
  }, []);

  // ── List rendering ──────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'folder') {
        return (
          <FolderCard
            folder={item.data}
            onPress={handleEnterFolder}
            onLongPress={openFolderMenu}
            theme={theme}
          />
        );
      }
      return (
        <AppListCard
          app={item.data}
          hasUpdate={!!updatesAvailable[item.data.app_id]}
          onLongPress={openContextMenu}
          theme={theme}
        />
      );
    },
    [handleEnterFolder, openFolderMenu, openContextMenu, updatesAvailable, theme]
  );

  const keyExtractor = useCallback((item: ListItem) =>
    item.type === 'folder' ? `folder-${item.data.folder_id}` : `app-${item.data.app_id}`, []);

  const totalCount = folders.length + currentApps.length;

  const listHeader = (
    <View style={{ paddingTop: 4, paddingBottom: totalCount > 0 ? 12 : 0, alignItems: 'center' }}>
      {/* ── Pending join approvals banner ─────────────────────────────────── */}
      {pendingJoins.length > 0 && currentFolderId === null && (
        <View style={{ width: '100%', paddingHorizontal: 16, paddingBottom: 12 }}>
          {pendingJoins.map((pj) => (
            <View
              key={pj.instance_id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#FFF7ED',
                borderWidth: 1,
                borderColor: '#FED7AA',
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                marginBottom: 8,
                gap: 10,
              }}
            >
              <Text style={{ fontSize: 18 }}>⏳</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#92400E' }} numberOfLines={1}>
                  {pj.app_name}
                </Text>
                <Text style={{ fontSize: 12, color: '#B45309', marginTop: 1 }}>
                  Waiting for owner to approve
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
      {currentFolderId === null ? (
        <>
          <Animated.Image
            source={require('../../assets/images/Cottix.png')}
            resizeMode="contain"
            style={[{ width: 132, height: 40, marginBottom: 2 }, largeTitleStyle]}
            accessibilityLabel="Cottix"
          />
          {!loading && (
            <Animated.Text style={[{ fontSize: 13, color: theme.labelSecondary, marginTop: 3 }, largeTitleStyle]}>
              {apps.length} app{apps.length !== 1 ? 's' : ''} installed
            </Animated.Text>
          )}
        </>
      ) : (
        <Animated.View style={[{ alignItems: 'center' }, largeTitleStyle]}>
          <Text style={{ fontSize: 26, marginBottom: 4 }}>📁</Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: theme.label }}>{currentFolderName}</Text>
          {!loading && (
            <Text style={{ fontSize: 13, color: theme.labelSecondary, marginTop: 3 }}>
              {totalCount} item{totalCount !== 1 ? 's' : ''}
            </Text>
          )}
        </Animated.View>
      )}
    </View>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      {/* ── Fixed nav bar ─────────────────────────────────────────────────── */}
      <View
        style={{
          height: 44,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.background,
          paddingHorizontal: 16,
        }}
      >
        {/* Back button — shown when inside a folder */}
        {currentFolderId !== null ? (
          <TouchableOpacity onPress={handleGoBack} hitSlop={8} style={{ marginRight: 8 }}>
            <Text style={{ fontSize: 17, color: theme.primary }}>← Home</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 80 }} />
        )}

        {/* Small title — fades in on scroll */}
        <Animated.View style={[{ flex: 1, alignItems: 'center' }, navBarTitleStyle]}>
          {currentFolderId === null ? (
            <Animated.Image
              source={require('../../assets/images/Cottix.png')}
              resizeMode="contain"
              style={{ width: 74, height: 22 }}
              accessibilityLabel="Cottix"
            />
          ) : (
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.label }} numberOfLines={1}>
              {currentFolderName}
            </Text>
          )}
        </Animated.View>

        {/* Right: scan indicator or new-folder button */}
        <View style={{ width: 80, alignItems: 'flex-end' }}>
          {scanRunning ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <TouchableOpacity onPress={handleNewFolder} hitSlop={8}>
              <Text style={{ fontSize: 15, color: theme.primary, fontWeight: '500' }}>📁+</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Scrollable content ─────────────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        <AnimatedFlatList
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          data={listData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            !loading ? <EmptyState isFolder={currentFolderId !== null} theme={theme} /> : null
          }
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 100,
            gap: 12,
          }}
          style={{ backgroundColor: theme.background }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handlePullRefresh} tintColor={theme.primary} />
          }
        />

        <FAB theme={theme} />
      </View>

      {/* ── App long-press context menu ────────────────────────────────── */}
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
            ? [
                {
                  label: '👥 Manage Group',
                  onPress: () => {
                    closeContextMenu();
                    router.push(`/shared-instance/${menuTargetApp.instance_id}`);
                  },
                },
              ]
            : [
                {
                  label: '👥 Collaborate',
                  onPress: () => { void performMenuCollaborate(); },
                },
              ]),
          {
            label: '📁 Move to Folder',
            onPress: handleOpenMovePicker,
          },
          {
            label:
              menuTargetApp && updatesAvailable[menuTargetApp.app_id]
                ? 'Check for Update (Available!)'
                : 'Check for Update',
            onPress: performMenuCheckUpdate,
            loading: menuBusy,
            disabled: menuBusy,
          },
          { label: 'Replace App Code', onPress: performMenuReplaceCode },
          { label: 'App Info', onPress: performMenuInfo },
          { label: 'Export Data', onPress: performMenuExportData, disabled: menuBusy },
          { label: 'Share App', onPress: performMenuShare, disabled: menuBusy },
        ]}
        destructiveActions={[
          { label: 'Clear App Data', onPress: performMenuClearData, disabled: menuBusy },
          { label: 'Delete', onPress: performMenuDelete },
        ]}
      />

      {/* ── Folder long-press context menu ─────────────────────────────── */}
      <ActionSheet
        visible={folderMenuVisible}
        title={folderMenuTarget?.name ?? ''}
        onDismiss={() => { setFolderMenuVisible(false); setFolderMenuTarget(null); }}
        actions={[
          {
            label: 'Open',
            onPress: () => {
              setFolderMenuVisible(false);
              if (folderMenuTarget) handleEnterFolder(folderMenuTarget);
            },
          },
          {
            label: 'Rename',
            onPress: () => {
              setFolderMenuVisible(false);
              if (folderMenuTarget) {
                setFolderInputMode('rename');
                setFolderInputInitial(folderMenuTarget.name);
                setFolderInputVisible(true);
              }
            },
          },
        ]}
        destructiveActions={[
          {
            label: 'Delete Folder',
            onPress: () => {
              if (folderMenuTarget) handleFolderDelete(folderMenuTarget);
            },
          },
        ]}
      />

      {/* ── Folder name modal (create / rename) ────────────────────────── */}
      <FolderNameModal
        visible={folderInputVisible}
        mode={folderInputMode}
        initialValue={folderInputInitial}
        onConfirm={handleFolderNameConfirm}
        onDismiss={() => setFolderInputVisible(false)}
        theme={theme}
      />

      {/* ── Move-to-folder picker ───────────────────────────────────────── */}
      <MoveFolderModal
        visible={movePickerVisible}
        folders={movePickerAllFolders}
        currentFolderId={menuTargetApp?.folder_id ?? null}
        onSelect={handleMoveConfirm}
        onDismiss={() => setMovePickerVisible(false)}
        theme={theme}
      />
    </SafeAreaView>
  );
}
