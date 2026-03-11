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
              // Direct upsert using the unique constraint on (instance_id, app_id, key).
              // This passes ALL columns including merge metadata that the old
              // migrate_to_shared RPC was silently dropping.
              const row = withWriteActor(table, record) as Record<
                string,
                unknown
              >;

              // Strip the PowerSync compound id — Supabase uses its own uuid PK.
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { id: _psId, ...rowWithoutId } = row;

              const { error } = await supabase
                .from("shared_app_data")
                .upsert(rowWithoutId, { onConflict: "instance_id,app_id,key" });
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
              const row = withWriteActor(table, record) as Record<
                string,
                unknown
              >;
              const { id: _psId, ...rowWithoutId } = row;

              const { error } = await supabase
                .from("shared_app_data")
                .upsert(rowWithoutId, { onConflict: "instance_id,app_id,key" });
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
              const { error } = await supabase
                .from(table)
                .delete()
                .eq("instance_id", record.instance_id as string)
                .eq("app_id", record.app_id as string)
                .eq("key", record.key as string);
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
