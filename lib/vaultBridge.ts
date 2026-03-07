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
import { Share } from 'react-native';
import type WebView from 'react-native-webview';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { supabase } from '../services/supabase';

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
  text?: string;     // plain-text content for device_share
  message?: string;
  delay_seconds?: number;
  [k: string]: unknown;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleVaultMessage(
  raw: string,
  db: SQLiteDatabase,
  syncDb: AbstractPowerSyncDatabase,
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

      case 'ls_set': {
        const { data: { session: lsSession } } = await supabase.auth.getSession();
        await syncDb.execute(
          `INSERT OR REPLACE INTO app_data (id, user_id, app_id, key, value, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [`${appId}/${msg.key!}`, lsSession?.user?.id ?? null, appId, msg.key!, msg.value!]
        );
        break;
      }

      case 'ls_delete':
        await syncDb.execute(
          `DELETE FROM app_data WHERE app_id = ? AND key = ?`,
          [appId, msg.key!]
        );
        break;

      case 'ls_clear':
        await syncDb.execute(`DELETE FROM app_data WHERE app_id = ?`, [appId]);
        break;

      // ── VaultAPI.db ───────────────────────────────────────────────────────
      // These come from window.VaultAPI.db.* and carry an `id` for the response.

      case 'db_set': {
        const { data: { session: dbSession } } = await supabase.auth.getSession();
        await syncDb.execute(
          `INSERT OR REPLACE INTO app_data (id, user_id, app_id, key, value, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [`${appId}/${msg.key!}`, dbSession?.user?.id ?? null, appId, msg.key!, msg.value!]
        );
        respond(true);
        break;
      }

      case 'db_get': {
        const row = await syncDb.getOptional<{ value: string }>(
          `SELECT value FROM app_data WHERE app_id = ? AND key = ?`,
          [appId, msg.key!]
        );
        respond(row?.value ?? null);
        break;
      }

      case 'db_delete':
        await syncDb.execute(
          `DELETE FROM app_data WHERE app_id = ? AND key = ?`,
          [appId, msg.key!]
        );
        respond(true);
        break;

      case 'db_get_all': {
        const rows = await syncDb.getAll<{ key: string; value: string }>(
          `SELECT key, value FROM app_data WHERE app_id = ?`,
          [appId]
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

      case 'device_notify': {
        // Request permission if not already granted
        const { granted } = await Notifications.getPermissionsAsync();
        if (!granted) {
          const { granted: newGranted } = await Notifications.requestPermissionsAsync();
          if (!newGranted) {
            respond(false, 'Notification permission denied');
            break;
          }
        }
        const delay = typeof msg.delay_seconds === 'number' && msg.delay_seconds > 0
          ? msg.delay_seconds
          : null;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: String(msg.title ?? 'Notification'),
            body: String(msg.body ?? ''),
          },
          trigger: delay
            ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: delay, repeats: false }
            : null,
        });
        respond(true);
        break;
      }

      case 'device_share': {
        const shareUrl = msg.url ? String(msg.url) : null;
        const shareText = msg.text ? String(msg.text) : (msg.message ? String(msg.message) : null);
        if (shareUrl) {
          // Share a file / URL via expo-sharing sheet
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            await Sharing.shareAsync(shareUrl, { dialogTitle: shareText ?? undefined });
          }
        } else if (shareText) {
          // Text-only share via the native share sheet
          await Share.share({ message: shareText });
        }
        respond(true);
        break;
      }

      // ── VaultAPI.auth / app ───────────────────────────────────────────────

      case 'auth_get_user': {
        const { data: { session } } = await supabase.auth.getSession();
        respond(session ? { id: session.user.id, email: session.user.email } : null);
        break;
      }

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
