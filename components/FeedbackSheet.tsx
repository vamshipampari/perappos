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
import { useTheme, type Colors } from '@/lib/theme';

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

function makeStyles(theme: Colors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: theme.overlay,
    },
    sheet: {
      backgroundColor: theme.surface,
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
      backgroundColor: theme.separatorOpaque,
      alignSelf: 'center',
      marginBottom: 20,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.label,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 15,
      color: theme.labelSecondary,
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
      borderColor: theme.separator,
      backgroundColor: theme.background,
    },
    typeChipActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    typeChipText: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.labelSecondary,
    },
    typeChipTextActive: {
      color: '#FFFFFF',
    },
    textArea: {
      height: 120,
      borderWidth: 1,
      borderColor: theme.separatorOpaque,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: theme.label,
      backgroundColor: theme.inputBackground,
      marginBottom: 16,
    },
    submitButton: {
      height: 50,
      borderRadius: 12,
      backgroundColor: theme.primary,
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
      color: theme.primary,
    },
    errorText: {
      fontSize: 13,
      color: theme.destructive,
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
}

export function FeedbackSheet({ visible, onClose }: FeedbackSheetProps) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const theme = useTheme();
  const styles = makeStyles(theme);

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
                placeholderTextColor={theme.labelSecondary}
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
