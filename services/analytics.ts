import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

type EventName =
  | 'app_opened' | 'app_installed' | 'app_opened_webview'
  | 'share_created' | 'share_joined' | 'share_join_requested' | 'signup_completed'
  | 'login_completed' | 'promo_redeemed' | 'feedback_submitted';

export async function track(
  eventName: EventName,
  properties: Record<string, unknown> = {}
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('events').insert({
      user_id: user.id,
      event_name: eventName,
      properties,
      platform: Platform.OS,
      app_version: Constants.expoConfig?.version ?? 'unknown',
    });
  } catch {
    // Fire and forget — never let analytics crash the app
  }
}
