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

    try {
      for (const op of transaction.crud) {
        const { table, opData, id } = op;
        const record = { ...opData, id };

        console.log('[PowerSync] upload op:', op.op, 'table:', table, 'record:', record);

        switch (op.op) {
          case UpdateType.PUT: {
            const { error } = await supabase.from(table).upsert({
              ...record,
              user_id: userId,
            });
            if (error) throw error;
            break;
          }
          case UpdateType.PATCH: {
            const { error } = await supabase.from(table).update({
              ...record,
              user_id: userId,
            }).eq('id', id);
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
