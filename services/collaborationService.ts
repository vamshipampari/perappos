import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { log } from '@/lib/logger';
import type { InstalledApp } from '@/types';
import { installUrlApp } from './appInstaller';
import { supabase } from './supabase';
import { track } from './analytics';
import { posthog } from '../src/config/posthog';

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
  status: 'pending' | 'active' | 'rejected';
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
  log.error('Create shared error:', safeErrorLogPayload(error));
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${stage}: ${message}`);
}

async function getRequiredSession(): Promise<{ userId: string; email: string | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    throw new Error('You must be signed in to use collaboration.');
  }

  return { userId: session.user.id, email: session.user.email ?? null };
}

async function getRequiredUserId(): Promise<string> {
  return (await getRequiredSession()).userId;
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
    log.error('getOwnedSharedInstance error:', safeErrorLogPayload(error));
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
      log.error('Create shared rollback error:', safeErrorLogPayload(rollbackError));
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

  void track('share_created', { instance_id: instanceId });
  posthog.capture('share_created', { instance_id: instanceId });

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

export type JoinStatus = 'pending' | 'active' | 'already_active' | 'already_pending';

export async function joinSharedAppByCode(
  db: SQLiteDatabase,
  code: string,
  onStateChange?: (state: string) => void
): Promise<{ appId: string; instance: SharedInstance; status: JoinStatus }> {
  const { userId, email } = await getRequiredSession();
  const normalizedCode = code.trim().toUpperCase();
  onStateChange?.('lookup_shared_instance');

  if (normalizedCode.length < 6) {
    throw new Error('Please enter a valid 6-character invite code.');
  }

  const { data, error: lookupError } = await supabase.rpc('lookup_shared_instance', {
    p_invite_code: normalizedCode,
  });
  log.info('Lookup result:', JSON.stringify(data), 'Error:', JSON.stringify(lookupError));
  const instance = (data as SharedInstance[] | null)?.[0] ?? null;

  if (lookupError || !instance) {
    throw new Error('Invalid invite code. Check and try again.');
  }
  onStateChange?.('check_existing_membership');

  // Check if user is already a member (RLS is DISABLED on instance_members — direct query is safe).
  const { data: existingRows } = await supabase
    .from('instance_members')
    .select('status')
    .eq('instance_id', instance.instance_id)
    .eq('user_id', userId)
    .limit(1);

  const existingMember = (existingRows as Array<{ status: string }> | null)?.[0] ?? null;

  if (existingMember) {
    const currentStatus = existingMember.status as 'pending' | 'active' | 'rejected';

    if (currentStatus === 'active') {
      // Already approved — link local app and navigate.
      onStateChange?.('check_local_install');
      const installedApp = await db.getFirstAsync<Pick<InstalledApp, 'app_id'>>(
        'SELECT app_id FROM apps WHERE app_id = ?',
        instance.app_id
      );
      let appId = installedApp?.app_id ?? null;
      if (!appId && instance.app_source_url) {
        onStateChange?.('install_app');
        appId = await installUrlApp(db, {
          appId: instance.app_id,
          name: instance.app_name,
          iconEmoji: '📱',
          iconBgColor: '#DBEAFE',
          url: instance.app_source_url,
        });
      }
      onStateChange?.('link_local_instance');
      await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
        instance.instance_id,
        instance.app_id,
      ]);
      onStateChange?.('complete');
      return { appId: appId ?? instance.app_id, instance, status: 'already_active' };
    }

    if (currentStatus === 'pending') {
      return { appId: instance.app_id, instance, status: 'already_pending' };
    }

    // Rejected — allow re-joining by re-inserting as pending below.
    await supabase
      .from('instance_members')
      .delete()
      .eq('instance_id', instance.instance_id)
      .eq('user_id', userId);
  }

  onStateChange?.('add_instance_member');

  // Insert with status='pending'. RLS is DISABLED on instance_members so direct insert is safe.
  // Store email so the owner can display it in the pending requests panel.
  const memberId = Crypto.randomUUID();
  const { error: insertError } = await supabase.from('instance_members').insert({
    id: memberId,
    instance_id: instance.instance_id,
    user_id: userId,
    email,
    role: 'member',
    status: 'pending',
    joined_at: new Date().toISOString(),
  });
  log.info('Member insert (pending) error:', JSON.stringify(insertError));

  if (insertError) {
    const isDuplicate = String(insertError.message).toLowerCase().includes('duplicate');
    if (!isDuplicate) throw insertError;
    // Race-condition duplicate — treat as already pending.
    return { appId: instance.app_id, instance, status: 'already_pending' };
  }

  onStateChange?.('complete');
  return { appId: instance.app_id, instance, status: 'pending' };
}

/** Owner approves a pending join request. Updates Supabase + PowerSync local. */
export async function approveMember(
  syncDb: AbstractPowerSyncDatabase,
  instanceId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('instance_members')
    .update({ status: 'active' })
    .eq('instance_id', instanceId)
    .eq('user_id', userId);

  if (error) throw error;

  // Update PowerSync local so the UI reflects the change immediately.
  await syncDb.execute(
    `UPDATE instance_members SET status = 'active' WHERE instance_id = ? AND user_id = ?`,
    [instanceId, userId]
  );
}

/** Owner rejects a pending join request. Deletes from Supabase + PowerSync local. */
export async function rejectMember(
  syncDb: AbstractPowerSyncDatabase,
  instanceId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('instance_members')
    .delete()
    .eq('instance_id', instanceId)
    .eq('user_id', userId);

  if (error) throw error;

  await syncDb.execute(
    `DELETE FROM instance_members WHERE instance_id = ? AND user_id = ?`,
    [instanceId, userId]
  );
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

  // Decrement shared instance count (fire-and-forget)
  void supabase.rpc('increment_shared_instance_count', { delta: -1 }).then(undefined, () => {});
}
