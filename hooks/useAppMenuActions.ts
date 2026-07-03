/**
 * Menu action callbacks for the WebView app runner screen.
 *
 * Handles: Collaborate, Manage Group, Check for Update, App Info,
 *          Clear App Data, Delete.
 * All actions are self-contained — they manage their own alerts and
 * call the provided setters when app state needs to change.
 */

import { useCallback, useState } from 'react';
import { Alert, Share } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { router } from 'expo-router';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import {
  applyUrlAppUpdate,
  checkForUpdates,
} from '@/lib/appUpdates';
import { clearAppData, isInstanceOwner } from '@/lib/clearAppData';
import { isUpgradeAvailable } from '@/lib/upgrade';
import { useGatekeeper } from '@/hooks/useGatekeeper';
import { log } from '@/lib/logger';
import { createSharedInstanceForApp, leaveSharedGroup, stopSharingAsOwner } from '@/services/collaborationService';
import { deployHtml } from '@/services/htmlDeployer';
import { supabase } from '@/services/supabase';
import { posthog } from '@/src/config/posthog';
import type { InstalledApp } from '@/types';

interface UseAppMenuActionsInput {
  app: InstalledApp | null;
  db: SQLiteDatabase;
  syncDb: AbstractPowerSyncDatabase;
  signedInUserId: string | null;
  setApp: (app: InstalledApp) => void;
  setMenuVisible: (v: boolean) => void;
  setAppInfoVisible: (v: boolean) => void;
  rebuildShimForApp: (app: InstalledApp) => Promise<void>;
  refreshWebView: () => void;
  remountWebView: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
}

interface UseAppMenuActionsResult {
  checkingUpdate: boolean;
  handleCollaborate: () => Promise<void>;
  handleManageGroup: () => void;
  handleCheckUpdate: () => Promise<void>;
  handleAppInfo: () => void;
  handleClearData: () => void;
  handleDelete: () => void;
}

export function useAppMenuActions({
  app,
  db,
  syncDb,
  signedInUserId,
  setApp,
  setMenuVisible,
  setAppInfoVisible,
  rebuildShimForApp,
  refreshWebView,
  remountWebView,
  showToast,
}: UseAppMenuActionsInput): UseAppMenuActionsResult {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const { gateSharedInstanceCreate } = useGatekeeper();

  const handleCollaborate = useCallback(async () => {
    if (!app) return;
    if (!gateSharedInstanceCreate()) return;
    if (!signedInUserId) {
      setMenuVisible(false);
      Alert.alert('Sign in required', 'You must sign in before creating a shared app.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.push('/auth') },
      ]);
      return;
    }
    if (app.instance_id) {
      setMenuVisible(false);
      Alert.alert('Already shared', 'This app is already in shared mode.');
      return;
    }

    // For HTML apps that were installed without internet, source_url may be null,
    // which means joiners would get a blank screen. Deploy now before continuing.
    // Use a local `liveApp` so the alert callback always has the fresh source_url.
    let liveApp = app;
    if (app.source_type === 'html' && !app.source_url) {
      if (!app.bundle_html) {
        setMenuVisible(false);
        Alert.alert(
          'Cannot Share',
          'This app has no cloud URL and no local HTML to deploy. Try reinstalling it.',
          [{ text: 'OK' }]
        );
        return;
      }
      try {
        const { url: cfUrl } = await deployHtml(app.app_id, app.bundle_html);
        await db.runAsync(
          `UPDATE apps SET source_url = ?, updated_at = datetime('now') WHERE app_id = ?`,
          cfUrl,
          app.app_id
        );
        liveApp = { ...app, source_url: cfUrl };
        setApp(liveApp);
      } catch (deployErr) {
        log.error('[handleCollaborate] pre-share deploy failed:', deployErr);
        setMenuVisible(false);
        Alert.alert(
          'Deploy Failed',
          'Could not upload this app to the cloud. Please check your internet connection and try again.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    setMenuVisible(false);
    Alert.alert(
      'Create Shared App?',
      `Create a shared version of "${liveApp.name}"?\n\nOther people can join with an invite code and you'll all share the same data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create Shared App',
          onPress: async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.user?.id) {
                Alert.alert('Sign in required', 'You must sign in before creating a shared app.');
                return;
              }
              const { data: existingData, error: existingError } = await supabase.rpc(
                'get_own_shared_instance',
                { p_app_id: app.app_id, p_user_id: session.user.id }
              );
              if (existingError) throw existingError;
              const existing = (existingData as { instance_id: string; invite_code: string }[] | null)?.[0] ?? null;

              if (existing) {
                const inviteCode = String(existing.invite_code).toUpperCase();
                await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
                  existing.instance_id,
                  app.app_id,
                ]);
                const updatedApp = { ...app, instance_id: String(existing.instance_id) };
                setApp(updatedApp);
                await rebuildShimForApp(updatedApp);
                remountWebView();
                Alert.alert(
                  'Existing shared instance found',
                  `Invite code: ${inviteCode}\n\nSpaced: ${inviteCode.split('').join(' ')}`,
                  [
                    { text: 'Copy Code', onPress: () => { void Share.share({ message: inviteCode }); } },
                    {
                      text: 'Share via Message',
                      onPress: () => {
                        void Share.share({
                          message:
                            `Join my "${app.name}" on Cottix!\n` +
                            `Open Cottix -> Settings -> Join Shared App -> Enter code: ${inviteCode}`,
                        });
                      },
                    },
                    { text: 'Done' },
                  ]
                );
                return;
              }

              // Backend enforces the limit atomically — check AND increment before creating.
              // This is the sole limit gate; no client-side plan/count checks.
              const { data: incrData } = await supabase.rpc('increment_shared_instance_count', { delta: 1 });
              const incrResult = incrData as { success?: boolean; error?: string; limit?: number } | null;
              if (incrResult?.error === 'shared_instance_limit_exceeded') {
                const limitVal = incrResult.limit;
                const limitMsg =
                  limitVal === 0
                    ? 'Sharing apps requires a Pro or Beta plan.'
                    : `Your plan allows up to ${limitVal} shared instances.${isUpgradeAvailable ? ' Upgrade for unlimited.' : ''}`;
                Alert.alert(
                  limitVal === 0 ? 'Upgrade Required' : 'Shared Instance Limit Reached',
                  isUpgradeAvailable
                    ? limitMsg
                    : limitMsg + '\n\nUpgrades aren’t available on Android yet — coming soon.',
                  isUpgradeAvailable
                    ? [
                        { text: 'Not Now', style: 'cancel' },
                        { text: 'Upgrade to Pro', onPress: () => router.push('/paywall') },
                      ]
                    : [{ text: 'OK', style: 'cancel' }]
                );
                return;
              }

              let result;
              try {
                result = await createSharedInstanceForApp(db, syncDb, liveApp);
              } catch (createError) {
                // Roll back the pre-increment since creation failed.
                void supabase.rpc('increment_shared_instance_count', { delta: -1 }).then(undefined, () => {});
                throw createError;
              }

              if (!result.created) {
                // An existing instance was found (no new instance) — undo the pre-increment.
                void supabase.rpc('increment_shared_instance_count', { delta: -1 }).then(undefined, () => {});
              }

              const inviteCode = result.inviteCode.toUpperCase();
              const updatedApp = { ...liveApp, instance_id: result.instanceId };
              setApp(updatedApp);
              await rebuildShimForApp(updatedApp);
              log.info('[share] shim rebuilt for shared instance, remounting WebView');
              remountWebView();
              Alert.alert(
                'Shared app created',
                `Invite code: ${inviteCode}\n\nSpaced: ${inviteCode.split('').join(' ')}`,
                [
                  {
                    text: 'Copy Code',
                    onPress: async () => { await Share.share({ message: inviteCode }); },
                  },
                  {
                    text: 'Share via Message',
                    onPress: async () => {
                      await Share.share({
                        message:
                          `Join my "${app.name}" on Cottix!\n` +
                          `Open Cottix -> Settings -> Join Shared App -> Enter code: ${inviteCode}`,
                      });
                    },
                  },
                  { text: 'Done' },
                ]
              );
            } catch (error) {
              log.error('[collaborate] error:', error);
              Alert.alert(
                'Could not check existing shared instance',
                error instanceof Error ? error.message : String(error)
              );
            }
          },
        },
      ]
    );
  }, [app, db, rebuildShimForApp, refreshWebView, setApp, setMenuVisible, signedInUserId, syncDb]);

  const handleManageGroup = useCallback(() => {
    if (!app?.instance_id) return;
    setMenuVisible(false);
    router.push(`/shared-instance/${app.instance_id}`);
  }, [app, setMenuVisible]);

  const handleCheckUpdate = useCallback(async () => {
    if (!app || checkingUpdate) return;
    if (app.source_type !== 'url') {
      setMenuVisible(false);
      Alert.alert('No Updates', 'Updates are only available for URL apps.');
      return;
    }

    setCheckingUpdate(true);
    try {
      const result = await checkForUpdates(app);
      if (!result.available) {
        setMenuVisible(false);
        Alert.alert('Already up to date', 'Already up to date ✓');
        return;
      }

      setMenuVisible(false);
      Alert.alert('Update available!', 'Download now?', [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            try {
              const latest = await db.getFirstAsync<InstalledApp>(
                'SELECT * FROM apps WHERE app_id = ?',
                app.app_id
              );
              if (!latest) return;
              const applied = await applyUrlAppUpdate(db, latest, result.newHash);
              if (!applied.updated) {
                Alert.alert('Already up to date', 'Already up to date ✓');
                return;
              }
              const refreshed = await db.getFirstAsync<InstalledApp>(
                'SELECT * FROM apps WHERE app_id = ?',
                app.app_id
              );
              if (refreshed) setApp(refreshed);
              Alert.alert('Success', 'Updated to latest version ✓');
            } catch {
              Alert.alert('Update failed', 'Could not apply update.');
            }
          },
        },
      ]);
    } catch {
      setMenuVisible(false);
      Alert.alert('Update check failed', 'Please try again.');
    } finally {
      setCheckingUpdate(false);
    }
  }, [app, checkingUpdate, db, setApp, setMenuVisible]);

  const handleAppInfo = useCallback(() => {
    if (!app) return;
    setMenuVisible(false);
    setAppInfoVisible(true);
  }, [app, setMenuVisible, setAppInfoVisible]);

  const handleClearData = useCallback(() => {
    if (!app) return;
    setMenuVisible(false);

    void (async () => {
      let isOwner = false;
      if (app.instance_id) {
        if (!signedInUserId) {
          Alert.alert('Sign in required', 'You must be signed in to clear app data.');
          return;
        }
        isOwner = await isInstanceOwner(app.instance_id, signedInUserId, syncDb);
        if (!isOwner) {
          Alert.alert('Not allowed', 'Only the instance owner can clear shared data.');
          return;
        }
      }

      const msg = app.instance_id
        ? `Clear all data for "${app.name}"? This will erase data for ALL members of this shared instance. This cannot be undone.`
        : `Clear all data for "${app.name}"? This cannot be undone.`;
      const btnLabel = app.instance_id ? 'Clear Shared Data' : 'Clear Data';

      Alert.alert('Clear App Data', msg, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: btnLabel,
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAppData({
                appId: app.app_id,
                instanceId: app.instance_id,
                isOwner,
                db,
                syncDb,
              });
              showToast('App data cleared', 'success');
              refreshWebView();
            } catch (e) {
              log.error('[handleClearData]', e);
              showToast('Could not clear data', 'error');
            }
          },
        },
      ]);
    })();
  }, [app, db, refreshWebView, setMenuVisible, showToast, signedInUserId, syncDb]);

  const handleDelete = useCallback(() => {
    if (!app) return;
    setMenuVisible(false);

    void (async () => {
      const installedAppsId = signedInUserId
        ? `${signedInUserId}/${app.app_id}`
        : app.app_id;

      if (app.instance_id) {
        const owned = signedInUserId
          ? await isInstanceOwner(app.instance_id, signedInUserId, syncDb)
          : false;

        if (owned) {
          // Owner: double confirmation before destroying the shared instance
          Alert.alert(
            `Delete "${app.name}"?`,
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
                            // stopSharingAsOwner: snapshots→personal, cascading Supabase delete,
                            // sets instance_id=NULL, decrements shared_instance_count
                            await stopSharingAsOwner(db, syncDb, app.app_id, app.instance_id!);
                            // Clear PowerSync local shared_app_data (Supabase already cleared by above)
                            await syncDb.execute(
                              'DELETE FROM shared_app_data WHERE instance_id = ? AND app_id = ?',
                              [app.instance_id, app.app_id]
                            );
                            await db.runAsync('DELETE FROM app_data WHERE app_id = ?', app.app_id);
                            await syncDb.execute('DELETE FROM app_data WHERE app_id = ?', [app.app_id]);
                            await syncDb.execute('DELETE FROM installed_apps WHERE id = ?', [installedAppsId]);
                            await db.runAsync('DELETE FROM apps WHERE app_id = ?', app.app_id);
                            void supabase.rpc('increment_app_count', { delta: -1 }).then(undefined, () => {});
                            posthog.capture('app_deleted', {
                              app_id: app.app_id,
                              app_name: app.name,
                              source_type: app.source_type,
                            });
                          } catch (e) {
                            log.error('[handleDelete owner]', e);
                          }
                          router.back();
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
            `Leave "${app.name}"?`,
            "You'll lose access to the shared data.",
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Leave',
                style: 'destructive',
                onPress: async () => {
                  try {
                    // leaveSharedGroup: snapshots shared→personal, removes from instance_members,
                    // sets instance_id=NULL
                    await leaveSharedGroup(db, syncDb, app.app_id, app.instance_id!);
                    await db.runAsync('DELETE FROM app_data WHERE app_id = ?', app.app_id);
                    await syncDb.execute('DELETE FROM app_data WHERE app_id = ?', [app.app_id]);
                    await syncDb.execute('DELETE FROM installed_apps WHERE id = ?', [installedAppsId]);
                    await db.runAsync('DELETE FROM apps WHERE app_id = ?', app.app_id);
                    void supabase.rpc('increment_app_count', { delta: -1 }).then(undefined, () => {});
                    posthog.capture('app_deleted', {
                      app_id: app.app_id,
                      app_name: app.name,
                      source_type: app.source_type,
                    });
                  } catch (e) {
                    log.error('[handleDelete non-owner]', e);
                  }
                  router.back();
                },
              },
            ]
          );
        }
        return;
      }

      // Personal app
      Alert.alert(
        `Delete "${app.name}"?`,
        'This will permanently remove the app and all its stored data.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await db.runAsync('DELETE FROM app_data WHERE app_id = ?', app.app_id);
                await syncDb.execute('DELETE FROM app_data WHERE app_id = ?', [app.app_id]);
                await syncDb.execute('DELETE FROM installed_apps WHERE id = ?', [installedAppsId]);
                await db.runAsync('DELETE FROM apps WHERE app_id = ?', app.app_id);
                void supabase.rpc('increment_app_count', { delta: -1 }).then(undefined, () => {});
                posthog.capture('app_deleted', {
                  app_id: app.app_id,
                  app_name: app.name,
                  source_type: app.source_type,
                });
              } catch {
                // ignore
              }
              router.back();
            },
          },
        ]
      );
    })();
  }, [app, db, setMenuVisible, signedInUserId, syncDb]);

  return {
    checkingUpdate,
    handleCollaborate,
    handleManageGroup,
    handleCheckUpdate,
    handleAppInfo,
    handleClearData,
    handleDelete,
  };
}
