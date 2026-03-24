/**
 * lib/__tests__/vaultBridge.test.ts
 *
 * Tests for handleVaultMessage routing in vaultBridge.ts.
 * All native modules are mocked so the suite runs in Node.
 */

// ── Module mocks (must precede imports) ───────────────────────────────────────
// IMPORTANT: jest.mock() factories are hoisted before variable declarations.
// Never reference outer `const`/`let` variables inside factory functions.

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native', () => ({
  Share: { share: jest.fn().mockResolvedValue(undefined) },
}));

// Inline mocks — avoid hoisting issues with outer variables
jest.mock('@/services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-123', email: 'test@example.com' } } },
      }),
    },
  },
}));

jest.mock('@/services/sync/bridge-merge-handler', () => ({
  handleSharedWrite: jest.fn().mockResolvedValue({
    success: true,
    newVersion: 2,
    newValue: 'merged',
    error: null,
  }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { handleVaultMessage } from '@/lib/vaultBridge';
import type { AppManifest } from '@/lib/vaultBridge';
import { handleSharedWrite } from '@/services/sync/bridge-merge-handler';

// Typed references to the mocked supabase functions
const getSupabaseGetSession = () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('@/services/supabase').supabase.auth.getSession as jest.Mock);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  return {
    runAsync: jest.fn().mockResolvedValue(undefined),
    getFirstAsync: jest.fn().mockResolvedValue(null),
  } as unknown as Parameters<typeof handleVaultMessage>[1];
}

function makeSyncDb(overrides?: object) {
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    getOptional: jest.fn().mockResolvedValue(null),
    getAll: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as Parameters<typeof handleVaultMessage>[2];
}

function makeWebViewRef() {
  return { current: { injectJavaScript: jest.fn() } } as unknown as Parameters<typeof handleVaultMessage>[3];
}

function makeManifest(overrides?: Partial<AppManifest>): AppManifest {
  return {
    app_id: 'app-abc',
    name: 'Test App',
    source_url: 'https://example.com',
    installed_at: '2025-01-01',
    open_count: 1,
    instance_id: null,
    ...overrides,
  };
}

/** Fire a message and return handles for asserting on the results. */
function send(type: string, extra: object = {}, manifest?: AppManifest) {
  const db = makeDb();
  const syncDb = makeSyncDb();
  const wvRef = makeWebViewRef();
  const msg = JSON.stringify({ type, id: 'req-1', appId: 'app-abc', ...extra });
  const result = handleVaultMessage(msg, db, syncDb, wvRef, manifest ?? makeManifest());
  const inject = () =>
    ((wvRef.current?.injectJavaScript as jest.Mock).mock.calls[0]?.[0] as string) ?? '';
  return { db, syncDb, wvRef, result, inject };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleVaultMessage — silently ignores non-JSON', () => {
  test('does not throw on plain text', async () => {
    const wvRef = makeWebViewRef();
    await expect(
      handleVaultMessage('not json', makeDb(), makeSyncDb(), wvRef, makeManifest())
    ).resolves.toBeUndefined();
    expect(wvRef.current?.injectJavaScript as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('auth_get_user', () => {
  test('responds with user id + email when signed in', async () => {
    const { result, inject } = send('auth_get_user');
    await result;
    const js = inject();
    expect(js).toContain('user-123');
    expect(js).toContain('test@example.com');
  });

  test('responds null when no session', async () => {
    getSupabaseGetSession().mockResolvedValueOnce({ data: { session: null } });
    const { result, inject } = send('auth_get_user');
    await result;
    expect(inject()).toContain('"result":null');
  });
});

describe('app_get_info', () => {
  test('responds with the manifest', async () => {
    const manifest = makeManifest({ name: 'My Test App' });
    const db = makeDb();
    const syncDb = makeSyncDb();
    const wvRef = makeWebViewRef();
    await handleVaultMessage(
      JSON.stringify({ type: 'app_get_info', id: 'x' }),
      db, syncDb, wvRef, manifest
    );
    const js = (wvRef.current?.injectJavaScript as jest.Mock).mock.calls[0]?.[0] as string;
    expect(js).toContain('My Test App');
  });
});

describe('ls_set — personal app', () => {
  test('inserts a row into app_data', async () => {
    const { syncDb, result } = send('ls_set', { key: 'counter', value: '42' });
    await result;
    expect(syncDb.execute as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO app_data'),
      expect.arrayContaining(['counter', '42'])
    );
  });
});

describe('ls_delete', () => {
  test('deletes key from app_data for personal app', async () => {
    const { syncDb, result } = send('ls_delete', { key: 'counter' });
    await result;
    expect(syncDb.execute as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM app_data'),
      expect.arrayContaining(['counter'])
    );
  });

  test('deletes from shared_app_data when instance_id present', async () => {
    const manifest = makeManifest({ instance_id: 'inst-1' });
    const db = makeDb();
    const syncDb = makeSyncDb();
    const wvRef = makeWebViewRef();
    await handleVaultMessage(
      JSON.stringify({ type: 'ls_delete', key: 'counter' }),
      db, syncDb, wvRef, manifest
    );
    expect(syncDb.execute as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM shared_app_data'),
      expect.arrayContaining(['inst-1', 'counter'])
    );
  });
});

describe('ls_clear', () => {
  test('deletes all app_data for personal app', async () => {
    const { syncDb, result } = send('ls_clear');
    await result;
    expect(syncDb.execute as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM app_data'),
      expect.arrayContaining(['app-abc'])
    );
  });
});

describe('db_get', () => {
  test('responds with the stored value', async () => {
    const syncDb = makeSyncDb({
      getOptional: jest.fn().mockResolvedValue({ value: 'hello' }),
    });
    const wvRef = makeWebViewRef();
    await handleVaultMessage(
      JSON.stringify({ type: 'db_get', id: 'x', key: 'greeting' }),
      makeDb(), syncDb, wvRef, makeManifest()
    );
    const js = (wvRef.current?.injectJavaScript as jest.Mock).mock.calls[0]?.[0] as string;
    expect(js).toContain('"hello"');
  });

  test('responds null when key does not exist', async () => {
    const { result, inject } = send('db_get', { key: 'missing' });
    await result;
    expect(inject()).toContain('"result":null');
  });
});

describe('db_delete', () => {
  test('deletes the key and responds true', async () => {
    const { syncDb, result, inject } = send('db_delete', { key: 'x' });
    await result;
    expect(syncDb.execute as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM app_data'),
      expect.arrayContaining(['x'])
    );
    expect(inject()).toContain('"result":true');
  });
});

describe('db_get_all', () => {
  test('responds with key-value map', async () => {
    const syncDb = makeSyncDb({
      getAll: jest.fn().mockResolvedValue([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ]),
    });
    const wvRef = makeWebViewRef();
    await handleVaultMessage(
      JSON.stringify({ type: 'db_get_all', id: 'x' }),
      makeDb(), syncDb, wvRef, makeManifest()
    );
    const js = (wvRef.current?.injectJavaScript as jest.Mock).mock.calls[0]?.[0] as string;
    expect(js).toContain('"a":"1"');
    expect(js).toContain('"b":"2"');
  });
});

describe('ls_set_sync — shared app', () => {
  beforeEach(() => {
    (handleSharedWrite as jest.Mock).mockClear();
  });

  test('calls handleSharedWrite with correct params', async () => {
    const manifest = makeManifest({ instance_id: 'inst-1' });
    const db = makeDb();
    const syncDb = makeSyncDb();
    const wvRef = makeWebViewRef();

    await handleVaultMessage(
      JSON.stringify({
        type: 'ls_set_sync',
        id: 'req-sync',
        key: 'score',
        value: '100',
        baseVersion: 1,
        clientWriteId: 'wid-abc',
      }),
      db, syncDb, wvRef, manifest
    );

    expect(handleSharedWrite).toHaveBeenCalledWith(
      syncDb,
      expect.objectContaining({ key: 'score', value: '100', clientWriteId: 'wid-abc' }),
      'inst-1',
      'app-abc',
      'user-123'
    );

    const js = (wvRef.current?.injectJavaScript as jest.Mock).mock.calls[0]?.[0] as string;
    expect(js).toContain('"success":true');
    expect(js).toContain('"newVersion":2');
  });

  test('responds with error when no instance_id', async () => {
    const { result, inject } = send('ls_set_sync', { key: 'x', value: 'y' });
    await result;
    expect(inject()).toContain('"error"');
  });
});

describe('device_haptic', () => {
  test('calls impactAsync for medium style', async () => {
    const Haptics = require('expo-haptics');
    const { result } = send('device_haptic', { style: 'medium' });
    await result;
    expect(Haptics.impactAsync).toHaveBeenCalled();
  });

  test('calls notificationAsync for success style', async () => {
    const Haptics = require('expo-haptics');
    const { result } = send('device_haptic', { style: 'success' });
    await result;
    expect(Haptics.notificationAsync).toHaveBeenCalled();
  });
});

describe('unknown message type', () => {
  test('is silently ignored (no error thrown)', async () => {
    const wvRef = makeWebViewRef();
    await expect(
      handleVaultMessage(
        JSON.stringify({ type: 'unknown_xyz', id: 'x' }),
        makeDb(), makeSyncDb(), wvRef, makeManifest()
      )
    ).resolves.toBeUndefined();
  });
});
