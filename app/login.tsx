import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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

type Step = 'credentials' | 'otp';
type Mode = 'login' | 'signup';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('credentials');
  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const passwordRef = useRef<TextInput>(null);

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

  const handleLogin = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (authError) {
        if (authError.message === 'Email not confirmed') {
          // User signed up but never confirmed — resend OTP and go to verification
          await supabase.auth.resend({ type: 'signup', email: trimmed });
          setStep('otp');
          startCooldown();
        } else {
          setError(authError.message);
        }
      } else {
        router.replace('/(tabs)');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signUp({
        email: trimmed,
        password,
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

  const handleSubmit = () => {
    if (mode === 'login') {
      handleLogin();
    } else {
      handleSignup();
    }
  };

  const handleVerifyOtp = async () => {
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
        type: 'signup',
      });
      if (verifyError) {
        setError(verifyError.message);
      } else {
        setLoading(false);
        router.replace('/(tabs)');
        return;
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
    setLoading(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
      });
      if (resendError) {
        setError(resendError.message);
      } else {
        startCooldown();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode((m) => (m === 'login' ? 'signup' : 'login'));
    setError(null);
    setStep('credentials');
    setOtp('');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          {/* Logo / name */}
          <Image
            source={require('../assets/images/logo.png')}
            resizeMode="contain"
            accessibilityLabel="Cottix logo"
            style={{ width: 104, height: 104, marginBottom: 12 }}
          />
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
              ? 'Check your email for a 6-digit confirmation code.'
              : mode === 'login'
                ? 'Sign in to sync your apps across devices.'
                : 'Create an account to get started.'}
          </Text>

          {step === 'credentials' ? (
            <>
              <TextInput
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (error) setError(null);
                }}
                placeholder="Email"
                placeholderTextColor="#C7C7CC"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
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
                  marginBottom: 12,
                }}
              />

              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (error) setError(null);
                }}
                placeholder="Password"
                placeholderTextColor="#C7C7CC"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
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
                onPress={handleSubmit}
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
                  {loading
                    ? mode === 'login'
                      ? 'Signing in…'
                      : 'Creating account…'
                    : mode === 'login'
                      ? 'Sign In'
                      : 'Create Account'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={toggleMode} activeOpacity={0.7} style={{ marginTop: 20 }}>
                <Text style={{ fontSize: 15, color: '#007AFF', fontWeight: '500' }}>
                  {mode === 'login'
                    ? "Don't have an account? Sign Up"
                    : 'Already have an account? Sign In'}
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
                Confirmation code sent to{' '}
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
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="done"
                onSubmitEditing={handleVerifyOtp}
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
                onPress={handleVerifyOtp}
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
                  {loading ? 'Verifying…' : 'Verify & Continue'}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12 }}>
                <TouchableOpacity
                  onPress={() => {
                    setStep('credentials');
                    setOtp('');
                    setError(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 15, color: '#007AFF', fontWeight: '500' }}>Back</Text>
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
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
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
