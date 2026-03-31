/**
 * Centralized type definitions for Cottix.
 *
 * Types that are shared across multiple files live here to avoid
 * circular imports and keep definitions in one place.
 */

// ── App types ────────────────────────────────────────────────────────────────

/** Row shape from the local `apps` SQLite table. */
export interface InstalledApp {
  app_id: string;
  name: string;
  icon_emoji: string;
  icon_bg_color: string;
  bundle_path: string;
  source_type: string;
  source_url: string | null;
  bundle_html: string | null;
  bundle_hash: string | null;
  auto_update: number;
  permissions: string;
  bundle_size: number;
  installed_at: string;
  updated_at: string;
  last_opened: string | null;
  open_count: number;
  instance_id: string | null;
  folder_id: string | null;
}

/** Row shape from the local `folders` SQLite table. */
export interface Folder {
  folder_id: string;
  parent_folder_id: string | null;
  name: string;
  icon_emoji: string;
  created_at: string;
  order_index: number;
}

/** Subset of InstalledApp passed to the WebView bridge as context. */
export interface AppManifest {
  app_id: string;
  name: string;
  source_url: string | null;
  installed_at: string;
  open_count: number;
  instance_id: string | null;
}

// ── Bridge types ─────────────────────────────────────────────────────────────

/** Raw JSON message received from the WebView shim via postMessage. */
export interface RawMessage {
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
  uri?: string;      // storage path returned by storage_upload / passed to storage_get_url
  text?: string;     // plain-text content for device_share
  message?: string;
  delay_seconds?: number;
  name?: string;     // secret name for secrets_* messages
  method?: string;   // HTTP method for secrets_fetch
  headers?: Record<string, string>; // HTTP headers for secrets_fetch
  source?: string;   // picker source for storage_upload ('gallery' | 'files')
  [k: string]: unknown;
}

// ── Screen types ─────────────────────────────────────────────────────────────

/** Loading phase for the WebView app runner screen. */
export type Phase = 'loading' | 'ready' | 'not_found';

// ── Re-exports ───────────────────────────────────────────────────────────────

export type { SharedWriteMessage } from '@/services/sync/bridge-merge-handler';
