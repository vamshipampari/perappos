/**
 * services/sync/bridge-merge-handler.ts
 *
 * Processes shared db_set / ls_set writes from the vault shim.
 * Ties together classification, guards, and merge.
 *
 * IMPORTANT: This writes to PowerSync's DB (powersync.db), NOT expo-sqlite.
 * PowerSync uses its own SQLite instance and tracks all writes for sync.
 *
 * Your existing vaultBridge.ts already routes ls_set to shared_app_data
 * when the app has an instance_id. This module replaces the direct write
 * with a merge-aware write for that shared path.
 *
 * Usage in lib/vaultBridge.ts:
 *
 *   import { handleSharedWrite } from '@/services/sync/bridge-merge-handler';
 *
 *   // Inside your existing ls_set / db_set handler, when instance_id exists:
 *   const result = await handleSharedWrite(powerSyncDb, message, instanceId, appId, userId);
 *   // Send ack back to WebView with result
 */

import { classifyShape, shapesCompatible } from './shape-classifier';
import { mergeArraysById, mergeObjectFields } from './three-way-merge';
import { deepEqual, quickHash } from './merge-utils';

// ─── Types ───────────────────────────────────────────────────────────

/**
 * PowerSync DB interface — matches the methods available on
 * the PowerSync database instance from @powersync/react-native.
 * Using a minimal interface so we don't import the full package here.
 */
export interface PowerSyncDB {
  execute: (sql: string, params?: any[]) => Promise<{ rows: { _array: any[] } }>;
  getAll: (sql: string, params?: any[]) => Promise<any[]>;
  get: (sql: string, params?: any[]) => Promise<any | null>;
}

/** What the shim sends on every shared write */
export interface SharedWriteMessage {
  key: string;
  value: string;                   // the JSON string from localStorage.setItem
  baseVersion: number;             // version this device last read
  baseHash: string | null;         // hash of base value (quick no-op check)
  baseValue: string | null;        // full base value (only when <32KB)
  clientWriteId: string;           // unique ID for idempotency
  pageAge: number;                 // ms since WebView loaded
  hadInteraction: boolean;         // whether user has tapped/typed
  timestamp: number;               // client Date.now()
}

/** Result sent back to the shim */
export interface SharedWriteResult {
  success: boolean;
  newVersion: number;
  newValue: string | null;         // non-null if merge modified the value
  strategy: MergeStrategy;
  conflictCount: number;
  error?: string;
}

export type MergeStrategy =
  | 'noop'
  | 'init_blocked'
  | 'fast_path'
  | 'array_merge'
  | 'object_merge'
  | 'lww'
  | 'idempotent_skip';

/** Row from shared_app_data in PowerSync */
interface SharedRow {
  id: string;
  instance_id: string;
  app_id: string;
  key: string;
  value: string;
  version: number;
  updated_by: string;
  updated_at: string;
  last_write_id: string | null;
}

// ─── Telemetry ───────────────────────────────────────────────────────

export interface MergeTelemetryEvent {
  strategy: MergeStrategy;
  conflictCount: number;
  conflictTypes: string[];
  blobSizeBytes: number;
  mergeTimeMs: number;
  keyName: string;
  appId: string;
  instanceId: string;
}

const telemetryBuffer: MergeTelemetryEvent[] = [];

export function getTelemetryBuffer(): MergeTelemetryEvent[] {
  return [...telemetryBuffer];
}

export function flushTelemetry(): MergeTelemetryEvent[] {
  return telemetryBuffer.splice(0);
}

// ─── In-memory version cache ─────────────────────────────────────────
// Survives PowerSync's post-upload local clear (which empties shared_app_data
// between transaction.complete() and the sync service re-delivering the row).
// Key: `${instanceId}/${appId}/${key}` → last confirmed written version.
const _versionCache = new Map<string, number>();

// ─── Main Handler ────────────────────────────────────────────────────

/**
 * Process a write to shared_app_data with 3-way merge support.
 *
 * Call this from vaultBridge.ts instead of the direct PowerSync write
 * when the app has an instance_id (shared/collaborative mode).
 *
 * @param psDb         PowerSync database instance
 * @param message      The write message from the shim (with base tracking metadata)
 * @param instanceId   The shared instance ID (e.g., "shared_abc123")
 * @param appId        The app ID
 * @param userId       The current user's Supabase auth ID
 */
export async function handleSharedWrite(
  psDb: PowerSyncDB,
  message: SharedWriteMessage,
  instanceId: string,
  appId: string,
  userId: string
): Promise<SharedWriteResult> {
  const startTime = Date.now();
  let strategy: MergeStrategy = 'lww';
  let conflictCount = 0;
  let conflictTypes: string[] = [];

  try {
    // ── Guard 1: No-op suppression ──
    if (message.baseHash && quickHash(message.value) === message.baseHash) {
      if (!message.baseValue || message.value === message.baseValue) {
        const currentRow = await readCurrentRow(psDb, instanceId, appId, message.key);
        logTelemetry('noop', 0, [], message, appId, instanceId, startTime);
        return {
          success: true,
          newVersion: currentRow?.version ?? 0,
          newValue: null,
          strategy: 'noop',
          conflictCount: 0,
        };
      }
    }

    // ── Read current DB state ──
    const currentRow = await readCurrentRow(psDb, instanceId, appId, message.key);
    const cacheKey = `${instanceId}/${appId}/${message.key}`;
    const cachedVersion = _versionCache.get(cacheKey) ?? 0;
    console.log('[merge] readCurrentRow:', JSON.stringify({
      key: message.key,
      instanceId,
      appId,
      found: !!currentRow,
      dbVersion: currentRow?.version ?? null,
      cachedVersion,
      baseVersion: message.baseVersion,
    }));

    // ── Guard: Idempotency ──
    if (currentRow && currentRow.last_write_id === message.clientWriteId) {
      logTelemetry('idempotent_skip', 0, [], message, appId, instanceId, startTime);
      return {
        success: true,
        newVersion: currentRow.version,
        newValue: null,
        strategy: 'idempotent_skip',
        conflictCount: 0,
      };
    }

    // ── Guard 2: Initialization clobber protection ──
    if (currentRow && isSuspiciousInit(message, currentRow)) {
      logTelemetry('init_blocked', 0, [], message, appId, instanceId, startTime);
      return {
        success: true,
        newVersion: currentRow.version,
        newValue: currentRow.value, // send real DB value back so shim refreshes
        strategy: 'init_blocked',
        conflictCount: 0,
      };
    }

    // ── Fast path: no conflict ──
    if (!currentRow || message.baseVersion >= currentRow.version) {
      // Use the highest known version across DB, in-memory cache, and shim's baseVersion.
      // This prevents reusing a version Supabase already has when the local row was
      // cleared by PowerSync after upload.
      const newVersion = Math.max(currentRow?.version ?? 0, cachedVersion, message.baseVersion) + 1;
      await writeRow(psDb, instanceId, appId, message.key, message.value, newVersion, userId, message.clientWriteId, 'fast_path', 0);
      _versionCache.set(cacheKey, newVersion);
      logTelemetry('fast_path', 0, [], message, appId, instanceId, startTime);
      return {
        success: true,
        newVersion,
        newValue: null,
        strategy: 'fast_path',
        conflictCount: 0,
      };
    }

    // ── Conflict: someone else wrote since our last read ──

    // Shape compatibility check (guards against app-update schema changes)
    if (!shapesCompatible(message.value, currentRow.value)) {
      const newVersion = Math.max(currentRow.version, cachedVersion) + 1;
      await writeRow(psDb, instanceId, appId, message.key, message.value, newVersion, userId, message.clientWriteId, 'lww', 0);
      _versionCache.set(cacheKey, newVersion);
      logTelemetry('lww', 0, ['schema_mismatch'], message, appId, instanceId, startTime);
      return { success: true, newVersion, newValue: null, strategy: 'lww', conflictCount: 0 };
    }

    // Classify shape
    const shape = classifyShape(message.value);

    // Low confidence → LWW
    if (shape.confidence < 0.8) {
      const newVersion = Math.max(currentRow.version, cachedVersion) + 1;
      await writeRow(psDb, instanceId, appId, message.key, message.value, newVersion, userId, message.clientWriteId, 'lww', 0);
      _versionCache.set(cacheKey, newVersion);
      logTelemetry('lww', 0, ['low_confidence'], message, appId, instanceId, startTime);
      return { success: true, newVersion, newValue: null, strategy: 'lww', conflictCount: 0 };
    }

    // Need base value for 3-way merge
    const baseValue = message.baseValue;
    if (baseValue === null) {
      const newVersion = Math.max(currentRow.version, cachedVersion) + 1;
      await writeRow(psDb, instanceId, appId, message.key, message.value, newVersion, userId, message.clientWriteId, 'lww', 0);
      _versionCache.set(cacheKey, newVersion);
      logTelemetry('lww', 0, ['no_base_value'], message, appId, instanceId, startTime);
      return { success: true, newVersion, newValue: null, strategy: 'lww', conflictCount: 0 };
    }

    // ── Run merge ──
    let mergedValue: string;

    try {
      if (shape.type === 'array_with_ids') {
        const baseParsed = JSON.parse(baseValue);
        const incomingParsed = JSON.parse(message.value);
        const currentParsed = JSON.parse(currentRow.value);

        const result = mergeArraysById(baseParsed, incomingParsed, currentParsed, shape.idField);
        mergedValue = JSON.stringify(result.merged);
        conflictCount = result.conflicts.length;
        conflictTypes = result.conflicts.map((c) => c.type);
        strategy = 'array_merge';
      } else if (shape.type === 'plain_object') {
        const baseParsed = JSON.parse(baseValue);
        const incomingParsed = JSON.parse(message.value);
        const currentParsed = JSON.parse(currentRow.value);

        const result = mergeObjectFields(baseParsed, incomingParsed, currentParsed);
        mergedValue = JSON.stringify(result.value);
        conflictCount = result.conflicts.length;
        conflictTypes = result.conflicts.map((f) => `field:${f}`);
        strategy = 'object_merge';
      } else {
        mergedValue = message.value;
        strategy = 'lww';
      }
    } catch {
      // JSON parse or merge failed — fall back to LWW
      mergedValue = message.value;
      strategy = 'lww';
    }

    const newVersion = Math.max(currentRow.version, cachedVersion) + 1;
    await writeRow(psDb, instanceId, appId, message.key, mergedValue, newVersion, userId, message.clientWriteId, strategy, conflictCount);
    _versionCache.set(cacheKey, newVersion);
    logTelemetry(strategy, conflictCount, conflictTypes, message, appId, instanceId, startTime);

    return {
      success: true,
      newVersion,
      newValue: mergedValue !== message.value ? mergedValue : null,
      strategy,
      conflictCount,
    };
  } catch (error) {
    console.error('[merge] Error in handleSharedWrite:', error);
    logTelemetry('lww', 0, ['error'], message, appId, instanceId, startTime);
    return {
      success: false,
      newVersion: 0,
      newValue: null,
      strategy: 'lww',
      conflictCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─── Initialization Clobber Guard ────────────────────────────────────

function isSuspiciousInit(message: SharedWriteMessage, dbRow: SharedRow): boolean {
  if (dbRow.version === 0) return false;
  if (message.pageAge > 3000) return false;
  if (message.hadInteraction) return false;
  if (message.baseVersion >= dbRow.version) return false;

  try {
    const incoming = JSON.parse(message.value);
    const current = JSON.parse(dbRow.value);

    if (Array.isArray(incoming) && Array.isArray(current)) {
      return incoming.length < current.length * 0.5;
    }

    if (
      incoming !== null && current !== null &&
      typeof incoming === 'object' && typeof current === 'object' &&
      !Array.isArray(incoming) && !Array.isArray(current)
    ) {
      return Object.keys(incoming).length < Object.keys(current).length * 0.5;
    }
  } catch {}

  return false;
}

// ─── PowerSync DB Helpers ────────────────────────────────────────────

/**
 * PowerSync shared_app_data uses a composite ID: `${instanceId}/${appId}/${key}`
 * This matches your existing pattern where app_data uses `${appId}/${key}`.
 */
function makeRowId(instanceId: string, appId: string, key: string): string {
  return `${instanceId}/${appId}/${key}`;
}

async function readCurrentRow(
  psDb: PowerSyncDB,
  instanceId: string,
  appId: string,
  key: string
): Promise<SharedRow | null> {
  try {
    const rows = await psDb.getAll(
      `SELECT id, instance_id, app_id, key, value,
              COALESCE(version, 0) as version,
              updated_by, updated_at, last_write_id
       FROM shared_app_data
       WHERE instance_id = ? AND app_id = ? AND key = ?
       ORDER BY version DESC
       LIMIT 1`,
      [instanceId, appId, key]
    );
    // Debug: also check total rows for this instance to detect if table is empty
    const allRows = await psDb.getAll(
      `SELECT key, COALESCE(version, 0) as version FROM shared_app_data WHERE instance_id = ?`,
      [instanceId]
    );
    console.log('[merge] readCurrentRow query params:', { instanceId, appId, key });
    console.log('[merge] readCurrentRow result rows:', rows.length, 'all instance rows:', JSON.stringify(allRows));
    return rows.length > 0 ? (rows[0] as SharedRow) : null;
  } catch (error) {
    console.warn('[merge] readCurrentRow failed:', error);
    return null;
  }
}

async function writeRow(
  psDb: PowerSyncDB,
  instanceId: string,
  appId: string,
  key: string,
  value: string,
  version: number,
  userId: string,
  clientWriteId: string,
  mergeStrategy: string,
  conflictCount: number
): Promise<void> {
  const rowId = makeRowId(instanceId, appId, key);
  const now = new Date().toISOString();

  // Use PowerSync's execute — this gets tracked in the CRUD queue
  // and uploaded to Supabase via SupabaseConnector.uploadData()
  await psDb.execute(
    `INSERT OR REPLACE INTO shared_app_data 
       (id, instance_id, app_id, key, value, version, 
        updated_by, updated_at, last_write_id,
        last_merge_strategy, last_conflict_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rowId,
      instanceId,
      appId,
      key,
      value,
      version,
      userId,
      now,
      clientWriteId,
      mergeStrategy,
      conflictCount,
    ]
  );
}

// ─── Telemetry ───────────────────────────────────────────────────────

function logTelemetry(
  strategy: MergeStrategy,
  conflictCount: number,
  conflictTypes: string[],
  message: SharedWriteMessage,
  appId: string,
  instanceId: string,
  startTime: number
): void {
  telemetryBuffer.push({
    strategy,
    conflictCount,
    conflictTypes,
    blobSizeBytes: message.value.length,
    mergeTimeMs: Date.now() - startTime,
    keyName: message.key,
    appId,
    instanceId,
  });

  if (telemetryBuffer.length > 500) {
    telemetryBuffer.splice(0, 250);
  }
}
