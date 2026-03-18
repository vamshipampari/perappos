import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';

interface PromoCodeSheetProps {
  visible: boolean;
  onClose: () => void;
  onRedeem: (code: string) => Promise<{ success: boolean; message: string }>;
}

export function PromoCodeSheet({ visible, onClose, onRedeem }: PromoCodeSheetProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleRedeem = async () => {
    if (!code.trim()) return;

    setLoading(true);
    setResult(null);

    const res = await onRedeem(code.trim());
    setResult(res);
    setLoading(false);

    if (res.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        onClose();
        setCode('');
        setResult(null);
      }, 2000);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleClose = () => {
    onClose();
    setCode('');
    setResult(null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.handle} />

          <Text style={styles.title}>Redeem Code</Text>
          <Text style={styles.subtitle}>
            Enter a promo or beta access code
          </Text>

          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(text) => {
              setCode(text.toUpperCase());
              setResult(null);
            }}
            placeholder="e.g. BETA2026"
            placeholderTextColor="#8E8E93"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            editable={!loading}
          />

          {result && (
            <Text style={[styles.resultText, { color: result.success ? '#34C759' : '#FF3B30' }]}>
              {result.message}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.redeemButton, (!code.trim() || loading) && styles.redeemButtonDisabled]}
            onPress={handleRedeem}
            disabled={!code.trim() || loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.redeemButtonText}>Redeem</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#8E8E93',
    marginBottom: 20,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
    letterSpacing: 2,
    textAlign: 'center',
    backgroundColor: '#F9FAFB',
    marginBottom: 12,
  },
  resultText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  redeemButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  redeemButtonDisabled: {
    opacity: 0.5,
  },
  redeemButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cancelButton: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 17,
    color: '#007AFF',
  },
});
