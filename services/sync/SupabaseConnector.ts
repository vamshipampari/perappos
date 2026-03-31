import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/react-native";
import { log } from "@/lib/logger";
import { supabase } from "../supabase";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Call the versioned upsert RPC with attribution columns if available,
 * falling back to the original 11-param signature if the migration hasn't
 * been applied yet (i.e. the new params don't exist in Supabase).
 *
 * This makes the attribution feature deploy-safe: uploads keep working
 * even if the SQL migration is run after the app update.
 */
async function upsertSharedAppData(
  client: typeof supabase,
  row: Record<string, unknown>
): Promise<void> {
  const baseParams = {
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
  };

  // Try with attribution params first (requires migration to have run).
  const { error } = await client.rpc("upsert_shared_app_data_versioned", {
    ...baseParams,
    p_last_editor_user_id:       row.last_editor_user_id ?? null,
    p_last_editor_display_name:  row.last_editor_display_name ?? null,
  });

  if (!error) return;

  // If Postgres rejected the call because the new params don't exist yet
  // (PGRST202 = "could not find the function"), retry without them.
  // Any other error is a real failure — rethrow immediately.
  if (
    (error as { code?: string }).code === "PGRST202" ||
    error.message?.includes("Could not find the function") ||
    error.message?.includes("does not exist")
  ) {
    log.warn("[PowerSync] attribution RPC params not available yet — retrying without them");
    const { error: retryError } = await client.rpc(
      "upsert_shared_app_data_versioned",
      baseParams
    );
    if (retryError) throw retryError;
    return;
  }

  throw error;
}

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

    log.info("[PowerSync] uploading...", transaction.crud.length, "op(s)");

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;

    const withWriteActor = (table: string, row: Record<string, unknown>) => {
      if (!userId) return row;
      if (table === "shared_app_data") {
        return { ...row, updated_by: userId };
      }
      if (table === "app_data" || table === "session_data") {
        return { ...row, user_id: userId };
      }
      if (table === "installed_apps") {
        // Scope the Supabase PK to the user so that multiple users installing
        // the same shared app (same app_id) don't conflict on the Supabase PK.
        // Local PowerSync id stays as app_id; Supabase id is ${userId}/${app_id}.
        const appId = (row.app_id as string) ?? (row.id as string);
        return { ...row, user_id: userId, id: `${userId}/${appId}` };
      }
      return row;
    };

    // Returns the Supabase-side row ID for a given table + local PowerSync id.
    // For installed_apps the Supabase PK is user-scoped; everything else is 1:1.
    const supabaseRowId = (table: string, localId: string): string => {
      if (table === "installed_apps" && userId) {
        return `${userId}/${localId}`;
      }
      return localId;
    };

    try {
      for (const op of transaction.crud) {
        const { table, opData, id } = op;
        const record = { ...opData, id };

        log.info(
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
              await upsertSharedAppData(supabase, row);

              // Append to audit log — fire-and-forget (history loss is acceptable).
              if (row.last_editor_user_id || row.updated_by) {
                supabase.from("shared_app_data_history").insert({
                  instance_id:          row.instance_id,
                  app_id:               row.app_id,
                  key:                  row.key,
                  value:                row.value,
                  editor_user_id:       (row.last_editor_user_id ?? row.updated_by ?? '') as string,
                  editor_display_name:  (row.last_editor_display_name ?? '') as string,
                  written_at:           row.updated_at ?? new Date().toISOString(),
                  merge_strategy:       row.last_merge_strategy ?? null,
                  version:              row.version ?? 1,
                }).then(({ error: histErr }) => {
                  if (histErr) log.warn("[PowerSync] history insert failed (non-fatal):", histErr.message);
                });
              }
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
              await upsertSharedAppData(supabase, row);
            } else {
              const { error } = await supabase
                .from(table)
                .update(withWriteActor(table, record))
                .eq("id", supabaseRowId(table, id));
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
                .eq("id", supabaseRowId(table, id));
              if (error) throw error;
            }
            break;
          }
        }
      }
      await transaction.complete();
      log.info("[PowerSync] upload complete");
    } catch (error) {
      log.error("[PowerSync] upload error:", error);
      throw error;
    }
  }
}
