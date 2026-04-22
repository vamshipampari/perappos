import type { SQLiteDatabase } from 'expo-sqlite';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { log } from '@/lib/logger';
import { supabase } from '@/services/supabase';

export async function isInstanceOwner(
  instanceId: string,
  userId: string,
  syncDb: AbstractPowerSyncDatabase
): Promise<boolean> {
  const row = await syncDb.getOptional<{ owner_id: string }>(
    'SELECT owner_id FROM shared_instances WHERE instance_id = ?',
    [instanceId]
  );
  return row?.owner_id === userId;
}

interface ClearAppDataParams {
  appId: string;
  instanceId: string | null | undefined;
  isOwner: boolean;
  db: SQLiteDatabase;
  syncDb: AbstractPowerSyncDatabase;
}

export async function clearAppData({
  appId,
  instanceId,
  isOwner,
  db,
  syncDb,
}: ClearAppDataParams): Promise<void> {
  // Clear local expo-sqlite app_data
  await db.runAsync('DELETE FROM app_data WHERE app_id = ?', appId);

  // Clear PowerSync local app_data
  await syncDb.execute('DELETE FROM app_data WHERE app_id = ?', [appId]);

  if (instanceId && isOwner) {
    // Clear PowerSync local shared_app_data
    await syncDb.execute(
      'DELETE FROM shared_app_data WHERE instance_id = ? AND app_id = ?',
      [instanceId, appId]
    );

    // Clear Supabase shared_app_data via natural key — fire-and-forget, log failures
    void supabase
      .from('shared_app_data')
      .delete()
      .eq('instance_id', instanceId)
      .eq('app_id', appId)
      .then(({ error }) => {
        if (error) log.error('[clearAppData] Supabase shared_app_data delete failed:', error);
      });
  }
}
