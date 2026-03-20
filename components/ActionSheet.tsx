/**
 * iOS-style bottom action sheet using Modal.
 * Supports normal actions, destructive actions, and a Cancel button.
 */

import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export interface SheetAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

interface Props {
  visible: boolean;
  title: string;
  actions: SheetAction[];
  destructiveActions?: SheetAction[];
  onDismiss: () => void;
}

export function ActionSheet({
  visible,
  title,
  actions,
  destructiveActions = [],
  onDismiss,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.wrapper}>
        {/* Tap-away backdrop */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

        <View style={styles.container}>
          {/* Title card */}
          <View style={styles.group}>
            <View style={styles.titleRow}>
              <Text style={styles.titleText} numberOfLines={1}>
                {title}
              </Text>
            </View>
          </View>

          {/* Normal actions */}
          <View style={styles.group}>
            {actions.map((action, i) => (
              <View key={action.label}>
                <TouchableOpacity
                  onPress={action.onPress}
                  disabled={action.disabled}
                  activeOpacity={0.55}
                  style={[styles.row, action.disabled && { opacity: 0.55 }]}
                >
                  <View style={styles.rowInner}>
                    {action.loading ? (
                      <ActivityIndicator size="small" color="#007AFF" />
                    ) : null}
                    <Text style={styles.rowText}>{action.label}</Text>
                  </View>
                </TouchableOpacity>
                {i < actions.length - 1 && <View style={styles.separator} />}
              </View>
            ))}
          </View>

          {/* Destructive actions */}
          {destructiveActions.length > 0 && (
            <View style={styles.group}>
              {destructiveActions.map((action, i) => (
                <View key={action.label}>
                  <TouchableOpacity
                    onPress={action.onPress}
                    activeOpacity={0.55}
                    style={styles.row}
                  >
                    <Text style={[styles.rowText, styles.destructiveText]}>
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                  {i < destructiveActions.length - 1 && (
                    <View style={styles.separator} />
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Cancel */}
          <View style={styles.group}>
            <TouchableOpacity
              onPress={onDismiss}
              activeOpacity={0.55}
              style={styles.row}
            >
              <Text style={[styles.rowText, styles.cancelText]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  container: {
    paddingHorizontal: 8,
    paddingBottom: 34, // accommodate home indicator
    gap: 8,
  },
  group: {
    backgroundColor: '#FFFFFF',
    borderRadius: 13,
    overflow: 'hidden',
  },
  titleRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  titleText: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '500',
  },
  row: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rowText: {
    fontSize: 17,
    color: '#007AFF',
  },
  destructiveText: {
    color: '#FF3B30',
  },
  cancelText: {
    fontWeight: '600',
  },
  separator: {
    height: 0.5,
    backgroundColor: '#E5E5EA',
  },
});
