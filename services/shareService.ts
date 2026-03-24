/**
 * Share flow: create a shared_apps record in Supabase (for analytics) and
 * open the native share sheet with a plain-text message containing the
 * source URL and installation instructions.
 *
 * Deep links are NOT used — custom URL schemes are stripped by WhatsApp/
 * iMessage. We share the source URL directly instead.
 *
 * ZIP and demo apps cannot be shared yet (no source URL to give).
 */

import { Share } from 'react-native';
import { log } from '@/lib/logger';
import { supabase } from './supabase';
import type { InstalledApp } from '@/types';

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
      log.error('[shareApp] insert error:', error);
      return { success: false, error: 'unknown' };
    }
  }

  const shareMessage =
    `Hey! Check out this app I'm using on Cottix:\n\n` +
    `${app.name}\n\n` +
    `To install it:\n` +
    `1. Open Cottix\n` +
    `2. Tap + to add a new app\n` +
    `3. Paste this URL: ${app.source_url}\n\n` +
    `Get Cottix: [TestFlight link here]`;

  await Share.share({ message: shareMessage });

  return { success: true, shareCode };
}
