/**
 * Native-side handler for messages posted from the WebView shim.
 *
 * Message flow:
 *   WebView (shim)  →  onMessage  →  handleVaultMessage  →  injectJavaScript(response)
 *
 * Two categories of messages:
 *  - "ls_*"  : localStorage shim messages; `ls_set_sync` carries an `id` and expects a response
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
import { handleSharedWrite } from '@/services/sync/bridge-merge-handler';
import type { SharedWriteMessage } from '@/services/sync/bridge-merge-handler';
import { supabase } from '../services/supabase';

type WebViewRef = RefObject<WebView | null>;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppManifest {
  app_id: string;
  name: string;
  source_url: string | null;
  installed_at: string;
  open_count: number;
  instance_id: string | null;
}

interface RawMessage {
  type: string;
  id?: string;       // present for VaultAPI calls and ls_set_sync, absent for ls_* fire-and-forget
  appId: string;
  _callbackId?: number;
  app_id?: string;
  key?: string;
  value?: string;
  baseVersion?: number;
  baseHash?: string | null;
  baseValue?: string | null;
  clientWriteId?: string;
  pageAge?: number;
  hadInteraction?: boolean;
  timestamp?: number;
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
  const effectiveAppId = manifest.app_id || msg.app_id || appId;
  const isShared = !!manifest.instance_id;
  const instanceId = manifest.instance_id;

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
      case 'ls_set_sync': {
        if (!isShared || !instanceId || !msg.key || typeof msg.value !== 'string') {
          respond(
            {
              success: false,
              newVersion: 0,
              newValue: null,
            },
            !isShared || !instanceId ? 'Shared sync is not available for this app instance' : 'Invalid sync write payload'
          );
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id ?? '';
        const sharedMsg: SharedWriteMessage = {
          key: msg.key,
          value: msg.value,
          baseVersion: msg.baseVersion ?? 0,
          baseHash: msg.baseHash ?? null,
          baseValue: msg.baseValue ?? null,
          clientWriteId: msg.clientWriteId ?? '',
          pageAge: msg.pageAge ?? 0,
          hadInteraction: msg.hadInteraction ?? false,
          timestamp: msg.timestamp ?? Date.now(),
        };

        const result = await handleSharedWrite(
          syncDb as unknown as Parameters<typeof handleSharedWrite>[0],
          sharedMsg,
          instanceId,
          effectiveAppId,
          userId
        );

        respond({
          success: result.success,
          newVersion: result.newVersion,
          newValue: result.newValue,
        }, result.error ?? undefined);
        return;
      }

      // ── localStorage fire-and-forget ──────────────────────────────────────
      // These come from the localStorage shim and carry no `id`.
      // We write to SQLite but send no response.

      case 'ls_set': {
        if (isShared && instanceId) {
          // Shared apps use vaultShimSync → ls_set_sync. If ls_set fires for a
          // shared app it means the wrong shim was loaded — skip to avoid
          // bypassing the merge engine.
          console.warn('[bridge] ls_set received for shared app — expected ls_set_sync');
          break;
        }
        const { data: { session: lsSession } } = await supabase.auth.getSession();
        await syncDb.execute(
          `INSERT OR REPLACE INTO app_data (id, user_id, app_id, key, value, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [`${effectiveAppId}/${msg.key!}`, lsSession?.user?.id ?? null, effectiveAppId, msg.key!, msg.value!]
        );
        break;
      }

      case 'ls_delete':
        if (isShared && instanceId) {
          await syncDb.execute(
            `DELETE FROM shared_app_data WHERE instance_id = ? AND app_id = ? AND key = ?`,
            [instanceId, effectiveAppId, msg.key!]
          );
        } else {
          await syncDb.execute(
            `DELETE FROM app_data WHERE app_id = ? AND key = ?`,
            [effectiveAppId, msg.key!]
          );
        }
        break;

      case 'ls_clear':
        if (isShared && instanceId) {
          await syncDb.execute(
            `DELETE FROM shared_app_data WHERE instance_id = ? AND app_id = ?`,
            [instanceId, effectiveAppId]
          );
        } else {
          await syncDb.execute(`DELETE FROM app_data WHERE app_id = ?`, [effectiveAppId]);
        }
        break;

      // ── VaultAPI.db ───────────────────────────────────────────────────────
      // These come from window.VaultAPI.db.* and carry an `id` for the response.

      case 'db_set': {
        const { data: { session: dbSession } } = await supabase.auth.getSession();
        if (isShared && instanceId) {
          // Route shared VaultAPI.db.set through the merge handler so writes
          // get proper version tracking and merge metadata.
          const dbUserId = dbSession?.user?.id ?? '';
          const sharedDbMsg: SharedWriteMessage = {
            key: msg.key!,
            value: msg.value!,
            baseVersion: 0,
            baseHash: null,
            baseValue: null,
            clientWriteId: `db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            pageAge: 10000,
            hadInteraction: true,
            timestamp: Date.now(),
          };
          const dbResult = await handleSharedWrite(
            syncDb as unknown as Parameters<typeof handleSharedWrite>[0],
            sharedDbMsg,
            instanceId,
            effectiveAppId,
            dbUserId
          );
          respond(dbResult.success, dbResult.error ?? undefined);
        } else {
          await syncDb.execute(
            `INSERT OR REPLACE INTO app_data (id, user_id, app_id, key, value, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [`${effectiveAppId}/${msg.key!}`, dbSession?.user?.id ?? null, effectiveAppId, msg.key!, msg.value!]
          );
          respond(true);
        }
        break;
      }

      case 'db_get': {
        const row = isShared && instanceId
          ? await syncDb.getOptional<{ value: string }>(
              `SELECT value FROM shared_app_data WHERE instance_id = ? AND app_id = ? AND key = ?`,
              [instanceId, effectiveAppId, msg.key!]
            )
          : await syncDb.getOptional<{ value: string }>(
              `SELECT value FROM app_data WHERE app_id = ? AND key = ?`,
              [effectiveAppId, msg.key!]
            );
        respond(row?.value ?? null);
        break;
      }

      case 'db_delete':
        if (isShared && instanceId) {
          await syncDb.execute(
            `DELETE FROM shared_app_data WHERE instance_id = ? AND app_id = ? AND key = ?`,
            [instanceId, effectiveAppId, msg.key!]
          );
        } else {
          await syncDb.execute(
            `DELETE FROM app_data WHERE app_id = ? AND key = ?`,
            [effectiveAppId, msg.key!]
          );
        }
        respond(true);
        break;

      case 'db_get_all': {
        const rows = isShared && instanceId
          ? await syncDb.getAll<{ key: string; value: string }>(
              `SELECT key, value FROM shared_app_data WHERE instance_id = ? AND app_id = ?`,
              [instanceId, effectiveAppId]
            )
          : await syncDb.getAll<{ key: string; value: string }>(
              `SELECT key, value FROM app_data WHERE app_id = ?`,
              [effectiveAppId]
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
