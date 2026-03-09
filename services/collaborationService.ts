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

const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)];
  }
  return out;
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

async function generateUniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 12; i += 1) {
    const code = randomCode(6);
    const { data, error } = await supabase
      .from('shared_instances')
      .select('instance_id')
      .eq('invite_code', code)
      .maybeSingle();

    if (error) throw error;
    if (!data) return code;
  }

  return randomCode(8);
}

export async function createSharedInstanceForApp(
  db: SQLiteDatabase,
  syncDb: AbstractPowerSyncDatabase,
  app: InstalledApp
): Promise<{ instanceId: string; inviteCode: string; created: boolean }> {
  const userId = await getRequiredUserId();

  const existingLocal = await syncDb.getOptional<{ instance_id: string; invite_code: string }>(
    `SELECT instance_id, invite_code
     FROM shared_instances
     WHERE app_id = ? AND owner_id = ?`,
    [app.app_id, userId]
  );

  if (existingLocal?.instance_id && existingLocal?.invite_code) {
    await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
      existingLocal.instance_id,
      app.app_id,
    ]);
    return {
      instanceId: existingLocal.instance_id,
      inviteCode: existingLocal.invite_code,
      created: false,
    };
  }

  const { data: existingRemote, error: existingRemoteError } = await supabase
    .from('shared_instances')
    .select('instance_id, invite_code')
    .eq('app_id', app.app_id)
    .eq('owner_id', userId)
    .maybeSingle();

  if (existingRemoteError) throw existingRemoteError;

  if (existingRemote?.instance_id && existingRemote?.invite_code) {
    await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
      existingRemote.instance_id,
      app.app_id,
    ]);
    return {
      instanceId: existingRemote.instance_id,
      inviteCode: existingRemote.invite_code,
      created: false,
    };
  }

  const instanceId = `shared-${Crypto.randomUUID()}`;
  const inviteCode = await generateUniqueInviteCode();

  const { error: createError } = await supabase.from('shared_instances').insert({
    instance_id: instanceId,
    app_id: app.app_id,
    app_name: app.name,
    app_source_url: app.source_url,
    owner_id: userId,
    invite_code: inviteCode,
  });

  if (createError) throw createError;

  const { error: ownerMemberError } = await supabase.from('instance_members').upsert(
    {
      instance_id: instanceId,
      user_id: userId,
      role: 'owner',
    },
    { onConflict: 'instance_id,user_id' }
  );

  if (ownerMemberError) throw ownerMemberError;

  const personalRows = await syncDb.getAll<{ key: string; value: string; updated_at: string | null }>(
    'SELECT key, value, updated_at FROM app_data WHERE app_id = ?',
    [app.app_id]
  );

  for (const row of personalRows) {
    const { error } = await supabase.from('shared_app_data').upsert(
      {
        id: `${instanceId}/${app.app_id}/${row.key}`,
        instance_id: instanceId,
        app_id: app.app_id,
        key: row.key,
        value: row.value,
        updated_by: userId,
        updated_at: row.updated_at ?? new Date().toISOString(),
      },
      { onConflict: 'instance_id,app_id,key' }
    );
    if (error) throw error;
  }

  await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [instanceId, app.app_id]);

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
  code: string
): Promise<{ appId: string; instance: SharedInstance; alreadyMember: boolean }> {
  const userId = await getRequiredUserId();
  const normalizedCode = code.trim().toUpperCase();

  if (normalizedCode.length < 6) {
    throw new Error('Please enter a valid 6-character invite code.');
  }

  const { data: instance, error: lookupError } = await supabase
    .from('shared_instances')
    .select('*')
    .eq('invite_code', normalizedCode)
    .single();

  if (lookupError || !instance) {
    throw new Error('Invalid invite code. Check and try again.');
  }

  const { data: existingMember, error: existingMemberError } = await supabase
    .from('instance_members')
    .select('instance_id')
    .eq('instance_id', instance.instance_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMemberError) throw existingMemberError;

  if (!existingMember) {
    const { error: addMemberError } = await supabase.from('instance_members').insert({
      instance_id: instance.instance_id,
      user_id: userId,
      role: 'member',
    });

    if (addMemberError && !String(addMemberError.message).toLowerCase().includes('duplicate')) {
      throw addMemberError;
    }
  }

  const installedApp = await db.getFirstAsync<Pick<InstalledApp, 'app_id'>>(
    'SELECT app_id FROM apps WHERE app_id = ?',
    instance.app_id
  );

  let appId = installedApp?.app_id ?? null;

  if (!appId) {
    if (!instance.app_source_url) {
      throw new Error('This shared app has no source URL and cannot be auto-installed.');
    }

    appId = await installUrlApp(db, {
      appId: instance.app_id,
      name: instance.app_name,
      iconEmoji: '📱',
      iconBgColor: '#DBEAFE',
      url: instance.app_source_url,
    });
  }

  await db.runAsync('UPDATE apps SET instance_id = ? WHERE app_id = ?', [
    instance.instance_id,
    instance.app_id,
  ]);

  return {
    appId,
    instance: instance as SharedInstance,
    alreadyMember: !!existingMember,
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

  const { error } = await supabase
    .from('shared_instances')
    .delete()
    .eq('instance_id', instanceId)
    .eq('owner_id', userId);

  if (error) throw error;

  await db.runAsync('UPDATE apps SET instance_id = NULL WHERE app_id = ?', appId);
}
