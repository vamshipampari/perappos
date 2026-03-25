/**
 * Menu action callbacks for the WebView app runner screen.
 *
 * Handles: Collaborate, Manage Group, Check for Update, App Info, Delete.
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
  getLatestBackup,
  revertToPreviousVersion,
} from '@/lib/appUpdates';
import { log } from '@/lib/logger';
import { createSharedInstanceForApp } from '@/services/collaborationService';
import { supabase } from '@/services/supabase';
import type { InstalledApp } from '@/types';

interface UseAppMenuActionsInput {
  app: InstalledApp | null;
  db: SQLiteDatabase;
  syncDb: AbstractPowerSyncDatabase;
  signedInUserId: string | null;
  setApp: (app: InstalledApp) => void;
  setMenuVisible: (v: boolean) => void;
  rebuildShimForApp: (app: InstalledApp) => Promise<void>;
  refreshWebView: () => void;
}

interface UseAppMenuActionsResult {
  checkingUpdate: boolean;
  handleCollaborate: () => Promise<void>;
  handleManageGroup: () => void;
  handleCheckUpdate: () => Promise<void>;
  handleAppInfo: () => Promise<void>;
  handleDelete: () => void;
}

export function useAppMenuActions({
  app,
  db,
  syncDb,
  signedInUserId,
  setApp,
  setMenuVisible,
  rebuildShimForApp,
  refreshWebView,
}: UseAppMenuActionsInput): UseAppMenuActionsResult {
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleCollaborate = useCallback(async () => {
    if (!app) return;
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

    // Check shared instance limit before proceeding
    try {
      const { data: profileData } = await supabase.rpc('get_user_profile');
      if (profileData) {
        const plan = (profileData as { plan: string }).plan;
        const count = (profileData as { shared_instance_count: number }).shared_instance_count;
        if (plan === 'free') {
          setMenuVisible(false);
          Alert.alert(
            'Upgrade Required',
            'Sharing apps requires a Pro or Beta plan. Redeem a promo code in Settings to unlock this feature.',
            [{ text: 'OK' }]
          );
          return;
        }
        const limit = plan === 'team' ? Infinity : 5;
        if (count >= limit) {
          setMenuVisible(false);
          Alert.alert(
            'Shared Instance Limit Reached',
            `Your plan allows up to ${limit} shared instances. Upgrade to Team for unlimited.`,
            [{ text: 'OK' }]
          );
          return;
        }
      }
    } catch {
      // If profile check fails, allow the action (don't block on network errors)
    }

    setMenuVisible(false);
    Alert.alert(
      'Create Shared App?',
      `Create a shared version of "${app.name}"?\n\nOther people can join with an invite code and you'll all share the same data.`,
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
                setTimeout(() => refreshWebView(), 0);
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

              const result = await createSharedInstanceForApp(db, syncDb, app);
              if (result.created) {
                void supabase.rpc('increment_shared_instance_count', { delta: 1 }).then(undefined, () => {});
              }
              const inviteCode = result.inviteCode.toUpperCase();
              const updatedApp = { ...app, instance_id: result.instanceId };
              setApp(updatedApp);
              await rebuildShimForApp(updatedApp);
              log.info('[share] shim rebuilt for shared instance, reloading WebView');
              setTimeout(() => refreshWebView(), 0);
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

  const handleAppInfo = useCallback(async () => {
    if (!app) return;
    setMenuVisible(false);
    try {
      const [countRow, backup] = await Promise.all([
        app.instance_id
          ? syncDb.getOptional<{ n: number }>(
              'SELECT COUNT(*) AS n FROM shared_app_data WHERE instance_id = ? AND app_id = ?',
              [app.instance_id, app.app_id]
            )
          : syncDb.getOptional<{ n: number }>(
              'SELECT COUNT(*) AS n FROM app_data WHERE app_id = ?',
              [app.app_id]
            ),
        getLatestBackup(db, app.app_id),
      ]);
      const entries = countRow?.n ?? 0;
      const installed = new Date(app.installed_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      Alert.alert(
        app.name,
        [
          `Source: ${app.source_url ?? app.bundle_path}`,
          `Type: ${app.source_type === 'url' ? 'Web URL' : 'Local bundle'}`,
          `Installed: ${installed}`,
          `Opened: ${app.open_count} time${app.open_count === 1 ? '' : 's'}`,
          `Stored data: ${entries} entr${entries === 1 ? 'y' : 'ies'}`,
        ].join('\n'),
        [
          { text: 'Close' },
          ...(backup
            ? [{
                text: 'Revert to Previous Version',
                onPress: async () => {
                  try {
                    const ok = await revertToPreviousVersion(db, app.app_id);
                    if (!ok) {
                      Alert.alert('No backup', 'No previous version is available.');
                      return;
                    }
                    const refreshed = await db.getFirstAsync<InstalledApp>(
                      'SELECT * FROM apps WHERE app_id = ?',
                      app.app_id
                    );
                    if (refreshed) setApp(refreshed);
                    Alert.alert('Restored', 'Reverted to previous version ✓');
                  } catch {
                    Alert.alert('Revert failed', 'Could not restore previous version.');
                  }
                },
              } as const]
            : []),
        ]
      );
    } catch {
      // non-critical
    }
  }, [app, db, setApp, setMenuVisible, syncDb]);

  const handleDelete = useCallback(() => {
    if (!app) return;
    setMenuVisible(false);
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
              await db.runAsync('UPDATE apps SET instance_id = NULL WHERE app_id = ?', app.app_id);
              await syncDb.execute('DELETE FROM app_data WHERE app_id = ?', [app.app_id]);
              await syncDb.execute('DELETE FROM installed_apps WHERE id = ?', [app.app_id]);
              await db.runAsync('DELETE FROM apps WHERE app_id = ?', app.app_id);
              void supabase.rpc('increment_app_count', { delta: -1 }).then(undefined, () => {});
            } catch {
              // ignore
            }
            router.back();
          },
        },
      ]
    );
  }, [app, db, setMenuVisible, syncDb]);

  return {
    checkingUpdate,
    handleCollaborate,
    handleManageGroup,
    handleCheckUpdate,
    handleAppInfo,
    handleDelete,
  };
}
