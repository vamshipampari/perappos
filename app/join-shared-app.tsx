import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { log } from '@/lib/logger';
import { joinSharedAppByCode, type SharedInstance } from '@/services/collaborationService';
import { reconnectPowerSync } from '@/services/sync/PowerSyncProvider';
import { supabase } from '@/services/supabase';

export default function JoinSharedAppScreen() {
  const db = useDatabase();
  const { refresh } = useInstalledApps();

  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<SharedInstance | null>(null);
  const [checking, setChecking] = useState(false);
  const [joining, setJoining] = useState(false);
  const joinStateRef = useRef('idle');

  const normalizedCode = code.trim().toUpperCase();

  const handleCheck = async () => {
    if (normalizedCode.length < 6) {
      Alert.alert('Invalid code', 'Enter the 6-character invite code.');
      return;
    }

    setChecking(true);
    try {
      const { data, error } = await supabase.rpc('lookup_shared_instance', {
        p_invite_code: normalizedCode,
      });
      log.info('Lookup result:', JSON.stringify(data), 'Error:', JSON.stringify(error));
      const instance = (data as SharedInstance[] | null)?.[0] ?? null;

      if (error || !instance) {
        Alert.alert('Invalid invite code', 'Check the code and try again.');
        setPreview(null);
        return;
      }

      setPreview(instance);
    } catch {
      Alert.alert('Lookup failed', 'Could not verify invite code right now.');
    } finally {
      setChecking(false);
    }
  };

  const handleJoin = async () => {
    if (!preview || joining) return;

    setJoining(true);
    joinStateRef.current = 'start';
    const timeoutId = setTimeout(() => {
      Alert.alert('Debug', `Join flow timed out at state: ${joinStateRef.current}. Check console logs.`);
      setJoining(false);
    }, 10000);

    try {
      const result = await joinSharedAppByCode(db, normalizedCode, (state) => {
        joinStateRef.current = state;
      });
      log.info('App install result:', JSON.stringify(result));
      // Force PowerSync reconnect so this device immediately receives
      // other members' shared_app_data rows under the refreshed sync buckets.
      await reconnectPowerSync();
      await refresh();
      setJoining(false);
      clearTimeout(timeoutId);
      router.replace(`/app/${result.appId}`);
    } catch (err) {
      try {
        log.error('Join error:', JSON.stringify(err));
      } catch {
        log.error('Join error:', String(err));
      }
      Alert.alert('Error', String(err));
      setJoining(false);
    } finally {
      clearTimeout(timeoutId);
      setJoining(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: 0.5,
            borderBottomColor: '#E5E5EA',
          }}
        >
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Text style={{ fontSize: 17, color: '#007AFF' }}>Back</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '600', color: '#1C1C1E' }}>Join Shared App</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
          <Text style={{ fontSize: 14, color: '#8E8E93', marginBottom: 10 }}>
            Invite code
          </Text>

          <TextInput
            value={normalizedCode}
            onChangeText={(text) => {
              setCode(text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8));
              if (preview) setPreview(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            placeholder="AB3K9Z"
            placeholderTextColor="#C7C7CC"
            style={{
              borderWidth: 1.5,
              borderColor: '#E5E5EA',
              borderRadius: 12,
              paddingHorizontal: 16,
              height: 58,
              fontSize: 28,
              fontWeight: '700',
              letterSpacing: 8,
              textAlign: 'center',
              color: '#1C1C1E',
              backgroundColor: '#FAFAFA',
            }}
          />

          <TouchableOpacity
            onPress={handleCheck}
            disabled={checking}
            style={{
              marginTop: 16,
              height: 48,
              borderRadius: 12,
              backgroundColor: checking ? '#A8C8FF' : '#007AFF',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
            }}
          >
            {checking ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
              {checking ? 'Checking…' : 'Join'}
            </Text>
          </TouchableOpacity>

          {preview ? (
            <View
              style={{
                marginTop: 22,
                borderWidth: 1,
                borderColor: '#E5E5EA',
                borderRadius: 14,
                padding: 16,
                backgroundColor: '#FFFFFF',
              }}
            >
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#1C1C1E' }}>
                Join "{preview.app_name}"?
              </Text>
              <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 20, color: '#636366' }}>
                You&apos;ll share data with the group. The app will be installed if you don&apos;t have
                it already.
              </Text>
              <TouchableOpacity
                onPress={handleJoin}
                disabled={joining}
                style={{
                  marginTop: 14,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: joining ? '#A8C8FF' : '#007AFF',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                {joining ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                  {joining ? 'Joining…' : 'Join Shared App'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
