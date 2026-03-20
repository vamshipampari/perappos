import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import { supabase } from '../services/supabase';

// Plan limits configuration
const PLAN_LIMITS = {
  free: {
    maxApps: 5,
    canCreateSharedInstances: false,
    maxSharedInstances: 0,
    maxMembersPerInstance: 0,
    label: 'Free',
  },
  beta: {
    maxApps: Infinity,
    canCreateSharedInstances: true,
    maxSharedInstances: 5,
    maxMembersPerInstance: 5,
    label: 'Beta',
  },
  pro: {
    maxApps: Infinity,
    canCreateSharedInstances: true,
    maxSharedInstances: 5,
    maxMembersPerInstance: 5,
    label: 'Pro',
  },
  team: {
    maxApps: Infinity,
    canCreateSharedInstances: true,
    maxSharedInstances: Infinity,
    maxMembersPerInstance: 20,
    label: 'Team',
  },
} as const;

export type PlanType = keyof typeof PLAN_LIMITS;

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
}

export interface UserProfileState {
  profile: UserProfile | null;
  limits: typeof PLAN_LIMITS[PlanType];
  loading: boolean;
  error: string | null;
  isProOrAbove: boolean;
  canInstallMoreApps: boolean;
  canCreateSharedInstance: boolean;
  refresh: () => Promise<void>;
  redeemPromoCode: (code: string) => Promise<{ success: boolean; message: string }>;
  updateDisplayName: (name: string) => Promise<void>;
  updateAvatarEmoji: (emoji: string) => Promise<void>;
}

export function useUserProfile(): UserProfileState {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc('get_user_profile');

      if (rpcError) throw rpcError;
      if (!data) throw new Error('No profile returned');

      setProfile(data as UserProfile);
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
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

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
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ display_name: name })
      .eq('user_id', profile?.user_id);

    if (updateError) throw updateError;
    await fetchProfile();
  }, [profile?.user_id, fetchProfile]);

  const updateAvatarEmoji = useCallback(async (emoji: string) => {
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ avatar_emoji: emoji })
      .eq('user_id', profile?.user_id);

    if (updateError) throw updateError;
    await fetchProfile();
  }, [profile?.user_id, fetchProfile]);

  return {
    profile,
    limits,
    loading,
    error,
    isProOrAbove: plan === 'pro' || plan === 'team' || plan === 'beta',
    canInstallMoreApps: limits.maxApps === Infinity || (profile?.app_install_count ?? 0) < limits.maxApps,
    canCreateSharedInstance: limits.canCreateSharedInstances && (
      limits.maxSharedInstances === Infinity ||
      (profile?.shared_instance_count ?? 0) < limits.maxSharedInstances
    ),
    refresh: fetchProfile,
    redeemPromoCode,
    updateDisplayName,
    updateAvatarEmoji,
  };
}
