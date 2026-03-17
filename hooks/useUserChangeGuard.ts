import * as FileSystem from 'expo-file-system/legacy';
import { useSQLiteContext } from 'expo-sqlite';
import { Storage } from 'expo-sqlite/kv-store';
import { useCallback, useState } from 'react';

import { connector, powerSyncDb } from '../services/sync/PowerSyncProvider';
import { supabase } from '../services/supabase';

const LAST_USER_KEY = 'lastUserId';

export interface UserChangeGuard {
  needsWipe: boolean;
  pendingUserEmail: string | null;
  checkUserChange: (userId: string, userEmail?: string) => Promise<boolean>;
  persistUserId: (userId: string) => Promise<void>;
  confirmWipe: () => Promise<void>;
  cancelWipe: () => void;
}

/**
 * Detects when a different Supabase user signs in and offers a safe
 * "wipe + switch" flow with explicit user confirmation.
 *
 * Must be used inside <SQLiteProvider> and <PowerSyncProvider>.
 */
export function useUserChangeGuard(): UserChangeGuard {
  const db = useSQLiteContext();
  const [needsWipe, setNeedsWipe] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingUserEmail, setPendingUserEmail] = useState<string | null>(null);

  /** Persist the active user ID so future launches can detect a switch. */
  const persistUserId = useCallback(async (userId: string) => {
    await Storage.setItem(LAST_USER_KEY, userId);
  }, []);

  /**
   * Call on every SIGNED_IN / INITIAL_SESSION event.
   * Returns true when a wipe confirmation modal should be shown, false when
   * it's safe to proceed immediately (same user, first login, or no local data).
   */
  const checkUserChange = useCallback(
    async (userId: string, userEmail?: string): Promise<boolean> => {
      const lastUserId = await Storage.getItem(LAST_USER_KEY);

      // First-ever login or same user — no wipe needed.
      if (!lastUserId || lastUserId === userId) {
        return false;
      }

      // Different user — skip modal if there are no local apps to lose.
      try {
        const row = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM apps'
        );
        if ((row?.count ?? 0) === 0) {
          return false;
        }
      } catch {
        // Can't query — assume data exists and show the modal to be safe.
      }

      // Different user AND local data present — need confirmation.
      setPendingUserId(userId);
      setPendingUserEmail(userEmail ?? null);
      setNeedsWipe(true);
      return true;
    },
    [db]
  );

  /**
   * Called when the user taps "Continue & Erase".
   * Destroys all local data belonging to the previous user then switches
   * PowerSync over to the new user's session.
   */
  const confirmWipe = useCallback(async () => {
    if (!pendingUserId) return;

    try {
      // 1. Disconnect PowerSync and clear its local sync database.
      try {
        // disconnectAndClear is available on PowerSyncDatabase ≥ 1.x
        await (powerSyncDb as unknown as { disconnectAndClear: () => Promise<void> }).disconnectAndClear();
      } catch {
        // Older SDK versions — disconnect is sufficient here; tables get
        // cleared by the SQLite wipe below.
        await powerSyncDb.disconnect();
      }

      // 2. Wipe all app data from the local SQLite database.
      await db.execAsync('DELETE FROM apps; DELETE FROM app_data; DELETE FROM shared_data;');

      // 3. Delete cached app bundles from disk.
      const appsDir = `${FileSystem.documentDirectory}apps/`;
      await FileSystem.deleteAsync(appsDir, { idempotent: true });

      // 4. Persist the new user ID as the new "last known" user.
      await Storage.setItem(LAST_USER_KEY, pendingUserId);

      // 5. Reconnect PowerSync for the new user.
      try {
        await powerSyncDb.connect(connector);
      } catch {
        // Non-critical — will reconnect on next app lifecycle event.
      }
    } finally {
      setNeedsWipe(false);
      setPendingUserId(null);
      setPendingUserEmail(null);
    }
  }, [db, pendingUserId]);

  /**
   * Called when the user taps "Cancel".
   * Signs out so they're returned to the login screen with their old data intact.
   */
  const cancelWipe = useCallback(() => {
    setNeedsWipe(false);
    setPendingUserId(null);
    setPendingUserEmail(null);
    void supabase.auth.signOut();
  }, []);

  return {
    needsWipe,
    pendingUserEmail,
    checkUserChange,
    persistUserId,
    confirmWipe,
    cancelWipe,
  };
}
