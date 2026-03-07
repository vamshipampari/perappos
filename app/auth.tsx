import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../services/supabase';

const RESEND_COOLDOWN = 60;

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: true },
      });
      if (authError) {
        setError(authError.message);
      } else {
        setStep('otp');
        startCooldown();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6) {
      setError('Please enter the 6-digit code from your email.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: trimmedOtp,
        type: 'email',
      });
      if (verifyError) {
        setError(verifyError.message);
      } else {
        router.replace('/(tabs)/settings');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setOtp('');
    setError(null);
    await handleSend();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Close button */}
        <View style={{ alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 8 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={10}
            style={{ padding: 4 }}
          >
            <Text style={{ fontSize: 16, color: '#007AFF' }}>Close</Text>
          </TouchableOpacity>
        </View>

        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
            gap: 0,
          }}
        >
          {/* Logo / name */}
          <Text style={{ fontSize: 52, marginBottom: 12 }}>📱</Text>
          <Text
            style={{
              fontSize: 28,
              fontWeight: '700',
              color: '#1C1C1E',
              marginBottom: 6,
            }}
          >
            Perappos
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: '#8E8E93',
              textAlign: 'center',
              marginBottom: 40,
              lineHeight: 20,
            }}
          >
            {step === 'otp'
              ? 'Check your email for a 6-digit code.'
              : 'Sign in to sync your apps across devices.'}
          </Text>

          {step === 'email' ? (
            <>
              <TextInput
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (error) setError(null);
                }}
                placeholder="Enter your email"
                placeholderTextColor="#C7C7CC"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                style={{
                  width: '100%',
                  height: 50,
                  borderWidth: 1.5,
                  borderColor: error ? '#FF3B30' : '#E5E5EA',
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  fontSize: 16,
                  color: '#1C1C1E',
                  backgroundColor: '#FAFAFA',
                  marginBottom: 8,
                }}
              />

              {error && (
                <Text
                  style={{
                    fontSize: 13,
                    color: '#FF3B30',
                    alignSelf: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  {error}
                </Text>
              )}

              <TouchableOpacity
                onPress={handleSend}
                disabled={loading}
                activeOpacity={0.8}
                style={{
                  width: '100%',
                  height: 50,
                  backgroundColor: loading ? '#A8C8FF' : '#007AFF',
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 8,
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                {loading && <ActivityIndicator color="#FFFFFF" size="small" />}
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                  {loading ? 'Sending…' : 'Send Code'}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text
                style={{
                  fontSize: 14,
                  color: '#8E8E93',
                  alignSelf: 'flex-start',
                  marginBottom: 8,
                }}
              >
                Code sent to{' '}
                <Text style={{ color: '#1C1C1E', fontWeight: '500' }}>{email.trim()}</Text>
              </Text>

              <TextInput
                value={otp}
                onChangeText={(t) => {
                  setOtp(t.replace(/[^0-9]/g, '').slice(0, 6));
                  if (error) setError(null);
                }}
                placeholder="000000"
                placeholderTextColor="#C7C7CC"
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={handleVerify}
                maxLength={6}
                style={{
                  width: '100%',
                  height: 56,
                  borderWidth: 1.5,
                  borderColor: error ? '#FF3B30' : '#E5E5EA',
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  fontSize: 24,
                  fontWeight: '600',
                  color: '#1C1C1E',
                  backgroundColor: '#FAFAFA',
                  marginBottom: 8,
                  letterSpacing: 8,
                  textAlign: 'center',
                }}
              />

              {error && (
                <Text
                  style={{
                    fontSize: 13,
                    color: '#FF3B30',
                    alignSelf: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  {error}
                </Text>
              )}

              <TouchableOpacity
                onPress={handleVerify}
                disabled={loading}
                activeOpacity={0.8}
                style={{
                  width: '100%',
                  height: 50,
                  backgroundColor: loading ? '#A8C8FF' : '#007AFF',
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 8,
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                {loading && <ActivityIndicator color="#FFFFFF" size="small" />}
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                  {loading ? 'Verifying…' : 'Verify Code'}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12 }}>
                <TouchableOpacity
                  onPress={() => {
                    setStep('email');
                    setOtp('');
                    setError(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 15, color: '#007AFF', fontWeight: '500' }}>
                    Change email
                  </Text>
                </TouchableOpacity>

                <Text style={{ color: '#C7C7CC' }}>·</Text>

                <TouchableOpacity
                  onPress={handleResend}
                  disabled={cooldown > 0 || loading}
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      color: cooldown > 0 ? '#C7C7CC' : '#007AFF',
                      fontWeight: '500',
                    }}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
