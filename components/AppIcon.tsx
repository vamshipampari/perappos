/**
 * Shared app icon component with optional badge overlays.
 *
 * Used in:
 * - app/(tabs)/index.tsx  — list card icon (48px) with update dot + shared badge
 * - app/app/[id].tsx      — header icon (22px, no badges)
 */

import { StyleSheet, Text, View } from 'react-native';

interface Props {
  emoji: string;
  bgColor: string;
  size: number;
  /** Show a red update-available dot in the top-right corner. */
  hasUpdate?: boolean;
  /** Show a 👥 shared badge in the bottom-right corner. */
  isShared?: boolean;
}

export function AppIcon({ emoji, bgColor, size, hasUpdate, isShared }: Props) {
  const radius = size * 0.25;
  const fontSize = size * 0.5;

  return (
    <View style={{ position: 'relative' }}>
      <View
        style={[
          styles.iconBase,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: bgColor,
          },
        ]}
      >
        <Text style={{ fontSize }}>{emoji}</Text>
      </View>

      {hasUpdate && (
        <View
          style={[
            styles.updateDot,
            { top: -2, right: -2 },
          ]}
        />
      )}

      {isShared && (
        <View style={styles.sharedBadge}>
          <Text style={styles.sharedBadgeText}>👥</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  iconBase: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  updateDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  sharedBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D1D6',
  },
  sharedBadgeText: {
    fontSize: 10,
  },
});
