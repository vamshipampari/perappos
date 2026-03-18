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

  const gateAppInstall = (): boolean => {
    if (canInstallMoreApps) return true;

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
