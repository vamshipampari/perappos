/**
 * services/secretsService.ts
 *
 * Thin wrapper around expo-secure-store for per-app secret storage.
 *
 * Key format:   cottix.{appId}.{name}
 * Index key:    cottix.{appId}.__index__  (JSON array of secret names)
 *
 * The actual secret values live in the device secure enclave (Keychain on iOS,
 * Keystore on Android). The index is stored in SecureStore too, so the entire
 * secrets surface stays off disk and out of SQLite.
 *
 * Key length limit: SecureStore keys max out at 2048 bytes on iOS. The prefix
 * `cottix.` (7) + appId (≤36 UUID chars) + `.` (1) + name leaves ~2004 bytes
 * for the name, which is more than enough in practice.
 */

import * as SecureStore from 'expo-secure-store';

// ── Key builders ──────────────────────────────────────────────────────────────

function secretKey(appId: string, name: string): string {
  return `cottix.${appId}.${name}`;
}

function indexKey(appId: string): string {
  return `cottix.${appId}.__index__`;
}

// ── Index helpers ─────────────────────────────────────────────────────────────

async function readIndex(appId: string): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(indexKey(appId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(appId: string, names: string[]): Promise<void> {
  await SecureStore.setItemAsync(indexKey(appId), JSON.stringify(names));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Store a secret value in the secure enclave. Adds name to the index. */
export async function setSecret(appId: string, name: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(secretKey(appId, name), value);
  const names = await readIndex(appId);
  if (!names.includes(name)) {
    names.push(name);
    await writeIndex(appId, names);
  }
}

/** Retrieve a secret value. Returns null if not found. */
export async function getSecret(appId: string, name: string): Promise<string | null> {
  return SecureStore.getItemAsync(secretKey(appId, name));
}

/** Delete a single secret and remove it from the index. */
export async function deleteSecret(appId: string, name: string): Promise<void> {
  await SecureStore.deleteItemAsync(secretKey(appId, name));
  const names = await readIndex(appId);
  const updated = names.filter((n) => n !== name);
  await writeIndex(appId, updated);
}

/** List all secret names for an app (values are never exposed). */
export async function listSecretNames(appId: string): Promise<string[]> {
  return readIndex(appId);
}

/**
 * Delete all secrets for an app. Called during app deletion.
 * Iterates the index, removes each key from SecureStore, then removes the index.
 */
export async function deleteAllSecrets(appId: string): Promise<void> {
  const names = await readIndex(appId);
  await Promise.all(names.map((name) => SecureStore.deleteItemAsync(secretKey(appId, name))));
  await SecureStore.deleteItemAsync(indexKey(appId));
}
