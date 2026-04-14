import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedbackSheet } from '@/components/FeedbackSheet';
import { PromoCodeSheet } from '@/components/PromoCodeSheet';
import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { useUserProfile, type PlanType } from '@/hooks/useUserProfile';
import { log } from '@/lib/logger';
import { useTheme, useSetTheme, type Colors, type ThemeMode } from '@/lib/theme';
import { track } from '@/services/analytics';
import { posthog } from '../../src/config/posthog';
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
  theme: Colors;
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
  const { theme } = props;

  const rowContainerStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
  };

  const separator = !props.isLast && (
    <View
      style={{
        height: 0.5,
        backgroundColor: theme.separator,
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
                color: props.labelColor ?? theme.label,
                flex: 1,
              }}
            >
              {props.label}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {props.value && (
                <Text style={{ fontSize: 16, color: theme.labelSecondary }}>{props.value}</Text>
              )}
              <Text style={{ fontSize: 18, color: theme.labelTertiary, lineHeight: 22 }}>›</Text>
            </View>
          </TouchableOpacity>
        );

      case 'value':
        return (
          <View style={rowContainerStyle}>
            <Text style={{ fontSize: 16, color: theme.label, flex: 1 }}>{props.label}</Text>
            <Text style={{ fontSize: 16, color: theme.labelSecondary }}>{props.value}</Text>
          </View>
        );

      case 'toggle':
        return (
          <View style={rowContainerStyle}>
            <Text
              style={{
                fontSize: 16,
                color: props.disabled ? theme.labelSecondary : theme.label,
                flex: 1,
              }}
            >
              {props.label}
            </Text>
            <Switch
              value={props.value}
              onValueChange={props.onChange}
              disabled={props.disabled}
              trackColor={{ false: theme.separator, true: theme.success }}
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
                color: theme.labelSecondary,
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
  theme,
}: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
  theme: Colors;
}) {
  return (
    <View style={{ marginBottom: 28 }}>
      {title && (
        <Text
          style={{
            fontSize: 13,
            fontWeight: '500',
            color: theme.labelSecondary,
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
          backgroundColor: theme.surface,
          borderRadius: 10,
          overflow: 'hidden',
          borderWidth: 0.5,
          borderColor: theme.separator,
        }}
      >
        {children}
      </View>
      {footer && (
        <Text
          style={{
            fontSize: 13,
            color: theme.labelSecondary,
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
  const theme = useTheme();
  const setAppTheme = useSetTheme();

  const [appLock, setAppLock] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [storageUsed, setStorageUsed] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [promoSheetVisible, setPromoSheetVisible] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [storedSecrets, setStoredSecrets] = useState<{ name: string; sourceApp: string }[]>([]);
  const [addKeyVisible, setAddKeyVisible] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [appearance, setAppearance] = useState<'light' | 'dark' | 'system'>('light');
  const [pendingJoins, setPendingJoins] = useState<{ instance_id: string; invite_code: string; app_name: string }[]>([]);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('👤');
  const [editProfileSaving, setEditProfileSaving] = useState(false);

  const { profile, limits, redeemPromoCode, refresh: refreshProfile, updateDisplayName, updateAvatarEmoji } = useUserProfile();
  const { apps } = useInstalledApps();
  // Use local SQLite count (not Supabase counter) so Settings matches the Home screen.
  // The Supabase app_install_count can drift after device wipes or multi-device use.
  const localAppCount = apps.filter((a) => a.source_type !== 'demo').length;

  // Refresh auth state + profile whenever this screen comes into focus.
  useFocusEffect(
    useCallback(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUserEmail(session?.user?.email ?? null);
      });
      refreshProfile();
    }, [refreshProfile])
  );

  // Load pending join requests from local SQLite whenever Settings is focused.
  const loadPendingJoins = useCallback(async () => {
    try {
      const rows = await db.getAllAsync<{ key: string; value: string }>(
        `SELECT key, value FROM shared_data WHERE category = 'pending_joins' ORDER BY updated_at DESC`
      );
      setPendingJoins(
        rows.map((r) => {
          try {
            const parsed = JSON.parse(r.value) as { invite_code: string; app_name: string };
            return { instance_id: r.key, invite_code: parsed.invite_code, app_name: parsed.app_name };
          } catch {
            return null;
          }
        }).filter((x): x is NonNullable<typeof x> => x !== null)
      );
    } catch { /* non-critical */ }
  }, [db]);

  useFocusEffect(useCallback(() => { void loadPendingJoins(); }, [loadPendingJoins]));

  // Load stored API key names whenever Settings is focused.
  const loadSecrets = useCallback(async () => {
    try {
      const rows = await db.getAllAsync<{ key: string; source_app: string | null }>(
        `SELECT key, source_app FROM shared_data WHERE category = 'vault_secrets' ORDER BY key`
      );
      setStoredSecrets(rows.map((r) => ({ name: r.key, sourceApp: r.source_app ?? '' })));
    } catch {
      // non-critical
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void loadSecrets(); }, [loadSecrets]));

  const handleDeleteSecret = async (secretName: string) => {
    Alert.alert('Delete API Key', `Remove "${secretName}"? Any mini-app using it will lose access.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const SecureStore = await import('expo-secure-store');
            await SecureStore.deleteItemAsync(`vault_secret__global__${secretName}`);
            await db.runAsync(
              `DELETE FROM shared_data WHERE category = 'vault_secrets' AND key = ?`,
              secretName
            );
            await loadSecrets();
          } catch {
            Alert.alert('Error', 'Failed to delete secret.');
          }
        },
      },
    ]);
  };

  const handleSaveNewKey = async () => {
    const name = newKeyName.trim();
    const value = newKeyValue.trim();
    if (!name || !value) {
      Alert.alert('Missing fields', 'Both a name and a value are required.');
      return;
    }
    try {
      const SecureStore = await import('expo-secure-store');
      await SecureStore.setItemAsync(`vault_secret__global__${name}`, value);
      await db.runAsync(
        `INSERT OR REPLACE INTO shared_data (category, key, value, source_app, updated_at)
         VALUES ('vault_secrets', ?, 'stored', 'manual', datetime('now'))`,
        name
      );
      setNewKeyName('');
      setNewKeyValue('');
      setAddKeyVisible(false);
      await loadSecrets();
    } catch {
      Alert.alert('Error', 'Failed to save the API key.');
    }
  };

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
        const [lockRow, updateRow, storageRow, biometric, appearanceRow] = await Promise.all([
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
          db.getFirstAsync<{ value: string }>(
            `SELECT value FROM shared_data WHERE category='settings' AND key='appearance'`
          ),
        ]);

        if (lockRow) setAppLock(lockRow.value === 'true');
        if (updateRow) setAutoUpdate(updateRow.value !== 'false');
        if (storageRow) setStorageUsed(storageRow.total ?? 0);
        setBiometricAvailable(biometric);
        if (appearanceRow) {
          const val = appearanceRow.value as ThemeMode;
          setAppearance(val);
          setAppTheme(val);
        }
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
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next) {
      try {
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
      } catch {
        Alert.alert('Authentication Error', 'Biometric authentication is not available on this device.');
        return;
      }
    }
    setAppLock(next);
    await savePref('app_lock', String(next));
  };

  const handleAutoUpdateToggle = async (next: boolean) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAutoUpdate(next);
    await savePref('auto_update', String(next));
  };

  const handleAppearanceChange = () => {
    const options: { label: string; value: 'light' | 'dark' | 'system' }[] = [
      { label: 'Light', value: 'light' },
      { label: 'Dark', value: 'dark' },
      { label: 'System', value: 'system' },
    ];
    Alert.alert(
      'Appearance',
      'Choose a color scheme',
      [
        ...options.map(({ label, value }) => ({
          text: label + (appearance === value ? ' ✓' : ''),
          onPress: async () => {
            setAppearance(value);
            setAppTheme(value);
            await savePref('appearance', value);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  };

  const handleOpenEditProfile = () => {
    setEditName(profile?.display_name ?? '');
    setEditEmoji(profile?.avatar_emoji ?? '👤');
    setEditProfileVisible(true);
  };

  const handleSaveProfile = async () => {
    setEditProfileSaving(true);
    try {
      const trimmed = editName.trim();
      await updateDisplayName(trimmed);
      await updateAvatarEmoji(editEmoji);
      setEditProfileVisible(false);
    } catch {
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setEditProfileSaving(false);
    }
  };

  const handleExportData = async () => {
    try {
      // app_data lives in PowerSync (syncDb), not expo-sqlite — the bridge writes
      // via syncDb.execute('INSERT OR REPLACE INTO app_data ...'), so db.getAllAsync
      // on the expo-sqlite handle always returns an empty array.
      const [appRows, dataRows] = await Promise.all([
        db.getAllAsync('SELECT * FROM apps'),
        syncDb.getAll<{ app_id: string; key: string; value: string; updated_at: string }>(
          'SELECT app_id, key, value, updated_at FROM app_data'
        ),
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
              // Remove from PowerSync local table
              await syncDb.execute('DELETE FROM installed_apps');
              // Also delete from Supabase so PowerSync has nothing to re-sync.
              // Without this, the sync engine re-fetches the rows and useRestoreApps
              // puts them back into the local apps table within seconds.
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                await supabase.from('installed_apps').delete().eq('user_id', session.user.id);
              }
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
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top']}>
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
            color: theme.label,
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
                color: theme.labelSecondary,
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
                backgroundColor: theme.surface,
                borderRadius: 10,
                overflow: 'hidden',
                borderWidth: 0.5,
                borderColor: theme.separator,
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
                    backgroundColor: theme.background,
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: 12,
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{profile.avatar_emoji ?? '👤'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontSize: 16, fontWeight: '600', color: theme.label }}
                    numberOfLines={1}
                  >
                    {userEmail}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <PlanBadge plan={profile.plan} />
                    {profile.plan_expires_at && (
                      <Text style={{ fontSize: 13, color: theme.labelSecondary }}>
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
                    backgroundColor: theme.primary,
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
                  onPress={handleOpenEditProfile}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 8,
                    backgroundColor: theme.background,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.label }}>
                    Edit Profile
                  </Text>
                </TouchableOpacity>
              </View>

              {/* App limit */}
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, color: theme.labelSecondary }}>Apps installed</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: theme.label }}>
                    {localAppCount} / {limits.appLimit === null ? '∞' : limits.appLimit}
                  </Text>
                </View>
                {limits.appLimit !== null && (
                  <View style={{ height: 4, backgroundColor: theme.separator, borderRadius: 2, overflow: 'hidden' }}>
                    <View
                      style={{
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: localAppCount >= (limits.appLimit ?? 0) ? theme.destructive : theme.primary,
                        width: `${Math.min((localAppCount / (limits.appLimit ?? 1)) * 100, 100)}%`,
                      }}
                    />
                  </View>
                )}
              </View>
            </View>
          </View>
        ) : null}

        {/* Account rows */}
        <Section title={userEmail && profile ? undefined : 'Account'} theme={theme}>
          {userEmail ? (
            <>
              <Row
                kind="value"
                label="Sync Status"
                value={isConnected ? 'Connected ✓' : 'Offline'}
                theme={theme}
              />
              {pendingJoins.length > 0 && (
                <>
                  {pendingJoins.map((pj) => (
                    <Row
                      key={pj.instance_id}
                      kind="chevron"
                      label={`⏳ ${pj.app_name}`}
                      value="Pending approval"
                      onPress={() => router.push(`/join-shared-app?code=${pj.invite_code}` as any)}
                      theme={theme}
                    />
                  ))}
                </>
              )}
              <Row
                kind="chevron"
                label="Join Shared App"
                onPress={() => router.push('/join-shared-app' as any)}
                theme={theme}
              />
              <Row
                kind="chevron"
                label="Debug: Check Sync DB"
                onPress={handleDebugSync}
                theme={theme}
              />
              <Row
                kind="chevron"
                label="Sign Out"
                labelColor={theme.destructive}
                onPress={handleSignOut}
                isLast
                theme={theme}
              />
            </>
          ) : (
            <Row
              kind="chevron"
              label="Sign In"
              onPress={() => router.push('/auth')}
              isLast
              theme={theme}
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
          theme={theme}
        >
          <Row
            kind="chevron"
            label="Appearance"
            value={appearance.charAt(0).toUpperCase() + appearance.slice(1)}
            onPress={handleAppearanceChange}
            theme={theme}
          />
          <Row
            kind="toggle"
            label="App Lock"
            value={appLock}
            onChange={handleAppLockToggle}
            disabled={!biometricAvailable}
            theme={theme}
          />
          <Row
            kind="toggle"
            label="Auto-Update Apps"
            value={autoUpdate}
            onChange={handleAutoUpdateToggle}
            isLast
            theme={theme}
          />
        </Section>

        {/* Data */}
        <Section title="Data" theme={theme}>
          <Row kind="value" label="Storage Used" value={formatBytes(storageUsed)} theme={theme} />
          <Row kind="chevron" label="Export All Data" onPress={handleExportData} theme={theme} />
          <Row
            kind="chevron"
            label="Clear All Data"
            labelColor={theme.destructive}
            onPress={handleClearAllData}
            isLast
            theme={theme}
          />
        </Section>

        {/* API Keys */}
        <Section
          title="API Keys"
          footer="Stored securely on-device. Mini-apps inject these into API requests — values are never exposed to the web."
          theme={theme}
        >
          {storedSecrets.map((s, i) => (
            <Row
              key={s.name}
              kind="chevron"
              label={s.name}
              value={s.sourceApp === 'manual' ? 'manual' : 'from app'}
              onPress={() => handleDeleteSecret(s.name)}
              isLast={false}
              theme={theme}
            />
          ))}
          <Row
            kind="chevron"
            label="Add API Key"
            labelColor={theme.primary}
            onPress={() => setAddKeyVisible(true)}
            isLast
            theme={theme}
          />
        </Section>

        {/* Add API Key modal */}
        <Modal
          visible={addKeyVisible}
          animationType="slide"
          presentationStyle="formSheet"
          onRequestClose={() => setAddKeyVisible(false)}
        >
          <View style={{ flex: 1, backgroundColor: theme.background }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 12,
            }}>
              <TouchableOpacity onPress={() => { setAddKeyVisible(false); setNewKeyName(''); setNewKeyValue(''); }}>
                <Text style={{ fontSize: 16, color: theme.primary }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 17, fontWeight: '600', color: theme.label }}>Add API Key</Text>
              <TouchableOpacity onPress={handleSaveNewKey}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: theme.primary }}>Save</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginHorizontal: 16, marginTop: 8, gap: 12 }}>
              <View style={{
                backgroundColor: theme.surface,
                borderRadius: 10,
                borderWidth: 0.5,
                borderColor: theme.separator,
                overflow: 'hidden',
              }}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, color: theme.labelSecondary, marginBottom: 2, marginTop: 8 }}>KEY NAME</Text>
                  <TextInput
                    value={newKeyName}
                    onChangeText={setNewKeyName}
                    placeholder="e.g. openai, anthropic"
                    placeholderTextColor={theme.labelTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ fontSize: 16, color: theme.label, paddingVertical: 8 }}
                  />
                </View>
              </View>

              <View style={{
                backgroundColor: theme.surface,
                borderRadius: 10,
                borderWidth: 0.5,
                borderColor: theme.separator,
                overflow: 'hidden',
              }}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, color: theme.labelSecondary, marginBottom: 2, marginTop: 8 }}>VALUE</Text>
                  <TextInput
                    value={newKeyValue}
                    onChangeText={setNewKeyValue}
                    placeholder="sk-..."
                    placeholderTextColor={theme.labelTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    style={{ fontSize: 16, color: theme.label, paddingVertical: 8 }}
                  />
                </View>
              </View>

              <Text style={{ fontSize: 13, color: theme.labelSecondary, paddingHorizontal: 4, lineHeight: 18 }}>
                The key name is what mini-apps reference (e.g. "openai"). The value is never displayed again after saving.
              </Text>
            </View>
          </View>
        </Modal>

        {/* About */}
        <Section title="About" theme={theme}>
          <Row
            kind="chevron"
            label="Send Feedback"
            onPress={() => setFeedbackVisible(true)}
            theme={theme}
          />
          <Row
            kind="value"
            label="Version"
            value={`${Constants.expoConfig?.version ?? '0.0.0'} (${Constants.expoConfig?.extra?.eas?.projectId ? 'EAS' : 'dev'})`}
            theme={theme}
          />
          <Row kind="info" label="Built with ❤️ in Hyderabad" centered theme={theme} />
          <Row kind="info" label="Cottix — Personal App OS" centered isLast theme={theme} />
        </Section>
      </ScrollView>

      {/* Edit Profile modal */}
      <Modal
        visible={editProfileVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setEditProfileVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 12,
          }}>
            <TouchableOpacity onPress={() => setEditProfileVisible(false)}>
              <Text style={{ fontSize: 16, color: theme.primary }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: '600', color: theme.label }}>Edit Profile</Text>
            <TouchableOpacity onPress={handleSaveProfile} disabled={editProfileSaving}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: editProfileSaving ? '#A8C8FF' : theme.primary }}>
                {editProfileSaving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginHorizontal: 16, gap: 20, marginTop: 8 }}>
            {/* Avatar emoji picker */}
            <View>
              <Text style={{ fontSize: 13, fontWeight: '500', color: theme.labelSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                Avatar
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {['👤','😀','😎','🤓','🧑‍💻','🦊','🐻','🐼','🦁','🐸','🚀','⭐','🔥','💡','🎯'].map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => setEditEmoji(emoji)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: editEmoji === emoji ? '#007AFF20' : theme.surface,
                      borderWidth: editEmoji === emoji ? 2 : 1,
                      borderColor: editEmoji === emoji ? theme.primary : theme.separator,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Display name */}
            <View>
              <Text style={{ fontSize: 13, fontWeight: '500', color: theme.labelSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                Display Name
              </Text>
              <View style={{
                backgroundColor: theme.surface,
                borderRadius: 10,
                borderWidth: 0.5,
                borderColor: theme.separator,
                overflow: 'hidden',
              }}>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Your name"
                  placeholderTextColor={theme.labelTertiary}
                  autoCorrect={false}
                  returnKeyType="done"
                  style={{ fontSize: 16, color: theme.label, paddingHorizontal: 16, paddingVertical: 13 }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <PromoCodeSheet
        visible={promoSheetVisible}
        onClose={() => setPromoSheetVisible(false)}
        onRedeem={async (code) => {
          const result = await redeemPromoCode(code);
          if (result.success) {
            void track('promo_redeemed', { code, plan_granted: profile?.plan });
            posthog.capture('promo_code_redeemed', { code, plan_granted: profile?.plan ?? null });
          }
          return result;
        }}
      />
      <FeedbackSheet
        visible={feedbackVisible}
        onClose={() => setFeedbackVisible(false)}
      />
    </SafeAreaView>
  );
}
