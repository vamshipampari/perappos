import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { log } from '@/lib/logger';
import {
  DAILY_HABITS_HTML,
  EXPENSE_SNAP_HTML,
  WORKOUT_LOG_HTML,
} from './demoAppsHtml';

const APPS_DIR = `${FileSystem.documentDirectory}apps/`;

// Keyed by display name — used to backfill bundle_html on existing demo records.
const DEMO_HTML_BY_NAME: Record<string, string> = {
  'Workout Log': WORKOUT_LOG_HTML,
  'Daily Habits': DAILY_HABITS_HTML,
  'Expense Snap': EXPENSE_SNAP_HTML,
};

export interface DemoAppConfig {
  name: string;
  iconEmoji: string;
  iconBgColor: string;
  htmlContent: string;
}

export async function createDemoApp(
  db: SQLiteDatabase,
  config: DemoAppConfig
): Promise<string> {
  const appId = Crypto.randomUUID();
  const appDir = `${APPS_DIR}${appId}/`;

  // Write HTML to filesystem (kept as a cache; viewer reads from DB instead).
  await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });
  const indexPath = `${appDir}index.html`;
  await FileSystem.writeAsStringAsync(indexPath, config.htmlContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const fileInfo = await FileSystem.getInfoAsync(indexPath);
  const bundleSize = fileInfo.exists && 'size' in fileInfo ? fileInfo.size : 0;

  // Store directory path without file:// prefix and without trailing slash.
  const bundlePath = appDir.replace(/^file:\/\//, '').replace(/\/$/, '');

  // Store the HTML content in the DB so the viewer never depends on filesystem.
  await db.runAsync(
    `INSERT INTO apps
       (app_id, name, icon_emoji, icon_bg_color, bundle_path, bundle_html,
        source_type, bundle_size, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'demo', ?, datetime('now'), datetime('now'))`,
    [appId, config.name, config.iconEmoji, config.iconBgColor, bundlePath,
     config.htmlContent, bundleSize]
  );

  return appId;
}

export async function seedDemoApps(db: SQLiteDatabase): Promise<void> {
  if (Platform.OS === 'web') return;

  // Backfill bundle_html for any existing demo records that are missing it
  // (e.g. seeded before this column was added).
  const existing = await db.getAllAsync<{ app_id: string; name: string; bundle_html: string | null }>(
    "SELECT app_id, name, bundle_html FROM apps WHERE source_type IN ('demo', 'bundle')"
  );
  for (const row of existing) {
    if (row.bundle_html === null) {
      const html = DEMO_HTML_BY_NAME[row.name];
      if (html) {
        await db.runAsync('UPDATE apps SET bundle_html = ? WHERE app_id = ?', [html, row.app_id]);
      }
    }
  }

  // If the user explicitly cleared all data, don't re-seed demos.
  const skipFlag = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM shared_data WHERE category = 'settings' AND key = 'skip_demo_seed'"
  );
  if (skipFlag?.value === '1') return;

  // If we already have apps (even after backfill), don't re-seed.
  const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM apps');
  if (result && result.count > 0) return;

  // Fresh install — seed all 3 demo apps.
  await FileSystem.makeDirectoryAsync(APPS_DIR, { intermediates: true });

  await createDemoApp(db, {
    name: 'Workout Log',
    iconEmoji: '💪',
    iconBgColor: '#DBEAFE',
    htmlContent: WORKOUT_LOG_HTML,
  });

  await createDemoApp(db, {
    name: 'Daily Habits',
    iconEmoji: '✅',
    iconBgColor: '#D1FAE5',
    htmlContent: DAILY_HABITS_HTML,
  });

  await createDemoApp(db, {
    name: 'Expense Snap',
    iconEmoji: '💰',
    iconBgColor: '#FEF3C7',
    htmlContent: EXPENSE_SNAP_HTML,
  });

  log.info('[Cottix] Demo apps seeded successfully');
}
