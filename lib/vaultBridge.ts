/**
 * Native-side handler for messages posted from the WebView shim.
 *
 * Message flow:
 *   WebView (shim)  →  onMessage  →  handleVaultMessage  →  injectJavaScript(response)
 *
 * Two categories of messages:
 *  - "ls_*"  : fire-and-forget from the localStorage shim (no `id`, no response)
 *  - "db_*" / "device_*" / "auth_*" / "app_*" : VaultAPI calls with `id`, need response
 */

import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

type WebViewRef = RefObject<WebView | null>;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppManifest {
  app_id: string;
  name: string;
  source_url: string | null;
  installed_at: string;
  open_count: number;
}

interface RawMessage {
  type: string;
  id?: string;       // present for VaultAPI calls, absent for ls_* fire-and-forget
  appId: string;
  key?: string;
  value?: string;
  style?: string;
  title?: string;
  body?: string;
  url?: string;
  message?: string;
  [k: string]: unknown;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleVaultMessage(
  raw: string,
  db: SQLiteDatabase,
  webViewRef: WebViewRef,
  manifest: AppManifest
): Promise<void> {
  let msg: RawMessage;
  try {
    msg = JSON.parse(raw) as RawMessage;
  } catch {
    return; // not a vault message — ignore silently
  }

  const { type, id, appId } = msg;

  /**
   * Sends a response back into the WebView, resolving or rejecting the
   * Promise that the VaultAPI call returned.
   * No-op when `id` is absent (fire-and-forget messages).
   */
  const respond = (result: unknown, error?: string): void => {
    if (!id) return;
    const payload = JSON.stringify({
      id,
      result: result ?? null,
      error: error ?? null,
    });
    webViewRef.current?.injectJavaScript(`window.__vaultRespond(${payload}); true;`);
  };

  try {
    switch (type) {
      // ── localStorage fire-and-forget ──────────────────────────────────────
      // These come from the localStorage shim and carry no `id`.
      // We write to SQLite but send no response.

      case 'ls_set':
        await db.runAsync(
          `INSERT OR REPLACE INTO app_data (app_id, key, value, updated_at)
           VALUES (?, ?, ?, datetime('now'))`,
          appId,
          msg.key!,
          msg.value!
        );
        break;

      case 'ls_delete':
        await db.runAsync(
          `DELETE FROM app_data WHERE app_id = ? AND key = ?`,
          appId,
          msg.key!
        );
        break;

      case 'ls_clear':
        await db.runAsync(`DELETE FROM app_data WHERE app_id = ?`, appId);
        break;

      // ── VaultAPI.db ───────────────────────────────────────────────────────
      // These come from window.VaultAPI.db.* and carry an `id` for the response.

      case 'db_set':
        await db.runAsync(
          `INSERT OR REPLACE INTO app_data (app_id, key, value, updated_at)
           VALUES (?, ?, ?, datetime('now'))`,
          appId,
          msg.key!,
          msg.value!
        );
        respond(true);
        break;

      case 'db_get': {
        const row = await db.getFirstAsync<{ value: string }>(
          `SELECT value FROM app_data WHERE app_id = ? AND key = ?`,
          appId,
          msg.key!
        );
        respond(row?.value ?? null);
        break;
      }

      case 'db_delete':
        await db.runAsync(
          `DELETE FROM app_data WHERE app_id = ? AND key = ?`,
          appId,
          msg.key!
        );
        respond(true);
        break;

      case 'db_get_all': {
        const rows = await db.getAllAsync<{ key: string; value: string }>(
          `SELECT key, value FROM app_data WHERE app_id = ?`,
          appId
        );
        respond(Object.fromEntries(rows.map((r) => [r.key, r.value])));
        break;
      }

      // ── VaultAPI.device ───────────────────────────────────────────────────

      case 'device_haptic': {
        const style = msg.style ?? 'medium';
        if (style === 'success' || style === 'warning' || style === 'error') {
          const notifType: Record<string, Haptics.NotificationFeedbackType> = {
            success: Haptics.NotificationFeedbackType.Success,
            warning: Haptics.NotificationFeedbackType.Warning,
            error: Haptics.NotificationFeedbackType.Error,
          };
          await Haptics.notificationAsync(notifType[style]);
        } else {
          const impactType: Record<string, Haptics.ImpactFeedbackStyle> = {
            light: Haptics.ImpactFeedbackStyle.Light,
            medium: Haptics.ImpactFeedbackStyle.Medium,
            heavy: Haptics.ImpactFeedbackStyle.Heavy,
          };
          await Haptics.impactAsync(
            impactType[style] ?? Haptics.ImpactFeedbackStyle.Medium
          );
        }
        respond(true);
        break;
      }

      case 'device_notify':
        await Notifications.scheduleNotificationAsync({
          content: {
            title: String(msg.title ?? 'Notification'),
            body: String(msg.body ?? ''),
          },
          trigger: null,
        });
        respond(true);
        break;

      case 'device_share': {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare && (msg.url || msg.message)) {
          await Sharing.shareAsync(String(msg.url ?? msg.message ?? ''), {
            dialogTitle: msg.title ? String(msg.title) : undefined,
          });
        }
        respond(true);
        break;
      }

      // ── VaultAPI.auth / app ───────────────────────────────────────────────

      case 'auth_get_user':
        // Phase 2: return signed-in user. Null until cloud auth is implemented.
        respond(null);
        break;

      case 'app_get_info':
        respond(manifest);
        break;

      default:
        // Unknown message types are silently ignored.
        break;
    }
  } catch (e) {
    respond(null, e instanceof Error ? e.message : String(e));
  }
}
