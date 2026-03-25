import { Alert } from 'react-native';
import { useUserProfile } from './useUserProfile';

/**
 * Provides gate functions that check limits and show upgrade prompts.
 * Use before any action that should be gated by plan.
 *
 * Usage:
 *   const { gateAppInstall, gateSharedInstanceCreate } = useGatekeeper();
 *
 *   const handleInstall = async () => {
 *     if (!gateAppInstall()) return;  // Shows alert if at limit
 *     // proceed with install...
 *   };
 */
export function useGatekeeper() {
  const { profile, limits, canInstallMoreApps, canCreateSharedInstance } = useUserProfile();

  /**
   * @param localCount - Pass the current local (non-demo) app count from SQLite.
   *   When provided it is used as the source of truth, preventing false "limit
   *   reached" errors caused by the Supabase counter drifting out of sync
   *   (e.g. after a device wipe or user-switch wipe).
   */
  const gateAppInstall = (localCount?: number): boolean => {
    const atLimit = localCount !== undefined
      ? (limits.maxApps !== Infinity && localCount >= limits.maxApps)
      : !canInstallMoreApps;

    if (!atLimit) return true;

    Alert.alert(
      'App Limit Reached',
      `The Free plan allows up to ${limits.maxApps} apps. Redeem a promo code or upgrade to Pro for unlimited apps.`,
      [{ text: 'OK' }]
    );
    return false;
  };

  const gateSharedInstanceCreate = (): boolean => {
    if (canCreateSharedInstance) return true;

    if (!limits.canCreateSharedInstances) {
      Alert.alert(
        'Upgrade Required',
        'Sharing apps requires a Pro or Beta plan. Redeem a promo code to unlock this feature.',
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert(
        'Shared Instance Limit Reached',
        `Your plan allows up to ${limits.maxSharedInstances} shared instances. Upgrade to Team for unlimited.`,
        [{ text: 'OK' }]
      );
    }
    return false;
  };

  return {
    gateAppInstall,
    gateSharedInstanceCreate,
    profile,
    limits,
  };
}
