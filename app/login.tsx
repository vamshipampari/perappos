import { router } from 'expo-router';
import { Storage as KVStore } from 'expo-sqlite/kv-store';
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
import { track } from '../services/analytics';
import { useTheme } from '@/lib/theme';
import { posthog } from '../src/config/posthog';

const RESEND_COOLDOWN = 60;

type Step = 'credentials' | 'otp' | 'forgot' | 'forgot_otp' | 'forgot_new_password';
type Mode = 'login' | 'signup';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('credentials');
  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpInfoMessage, setOtpInfoMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const theme = useTheme();

  const navigateAfterAuth = async () => {
    const done = await KVStore.getItem('onboarding_complete');
    router.replace(done ? '/(tabs)' : '/onboarding');
  };

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
          // User signed up but never confirmed — resend OTP and go to verification.
          // Check resend result: if it fails the email doesn't exist (anti-enumeration response).
          const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: trimmed });
          if (resendError) {
            setError('Invalid login credentials.');
          } else {
            setOtpInfoMessage(`Your email isn't verified yet. We've sent a new code to ${trimmed}.`);
            setStep('otp');
            startCooldown();
          }
        } else {
          setError(authError.message);
        }
      } else {
        void navigateAfterAuth();
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
      const { data, error: authError } = await supabase.auth.signUp({
        email: trimmed,
        password,
      });
      if (authError) {
        setError(authError.message);
      } else if (data.session) {
        // Supabase email confirmations are disabled — session granted immediately, no OTP needed.
        // This is always a fresh signup, so always show onboarding.
        void track('signup_completed');
        router.replace('/onboarding');
      } else if (!data.user || data.user.identities?.length === 0) {
        // Supabase silently "succeeds" for already-registered emails — detect it.
        // Two cases: (a) confirmed account → must sign in, (b) unconfirmed → resend OTP.
        const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: trimmed });
        if (resendError) {
          // Account is fully confirmed — resend fails → direct to sign-in
          setError('An account with this email already exists. Try signing in instead.');
        } else {
          // Account exists but is unconfirmed — OTP resent, let them complete signup
          setOtpInfoMessage(`We found an unconfirmed account for ${trimmed}. Check your email for a confirmation code.`);
          setStep('otp');
          startCooldown();
        }
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
        void track('signup_completed');
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          posthog.identify(user.id, {
            email: user.email ?? null,
          });
          posthog.capture('user_signed_up', { email: user.email ?? null, first_signup_date: new Date().toISOString() });
        }
        setLoading(false);
        // OTP verification is only reachable during signup — always route to onboarding.
        // (Login goes directly to /(tabs) without this step.)
        router.replace('/onboarding');
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

  const handleForgotPassword = async () => {
    const trimmed = forgotEmail.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        setError(otpError.message);
      } else {
        setForgotOtp('');
        setStep('forgot_otp');
        startCooldown();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendForgotOtp = async () => {
    if (cooldown > 0) return;
    setForgotOtp('');
    setError(null);
    setLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: forgotEmail.trim().toLowerCase(),
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        setError(otpError.message);
      } else {
        startCooldown();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyForgotOtp = async () => {
    const trimmedOtp = forgotOtp.trim();
    if (trimmedOtp.length !== 6) {
      setError('Please enter the 6-digit code from your email.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: forgotEmail.trim().toLowerCase(),
        token: trimmedOtp,
        type: 'email',
      });
      if (verifyError) {
        setError(verifyError.message);
      } else {
        setNewPassword('');
        setStep('forgot_new_password');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetNewPassword = async () => {
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
      } else {
        void navigateAfterAuth();
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
    setForgotOtp('');
    setNewPassword('');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }}>
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
              color: theme.labelSecondary,
              textAlign: 'center',
              marginBottom: 40,
              lineHeight: 20,
            }}
          >
            {step === 'otp'
              ? (otpInfoMessage ?? 'Check your email for a 6-digit confirmation code.')
              : step === 'forgot'
                ? 'Reset your password'
                : step === 'forgot_otp'
                  ? 'Enter the code we sent to reset your password.'
                  : step === 'forgot_new_password'
                    ? 'Almost done — set your new password.'
                    : mode === 'login'
                      ? 'Sign in to sync your apps across devices.'
                      : 'Create an account to get started.'}
          </Text>

          {step === 'forgot' ? (
            <>
              <Text
                style={{
                  fontSize: 14,
                  color: theme.labelSecondary,
                  alignSelf: 'flex-start',
                  marginBottom: 12,
                  lineHeight: 20,
                }}
              >
                Enter your email and we'll send a 6-digit reset code.
              </Text>
              <TextInput
                value={forgotEmail}
                onChangeText={(t) => {
                  setForgotEmail(t);
                  if (error) setError(null);
                }}
                placeholder="Email"
                placeholderTextColor={theme.labelTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleForgotPassword}
                style={{
                  width: '100%',
                  height: 50,
                  borderWidth: 1.5,
                  borderColor: error ? theme.destructive : theme.separator,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  fontSize: 16,
                  color: theme.label,
                  backgroundColor: theme.inputBackground,
                  marginBottom: 8,
                }}
              />
              {error && (
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.destructive,
                    alignSelf: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  {error}
                </Text>
              )}
              <TouchableOpacity
                onPress={handleForgotPassword}
                disabled={loading}
                activeOpacity={0.8}
                style={{
                  width: '100%',
                  height: 50,
                  backgroundColor: loading ? '#A8C8FF' : theme.primary,
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
              <TouchableOpacity
                onPress={() => { setStep('credentials'); setError(null); }}
                activeOpacity={0.7}
                style={{ marginTop: 20 }}
              >
                <Text style={{ fontSize: 15, color: theme.primary, fontWeight: '500' }}>
                  Back to Sign In
                </Text>
              </TouchableOpacity>
            </>
          ) : step === 'forgot_otp' ? (
            <>
              <Text
                style={{
                  fontSize: 14,
                  color: theme.labelSecondary,
                  alignSelf: 'flex-start',
                  marginBottom: 8,
                }}
              >
                Code sent to{' '}
                <Text style={{ color: theme.label, fontWeight: '500' }}>{forgotEmail}</Text>
              </Text>
              <TextInput
                value={forgotOtp}
                onChangeText={(t) => {
                  setForgotOtp(t.replace(/[^0-9]/g, '').slice(0, 6));
                  if (error) setError(null);
                }}
                placeholder="000000"
                placeholderTextColor={theme.labelTertiary}
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="done"
                onSubmitEditing={handleVerifyForgotOtp}
                maxLength={6}
                style={{
                  width: '100%',
                  height: 56,
                  borderWidth: 1.5,
                  borderColor: error ? theme.destructive : theme.separator,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  fontSize: 24,
                  fontWeight: '600',
                  color: theme.label,
                  backgroundColor: theme.inputBackground,
                  marginBottom: 8,
                  letterSpacing: 8,
                  textAlign: 'center',
                }}
              />
              {error && (
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.destructive,
                    alignSelf: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  {error}
                </Text>
              )}
              <TouchableOpacity
                onPress={handleVerifyForgotOtp}
                disabled={loading}
                activeOpacity={0.8}
                style={{
                  width: '100%',
                  height: 50,
                  backgroundColor: loading ? '#A8C8FF' : theme.primary,
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
                  onPress={() => { setStep('forgot'); setError(null); }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 15, color: theme.primary, fontWeight: '500' }}>Back</Text>
                </TouchableOpacity>
                <Text style={{ color: theme.labelTertiary }}>·</Text>
                <TouchableOpacity
                  onPress={handleResendForgotOtp}
                  disabled={cooldown > 0 || loading}
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      color: cooldown > 0 ? theme.labelTertiary : theme.primary,
                      fontWeight: '500',
                    }}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : step === 'forgot_new_password' ? (
            <>
              <Text
                style={{
                  fontSize: 14,
                  color: theme.labelSecondary,
                  alignSelf: 'flex-start',
                  marginBottom: 12,
                  lineHeight: 20,
                }}
              >
                Choose a new password for your account.
              </Text>
              <TextInput
                value={newPassword}
                onChangeText={(t) => {
                  setNewPassword(t);
                  if (error) setError(null);
                }}
                placeholder="New password"
                placeholderTextColor={theme.labelTertiary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSetNewPassword}
                style={{
                  width: '100%',
                  height: 50,
                  borderWidth: 1.5,
                  borderColor: error ? theme.destructive : theme.separator,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  fontSize: 16,
                  color: theme.label,
                  backgroundColor: theme.inputBackground,
                  marginBottom: 8,
                }}
              />
              {error && (
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.destructive,
                    alignSelf: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  {error}
                </Text>
              )}
              <TouchableOpacity
                onPress={handleSetNewPassword}
                disabled={loading}
                activeOpacity={0.8}
                style={{
                  width: '100%',
                  height: 50,
                  backgroundColor: loading ? '#A8C8FF' : theme.primary,
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
                  {loading ? 'Saving…' : 'Set New Password'}
                </Text>
              </TouchableOpacity>
            </>
          ) : step === 'credentials' ? (
            <>
              <TextInput
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (error) setError(null);
                }}
                placeholder="Email"
                placeholderTextColor={theme.labelTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                style={{
                  width: '100%',
                  height: 50,
                  borderWidth: 1.5,
                  borderColor: error ? theme.destructive : theme.separator,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  fontSize: 16,
                  color: theme.label,
                  backgroundColor: theme.inputBackground,
                  marginBottom: 12,
                }}
              />

              <View style={{ width: '100%', marginBottom: 8 }}>
                <TextInput
                  ref={passwordRef}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (error) setError(null);
                  }}
                  placeholder="Password"
                  placeholderTextColor={theme.labelTertiary}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={handleSubmit}
                  style={{
                    width: '100%',
                    height: 50,
                    borderWidth: 1.5,
                    borderColor: error ? theme.destructive : theme.separator,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingRight: 52,
                    fontSize: 16,
                    color: theme.label,
                    backgroundColor: theme.inputBackground,
                  }}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  activeOpacity={0.7}
                  style={{
                    position: 'absolute',
                    right: 14,
                    top: 0,
                    bottom: 0,
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={{ fontSize: 13, color: theme.labelSecondary, fontWeight: '500' }}>
                    {showPassword ? 'Hide' : 'Show'}
                  </Text>
                </TouchableOpacity>
              </View>

              {mode === 'login' && (
                <TouchableOpacity
                  onPress={() => {
                    setForgotEmail(email.trim().toLowerCase());
                    setError(null);
                    setStep('forgot');
                  }}
                  activeOpacity={0.7}
                  style={{ alignSelf: 'flex-end', marginBottom: 8 }}
                >
                  <Text style={{ fontSize: 13, color: theme.primary, fontWeight: '500' }}>
                    Forgot password?
                  </Text>
                </TouchableOpacity>
              )}

              {error && (
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.destructive,
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
                  backgroundColor: loading ? '#A8C8FF' : theme.primary,
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
                <Text style={{ fontSize: 15, color: theme.primary, fontWeight: '500' }}>
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
                  color: theme.labelSecondary,
                  alignSelf: 'flex-start',
                  marginBottom: 8,
                }}
              >
                Confirmation code sent to{' '}
                <Text style={{ color: theme.label, fontWeight: '500' }}>{email.trim()}</Text>
              </Text>

              <TextInput
                value={otp}
                onChangeText={(t) => {
                  setOtp(t.replace(/[^0-9]/g, '').slice(0, 6));
                  if (error) setError(null);
                }}
                placeholder="000000"
                placeholderTextColor={theme.labelTertiary}
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
                  borderColor: error ? theme.destructive : theme.separator,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  fontSize: 24,
                  fontWeight: '600',
                  color: theme.label,
                  backgroundColor: theme.inputBackground,
                  marginBottom: 8,
                  letterSpacing: 8,
                  textAlign: 'center',
                }}
              />

              {error && (
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.destructive,
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
                  backgroundColor: loading ? '#A8C8FF' : theme.primary,
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
                    setOtpInfoMessage(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 15, color: theme.primary, fontWeight: '500' }}>Back</Text>
                </TouchableOpacity>

                <Text style={{ color: theme.labelTertiary }}>·</Text>

                <TouchableOpacity
                  onPress={handleResend}
                  disabled={cooldown > 0 || loading}
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      color: cooldown > 0 ? theme.labelTertiary : theme.primary,
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
