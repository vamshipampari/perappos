import '../global.css';

import * as Linking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, TouchableOpacity, View } from 'react-native';

import { ToastProvider } from '@/components/Toast';
import { cleanupExpiredUpdateBackups } from '@/lib/appUpdates';
import { seedDemoApps } from '@/utils/createDemoApp';
import { PowerSyncProvider } from '../services/sync/PowerSyncProvider';
import { supabase } from '../services/supabase';

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

    CREATE TABLE IF NOT EXISTS app_updates (
      update_id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      previous_hash TEXT,
      backup_path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      reverted_at TEXT
    );
  `);

  // Add bundle_html column if it doesn't exist yet (migration for existing DBs).
  try {
    await db.execAsync('ALTER TABLE apps ADD COLUMN bundle_html TEXT');
  } catch {
    // Column already exists — safe to ignore.
  }

  await seedDemoApps(db);
  await cleanupExpiredUpdateBackups(db);
};

// ── App Lock Gate ─────────────────────────────────────────────────────────────
// Reads the 'app_lock' setting from shared_data. When enabled, listens for
// the app returning to the foreground and requires biometric authentication.

function AppLockGate({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [lockEnabled, setLockEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  const authenticate = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Perappos',
      fallbackLabel: 'Use passcode',
    });
    if (result.success) setLocked(false);
  }, []);

  // Read lock preference on mount; lock immediately if enabled
  useEffect(() => {
    (async () => {
      try {
        const row = await db.getFirstAsync<{ value: string }>(
          `SELECT value FROM shared_data WHERE category='settings' AND key='app_lock'`
        );
        const enabled = row?.value === 'true';
        setLockEnabled(enabled);
        if (enabled) {
          setLocked(true);
          authenticate();
        }
      } catch {
        // non-critical — defaults (unlocked) are safe
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock whenever the app returns to the foreground
  useEffect(() => {
    if (!lockEnabled) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        setLocked(true);
        authenticate();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [lockEnabled, authenticate]);

  if (locked) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Text style={{ fontSize: 64 }}>🔒</Text>
        <Text style={{ fontSize: 20, fontWeight: '600', color: '#1C1C1E' }}>Perappos is locked</Text>
        <Text style={{ fontSize: 15, color: '#8E8E93' }}>Authenticate to continue</Text>
        <TouchableOpacity
          onPress={authenticate}
          style={{ marginTop: 8, backgroundColor: '#007AFF', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10 }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const router = useRouter();
  const [isDeepLinkReady, setIsDeepLinkReady] = useState(false);

  useEffect(() => {
    if (isDeepLinkReady) {
      SplashScreen.hideAsync();
    }
  }, [isDeepLinkReady]);

  useEffect(() => {
    let isMounted = true;

    const handleAuthCallback = async (url: string) => {
      try {
        if (!url.includes('auth/callback')) return;
        const [base, hash = ''] = url.split('#');
        const query = base.includes('?') ? base.split('?')[1] : '';

        const hashParams = new URLSearchParams(hash);
        const queryParams = new URLSearchParams(query);

        const accessToken =
          hashParams.get('access_token') ?? queryParams.get('access_token');
        const refreshToken =
          hashParams.get('refresh_token') ?? queryParams.get('refresh_token');

        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          router.replace('/(tabs)/settings');
          return;
        }

        const authCode = queryParams.get('code') ?? hashParams.get('code');
        if (authCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(authCode);
          if (!error) {
            router.replace('/(tabs)/settings');
          } else {
            console.error('Auth code exchange error:', error);
          }
        }
      } catch (error) {
        console.error('Auth callback error:', error);
      }
    };

    let sub: ReturnType<typeof Linking.addEventListener> | null = null;

    const initializeDeepLinkHandling = async () => {
      try {
        sub = Linking.addEventListener('url', (event) => {
          void handleAuthCallback(event.url);
        });

        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          await handleAuthCallback(initialUrl);
        }
      } catch (error) {
        console.error('Deep link setup error:', error);
      } finally {
        if (isMounted) {
          setIsDeepLinkReady(true);
        }
      }
    };

    void initializeDeepLinkHandling();

    return () => {
      isMounted = false;
      sub?.remove();
    };
  }, [router]);

  if (!isDeepLinkReady) {
    return null;
  }

  return (
    <Suspense
      fallback={
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      }
    >
      <SQLiteProvider databaseName={DB_NAME} onInit={initializeDatabase} useSuspense>
        <PowerSyncProvider>
          <ToastProvider>
            <AppLockGate>
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="auth"
                  options={{
                    presentation: 'modal',
                    headerShown: false,
                  }}
                />
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
                    presentation: 'card',
                    gestureEnabled: true,
                    animation: 'slide_from_right',
                  }}
                />
              </Stack>
            </AppLockGate>
          </ToastProvider>
        </PowerSyncProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
