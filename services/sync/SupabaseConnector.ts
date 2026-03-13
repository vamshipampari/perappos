import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/react-native";
import { supabase } from "../supabase";

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw new Error("Not authenticated");
    }

    return {
      endpoint: process.env.EXPO_PUBLIC_POWERSYNC_URL!,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    console.log("[PowerSync] uploading...", transaction.crud.length, "op(s)");

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;

    const withWriteActor = (table: string, row: Record<string, unknown>) => {
      if (!userId) return row;
      if (table === "shared_app_data") {
        return { ...row, updated_by: userId };
      }
      if (
        table === "app_data" ||
        table === "installed_apps" ||
        table === "session_data"
      ) {
        return { ...row, user_id: userId };
      }
      return row;
    };

    try {
      for (const op of transaction.crud) {
        const { table, opData, id } = op;
        const record = { ...opData, id };

        console.log(
          "[PowerSync] upload op:",
          op.op,
          "table:",
          table,
          "record:",
          record,
        );

        switch (op.op) {
          case UpdateType.PUT: {
            if (table === "shared_app_data") {
              // Use versioned upsert RPC so stale CRUD entries (lower version)
              // never overwrite newer writes from other devices.
              const row = withWriteActor(table, record) as Record<string, unknown>;
              const { error } = await supabase.rpc(
                "upsert_shared_app_data_versioned",
                {
                  p_id:                   row.id,
                  p_instance_id:          row.instance_id,
                  p_app_id:               row.app_id,
                  p_key:                  row.key,
                  p_value:                row.value,
                  p_version:              row.version ?? 1,
                  p_updated_by:           row.updated_by ?? null,
                  p_updated_at:           row.updated_at ?? new Date().toISOString(),
                  p_last_write_id:        row.last_write_id ?? null,
                  p_last_merge_strategy:  row.last_merge_strategy ?? null,
                  p_last_conflict_count:  row.last_conflict_count ?? 0,
                }
              );
              if (error) throw error;
            } else {
              const { error } = await supabase
                .from(table)
                .upsert(withWriteActor(table, record));
              if (error) throw error;
            }
            break;
          }
          case UpdateType.PATCH: {
            if (table === "shared_app_data") {
              // Same versioned guard for PATCH operations.
              const row = withWriteActor(table, record) as Record<string, unknown>;
              const { error } = await supabase.rpc(
                "upsert_shared_app_data_versioned",
                {
                  p_id:                   row.id,
                  p_instance_id:          row.instance_id,
                  p_app_id:               row.app_id,
                  p_key:                  row.key,
                  p_value:                row.value,
                  p_version:              row.version ?? 1,
                  p_updated_by:           row.updated_by ?? null,
                  p_updated_at:           row.updated_at ?? new Date().toISOString(),
                  p_last_write_id:        row.last_write_id ?? null,
                  p_last_merge_strategy:  row.last_merge_strategy ?? null,
                  p_last_conflict_count:  row.last_conflict_count ?? 0,
                }
              );
              if (error) throw error;
            } else {
              const { error } = await supabase
                .from(table)
                .update(withWriteActor(table, record))
                .eq("id", id);
              if (error) throw error;
            }
            break;
          }
          case UpdateType.DELETE: {
            if (table === "shared_app_data") {
              const sharedRecord = record as Record<string, unknown>;
              const { error } = await supabase
                .from(table)
                .delete()
                .eq("instance_id", sharedRecord.instance_id as string)
                .eq("app_id", sharedRecord.app_id as string)
                .eq("key", sharedRecord.key as string);
              if (error) throw error;
            } else {
              const { error } = await supabase
                .from(table)
                .delete()
                .eq("id", id);
              if (error) throw error;
            }
            break;
          }
        }
      }
      await transaction.complete();
      console.log("[PowerSync] upload complete");
    } catch (error) {
      console.error("[PowerSync] upload error:", error);
      throw error;
    }
  }
}
