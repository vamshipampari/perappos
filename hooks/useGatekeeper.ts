import { Alert, type AlertButton } from 'react-native';
import { useRouter } from 'expo-router';
import { isUpgradeAvailable } from '@/lib/upgrade';
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

  // On platforms where the upgrade flow is available, offer a CTA that routes to
  // the paywall. On Android (no RevenueCat provisioning yet) show a softer
  // "coming soon" note instead of a button that dead-ends.
  const upgradeCta = (): AlertButton =>
    isUpgradeAvailable
      ? { text: 'Upgrade to Pro', onPress: () => router.push('/paywall') }
      : { text: 'OK', style: 'cancel' };
  const upgradeSuffix = isUpgradeAvailable
    ? ''
    : '\n\nUpgrades aren’t available on Android yet — coming soon.';

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

    const base = isUpgradeAvailable
      ? `Your plan allows up to ${limits.appLimit} apps. Upgrade to Pro for unlimited apps.`
      : `Your plan allows up to ${limits.appLimit} apps.`;
    Alert.alert(
      'App Limit Reached',
      base + upgradeSuffix,
      isUpgradeAvailable
        ? [{ text: 'Not Now', style: 'cancel' }, upgradeCta()]
        : [upgradeCta()]
    );
    return false;
  };

  const gateSharedInstanceCreate = (): boolean => {
    if (canCreateSharedInstance) return true;

    if (limits.sharedInstanceLimit === 0) {
      Alert.alert(
        'Upgrade Required',
        'Sharing apps requires a Pro plan.' + upgradeSuffix,
        isUpgradeAvailable
          ? [{ text: 'Not Now', style: 'cancel' }, upgradeCta()]
          : [upgradeCta()]
      );
    } else {
      const base = isUpgradeAvailable
        ? `Your plan allows up to ${limits.sharedInstanceLimit} shared instances. Upgrade to Pro for more.`
        : `Your plan allows up to ${limits.sharedInstanceLimit} shared instances.`;
      Alert.alert(
        'Shared Instance Limit Reached',
        base + upgradeSuffix,
        isUpgradeAvailable
          ? [{ text: 'Not Now', style: 'cancel' }, upgradeCta()]
          : [upgradeCta()]
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
