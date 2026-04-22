/**
 * Context menu state and action callbacks for the home screen app list.
 *
 * Handles: Open, Manage Group, Check for Update, Replace Code,
 *          App Info, Export Data, Share App, Clear App Data, Delete.
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as Haptics from 'expo-haptics';

import { applyUrlAppUpdate, checkForUpdates } from '@/lib/appUpdates';
import { clearAppData } from '@/lib/clearAppData';
import { safeImpactAsync } from '@/lib/haptics';
import { log } from '@/lib/logger';
import { supabase } from '@/services/supabase';
import { leaveSharedGroup, stopSharingAsOwner } from '@/services/collaborationService';
import { posthog } from '../src/config/posthog';
import { powerSyncDb } from '@/services/sync/PowerSyncProvider';
import { shareApp } from '@/services/shareService';
import type { InstalledApp } from '@/types';

interface UseAppContextMenuInput {
  db: SQLiteDatabase;
  refresh: () => Promise<void>;
  showToast: (message: string, type: 'success' | 'error') => void;
  updatesAvailable: Record<string, boolean>;
  setUpdatesAvailable: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  exportAppData: (db: SQLiteDatabase, app: InstalledApp) => Promise<void>;
}

export function useAppContextMenu({
  db,
  refresh,
  showToast,
  updatesAvailable,
  setUpdatesAvailable,
  exportAppData,
}: UseAppContextMenuInput) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTargetApp, setMenuTargetApp] = useState<InstalledApp | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);

  const openContextMenu = useCallback((app: InstalledApp) => {
    void safeImpactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuTargetApp(app);
    setMenuVisible(true);
  }, []);

  const closeContextMenu = useCallback(() => {
    if (menuBusy) return;
    setMenuVisible(false);
    setMenuTargetApp(null);
  }, [menuBusy]);

  const performMenuCheckUpdate = useCallback(async () => {
    if (!menuTargetApp || menuBusy) return;
    setMenuBusy(true);
    try {
      const result = await checkForUpdates(menuTargetApp);
      if (!result.available) {
        setUpdatesAvailable((prev) => ({ ...prev, [menuTargetApp.app_id]: false }));
        Alert.alert('Already up to date', 'No newer version is available.');
        return;
      }

      setUpdatesAvailable((prev) => ({ ...prev, [menuTargetApp.app_id]: true }));
      Alert.alert(
        'Update Available!',
        'A newer version was detected. Download and apply now?',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Update Now',
            onPress: async () => {
              try {
                const latestApp = await db.getFirstAsync<InstalledApp>(
                  'SELECT * FROM apps WHERE app_id = ?',
                  menuTargetApp.app_id
                );
                if (!latestApp) return;
                const applied = await applyUrlAppUpdate(db, latestApp, result.newHash);
                if (applied.updated) {
                  setUpdatesAvailable((prev) => ({ ...prev, [menuTargetApp.app_id]: false }));
                  await refresh();
                  showToast('Updated ✓', 'success');
                } else {
                  Alert.alert('Already up to date', 'Already up to date ✓');
                }
              } catch {
                showToast('Could not apply update', 'error');
              }
            },
          },
        ]
      );
    } catch {
      Alert.alert('Update check failed', 'Could not check updates right now.');
    } finally {
      setMenuBusy(false);
      setMenuVisible(false);
    }
  }, [db, menuBusy, menuTargetApp, refresh, setUpdatesAvailable, showToast]);

  const performMenuReplaceCode = useCallback(() => {
    if (!menuTargetApp) return;
    const url = encodeURIComponent(menuTargetApp.source_url ?? '');
    const appId = encodeURIComponent(menuTargetApp.app_id);
    setMenuVisible(false);
    router.push(`/add?replace_app_id=${appId}&replace_url=${url}`);
  }, [menuTargetApp]);

  const performMenuInfo = useCallback(async () => {
    if (!menuTargetApp) return;
    setMenuVisible(false);
    try {
      const dataCount = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM app_data WHERE app_id = ?',
        menuTargetApp.app_id
      );
      Alert.alert(
        menuTargetApp.name,
        [
          `Source: ${menuTargetApp.source_url ?? menuTargetApp.bundle_path}`,
          `Type: ${menuTargetApp.source_type}`,
          `Stored entries: ${dataCount?.n ?? 0}`,
          `Opened: ${menuTargetApp.open_count} time${menuTargetApp.open_count === 1 ? '' : 's'}`,
          updatesAvailable[menuTargetApp.app_id] ? 'Update: Available' : 'Update: Up to date',
        ].join('\n'),
        [{ text: 'OK' }]
      );
    } catch {
      Alert.alert('Error', 'Could not load app details.');
    }
  }, [db, menuTargetApp, updatesAvailable]);

  const performMenuShare = useCallback(async () => {
    if (!menuTargetApp || menuBusy) return;

    if (!menuTargetApp.source_url) {
      setMenuVisible(false);
      Alert.alert(
        'Cannot Share',
        "This app can only be shared if it was installed from a URL. ZIP and demo apps can't be shared yet."
      );
      return;
    }

    setMenuBusy(true);
    try {
      const result = await shareApp(menuTargetApp);
      if (result.error === 'not_signed_in') {
        Alert.alert('Sign in to Share', 'You need to sign in to share apps.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/auth') },
        ]);
      } else if (!result.success) {
        Alert.alert('Share failed', 'Could not share app. Please try again.');
      }
    } catch {
      Alert.alert('Share failed', 'Could not share app. Please try again.');
    } finally {
      setMenuBusy(false);
      setMenuVisible(false);
    }
  }, [menuTargetApp, menuBusy]);

  const performMenuExportData = useCallback(async () => {
    if (!menuTargetApp || menuBusy) return;
    setMenuBusy(true);
    try {
      await exportAppData(db, menuTargetApp);
    } catch {
      Alert.alert('Export failed', 'Could not export app data.');
    } finally {
      setMenuBusy(false);
      setMenuVisible(false);
    }
  }, [db, exportAppData, menuBusy, menuTargetApp]);

  const performMenuClearData = useCallback(() => {
    if (!menuTargetApp) return;
    setMenuVisible(false);

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;

      let isOwner = false;
      if (menuTargetApp.instance_id) {
        if (!userId) {
          Alert.alert('Sign in required', 'You must be signed in to clear app data.');
          return;
        }
        const ownerRow = await powerSyncDb.getOptional<{ owner_id: string }>(
          'SELECT owner_id FROM shared_instances WHERE instance_id = ?',
          [menuTargetApp.instance_id]
        );
        isOwner = ownerRow?.owner_id === userId;
        if (!isOwner) {
          Alert.alert('Not allowed', 'Only the instance owner can clear shared data.');
          return;
        }
      }

      const msg = menuTargetApp.instance_id
        ? `Clear all data for "${menuTargetApp.name}"? This will erase data for ALL members of this shared instance. This cannot be undone.`
        : `Clear all data for "${menuTargetApp.name}"? This cannot be undone.`;
      const btnLabel = menuTargetApp.instance_id ? 'Clear Shared Data' : 'Clear Data';

      Alert.alert('Clear App Data', msg, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: btnLabel,
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAppData({
                appId: menuTargetApp.app_id,
                instanceId: menuTargetApp.instance_id,
                isOwner,
                db,
                syncDb: powerSyncDb,
              });
              showToast('App data cleared', 'success');
            } catch (e) {
              log.error('[performMenuClearData]', e);
              showToast('Could not clear data', 'error');
            }
          },
        },
      ]);
    })();
  }, [db, menuTargetApp, showToast]);

  const performMenuDelete = useCallback(() => {
    if (!menuTargetApp) return;

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      const installedAppsId = userId
        ? `${userId}/${menuTargetApp.app_id}`
        : menuTargetApp.app_id;

      if (menuTargetApp.instance_id) {
        const ownerRow = await powerSyncDb.getOptional<{ owner_id: string }>(
          'SELECT owner_id FROM shared_instances WHERE instance_id = ?',
          [menuTargetApp.instance_id]
        );
        const isOwner = userId !== null && ownerRow?.owner_id === userId;

        if (isOwner) {
          // Owner: double confirmation before destroying the shared instance
          Alert.alert(
            `Delete "${menuTargetApp.name}"?`,
            'This will remove the app from your device.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Continue',
                onPress: () => {
                  Alert.alert(
                    'Destroy shared instance?',
                    'This will permanently destroy the shared instance and erase all data for every member. This cannot be undone.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete Everything',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await stopSharingAsOwner(
                              db, powerSyncDb, menuTargetApp.app_id, menuTargetApp.instance_id!
                            );
                            await powerSyncDb.execute(
                              'DELETE FROM shared_app_data WHERE instance_id = ? AND app_id = ?',
                              [menuTargetApp.instance_id, menuTargetApp.app_id]
                            );
                            await db.runAsync('DELETE FROM app_data WHERE app_id = ?', menuTargetApp.app_id);
                            await powerSyncDb.execute('DELETE FROM app_data WHERE app_id = ?', [menuTargetApp.app_id]);
                            await db.runAsync('DELETE FROM apps WHERE app_id = ?', menuTargetApp.app_id);
                            void powerSyncDb.execute('DELETE FROM installed_apps WHERE id = ?', [installedAppsId]);
                            void supabase.rpc('increment_app_count', { delta: -1 }).then(undefined, () => {});
                            posthog.capture('app_deleted', {
                              app_id: menuTargetApp.app_id,
                              app_name: menuTargetApp.name,
                              source_type: menuTargetApp.source_type,
                              open_count: menuTargetApp.open_count,
                              days_installed: Math.floor(
                                (Date.now() - new Date(menuTargetApp.installed_at).getTime()) / 86400000
                              ),
                            });
                            setUpdatesAvailable((prev) => {
                              const next = { ...prev };
                              delete next[menuTargetApp.app_id];
                              return next;
                            });
                            setMenuVisible(false);
                            await refresh();
                          } catch (e) {
                            log.error('[performMenuDelete owner]', e);
                            Alert.alert('Delete failed', 'Could not delete app.');
                            setMenuVisible(false);
                          }
                        },
                      },
                    ]
                  );
                },
              },
            ]
          );
        } else {
          // Non-owner member: leave the shared group then delete local app
          Alert.alert(
            `Leave "${menuTargetApp.name}"?`,
            "You'll lose access to the shared data.",
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Leave',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await leaveSharedGroup(
                      db, powerSyncDb, menuTargetApp.app_id, menuTargetApp.instance_id!
                    );
                    await db.runAsync('DELETE FROM app_data WHERE app_id = ?', menuTargetApp.app_id);
                    await powerSyncDb.execute('DELETE FROM app_data WHERE app_id = ?', [menuTargetApp.app_id]);
                    await db.runAsync('DELETE FROM apps WHERE app_id = ?', menuTargetApp.app_id);
                    void powerSyncDb.execute('DELETE FROM installed_apps WHERE id = ?', [installedAppsId]);
                    void supabase.rpc('increment_app_count', { delta: -1 }).then(undefined, () => {});
                    posthog.capture('app_deleted', {
                      app_id: menuTargetApp.app_id,
                      app_name: menuTargetApp.name,
                      source_type: menuTargetApp.source_type,
                      open_count: menuTargetApp.open_count,
                      days_installed: Math.floor(
                        (Date.now() - new Date(menuTargetApp.installed_at).getTime()) / 86400000
                      ),
                    });
                    setUpdatesAvailable((prev) => {
                      const next = { ...prev };
                      delete next[menuTargetApp.app_id];
                      return next;
                    });
                    setMenuVisible(false);
                    await refresh();
                  } catch (e) {
                    log.error('[performMenuDelete non-owner]', e);
                    Alert.alert('Leave failed', 'Could not leave app.');
                    setMenuVisible(false);
                  }
                },
              },
            ]
          );
        }
        return;
      }

      // Personal app
      Alert.alert(
        `Delete "${menuTargetApp.name}"?`,
        'This will permanently remove the app and all its stored data.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await db.runAsync('DELETE FROM app_data WHERE app_id = ?', menuTargetApp.app_id);
                await db.runAsync('DELETE FROM apps WHERE app_id = ?', menuTargetApp.app_id);
                void powerSyncDb.execute('DELETE FROM installed_apps WHERE id = ?', [installedAppsId]);
                void supabase.rpc('increment_app_count', { delta: -1 }).then(undefined, () => {});
                posthog.capture('app_deleted', {
                  app_id: menuTargetApp.app_id,
                  app_name: menuTargetApp.name,
                  source_type: menuTargetApp.source_type,
                  open_count: menuTargetApp.open_count,
                  days_installed: Math.floor(
                    (Date.now() - new Date(menuTargetApp.installed_at).getTime()) / 86400000
                  ),
                });
                setUpdatesAvailable((prev) => {
                  const next = { ...prev };
                  delete next[menuTargetApp.app_id];
                  return next;
                });
                // Close the modal first so the list is visible when refresh runs.
                // React Native Modal renders in a separate native layer — calling
                // setApps() while the modal is open doesn't reliably update the
                // FlatList until the modal is dismissed.
                setMenuVisible(false);
                await refresh();
              } catch {
                Alert.alert('Delete failed', 'Could not delete app.');
                setMenuVisible(false);
              }
            },
          },
        ]
      );
    })();
  }, [db, menuTargetApp, refresh, setUpdatesAvailable]);

  return {
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
    performMenuDelete,
  };
}
