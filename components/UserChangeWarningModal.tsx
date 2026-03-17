import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  visible: boolean;
  newUserEmail: string | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Shown when a different Supabase account signs in while local app data
 * from a previous user still exists on the device.
 *
 * The modal is intentionally NOT dismissable by tapping outside or swiping —
 * the user must explicitly choose "Continue & Erase" or "Cancel".
 */
export function UserChangeWarningModal({ visible, newUserEmail, onConfirm, onCancel }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Prevent accidental dismiss
      onRequestClose={() => {}}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 28,
        }}
      >
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            paddingVertical: 28,
            paddingHorizontal: 24,
            width: '100%',
            maxWidth: 360,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 24,
            elevation: 12,
          }}
        >
          {/* Icon */}
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 44 }}>⚠️</Text>
          </View>

          {/* Title */}
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#1C1C1E',
              textAlign: 'center',
              marginBottom: 12,
            }}
          >
            Different Account Detected
          </Text>

          {/* Body */}
          <Text
            style={{
              fontSize: 15,
              color: '#3C3C43',
              textAlign: 'center',
              lineHeight: 22,
              marginBottom: 28,
            }}
          >
            Signing in as{' '}
            <Text style={{ fontWeight: '600', color: '#1C1C1E' }}>
              {newUserEmail ?? 'a new account'}
            </Text>{' '}
            will{' '}
            <Text style={{ fontWeight: '600', color: '#FF3B30' }}>
              erase all local apps and data
            </Text>{' '}
            from the previous account.{'\n\n'}
            This cannot be undone.
          </Text>

          {/* Continue & Erase — destructive primary action */}
          <EraseButton onConfirm={onConfirm} />

          {/* Divider */}
          <View
            style={{
              height: 1,
              backgroundColor: '#E5E5EA',
              marginVertical: 12,
            }}
          />

          {/* Cancel */}
          <TouchableOpacity onPress={onCancel} activeOpacity={0.7}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '500',
                color: '#007AFF',
                textAlign: 'center',
                paddingVertical: 4,
              }}
            >
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** Isolated button so we can hold local loading state without re-rendering the whole modal. */
function EraseButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [loading, setLoading] = React.useState(false);

  const handlePress = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={loading}
      activeOpacity={0.85}
      style={{
        backgroundColor: '#FF3B30',
        borderRadius: 12,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      {loading && <ActivityIndicator color="#FFFFFF" size="small" />}
      <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
        {loading ? 'Erasing…' : 'Continue & Erase'}
      </Text>
    </TouchableOpacity>
  );
}

// React is used by JSX — import it explicitly since we reference it in EraseButton.
import React from 'react';
