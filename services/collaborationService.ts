import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { InstalledApp } from '@/hooks/useInstalledApps';
import { installUrlApp } from './appInstaller';
import { supabase } from './supabase';

export interface SharedInstance {
  instance_id: string;
  app_id: string;
  app_name: string;
  app_source_url: string | null;
  owner_id: string;
  invite_code: string;
  created_at: string;
}

interface InstanceMember {
  instance_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
}

export interface GroupDetails {
  instance: SharedInstance;
  memberCount: number;
  myRole: 'owner' | 'member';
}

function randomCode(): string {
  // Keep generation explicitly uppercase to match join-side normalization.
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function safeErrorLogPayload(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify({
      ...error,
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function throwWithStage(stage: string, error: unknown): never {
  console.error('Create shared error:', safeErrorLogPayload(error));
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${stage}: ${message}`);
}

async function getRequiredUserId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    throw new Error('You must be signed in to use collaboration.');
  }

  return session.user.id;
}

// Use lookup_shared_instance RPC to check uniqueness — avoids direct table select (RLS).
async function generateUniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 12; i += 1) {
    const code = randomCode();
    const { data } = await supabase.rpc('lookup_shared_instance', { p_invite_code: code });
    const taken = Array.isArray(data) && data.length > 0;
    if (!taken) return code;
  }
  return randomCode();
}

// Use get_own_shared_instance RPC — bypasses RLS on shared_instances.
export async function getOwnedSharedInstance(appId: string): Promise<SharedInstance | null> {
  const userId = await getRequiredUserId();
  const { data, error } = await supabase.rpc('get_own_shared_instance', {
    p_app_id: appId,
    p_user_id: userId,
  });

  if (error) {
    console.error('getOwnedSharedInstance error:', safeErrorLogPayload(error));
    throw new Error(`Failed checking existing shared instance: ${error.message}`);
  }

  return (data as SharedInstance[] | null)?.[0] ?? null;
}

async function deleteSharedInstanceInOrder(instanceId: string): Promise<void> {
  const { error: memberDeleteError } = await supabase
    .from('instance_members')
    .delete()
    .eq('instance_id', instanceId);
  if (memberDeleteError) {
    throwWithStage('Failed deleting instance members', memberDeleteError);
  }

  const { error: sharedDataDeleteError } = await supabase
    .from('shared_app_data')
    .delete()
    .eq('instance_id', instanceId);
  if (sharedDataDeleteError) {
    throwWithStage('Failed deleting shared app data', sharedDataDeleteError);
  }

  const { error: instanceDeleteError } = await supabase
    .from('shared_instances')
    .delete()
    .eq('instance_id', instanceId);
  if (instanceDeleteError) {
    throwWithStage('Failed deleting shared instance', instanceDeleteError);
  }
}

export async function createSharedInstanceForApp(
  db: SQLiteDatabase,
  syncDb: AbstractPowerSyncDatabase,
  app: InstalledApp
): Promise<{ instanceId: string; inviteCode: string; created: boolean }> {
  const userId = await getRequiredUserId();

  // 1. Check PowerSync local cache first (fastest, no network).
  const existingLocal = await syncDb.getOptional<{ instance_id: string; invite_code: string }>(
    `SELECT instance_id, invite_code
     FROM shared_instances
     WHERE app_id = ? AND owner_id = ?`,
    [app.app_id, userId]
  );

  if (existingLocal?.instance_id && existingLocal?.invite_code) {
    try {
      await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
        existingLocal.instance_id,
        app.app_id,
      ]);
    } catch (error) {
      throwWithStage('Failed linking local app to existing shared instance', error);
    }
    return {
      instanceId: existingLocal.instance_id,
      inviteCode: existingLocal.invite_code.toUpperCase(),
      created: false,
    };
  }

  // 2. Check Supabase via RPC — avoids direct table select hitting RLS.
  const { data: existingRemoteData, error: existingRemoteError } = await supabase.rpc(
    'get_own_shared_instance',
    { p_app_id: app.app_id, p_user_id: userId }
  );

  if (existingRemoteError) {
    throwWithStage('Failed checking existing shared instance in Supabase', existingRemoteError);
  }

  const existingRemote = (existingRemoteData as SharedInstance[] | null)?.[0] ?? null;

  if (existingRemote?.instance_id && existingRemote?.invite_code) {
    try {
      await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
        existingRemote.instance_id,
        app.app_id,
      ]);
    } catch (error) {
      throwWithStage('Failed linking local app to existing remote shared instance', error);
    }
    return {
      instanceId: existingRemote.instance_id,
      inviteCode: existingRemote.invite_code.toUpperCase(),
      created: false,
    };
  }

  // 3. Create a new shared instance.
  const instanceId = `shared-${Crypto.randomUUID()}`;
  const inviteCode = await generateUniqueInviteCode();

  try {
    const { error: createError } = await supabase.from('shared_instances').insert({
      instance_id: instanceId,
      app_id: app.app_id,
      app_name: app.name,
      app_source_url: app.source_url,
      owner_id: userId,
      invite_code: inviteCode,
    });
    if (createError) throw createError;
  } catch (error) {
    throwWithStage('Failed creating shared instance row', error);
  }

  // 4. Add the owner as the first member via RPC — bypasses RLS on instance_members.
  try {
    const { error: ownerMemberError } = await supabase.rpc('add_instance_member', {
      p_instance_id: instanceId,
      p_user_id: userId,
      p_role: 'owner',
    });
    if (ownerMemberError) throw ownerMemberError;
  } catch (error) {
    // Roll back the parent row if member creation fails.
    try {
      await deleteSharedInstanceInOrder(instanceId);
    } catch (rollbackError) {
      console.error('Create shared rollback error:', safeErrorLogPayload(rollbackError));
    }
    throwWithStage('Failed adding owner as member', error);
  }

  // 5. Migrate personal app_data → shared_app_data via PowerSync local.
  // Writing to PowerSync local ensures data is immediately available for the
  // WebView shim AND gets synced to Supabase via the normal CRUD upload pipeline.
  const personalRows = await syncDb.getAll<{ key: string; value: string }>(
    'SELECT key, value FROM app_data WHERE app_id = ?',
    [app.app_id]
  );

  for (const row of personalRows) {
    await syncDb.execute(
      `INSERT OR REPLACE INTO shared_app_data
       (id, instance_id, app_id, key, value, version, updated_by, updated_at,
        last_write_id, last_merge_strategy, last_conflict_count)
       VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), ?, 'migration', 0)`,
      [
        `${instanceId}/${app.app_id}/${row.key}`,
        instanceId,
        app.app_id,
        row.key,
        row.value,
        userId,
        `migrate_${Date.now()}`,
      ]
    );
  }

  // 6. Link local app row to the new instance.
  try {
    await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [instanceId, app.app_id]);
  } catch (error) {
    throwWithStage('Failed updating local app instance_id', error);
  }

  return { instanceId, inviteCode, created: true };
}

export async function getSharedGroupDetails(
  syncDb: AbstractPowerSyncDatabase,
  instanceId: string
): Promise<GroupDetails | null> {
  const userId = await getRequiredUserId();

  const [instance, countRow, memberRow] = await Promise.all([
    syncDb.getOptional<SharedInstance>('SELECT * FROM shared_instances WHERE instance_id = ?', [
      instanceId,
    ]),
    syncDb.getOptional<{ n: number }>('SELECT COUNT(*) AS n FROM instance_members WHERE instance_id = ?', [
      instanceId,
    ]),
    syncDb.getOptional<Pick<InstanceMember, 'role'>>(
      'SELECT role FROM instance_members WHERE instance_id = ? AND user_id = ?',
      [instanceId, userId]
    ),
  ]);

  if (!instance || !memberRow?.role) return null;

  return {
    instance,
    memberCount: countRow?.n ?? 1,
    myRole: memberRow.role,
  };
}

export async function joinSharedAppByCode(
  db: SQLiteDatabase,
  code: string,
  onStateChange?: (state: string) => void
): Promise<{ appId: string; instance: SharedInstance; alreadyMember: boolean }> {
  const userId = await getRequiredUserId();
  const normalizedCode = code.trim().toUpperCase();
  onStateChange?.('lookup_shared_instance');

  if (normalizedCode.length < 6) {
    throw new Error('Please enter a valid 6-character invite code.');
  }

  // lookup_shared_instance RPC already in use — no direct table access needed.
  const { data, error: lookupError } = await supabase.rpc('lookup_shared_instance', {
    p_invite_code: normalizedCode,
  });
  console.log('Lookup result:', JSON.stringify(data), 'Error:', JSON.stringify(lookupError));
  const instance = (data as SharedInstance[] | null)?.[0] ?? null;

  if (lookupError || !instance) {
    throw new Error('Invalid invite code. Check and try again.');
  }
  onStateChange?.('add_instance_member');

  // Use add_instance_member RPC — bypasses RLS on instance_members.
  // The RPC is idempotent; if the user is already a member it either no-ops or
  // returns a duplicate-key error, which we treat as "already a member".
  const { data: memberAddData, error: addMemberError } = await supabase.rpc('add_instance_member', {
    p_instance_id: instance.instance_id,
    p_user_id: userId,
    p_role: 'member',
  });
  console.log(
    'Member add result:',
    JSON.stringify(memberAddData),
    'Error:',
    JSON.stringify(addMemberError)
  );

  const alreadyMember =
    !!addMemberError &&
    String(addMemberError.message).toLowerCase().includes('duplicate');

  if (addMemberError && !alreadyMember) {
    throw addMemberError;
  }

  onStateChange?.('check_local_install');

  const installedApp = await db.getFirstAsync<Pick<InstalledApp, 'app_id'>>(
    'SELECT app_id FROM apps WHERE app_id = ?',
    instance.app_id
  );

  let appId = installedApp?.app_id ?? null;

  if (!appId) {
    if (!instance.app_source_url) {
      throw new Error('This shared app has no source URL and cannot be auto-installed.');
    }

    onStateChange?.('install_app');
    appId = await installUrlApp(db, {
      appId: instance.app_id,
      name: instance.app_name,
      iconEmoji: '📱',
      iconBgColor: '#DBEAFE',
      url: instance.app_source_url,
    });
    console.log('App install result:', JSON.stringify({ appId, appSourceUrl: instance.app_source_url }));
  }

  onStateChange?.('link_local_instance');
  await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
    instance.instance_id,
    instance.app_id,
  ]);
  onStateChange?.('complete');

  return {
    appId,
    instance: instance as SharedInstance,
    alreadyMember,
  };
}

async function snapshotSharedDataToPersonal(
  syncDb: AbstractPowerSyncDatabase,
  appId: string,
  instanceId: string,
  userId: string
): Promise<void> {
  const sharedRows = await syncDb.getAll<{ key: string; value: string; updated_at: string | null }>(
    `SELECT key, value, updated_at
     FROM shared_app_data
     WHERE instance_id = ? AND app_id = ?`,
    [instanceId, appId]
  );

  for (const row of sharedRows) {
    await syncDb.execute(
      `INSERT OR REPLACE INTO app_data (id, user_id, app_id, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      [`${appId}/${row.key}`, userId, appId, row.key, row.value, row.updated_at]
    );
  }
}

export async function leaveSharedGroup(
  db: SQLiteDatabase,
  syncDb: AbstractPowerSyncDatabase,
  appId: string,
  instanceId: string
): Promise<void> {
  const userId = await getRequiredUserId();

  await snapshotSharedDataToPersonal(syncDb, appId, instanceId, userId);

  const { error } = await supabase
    .from('instance_members')
    .delete()
    .eq('instance_id', instanceId)
    .eq('user_id', userId);

  if (error) throw error;

  await db.runAsync('UPDATE apps SET instance_id = NULL WHERE app_id = ?', appId);
}

export async function stopSharingAsOwner(
  db: SQLiteDatabase,
  syncDb: AbstractPowerSyncDatabase,
  appId: string,
  instanceId: string
): Promise<void> {
  const userId = await getRequiredUserId();

  await snapshotSharedDataToPersonal(syncDb, appId, instanceId, userId);

  await deleteSharedInstanceInOrder(instanceId);

  await db.runAsync('UPDATE apps SET instance_id = NULL WHERE app_id = ?', appId);
}
