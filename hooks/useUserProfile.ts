import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import { supabase } from '../services/supabase';
import { getCustomerInfo, hasProAccess } from '../services/revenueCat';

export type PlanType = 'free' | 'beta' | 'pro' | 'team';

export interface UserProfile {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_emoji: string;
  plan: PlanType;
  plan_source: string;
  plan_expires_at: string | null;
  promo_code_used: string | null;
  app_install_count: number;
  shared_instance_count: number;
  created_at: string;
  // Limit columns — sourced from Supabase, null = unlimited
  app_limit: number | null;
  shared_instance_limit: number | null;
  members_per_instance_limit: number | null;
  storage_limit_mb: number | null;
}

export interface Limits {
  appLimit: number | null;
  sharedInstanceLimit: number | null;
  membersPerInstanceLimit: number | null;
  storageLimitMb: number | null;
}

export interface UserProfileState {
  profile: UserProfile | null;
  limits: Limits;
  loading: boolean;
  error: string | null;
  isProOrAbove: boolean;
  canInstallMoreApps: boolean;
  canCreateSharedInstance: boolean;
  purchasedViaPlatform: boolean;
  refresh: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  redeemPromoCode: (code: string) => Promise<{ success: boolean; message: string }>;
  updateDisplayName: (name: string) => Promise<void>;
  updateAvatarEmoji: (emoji: string) => Promise<void>;
}

export function useUserProfile(): UserProfileState {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasedViaPlatform, setPurchasedViaPlatform] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc('get_user_profile');

      if (rpcError) throw rpcError;
      if (!data) throw new Error('No profile returned');

      const profileData = data as UserProfile;

      // Check RevenueCat — overrides Supabase plan if active entitlement found.
      let rcPlatformPurchase = false;
      try {
        const customerInfo = await getCustomerInfo();
        if (hasProAccess(customerInfo)) {
          profileData.plan = 'pro';
          rcPlatformPurchase = true;
        }
      } catch {
        // RC unavailable — fall back to Supabase plan only.
      }

      setPurchasedViaPlatform(rcPlatformPurchase);
      setProfile(profileData);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load profile';
      log.error('[useUserProfile] fetch error:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const plan = profile?.plan ?? 'free';

  // Limits come directly from the profile row — null means unlimited.
  const limits: Limits = {
    appLimit: profile?.app_limit ?? null,
    sharedInstanceLimit: profile?.shared_instance_limit ?? null,
    membersPerInstanceLimit: profile?.members_per_instance_limit ?? null,
    storageLimitMb: profile?.storage_limit_mb ?? null,
  };

  const appCount = profile?.app_install_count ?? 0;
  const sharedCount = profile?.shared_instance_count ?? 0;

  // null = unlimited → can always install
  const canInstallMoreApps =
    limits.appLimit === null || appCount < limits.appLimit;

  // 0 = sharing disabled; null = unlimited; N = can create up to N
  const canCreateSharedInstance =
    limits.sharedInstanceLimit !== 0 &&
    (limits.sharedInstanceLimit === null || sharedCount < limits.sharedInstanceLimit);

  const redeemPromoCode = useCallback(async (code: string) => {
    try {
      const { data, error: rpcError } = await supabase.rpc('redeem_promo_code', {
        code_input: code,
      });

      if (rpcError) throw rpcError;

      const result = data as { success: boolean; error?: string; message?: string; plan?: string };

      if (result.success) {
        await fetchProfile();
        return { success: true, message: result.message || 'Code redeemed!' };
      } else {
        return { success: false, message: result.error || 'Failed to redeem code' };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      return { success: false, message };
    }
  }, [fetchProfile]);

  const updateDisplayName = useCallback(async (name: string) => {
    try {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ display_name: name })
        .eq('user_id', profile?.user_id);

      if (updateError) throw updateError;
      await fetchProfile();
    } catch {
      throw new Error('Failed to update display name');
    }
  }, [profile?.user_id, fetchProfile]);

  const updateAvatarEmoji = useCallback(async (emoji: string) => {
    try {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ avatar_emoji: emoji })
        .eq('user_id', profile?.user_id);

      if (updateError) throw updateError;
      await fetchProfile();
    } catch {
      throw new Error('Failed to update avatar');
    }
  }, [profile?.user_id, fetchProfile]);

  return {
    profile,
    limits,
    loading,
    error,
    isProOrAbove: plan === 'pro' || plan === 'team' || plan === 'beta',
    canInstallMoreApps,
    canCreateSharedInstance,
    purchasedViaPlatform,
    refresh: fetchProfile,
    refreshProfile: fetchProfile,
    redeemPromoCode,
    updateDisplayName,
    updateAvatarEmoji,
  };
}
