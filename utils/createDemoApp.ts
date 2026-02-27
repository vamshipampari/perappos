import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import {
  DAILY_HABITS_HTML,
  EXPENSE_SNAP_HTML,
  WORKOUT_LOG_HTML,
} from './demoAppsHtml';

const APPS_DIR = `${FileSystem.documentDirectory}apps/`;

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

  // Create directory
  await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });

  // Write HTML file
  const indexPath = `${appDir}index.html`;
  await FileSystem.writeAsStringAsync(indexPath, config.htmlContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // Get file size
  const fileInfo = await FileSystem.getInfoAsync(indexPath);
  const bundleSize = fileInfo.exists && 'size' in fileInfo ? fileInfo.size : 0;

  // Store directory path without file:// prefix and without trailing slash.
  // The viewer constructs: file://${bundle_path}/index.html
  const bundlePath = appDir.replace(/^file:\/\//, '').replace(/\/$/, '');

  // Register in database
  await db.runAsync(
    `INSERT INTO apps (app_id, name, icon_emoji, icon_bg_color, bundle_path, source_type, bundle_size, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'demo', ?, datetime('now'), datetime('now'))`,
    [appId, config.name, config.iconEmoji, config.iconBgColor, bundlePath, bundleSize]
  );

  return appId;
}

export async function seedDemoApps(db: SQLiteDatabase): Promise<void> {
  if (Platform.OS === 'web') return;

  // Check if any apps exist
  const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM apps');
  if (result && result.count > 0) {
    return; // Already have apps, don't re-seed
  }

  // Ensure apps directory exists
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

  console.log('[Perappos] Demo apps seeded successfully');
}
