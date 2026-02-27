import * as FileSystem from 'expo-file-system/legacy';
import * as LocalAuthentication from 'expo-local-authentication';
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

import { useDatabase } from '@/hooks/useDatabase';

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

  const [appLock, setAppLock] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [storageUsed, setStorageUsed] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

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

  const handleSignIn = () => {
    Alert.alert('Coming soon', 'Cloud sync & sharing is coming in a future update.');
  };

  const handleAppLockToggle = async (next: boolean) => {
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
      const path = `${FileSystem.cacheDirectory}perappos-export.json`;
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
        dialogTitle: 'Export Perappos Data',
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
              await db.execAsync(`
                DELETE FROM app_data;
                DELETE FROM shared_data WHERE category != 'settings';
                DELETE FROM apps;
              `);
              setStorageUsed(0);
              Alert.alert('Done', 'All app data has been cleared.');
            } catch {
              Alert.alert('Error', 'Failed to clear data. Please try again.');
            }
          },
        },
      ]
    );
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
        {/* Account */}
        <Section title="Account">
          <Row
            kind="chevron"
            label="Sign In"
            onPress={handleSignIn}
            isLast
          />
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
          <Row kind="info" label="Perappos — Personal App OS" centered isLast />
        </Section>
      </ScrollView>
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
