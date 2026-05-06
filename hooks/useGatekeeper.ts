import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
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
  const router = useRouter();
  const { profile, limits, canInstallMoreApps, canCreateSharedInstance } = useUserProfile();

  /**
   * @param localCount - Pass the current local (non-demo) app count from SQLite.
   *   When provided it is used as the source of truth, preventing false "limit
   *   reached" errors caused by the Supabase counter drifting out of sync
   *   (e.g. after a device wipe or user-switch wipe).
   */
  const gateAppInstall = (localCount?: number): boolean => {
    const atLimit = localCount !== undefined
      ? (limits.appLimit !== null && localCount >= limits.appLimit)
      : !canInstallMoreApps;

    if (!atLimit) return true;

    Alert.alert(
      'App Limit Reached',
      `Your plan allows up to ${limits.appLimit} apps. Upgrade to Pro for unlimited apps.`,
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Upgrade to Pro', onPress: () => router.push('/paywall') },
      ]
    );
    return false;
  };

  const gateSharedInstanceCreate = (): boolean => {
    if (canCreateSharedInstance) return true;

    if (limits.sharedInstanceLimit === 0) {
      Alert.alert(
        'Upgrade Required',
        'Sharing apps requires a Pro plan.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Upgrade to Pro', onPress: () => router.push('/paywall') },
        ]
      );
    } else {
      Alert.alert(
        'Shared Instance Limit Reached',
        `Your plan allows up to ${limits.sharedInstanceLimit} shared instances. Upgrade to Pro for more.`,
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Upgrade to Pro', onPress: () => router.push('/paywall') },
        ]
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
