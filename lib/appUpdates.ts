import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { InstalledApp } from '@/hooks/useInstalledApps';

const UPDATE_TIMEOUT_MS = 10_000;

type UpdateCheckResult = { available: false } | { available: true; newHash: string };

interface BackupPayload {
  appId: string;
  sourceType: string;
  sourceUrl: string | null;
  bundlePath: string;
  bundleHtml: string | null;
  bundleHash: string | null;
  bundleSize: number;
  capturedAt: string;
}

function normalizeBundlePath(bundlePath: string): string {
  return bundlePath.replace(/^file:\/\//, '').replace(/\/$/, '');
}

function getAppDir(appId: string): string {
  return `${FileSystem.documentDirectory}apps/${appId}/`;
}

function getUpdateBackupDir(): string {
  return `${FileSystem.documentDirectory}updates/`;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourceHtml(url: string, timeoutMs = UPDATE_TIMEOUT_MS): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, timeoutMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error';
    throw new Error(msg.toLowerCase().includes('abort') ? 'Update check timed out' : msg);
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch app source: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export async function hashHtml(html: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, html);
}

export async function checkForUpdates(app: InstalledApp): Promise<UpdateCheckResult> {
  if (app.source_type !== 'url' || !app.source_url) {
    return { available: false };
  }

  const html = await fetchSourceHtml(app.source_url, UPDATE_TIMEOUT_MS);
  const newHash = await hashHtml(html);
  if (app.bundle_hash && app.bundle_hash === newHash) {
    return { available: false };
  }

  if (!app.bundle_hash) {
    return { available: true, newHash };
  }

  return { available: app.bundle_hash !== newHash, newHash };
}

async function captureCurrentBundleHtml(app: InstalledApp): Promise<string | null> {
  if (app.bundle_html) return app.bundle_html;
  if (!app.bundle_path) return null;

  const normalized = normalizeBundlePath(app.bundle_path);
  if (!normalized) return null;

  const htmlPath = normalized.toLowerCase().endsWith('.html')
    ? normalized
    : `${normalized}/index.html`;
  try {
    return await FileSystem.readAsStringAsync(htmlPath, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    return null;
  }
}

async function createUpdateBackup(db: SQLiteDatabase, app: InstalledApp): Promise<void> {
  const backupHtml = await captureCurrentBundleHtml(app);
  const payload: BackupPayload = {
    appId: app.app_id,
    sourceType: app.source_type,
    sourceUrl: app.source_url,
    bundlePath: app.bundle_path,
    bundleHtml: backupHtml,
    bundleHash: app.bundle_hash,
    bundleSize: app.bundle_size,
    capturedAt: new Date().toISOString(),
  };

  await FileSystem.makeDirectoryAsync(getUpdateBackupDir(), { intermediates: true });
  const backupFilePath = `${getUpdateBackupDir()}${app.app_id}-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(backupFilePath, JSON.stringify(payload), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  await db.runAsync(
    `INSERT INTO app_updates
       (update_id, app_id, previous_hash, backup_path, created_at, expires_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'))`,
    Crypto.randomUUID(),
    app.app_id,
    app.bundle_hash ?? null,
    backupFilePath
  );
}

export async function applyUrlAppUpdate(
  db: SQLiteDatabase,
  app: InstalledApp,
  expectedHash?: string
): Promise<{ updated: boolean; newHash?: string }> {
  if (app.source_type !== 'url' || !app.source_url) return { updated: false };

  const html = await fetchSourceHtml(app.source_url, UPDATE_TIMEOUT_MS);
  const newHash = expectedHash ?? (await hashHtml(html));
  if (app.bundle_hash && app.bundle_hash === newHash) {
    return { updated: false, newHash };
  }

  await createUpdateBackup(db, app);

  const appDir = getAppDir(app.app_id);
  await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });
  const indexPath = `${appDir}index.html`;
  await FileSystem.writeAsStringAsync(indexPath, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const bundlePath = appDir.replace(/^file:\/\//, '').replace(/\/$/, '');
  await db.runAsync(
    `UPDATE apps
       SET bundle_path = ?, bundle_html = ?, bundle_hash = ?, bundle_size = ?, updated_at = datetime('now')
     WHERE app_id = ?`,
    bundlePath,
    html,
    newHash,
    html.length,
    app.app_id
  );

  return { updated: true, newHash };
}

export async function getLatestBackup(
  db: SQLiteDatabase,
  appId: string
): Promise<{ update_id: string; backup_path: string } | null> {
  return db.getFirstAsync<{ update_id: string; backup_path: string }>(
    `SELECT update_id, backup_path
       FROM app_updates
      WHERE app_id = ? AND reverted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    appId
  );
}

export async function revertToPreviousVersion(
  db: SQLiteDatabase,
  appId: string
): Promise<boolean> {
  const latest = await getLatestBackup(db, appId);
  if (!latest) return false;

  let parsed: BackupPayload;
  try {
    const raw = await FileSystem.readAsStringAsync(latest.backup_path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    parsed = JSON.parse(raw) as BackupPayload;
  } catch {
    return false;
  }

  const fallbackPath = getAppDir(appId).replace(/^file:\/\//, '').replace(/\/$/, '');
  const restoredBundlePath = parsed.bundlePath || fallbackPath;
  const restoredHtml = parsed.bundleHtml ?? '';

  if (restoredHtml) {
    const normalized = normalizeBundlePath(restoredBundlePath);
    const restoredDir = normalized.toLowerCase().endsWith('.html')
      ? normalized.slice(0, Math.max(0, normalized.lastIndexOf('/')))
      : normalized;
    if (restoredDir) {
      await FileSystem.makeDirectoryAsync(restoredDir, { intermediates: true });
    }
    const indexPath = normalized.toLowerCase().endsWith('.html')
      ? normalized
      : `${normalized}/index.html`;
    await FileSystem.writeAsStringAsync(indexPath, restoredHtml, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  }

  await db.runAsync(
    `UPDATE apps
       SET bundle_path = ?, bundle_html = ?, bundle_hash = ?, bundle_size = ?, updated_at = datetime('now')
     WHERE app_id = ?`,
    restoredBundlePath,
    parsed.bundleHtml,
    parsed.bundleHash,
    parsed.bundleSize,
    appId
  );

  await db.runAsync(
    `UPDATE app_updates SET reverted_at = datetime('now') WHERE update_id = ?`,
    latest.update_id
  );
  return true;
}

export async function cleanupExpiredUpdateBackups(db: SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ update_id: string; backup_path: string }>(
    `SELECT update_id, backup_path
       FROM app_updates
      WHERE expires_at < datetime('now')`
  );

  for (const row of rows) {
    try {
      await FileSystem.deleteAsync(row.backup_path, { idempotent: true });
    } catch {
      // Ignore file delete failures.
    }
  }

  await db.runAsync(`DELETE FROM app_updates WHERE expires_at < datetime('now')`);
}
