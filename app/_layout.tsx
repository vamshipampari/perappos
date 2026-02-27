import '../global.css';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { seedDemoApps } from '@/utils/createDemoApp';

SplashScreen.preventAutoHideAsync();

const DB_NAME = 'perappos.db';

const initializeDatabase = async (db: import('expo-sqlite').SQLiteDatabase) => {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS apps (
      app_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_emoji TEXT DEFAULT '📱',
      icon_bg_color TEXT DEFAULT '#E5E7EB',
      bundle_path TEXT NOT NULL,
      source_type TEXT DEFAULT 'url',
      source_url TEXT,
      bundle_hash TEXT,
      auto_update INTEGER DEFAULT 1,
      permissions TEXT DEFAULT '[]',
      bundle_size INTEGER DEFAULT 0,
      installed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_opened TEXT,
      open_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_data (
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0,
      PRIMARY KEY (app_id, key)
    );

    CREATE TABLE IF NOT EXISTS shared_data (
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source_app TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (category, key)
    );
  `);

  // Add bundle_html column if it doesn't exist yet (migration for existing DBs).
  try {
    await db.execAsync('ALTER TABLE apps ADD COLUMN bundle_html TEXT');
  } catch {
    // Column already exists — safe to ignore.
  }

  await seedDemoApps(db);
};

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <Suspense
      fallback={
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      }
    >
      <SQLiteProvider databaseName={DB_NAME} onInit={initializeDatabase} useSuspense>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="add"
            options={{
              presentation: 'modal',
              title: 'Add App',
              headerShown: true,
              headerStyle: { backgroundColor: '#FFFFFF' },
              headerTitleStyle: { color: '#1C1C1E', fontWeight: '600' },
              headerTintColor: '#007AFF',
            }}
          />
          <Stack.Screen
            name="app/[id]"
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
            }}
          />
        </Stack>
      </SQLiteProvider>
    </Suspense>
  );
}
