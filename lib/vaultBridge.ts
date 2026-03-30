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

// Lazy-load native modules to avoid crashing the bridge at import time
// if any native module isn't linked (e.g. Expo Go, stale dev-client build).
function lazyModule<T>(loader: () => Promise<T>): () => Promise<T> {
  let cached: T | null = null;
  return async () => (cached ??= await loader());
}
const getHaptics = lazyModule(() => import('expo-haptics'));
const getNotifications = lazyModule(() => import('expo-notifications'));
const getSharing = lazyModule(() => import('expo-sharing'));
const getSecureStore = lazyModule(() => import('expo-secure-store'));
const getImagePicker = lazyModule(() => import('expo-image-picker'));
const getFileSystem = lazyModule(() => import('expo-file-system'));
// Type-only imports for namespace types used in type annotations.
import type * as HapticsTypes from 'expo-haptics';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { RefObject } from 'react';
import { Share } from 'react-native';
import type WebView from 'react-native-webview';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { handleSharedWrite } from '@/services/sync/bridge-merge-handler';
import type { SharedWriteMessage } from '@/services/sync/bridge-merge-handler';
import { supabase } from '../services/supabase';
import type { AppManifest, RawMessage } from '@/types';

/** Supabase Storage bucket used for mini-app user file uploads. */
const STORAGE_BUCKET = 'user-media';

export type { AppManifest };

type WebViewRef = RefObject<WebView | null>;

// ── Module-level user identity cache ─────────────────────────────────────────
// Avoids calling getSession() on every shared write (async latency).
// Refreshed on every auth state change. Attribution is best-effort — never
// blocks a write if the cache hasn't populated yet.

interface BridgeUser {
  userId: string;
  displayName: string;
}

let _bridgeUser: BridgeUser | null = null;

function _extractDisplayName(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): string {
  return (
    (user.user_metadata?.name as string) ||
    (user.user_metadata?.full_name as string) ||
    user.email?.split('@')[0] ||
    ''
  );
}

// Warm up the cache immediately on module import; keep it fresh on auth changes.
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session?.user) {
    _bridgeUser = { userId: session.user.id, displayName: _extractDisplayName(session.user) };
  }
});
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    _bridgeUser = { userId: session.user.id, displayName: _extractDisplayName(session.user) };
  } else {
    _bridgeUser = null;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? '';
}

/** Returns the cached user identity. Falls back to getSession() if cache is cold. */
async function getBridgeUser(): Promise<BridgeUser> {
  if (_bridgeUser) return _bridgeUser;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    _bridgeUser = { userId: session.user.id, displayName: _extractDisplayName(session.user) };
    return _bridgeUser;
  }
  return { userId: '', displayName: '' };
}

function buildSharedWriteMessage(
  msg: RawMessage,
  prefix: string
): SharedWriteMessage {
  return {
    key: msg.key!,
    value: msg.value!,
    baseVersion: msg.baseVersion ?? 0,
    baseHash: msg.baseHash ?? null,
    baseValue: msg.baseValue ?? null,
    clientWriteId: msg.clientWriteId ?? `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pageAge: msg.pageAge ?? 0,
    hadInteraction: msg.hadInteraction ?? false,
    timestamp: msg.timestamp ?? Date.now(),
  };
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

        const { userId, displayName } = await getBridgeUser();
        const sharedMsg = buildSharedWriteMessage(msg, 'ls_set_sync');

        const result = await handleSharedWrite(
          syncDb as unknown as Parameters<typeof handleSharedWrite>[0],
          sharedMsg,
          instanceId,
          effectiveAppId,
          userId,
          displayName
        );

        // If the instance is frozen, inject a notification into the WebView
        // so the native layer can show the frozen banner.
        if (!result.success && result.error === 'INSTANCE_FROZEN') {
          webViewRef.current?.injectJavaScript(`
            (function() {
              window.__vaultInstanceFrozen = true;
              window.dispatchEvent(new CustomEvent('vaultInstanceFrozen', {
                detail: { message: "This shared app is currently read-only because the owner's plan has expired." }
              }));
            })();
            true;
          `);
        }

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
          // Fallback: if the sync shim didn't load (race condition during
          // WebView reload after creating a shared instance), route through
          // the merge handler so the write is never silently lost.
          const { userId: lsSharedUserId, displayName: lsSharedDisplayName } = await getBridgeUser();
          const lsSharedMsg: SharedWriteMessage = {
            key: msg.key!,
            value: msg.value!,
            baseVersion: 0,
            baseHash: null,
            baseValue: null,
            clientWriteId: `ls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            pageAge: 10000,
            hadInteraction: true,
            timestamp: Date.now(),
          };
          await handleSharedWrite(
            syncDb as unknown as Parameters<typeof handleSharedWrite>[0],
            lsSharedMsg,
            instanceId,
            effectiveAppId,
            lsSharedUserId,
            lsSharedDisplayName
          );
          break;
        }
        const lsUserId = await getUserId();
        await syncDb.execute(
          `INSERT OR REPLACE INTO app_data (id, user_id, app_id, key, value, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [`${effectiveAppId}/${msg.key!}`, lsUserId || null, effectiveAppId, msg.key!, msg.value!]
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
        const { userId: dbUserId, displayName: dbDisplayName } = await getBridgeUser();
        if (isShared && instanceId) {
          // Route shared VaultAPI.db.set through the merge handler so writes
          // get proper version tracking and merge metadata.
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
            dbUserId,
            dbDisplayName
          );
          respond(dbResult.success, dbResult.error ?? undefined);
        } else {
          await syncDb.execute(
            `INSERT OR REPLACE INTO app_data (id, user_id, app_id, key, value, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [`${effectiveAppId}/${msg.key!}`, dbUserId || null, effectiveAppId, msg.key!, msg.value!]
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
        const Haptics = await getHaptics();
        const style = msg.style ?? 'medium';
        if (style === 'success' || style === 'warning' || style === 'error') {
          const notifType: Record<string, HapticsTypes.NotificationFeedbackType> = {
            success: Haptics.NotificationFeedbackType.Success,
            warning: Haptics.NotificationFeedbackType.Warning,
            error: Haptics.NotificationFeedbackType.Error,
          };
          await Haptics.notificationAsync(notifType[style]);
        } else {
          const impactType: Record<string, HapticsTypes.ImpactFeedbackStyle> = {
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
        const Notifications = await getNotifications();
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
          const Sharing = await getSharing();
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

      // ── VaultAPI.secrets ──────────────────────────────────────────────────
      // Secrets are stored in expo-secure-store, namespaced to this app.
      // The secret value never leaves the native layer — only the bridge
      // substitutes it into outgoing HTTP requests.

      case 'secrets_set': {
        const secretName = msg.name;
        const secretValue = msg.value;
        if (!secretName || typeof secretValue !== 'string') {
          respond(false, 'secrets_set requires a name and value');
          break;
        }
        const ss = await getSecureStore();
        await ss.setItemAsync(
          `vault_secret__global__${secretName}`,
          secretValue
        );
        // Track the secret name in SQLite so Settings can list stored keys.
        await db.runAsync(
          `INSERT OR REPLACE INTO shared_data (category, key, value, source_app, updated_at)
           VALUES ('vault_secrets', ?, ?, ?, datetime('now'))`,
          secretName,
          'stored',
          effectiveAppId
        );
        respond(true);
        break;
      }

      case 'secrets_fetch': {
        const sfName = msg.name;
        const sfUrl = msg.url;
        const sfMethod = msg.method ?? 'POST';
        const sfHeaders = (msg.headers ?? {}) as Record<string, string>;
        const sfBody = (msg.body ?? null) as string | null;

        if (!sfName || !sfUrl) {
          respond(null, 'secrets_fetch requires name and url');
          break;
        }

        const ss2 = await getSecureStore();
        const secretValue = await ss2.getItemAsync(
          `vault_secret__global__${sfName}`
        );
        if (!secretValue) {
          // Return a structured error so the mini-app can prompt the user.
          respond({ error: 'secret_not_found' });
          break;
        }

        // Substitute {{secret}} placeholder in every header value.
        const resolvedHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(sfHeaders)) {
          resolvedHeaders[k] = typeof v === 'string' ? v.replace('{{secret}}', secretValue) : v;
        }

        const fetchInit: RequestInit = { method: sfMethod, headers: resolvedHeaders };
        if (sfBody !== null && sfMethod !== 'GET' && sfMethod !== 'HEAD') {
          fetchInit.body = sfBody;
        }

        const httpRes = await fetch(sfUrl, fetchInit);
        const responseBody = await httpRes.text();
        respond({ status: httpRes.status, body: responseBody });
        break;
      }

      // ── VaultAPI.storage ──────────────────────────────────────────────────
      // Images are uploaded to Supabase Storage so the WebView never holds
      // raw binary data. The mini-app works with opaque storage paths only.

      case 'storage_upload': {
        // Request photo library permission (no-op on Android; required on iOS).
        const ImagePicker = await getImagePicker();
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          respond(null, 'Photo library permission denied');
          break;
        }

        const pickerResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          allowsEditing: false,
        });

        if (pickerResult.canceled || !pickerResult.assets?.[0]) {
          respond({ cancelled: true });
          break;
        }

        const asset = pickerResult.assets[0];
        const uploadUserId = await getUserId();

        // Derive file extension from URI or fallback to jpeg.
        const uriParts = asset.uri.split('.');
        const ext = (uriParts.length > 1 ? uriParts[uriParts.length - 1] : 'jpg')
          .toLowerCase()
          .split('?')[0]; // strip query strings on Android URIs
        const storagePath = `${effectiveAppId}/${uploadUserId || 'anon'}/${Date.now()}.${ext}`;

        // Read as base64 via expo-file-system (reliable in RN native context),
        // then convert to Uint8Array — the only upload format supabase-js handles
        // correctly in React Native (fetch().blob() is unreliable here).
        const FileSystem = await getFileSystem();
        const base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: 'base64' as const,
        });
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, bytes, {
            contentType: asset.mimeType ?? 'image/jpeg',
            upsert: false,
          });

        if (uploadError) {
          respond(null, uploadError.message);
          break;
        }

        respond({ uri: storagePath, cancelled: false });
        break;
      }

      case 'storage_get_url': {
        const storageUri = msg.uri;
        if (!storageUri) {
          respond(null, 'storage_get_url requires a uri');
          break;
        }

        const { data: urlData, error: urlError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(storageUri, 3600); // 1-hour signed URL

        if (urlError ?? !urlData) {
          respond(null, urlError?.message ?? 'Failed to create signed URL');
          break;
        }

        respond({ url: urlData.signedUrl });
        break;
      }

      // ── VaultAPI.collaboration (attribution queries) ───────────────────────
      // Returns attribution metadata for shared app data.
      // Responds with null for personal apps (no instanceId).

      case 'collab_get_attribution': {
        if (!isShared || !instanceId || !msg.key) {
          respond(null);
          break;
        }
        const attrRow = await syncDb.getOptional<{
          last_editor_user_id: string | null;
          last_editor_display_name: string | null;
          updated_at: string | null;
          version: number | null;
        }>(
          `SELECT last_editor_user_id, last_editor_display_name, updated_at, version
           FROM shared_app_data
           WHERE instance_id = ? AND app_id = ? AND key = ?`,
          [instanceId, effectiveAppId, msg.key!]
        );
        if (!attrRow) {
          respond(null);
          break;
        }
        respond({
          userId: attrRow.last_editor_user_id ?? null,
          displayName: attrRow.last_editor_display_name ?? null,
          writtenAt: attrRow.updated_at ?? null,
          version: attrRow.version ?? 0,
        });
        break;
      }

      case 'collab_get_activity': {
        if (!isShared || !instanceId) {
          respond([]);
          break;
        }
        const activityLimit = typeof msg.limit === 'number' && msg.limit > 0
          ? Math.min(msg.limit, 100)
          : 20;

        // Prefer the history table (richer log); fall back to shared_app_data last-write info.
        type HistoryRow = {
          key: string;
          editor_user_id: string | null;
          editor_display_name: string | null;
          written_at: string | null;
          merge_strategy: string | null;
          version: number | null;
        };
        let historyRows: HistoryRow[] = [];
        try {
          historyRows = await syncDb.getAll<HistoryRow>(
            `SELECT key, editor_user_id, editor_display_name, written_at, merge_strategy, version
             FROM shared_app_data_history
             WHERE instance_id = ?
             ORDER BY written_at DESC
             LIMIT ?`,
            [instanceId, activityLimit]
          );
        } catch {
          // History table may not be synced yet — fall back gracefully.
        }

        if (historyRows.length > 0) {
          respond(historyRows.map((r) => ({
            key: r.key,
            userId: r.editor_user_id ?? null,
            displayName: r.editor_display_name ?? null,
            writtenAt: r.written_at ?? null,
            mergeStrategy: r.merge_strategy ?? null,
            version: r.version ?? 0,
          })));
          break;
        }

        // Fallback: recent last-write data from shared_app_data itself
        type DataRow = {
          key: string;
          last_editor_user_id: string | null;
          last_editor_display_name: string | null;
          updated_at: string | null;
          last_merge_strategy: string | null;
          version: number | null;
        };
        const dataRows = await syncDb.getAll<DataRow>(
          `SELECT key, last_editor_user_id, last_editor_display_name,
                  updated_at, last_merge_strategy, version
           FROM shared_app_data
           WHERE instance_id = ? AND app_id = ?
           ORDER BY updated_at DESC
           LIMIT ?`,
          [instanceId, effectiveAppId, activityLimit]
        );
        respond(dataRows.map((r) => ({
          key: r.key,
          userId: r.last_editor_user_id ?? null,
          displayName: r.last_editor_display_name ?? null,
          writtenAt: r.updated_at ?? null,
          mergeStrategy: r.last_merge_strategy ?? null,
          version: r.version ?? 0,
        })));
        break;
      }

      case 'collab_get_recent_activity': {
        if (!isShared || !instanceId) {
          respond([]);
          break;
        }
        const recentLimit = typeof msg.limit === 'number' && msg.limit > 0
          ? Math.min(msg.limit, 200)
          : 50;

        type RecentRow = {
          key: string;
          value: string;
          editor_user_id: string | null;
          editor_display_name: string | null;
          written_at: string | null;
          merge_strategy: string | null;
          version: number | null;
        };
        let recentRows: RecentRow[] = [];
        try {
          recentRows = await syncDb.getAll<RecentRow>(
            `SELECT key, value, editor_user_id, editor_display_name,
                    written_at, merge_strategy, version
             FROM shared_app_data_history
             WHERE instance_id = ? AND app_id = ?
             ORDER BY written_at DESC
             LIMIT ?`,
            [instanceId, effectiveAppId, recentLimit]
          );
        } catch {
          // History table not yet synced — return empty array
        }

        respond(recentRows.map((r) => ({
          key: r.key,
          value: r.value,
          userId: r.editor_user_id ?? null,
          displayName: r.editor_display_name ?? null,
          writtenAt: r.written_at ?? null,
          mergeStrategy: r.merge_strategy ?? null,
          version: r.version ?? 0,
        })));
        break;
      }

      default:
        // Unknown message types are silently ignored.
        break;
    }
  } catch (e) {
    respond(null, e instanceof Error ? e.message : String(e));
  }
}
