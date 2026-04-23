/**
 * Context menu state and action callbacks for the home screen app list.
 *
 * Handles: Open, Manage Group, Check for Update, Replace Code,
 *          App Info, Export Data, Share App, Clear App Data, Delete.
 */

import { useCallback, useState } from 'react';
import { Alert, Share } from 'react-native';
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
import { createSharedInstanceForApp } from '@/services/collaborationService';
import { deployHtml } from '@/services/htmlDeployer';
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
            }
          },
        },
      ]);
    })();
  }, [db, menuTargetApp, showToast]);

  const performMenuCollaborate = useCallback(async () => {
    if (!menuTargetApp) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      closeContextMenu();
      Alert.alert('Sign in required', 'You must sign in before creating a shared app.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.push('/auth') },
      ]);
      return;
    }

    if (menuTargetApp.instance_id) {
      closeContextMenu();
      Alert.alert('Already shared', 'This app is already in shared mode.');
      return;
    }

    let liveApp = menuTargetApp;
    if (menuTargetApp.source_type === 'html' && !menuTargetApp.source_url) {
      if (!menuTargetApp.bundle_html) {
        closeContextMenu();
        Alert.alert('Cannot Share', 'This app has no cloud URL and no local HTML to deploy. Try reinstalling it.', [{ text: 'OK' }]);
        return;
      }
      try {
        const { url: cfUrl } = await deployHtml(menuTargetApp.app_id, menuTargetApp.bundle_html);
        await db.runAsync(
          `UPDATE apps SET source_url = ?, updated_at = datetime('now') WHERE app_id = ?`,
          cfUrl,
          menuTargetApp.app_id
        );
        liveApp = { ...menuTargetApp, source_url: cfUrl };
      } catch {
        closeContextMenu();
        Alert.alert('Deploy Failed', 'Could not upload this app to the cloud. Check your internet and try again.', [{ text: 'OK' }]);
        return;
      }
    }

    closeContextMenu();
    Alert.alert(
      'Create Shared App?',
      `Create a shared version of "${liveApp.name}"?\n\nOther people can join with an invite code and you'll all share the same data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create Shared App',
          onPress: async () => {
            try {
              const { data: { session: s } } = await supabase.auth.getSession();
              if (!s?.user?.id) {
                Alert.alert('Sign in required', 'You must sign in before creating a shared app.');
                return;
              }

              const { data: existingData, error: existingError } = await supabase.rpc(
                'get_own_shared_instance',
                { p_app_id: liveApp.app_id, p_user_id: s.user.id }
              );
              if (existingError) throw existingError;
              const existing = (existingData as { instance_id: string; invite_code: string }[] | null)?.[0] ?? null;

              if (existing) {
                const inviteCode = String(existing.invite_code).toUpperCase();
                await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [existing.instance_id, liveApp.app_id]);
                await refresh();
                Alert.alert(
                  'Existing shared instance found',
                  `Invite code: ${inviteCode}\n\nSpaced: ${inviteCode.split('').join(' ')}`,
                  [
                    { text: 'Copy Code', onPress: () => { void Share.share({ message: inviteCode }); } },
                    {
                      text: 'Share via Message',
                      onPress: () => {
                        void Share.share({
                          message: `Join my "${liveApp.name}" on Cottix!\nOpen Cottix -> Settings -> Join Shared App -> Enter code: ${inviteCode}`,
                        });
                      },
                    },
                    { text: 'Done' },
                  ]
                );
                return;
              }

              const { data: incrData } = await supabase.rpc('increment_shared_instance_count', { delta: 1 });
              const incrResult = incrData as { success?: boolean; error?: string; limit?: number } | null;
              if (incrResult?.error === 'shared_instance_limit_exceeded') {
                const limitVal = incrResult.limit;
                Alert.alert(
                  limitVal === 0 ? 'Upgrade Required' : 'Shared Instance Limit Reached',
                  limitVal === 0
                    ? 'Sharing apps requires a Pro or Beta plan. Redeem a promo code in Settings to unlock this feature.'
                    : `Your plan allows up to ${limitVal} shared instances. Upgrade to Team for unlimited.`,
                  [{ text: 'OK' }]
                );
                return;
              }

              let result;
              try {
                result = await createSharedInstanceForApp(db, powerSyncDb, liveApp);
              } catch (createError) {
                void supabase.rpc('increment_shared_instance_count', { delta: -1 }).then(undefined, () => {});
                throw createError;
              }

              if (!result.created) {
                void supabase.rpc('increment_shared_instance_count', { delta: -1 }).then(undefined, () => {});
              }

              const inviteCode = result.inviteCode.toUpperCase();
              await refresh();
              Alert.alert(
                'Shared app created',
                `Invite code: ${inviteCode}\n\nSpaced: ${inviteCode.split('').join(' ')}`,
                [
                  { text: 'Copy Code', onPress: async () => { await Share.share({ message: inviteCode }); } },
                  {
                    text: 'Share via Message',
                    onPress: async () => {
                      await Share.share({
                        message: `Join my "${liveApp.name}" on Cottix!\nOpen Cottix -> Settings -> Join Shared App -> Enter code: ${inviteCode}`,
                      });
                    },
                  },
                  { text: 'Done' },
                ]
              );
            } catch (error) {
              Alert.alert('Could not create shared app', error instanceof Error ? error.message : String(error));
            }
          },
        },
      ]
    );
  }, [db, menuTargetApp, closeContextMenu, refresh]);

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
    performMenuCollaborate,
    performMenuDelete,
  };
}
