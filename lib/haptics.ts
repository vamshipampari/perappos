import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const iosPlatformId = Constants.platform?.ios?.platform?.toLowerCase() ?? '';
const iosModelName = Constants.platform?.ios?.model?.toLowerCase() ?? '';
const deviceName = Constants.deviceName?.toLowerCase() ?? '';

const isIosSimulator =
  Platform.OS === 'ios' &&
  (
    iosPlatformId === 'x86_64' ||
    iosPlatformId === 'i386' ||
    iosPlatformId === 'arm64' ||
    iosModelName.includes('simulator') ||
    deviceName.includes('simulator')
  );

function canTriggerHaptics(): boolean {
  return Platform.OS !== 'web' && !isIosSimulator;
}

export async function safeImpactAsync(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium
): Promise<void> {
  if (!canTriggerHaptics()) return;
  try {
    await Haptics.impactAsync(style);
  } catch {}
}

export async function safeNotificationAsync(
  type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success
): Promise<void> {
  if (!canTriggerHaptics()) return;
  try {
    await Haptics.notificationAsync(type);
  } catch {}
}

export async function safeSelectionAsync(): Promise<void> {
  if (!canTriggerHaptics()) return;
  try {
    await Haptics.selectionAsync();
  } catch {}
}

export { Haptics };
