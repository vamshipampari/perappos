import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PromoCodeSheet } from '@/components/PromoCodeSheet';
import { useDatabase } from '@/hooks/useDatabase';
import { useUserProfile, type PlanType } from '@/hooks/useUserProfile';
import { log } from '@/lib/logger';
import { supabase } from '../../services/supabase';
import { usePowerSync } from '../../services/sync/PowerSyncProvider';

// ─── Plan badge ──────────────────────────────────────────────────────────────

const PLAN_BADGE_COLORS: Record<PlanType, { bg: string; text: string }> = {
  free: { bg: '#E5E5EA', text: '#8E8E93' },
  beta: { bg: '#7C3AED', text: '#FFFFFF' },
  pro: { bg: '#007AFF', text: '#FFFFFF' },
  team: { bg: '#059669', text: '#FFFFFF' },
};

function PlanBadge({ plan }: { plan: PlanType }) {
  const colors = PLAN_BADGE_COLORS[plan] ?? PLAN_BADGE_COLORS.free;
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);
  return (
    <View
      style={{
        backgroundColor: colors.bg,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>
        {label}
      </Text>
    </View>
  );
}

function formatExpiry(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (isNaN(d.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Expires ${months[d.getMonth()]} ${d.getDate()}`;
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Row variants ─────────────────────────────────────────────────────────────

interface BaseRowProps {
  label: string;
  isLast?: boolean;
}

interface ChevronRowProps extends BaseRowProps {
  kind: 'chevron';
  value?: string;
  labelColor?: string;
  onPress: () => void;
}

interface ValueRowProps extends BaseRowProps {
  kind: 'value';
  value: string;
}

interface ToggleRowProps extends BaseRowProps {
  kind: 'toggle';
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

interface InfoRowProps extends BaseRowProps {
  kind: 'info';
  centered?: boolean;
}

type RowProps = ChevronRowProps | ValueRowProps | ToggleRowProps | InfoRowProps;

function Row(props: RowProps) {
  const separator = !props.isLast && (
    <View
      style={{
        height: 0.5,
        backgroundColor: '#E5E5EA',
        marginLeft: 16,
      }}
    />
  );

  const inner = (() => {
    switch (props.kind) {
      case 'chevron':
        return (
          <TouchableOpacity
            onPress={props.onPress}
            activeOpacity={0.6}
            style={rowContainerStyle}
          >
            <Text
              style={{
                fontSize: 16,
                color: props.labelColor ?? '#1C1C1E',
                flex: 1,
              }}
            >
              {props.label}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {props.value && (
                <Text style={{ fontSize: 16, color: '#8E8E93' }}>{props.value}</Text>
              )}
              <Text style={{ fontSize: 18, color: '#C7C7CC', lineHeight: 22 }}>›</Text>
            </View>
          </TouchableOpacity>
        );

      case 'value':
        return (
          <View style={rowContainerStyle}>
            <Text style={{ fontSize: 16, color: '#1C1C1E', flex: 1 }}>{props.label}</Text>
            <Text style={{ fontSize: 16, color: '#8E8E93' }}>{props.value}</Text>
          </View>
        );

      case 'toggle':
        return (
          <View style={rowContainerStyle}>
            <Text
              style={{
                fontSize: 16,
                color: props.disabled ? '#8E8E93' : '#1C1C1E',
                flex: 1,
              }}
            >
              {props.label}
            </Text>
            <Switch
              value={props.value}
              onValueChange={props.onChange}
              disabled={props.disabled}
              trackColor={{ false: '#E5E5EA', true: '#34C759' }}
              thumbColor="#FFFFFF"
            />
          </View>
        );

      case 'info':
        return (
          <View
            style={[
              rowContainerStyle,
              props.centered && { justifyContent: 'center' },
            ]}
          >
            <Text
              style={{
                fontSize: 15,
                color: '#8E8E93',
                textAlign: props.centered ? 'center' : 'left',
                flex: props.centered ? undefined : 1,
              }}
            >
              {props.label}
            </Text>
          </View>
        );
    }
  })();

  return (
    <>
      {inner}
      {separator}
    </>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function Section({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 28 }}>
      {title && (
        <Text
          style={{
            fontSize: 13,
            fontWeight: '500',
            color: '#8E8E93',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            paddingHorizontal: 20,
            marginBottom: 6,
          }}
        >
          {title}
        </Text>
      )}
      <View
        style={{
          marginHorizontal: 16,
          backgroundColor: '#FFFFFF',
          borderRadius: 10,
          overflow: 'hidden',
          borderWidth: 0.5,
          borderColor: '#E5E5EA',
        }}
      >
        {children}
      </View>
      {footer && (
        <Text
          style={{
            fontSize: 13,
            color: '#8E8E93',
            paddingHorizontal: 20,
            marginTop: 6,
            lineHeight: 18,
          }}
        >
          {footer}
        </Text>
      )}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const db = useDatabase();
  const { db: syncDb, isConnected } = usePowerSync();

  const [appLock, setAppLock] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [storageUsed, setStorageUsed] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [promoSheetVisible, setPromoSheetVisible] = useState(false);

  const { profile, limits, redeemPromoCode, refresh: refreshProfile } = useUserProfile();

  // Refresh auth state + profile whenever this screen comes into focus.
  useFocusEffect(
    useCallback(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUserEmail(session?.user?.email ?? null);
      });
      refreshProfile();
    }, [refreshProfile])
  );

  // Also keep a live subscription so sign-out updates instantly.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load persisted preferences + storage stats on mount
  useEffect(() => {
    (async () => {
      try {
        const [lockRow, updateRow, storageRow, biometric] = await Promise.all([
          db.getFirstAsync<{ value: string }>(
            `SELECT value FROM shared_data WHERE category='settings' AND key='app_lock'`
          ),
          db.getFirstAsync<{ value: string }>(
            `SELECT value FROM shared_data WHERE category='settings' AND key='auto_update'`
          ),
          db.getFirstAsync<{ total: number }>(
            `SELECT COALESCE(SUM(bundle_size), 0) AS total FROM apps`
          ),
          LocalAuthentication.hasHardwareAsync(),
        ]);

        if (lockRow) setAppLock(lockRow.value === 'true');
        if (updateRow) setAutoUpdate(updateRow.value !== 'false');
        if (storageRow) setStorageUsed(storageRow.total ?? 0);
        setBiometricAvailable(biometric);
      } catch {
        // non-critical, defaults are fine
      }
    })();
  }, [db]);

  const savePref = useCallback(
    async (key: string, value: string) => {
      await db.runAsync(
        `INSERT OR REPLACE INTO shared_data (category, key, value, updated_at)
         VALUES ('settings', ?, ?, datetime('now'))`,
        key,
        value
      );
    },
    [db]
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  const handleAppLockToggle = async (next: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next) {
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) {
        Alert.alert(
          'No Biometrics',
          'Set up Face ID or fingerprint in your device settings first.'
        );
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to enable App Lock',
        fallbackLabel: 'Use passcode',
      });
      if (!result.success) return;
    }
    setAppLock(next);
    await savePref('app_lock', String(next));
  };

  const handleAutoUpdateToggle = async (next: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAutoUpdate(next);
    await savePref('auto_update', String(next));
  };

  const handleExportData = async () => {
    try {
      const [appRows, dataRows] = await Promise.all([
        db.getAllAsync('SELECT * FROM apps'),
        db.getAllAsync('SELECT * FROM app_data'),
      ]);

      const payload = JSON.stringify({ apps: appRows, app_data: dataRows }, null, 2);
      const path = `${FileSystem.cacheDirectory}cottix-export.json`;
      await FileSystem.writeAsStringAsync(path, payload, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing not available', 'Cannot share files on this device.');
        return;
      }
      await Sharing.shareAsync(path, {
        mimeType: 'application/json',
        dialogTitle: 'Export Cottix Data',
        UTI: 'public.json',
      });
    } catch (e) {
      Alert.alert('Export failed', 'Could not export data. Please try again.');
    }
  };

  const handleClearAllData = () => {
    Alert.alert(
      'Clear All Data',
      'This will permanently delete all installed apps and their data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              const countRow = await db.getFirstAsync<{ n: number }>(
                'SELECT COUNT(*) AS n FROM apps'
              );
              await db.execAsync(`
                DELETE FROM app_data;
                DELETE FROM shared_data WHERE category != 'settings';
                DELETE FROM apps;
              `);
              setStorageUsed(0);
              // Reset app count in profile
              if (countRow && countRow.n > 0) {
                void supabase.rpc('increment_app_count', { delta: -countRow.n }).then(undefined, () => {});
              }
              Alert.alert('Done', 'All app data has been cleared.');
            } catch {
              Alert.alert('Error', 'Failed to clear data. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleDebugSync = async () => {
    try {
      const rows = await syncDb.getAll<{ app_id: string; key: string; value: string }>(
        'SELECT app_id, key, value FROM app_data LIMIT 10'
      );
      const mergeRows = await syncDb.getAll<{
        key: string;
        version: number | null;
        last_merge_strategy: string | null;
        last_conflict_count: number | null;
        updated_at: string | null;
      }>(
        `SELECT key, version, last_merge_strategy, last_conflict_count, updated_at
         FROM shared_app_data
         ORDER BY updated_at DESC
         LIMIT 10`
      );
      const total = await syncDb.getOptional<{ n: number }>('SELECT COUNT(*) AS n FROM app_data');
      const appRows = await db.getAllAsync<{ app_id: string; name: string; instance_id: string | null }>(
        'SELECT app_id, name, instance_id FROM apps'
      );
      const count = total?.n ?? 0;
      log.info('[DebugSync] app_data row count:', count);
      log.info('[DebugSync] first rows:', rows);
      log.info('[DebugSync] merge status rows:', mergeRows);
      log.info('[DebugSync] apps rows:', appRows);

      const mergeStatus = mergeRows.length === 0
        ? 'none'
        : mergeRows
            .map(
              (r) =>
                `${r.key} | v${r.version ?? 0} | ${r.last_merge_strategy ?? 'unknown'} | conflicts ${r.last_conflict_count ?? 0}`
            )
            .join('\n');
      const appsStatus = appRows.length === 0
        ? 'none'
        : appRows
            .map((r) => `${r.name} | instance_id: ${r.instance_id ?? 'null'}`)
            .join('\n');

      Alert.alert(
        `Sync DB: ${count} row${count === 1 ? '' : 's'}`,
        (count === 0
          ? 'No data in PowerSync app_data table.'
          : rows.map((r) => `[${r.app_id.slice(0, 8)}] ${r.key} = ${r.value.slice(0, 40)}`).join('\n'))
          + `\n\nMerge Status:\n${mergeStatus}`
          + `\n\nApps:\n${appsStatus}`
      );
    } catch (e) {
      log.error('[DebugSync] error:', e);
      Alert.alert('Debug error', String(e));
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F2F2F7' }} edges={['top']}>
      {/* Large title */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <Text
          style={{
            fontSize: 34,
            fontWeight: '700',
            color: '#1C1C1E',
            letterSpacing: 0.3,
          }}
        >
          Settings
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 48 }}
      >
        {/* Account Card */}
        {userEmail && profile ? (
          <View style={{ marginBottom: 28 }}>
            <Text
              style={{
                fontSize: 13,
                fontWeight: '500',
                color: '#8E8E93',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                paddingHorizontal: 20,
                marginBottom: 6,
              }}
            >
              Account
            </Text>
            <View
              style={{
                marginHorizontal: 16,
                backgroundColor: '#FFFFFF',
                borderRadius: 10,
                overflow: 'hidden',
                borderWidth: 0.5,
                borderColor: '#E5E5EA',
                padding: 16,
              }}
            >
              {/* Profile row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: '#F2F2F7',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: 12,
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{profile.avatar_emoji ?? '👤'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontSize: 16, fontWeight: '600', color: '#1C1C1E' }}
                    numberOfLines={1}
                  >
                    {userEmail}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <PlanBadge plan={profile.plan} />
                    {profile.plan_expires_at && (
                      <Text style={{ fontSize: 13, color: '#8E8E93' }}>
                        {formatExpiry(profile.plan_expires_at)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>

              {/* Action buttons */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setPromoSheetVisible(true)}
                  activeOpacity={0.7}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 8,
                    backgroundColor: '#007AFF',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#FFFFFF' }}>
                    Redeem Code
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  disabled
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 8,
                    backgroundColor: '#F2F2F7',
                    justifyContent: 'center',
                    alignItems: 'center',
                    opacity: 0.5,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E' }}>
                    Edit Profile
                  </Text>
                </TouchableOpacity>
              </View>

              {/* App limit */}
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, color: '#8E8E93' }}>Apps installed</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#1C1C1E' }}>
                    {profile.app_install_count} / {limits.maxApps === Infinity ? '∞' : limits.maxApps}
                  </Text>
                </View>
                {limits.maxApps !== Infinity && (
                  <View style={{ height: 4, backgroundColor: '#E5E5EA', borderRadius: 2, overflow: 'hidden' }}>
                    <View
                      style={{
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: profile.app_install_count >= limits.maxApps ? '#FF3B30' : '#007AFF',
                        width: `${Math.min((profile.app_install_count / limits.maxApps) * 100, 100)}%`,
                      }}
                    />
                  </View>
                )}
              </View>
            </View>
          </View>
        ) : null}

        {/* Account rows */}
        <Section title={userEmail && profile ? undefined : 'Account'}>
          {userEmail ? (
            <>
              <Row
                kind="value"
                label="Sync Status"
                value={isConnected ? 'Connected ✓' : 'Offline'}
              />
              <Row
                kind="chevron"
                label="Join Shared App"
                onPress={() => router.push('/join-shared-app' as any)}
              />
              <Row
                kind="chevron"
                label="Debug: Check Sync DB"
                onPress={handleDebugSync}
              />
              <Row
                kind="chevron"
                label="Sign Out"
                labelColor="#FF3B30"
                onPress={handleSignOut}
                isLast
              />
            </>
          ) : (
            <Row
              kind="chevron"
              label="Sign In"
              onPress={() => router.push('/auth')}
              isLast
            />
          )}
        </Section>

        {/* General */}
        <Section
          title="General"
          footer={
            !biometricAvailable
              ? 'App Lock requires Face ID or fingerprint to be set up on this device.'
              : undefined
          }
        >
          <Row kind="value" label="Appearance" value="Light" />
          <Row
            kind="toggle"
            label="App Lock"
            value={appLock}
            onChange={handleAppLockToggle}
            disabled={!biometricAvailable}
          />
          <Row
            kind="toggle"
            label="Auto-Update Apps"
            value={autoUpdate}
            onChange={handleAutoUpdateToggle}
            isLast
          />
        </Section>

        {/* Data */}
        <Section title="Data">
          <Row kind="value" label="Storage Used" value={formatBytes(storageUsed)} />
          <Row kind="chevron" label="Export All Data" onPress={handleExportData} />
          <Row
            kind="chevron"
            label="Clear All Data"
            labelColor="#FF3B30"
            onPress={handleClearAllData}
            isLast
          />
        </Section>

        {/* About */}
        <Section title="About">
          <Row kind="value" label="Version" value="0.1.0" />
          <Row kind="info" label="Built with ❤️ in Hyderabad" centered />
          <Row kind="info" label="Cottix — Personal App OS" centered isLast />
        </Section>
      </ScrollView>

      <PromoCodeSheet
        visible={promoSheetVisible}
        onClose={() => setPromoSheetVisible(false)}
        onRedeem={redeemPromoCode}
      />
    </SafeAreaView>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const rowContainerStyle: import('react-native').ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 16,
  paddingVertical: 12,
  minHeight: 44,
};
