/**
 * services/mediaService.ts
 *
 * Upload media files to Supabase Storage and resolve stable cottix-media:// URIs
 * to time-limited signed HTTPS URLs.
 *
 * Bucket layout:
 *   user-media     — personal app files. Path: {userId}/{appId}/{filename}
 *   instance-media — shared app files.  Path: {instanceId}/{appId}/{filename}
 *
 * The `cottix-media://` URI scheme is a stable, non-expiring reference stored
 * in app_data / shared_app_data. Other devices call getSignedUrl() to resolve
 * it to a fresh HTTPS URL (1 hour expiry) for display.
 *
 * Note: Supabase Storage bucket + RLS policies must be created manually in the
 * Supabase dashboard before this service will function. See TECHNICAL.md.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/services/supabase';

// ── URI helpers ───────────────────────────────────────────────────────────────

const SCHEME = 'cottix-media://';

function buildMediaUri(bucket: string, path: string): string {
  return `${SCHEME}${bucket}/${path}`;
}

function parseMediaUri(uri: string): { bucket: string; path: string } | null {
  if (!uri.startsWith(SCHEME)) return null;
  const rest = uri.slice(SCHEME.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return null;
  return {
    bucket: rest.slice(0, slashIdx),
    path: rest.slice(slashIdx + 1),
  };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
  };
  return map[mimeType] ?? 'bin';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upload a local file URI to Supabase Storage.
 *
 * @param appId      The mini-app's ID (namespaces the file within the folder)
 * @param userId     The authenticated user's ID
 * @param instanceId Set for shared apps → uses instance-media bucket
 * @param fileUri    Local file URI from expo-image-picker (file:// or content://)
 * @param mimeType   e.g. "image/jpeg"
 * @returns          A stable `cottix-media://` URI to store and share
 */
export async function uploadMedia(
  appId: string,
  userId: string,
  instanceId: string | null,
  fileUri: string,
  mimeType: string
): Promise<string> {
  const ext = extFromMimeType(mimeType);
  const filename = `${Date.now()}-${randomSuffix()}.${ext}`;

  const bucket = instanceId ? 'instance-media' : 'user-media';
  const folder = instanceId ? `${instanceId}/${appId}` : `${userId}/${appId}`;
  const storagePath = `${folder}/${filename}`;

  // Read file as base64, convert to Uint8Array for upload
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Media upload failed: ${error.message}`);

  return buildMediaUri(bucket, storagePath);
}

/**
 * Resolve a `cottix-media://` URI to a time-limited signed HTTPS URL (1 hour).
 *
 * @param mediaUri   A URI previously returned by uploadMedia()
 * @returns          A signed HTTPS URL valid for ~1 hour
 */
export async function getSignedUrl(mediaUri: string): Promise<string> {
  const parsed = parseMediaUri(mediaUri);
  if (!parsed) throw new Error(`Invalid cottix-media URI: ${mediaUri}`);

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, 3600);

  if (error || !data?.signedUrl) {
    throw new Error(`Could not create signed URL: ${error?.message ?? 'unknown'}`);
  }

  return data.signedUrl;
}
