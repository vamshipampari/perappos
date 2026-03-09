import { PowerSyncBackendConnector, AbstractPowerSyncDatabase, UpdateType } from '@powersync/react-native';
import { supabase } from '../supabase';

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('Not authenticated');
    }

    return {
      endpoint: process.env.EXPO_PUBLIC_POWERSYNC_URL!,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    console.log('[PowerSync] uploading...', transaction.crud.length, 'op(s)');

    // Fetch session once for the whole transaction
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    const withWriteActor = (table: string, row: Record<string, unknown>) => {
      if (!userId) return row;
      if (table === 'shared_app_data') {
        return { ...row, updated_by: userId };
      }
      if (table === 'app_data' || table === 'installed_apps' || table === 'session_data') {
        return { ...row, user_id: userId };
      }
      return row;
    };

    try {
      for (const op of transaction.crud) {
        const { table, opData, id } = op;
        const record = { ...opData, id };

        console.log('[PowerSync] upload op:', op.op, 'table:', table, 'record:', record);

        switch (op.op) {
          case UpdateType.PUT: {
            const { error } = await supabase.from(table).upsert(withWriteActor(table, record));
            if (error) throw error;
            break;
          }
          case UpdateType.PATCH: {
            const { error } = await supabase
              .from(table)
              .update(withWriteActor(table, record))
              .eq('id', id);
            if (error) throw error;
            break;
          }
          case UpdateType.DELETE: {
            const { error } = await supabase.from(table).delete().eq('id', id);
            if (error) throw error;
            break;
          }
        }
      }
      await transaction.complete();
      console.log('[PowerSync] upload complete');
    } catch (error) {
      console.error('[PowerSync] upload error:', error);
      throw error;
    }
  }
}
