/**
 * Share flow: create a shared_apps record in Supabase and open the native share sheet.
 *
 * - Reuses an existing active share link if one exists for this app/user pair.
 * - Generates a unique 8-char alphanumeric code when creating a new link.
 * - Only URL-based apps can be shared (source_url must be non-null).
 * - User must be signed in (owner_id is required by Supabase RLS).
 */

import { Share } from 'react-native';
import { supabase } from './supabase';
import type { InstalledApp } from '@/hooks/useInstalledApps';

export type ShareError = 'not_signed_in' | 'no_source_url' | 'unknown';

export interface ShareResult {
  success: boolean;
  shareCode?: string;
  error?: ShareError;
}

function generateCode(): string {
  return Math.random().toString(36).substring(2, 10);
}

async function uniqueCode(): Promise<string> {
  let code = generateCode();
  for (let i = 0; i < 5; i++) {
    const { data } = await supabase
      .from('shared_apps')
      .select('share_code')
      .eq('share_code', code)
      .maybeSingle();
    if (!data) return code;
    code = generateCode();
  }
  return code; // accept last attempt — collision probability negligible
}

export async function shareApp(app: InstalledApp): Promise<ShareResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return { success: false, error: 'not_signed_in' };
  if (!app.source_url) return { success: false, error: 'no_source_url' };

  // Reuse an existing active link for this owner + app
  const { data: existing } = await supabase
    .from('shared_apps')
    .select('share_code')
    .eq('owner_id', session.user.id)
    .eq('app_id', app.app_id)
    .eq('is_active', true)
    .maybeSingle();

  let shareCode: string;

  if (existing?.share_code) {
    shareCode = existing.share_code;
  } else {
    shareCode = await uniqueCode();
    const { error } = await supabase.from('shared_apps').insert({
      owner_id: session.user.id,
      app_id: app.app_id,
      name: app.name,
      source_url: app.source_url,
      icon_emoji: app.icon_emoji,
      icon_bg_color: app.icon_bg_color,
      share_code: shareCode,
    });
    if (error) {
      console.error('[shareApp] insert error:', error);
      return { success: false, error: 'unknown' };
    }
  }

  await Share.share({
    message: `Check out "${app.name}" on Perappos!\n\nperappos://share/${shareCode}`,
  });

  return { success: true, shareCode };
}
