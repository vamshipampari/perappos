import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { track } from '@/services/analytics';
import { supabase } from '@/services/supabase';

type FeedbackType = 'bug' | 'feature' | 'other';

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'other', label: 'Other' },
];

interface FeedbackSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function FeedbackSheet({ visible, onClose }: FeedbackSheetProps) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('feedback').insert({
        user_id: user?.id ?? null,
        type,
        body: message.trim(),
      });
      if (error) throw error;
      void track('feedback_submitted', { type });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
      setTimeout(() => {
        handleClose();
      }, 1800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      console.error('[FeedbackSheet] insert failed:', msg);
      setErrorMsg(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    // Reset after sheet close animation
    setTimeout(() => {
      setMessage('');
      setType('bug');
      setSubmitted(false);
    }, 300);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {submitted ? (
            <View style={styles.successContainer}>
              <Text style={styles.successEmoji}>🎉</Text>
              <Text style={styles.title}>Thanks for your feedback!</Text>
              <Text style={styles.subtitle}>We read every submission.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.title}>Send Feedback</Text>
              <Text style={styles.subtitle}>Help us improve Cottix</Text>

              {/* Type picker */}
              <View style={styles.typeRow}>
                {TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    onPress={() => setType(t.value)}
                    style={[styles.typeChip, type === t.value && styles.typeChipActive]}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.typeChipText, type === t.value && styles.typeChipTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.textArea}
                value={message}
                onChangeText={setMessage}
                placeholder="Describe the bug, feature request, or anything else…"
                placeholderTextColor="#8E8E93"
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                editable={!loading}
                maxLength={1000}
              />

              {errorMsg ? (
                <Text style={styles.errorText}>{errorMsg}</Text>
              ) : null}

              <TouchableOpacity
                style={[styles.submitButton, (!message.trim() || loading) && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                disabled={!message.trim() || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>Send</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
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
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  typeChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#F2F2F7',
  },
  typeChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  typeChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8E8E93',
  },
  typeChipTextActive: {
    color: '#FFFFFF',
  },
  textArea: {
    height: 120,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1C1C1E',
    backgroundColor: '#F9FAFB',
    marginBottom: 16,
  },
  submitButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
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
  errorText: {
    fontSize: 13,
    color: '#FF3B30',
    marginBottom: 10,
    textAlign: 'center',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  successEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
});
