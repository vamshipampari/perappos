import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { useTheme } from '@/lib/theme';
import { Sentry, toError } from '@/lib/sentry';
import {
  joinSharedAppByCode,
  type JoinStatus,
  type SharedInstance,
} from '@/services/collaborationService';
import { reconnectPowerSync } from '@/services/sync/PowerSyncProvider';
import { supabase } from '@/services/supabase';
import { track } from '@/services/analytics';
import { posthog } from '../src/config/posthog';

export default function JoinSharedAppScreen() {
  const db = useDatabase();
  const { refresh } = useInstalledApps();
  const params = useLocalSearchParams<{ code?: string }>();

  const [code, setCode] = useState(params.code ?? '');
  const [preview, setPreview] = useState<SharedInstance | null>(null);
  const [checking, setChecking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinStatus, setJoinStatus] = useState<JoinStatus | null>(null);
  const [existingMemberStatus, setExistingMemberStatus] = useState<'active' | 'pending' | null>(null);
  const joinStateRef = useRef('idle');
  const autoTriggered = useRef(false);

  const theme = useTheme();
  const normalizedCode = code.trim().toUpperCase();

  // When launched with ?code=XXX (from Settings pending list), auto-trigger check.
  useEffect(() => {
    if (params.code && !autoTriggered.current) {
      autoTriggered.current = true;
      // Small delay to let the screen mount fully before firing.
      setTimeout(() => { void handleCheck(); }, 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist / clear pending join in local SQLite ─────────────────────────────

  const savePendingJoin = async (instance: SharedInstance) => {
    try {
      await db.runAsync(
        `INSERT OR REPLACE INTO shared_data (category, key, value, source_app, updated_at)
         VALUES ('pending_joins', ?, ?, NULL, datetime('now'))`,
        instance.instance_id,
        JSON.stringify({ invite_code: instance.invite_code.toUpperCase(), app_name: instance.app_name })
      );
    } catch { /* non-critical */ }
  };

  const clearPendingJoin = async (instanceId: string) => {
    try {
      await db.runAsync(
        `DELETE FROM shared_data WHERE category = 'pending_joins' AND key = ?`,
        instanceId
      );
    } catch { /* non-critical */ }
  };

  const handleCheck = async () => {
    if (normalizedCode.length < 6) {
      Alert.alert('Invalid code', 'Enter the 6-character invite code.');
      return;
    }

    setChecking(true);
    setJoinStatus(null);
    setExistingMemberStatus(null);
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

      // Check if the user is already a member so we can show the right button.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data: memberRows } = await supabase
            .from('instance_members')
            .select('status')
            .eq('instance_id', instance.instance_id)
            .eq('user_id', session.user.id)
            .limit(1);
          const status = (memberRows as Array<{ status: string }> | null)?.[0]?.status ?? null;
          if (status === 'active' || status === 'pending') {
            setExistingMemberStatus(status);
          }
        }
      } catch { /* non-critical */ }

      setPreview(instance);
    } catch (error) {
      Sentry.captureException(toError(error), {
        tags: { screen: 'join_shared_app', step: 'lookup' },
        extra: { inviteCode: normalizedCode },
      });
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
      log.info('Join result:', JSON.stringify({ appId: result.appId, status: result.status }));

      setJoinStatus(result.status);
      clearTimeout(timeoutId);

      if (result.status === 'already_active') {
        // User is already approved — clear pending record, reconnect PowerSync, navigate.
        await clearPendingJoin(result.instance.instance_id);
        await reconnectPowerSync();
        await refresh();
        void track('share_joined', { instance_id: result.instance.instance_id });
        posthog.capture('share_joined', { instance_id: result.instance.instance_id });
        setJoining(false);
        router.replace(`/app/${result.appId}`);
        return;
      }

      if (result.status === 'pending' || result.status === 'already_pending') {
        // Request submitted (or still pending) — persist so Settings can show it.
        await savePendingJoin(result.instance);
        void track('share_join_requested', { instance_id: result.instance.instance_id });
        posthog.capture('share_join_requested', { instance_id: result.instance.instance_id });
        setJoining(false);
        return;
      }
    } catch (err) {
      try {
        log.error('Join error:', JSON.stringify(err));
      } catch {
        log.error('Join error:', String(err));
      }
      Sentry.captureException(toError(err), {
        tags: { screen: 'join_shared_app', step: 'join' },
        extra: {
          inviteCode: normalizedCode,
          previewInstanceId: preview?.instance_id ?? null,
        },
      });
      Alert.alert('Error', String(err));
      setJoining(false);
    } finally {
      clearTimeout(timeoutId);
      setJoining(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: 0.5,
            borderBottomColor: theme.separator,
          }}
        >
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Text style={{ fontSize: 17, color: theme.primary }}>Back</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '600', color: theme.label }}>Join Shared App</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
          <Text style={{ fontSize: 14, color: theme.labelSecondary, marginBottom: 10 }}>
            Invite code
          </Text>

          <TextInput
            value={normalizedCode}
            onChangeText={(text) => {
              setCode(text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8));
              if (preview) setPreview(null);
              if (joinStatus) setJoinStatus(null);
              if (existingMemberStatus) setExistingMemberStatus(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            placeholder="AB3K9Z"
            placeholderTextColor={theme.labelTertiary}
            style={{
              borderWidth: 1.5,
              borderColor: theme.separator,
              borderRadius: 12,
              paddingHorizontal: 16,
              height: 58,
              fontSize: 28,
              fontWeight: '700',
              letterSpacing: 8,
              textAlign: 'center',
              color: theme.label,
              backgroundColor: theme.inputBackground,
            }}
          />

          <TouchableOpacity
            onPress={handleCheck}
            disabled={checking}
            style={{
              marginTop: 16,
              height: 48,
              borderRadius: 12,
              backgroundColor: checking ? '#A8C8FF' : theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
            }}
          >
            {checking ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
              {checking ? 'Checking…' : 'Look Up Code'}
            </Text>
          </TouchableOpacity>

          {/* ── Pending confirmation banner ────────────────────────────── */}
          {(joinStatus === 'pending' || joinStatus === 'already_pending') && (
            <View
              style={{
                marginTop: 22,
                borderRadius: 14,
                padding: 20,
                backgroundColor: '#FFF7ED',
                borderWidth: 1,
                borderColor: '#FED7AA',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Text style={{ fontSize: 28 }}>⏳</Text>
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#92400E', textAlign: 'center' }}>
                {joinStatus === 'already_pending' ? 'Still waiting for approval' : 'Request sent!'}
              </Text>
              <Text style={{ fontSize: 14, color: '#B45309', textAlign: 'center', lineHeight: 20 }}>
                {joinStatus === 'already_pending'
                  ? 'Your request is pending. The owner needs to approve it before you can access shared data.'
                  : `Your join request for "${preview?.app_name ?? 'this app'}" has been sent. The owner will be notified.`}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <TouchableOpacity
                  onPress={handleJoin}
                  disabled={joining}
                  style={{
                    flex: 1,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1.5,
                    borderColor: '#F59E0B',
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                  activeOpacity={0.8}
                >
                  {joining ? <ActivityIndicator size="small" color="#F59E0B" /> : null}
                  <Text style={{ color: '#92400E', fontWeight: '600', fontSize: 14 }}>
                    {joining ? 'Checking…' : 'Check Status'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={{
                    flex: 1,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: '#F59E0B',
                    alignItems: 'center',
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 14 }}>Got it</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Preview card (shown before joining) ───────────────────── */}
          {preview && joinStatus === null ? (
            <View
              style={{
                marginTop: 22,
                borderWidth: 1,
                borderColor: theme.separator,
                borderRadius: 14,
                padding: 16,
                backgroundColor: theme.surface,
              }}
            >
              <Text style={{ fontSize: 17, fontWeight: '600', color: theme.label }}>
                Join &quot;{preview.app_name}&quot;?
              </Text>
              <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 20, color: theme.labelSecondary }}>
                {existingMemberStatus === 'active'
                  ? "You're approved — tap to open the app."
                  : 'Your request will be sent to the owner for approval. Once approved, you\'ll share data with the group.'}
              </Text>
              <TouchableOpacity
                onPress={handleJoin}
                disabled={joining}
                style={{
                  marginTop: 14,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: joining ? '#A8C8FF' : theme.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                {joining ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                  {joining
                    ? (existingMemberStatus === 'active' ? 'Opening…' : 'Sending request…')
                    : (existingMemberStatus === 'active' ? 'Open App' : 'Request to Join')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
