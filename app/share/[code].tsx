import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/Toast';
import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { installUrlApp } from '../../services/appInstaller';
import { supabase } from '../../services/supabase';

interface SharedApp {
  id: string;
  name: string;
  source_url: string | null;
  icon_emoji: string;
  icon_bg_color: string;
  share_code: string;
}

export default function SharePreviewScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const db = useDatabase();
  const { refresh } = useInstalledApps();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [sharedApp, setSharedApp] = useState<SharedApp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    supabase
      .from('shared_apps')
      .select('*')
      .eq('share_code', code)
      .eq('is_active', true)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data) {
          setError('This share link is no longer active.');
        } else {
          setSharedApp(data as SharedApp);
        }
        setLoading(false);
      });
  }, [code]);

  const handleInstall = async () => {
    if (!sharedApp) return;

    if (!sharedApp.source_url) {
      Alert.alert(
        'Cannot Install',
        "This app can't be installed automatically. Ask the sender for the app URL."
      );
      return;
    }

    setInstalling(true);
    try {
      await installUrlApp(db, {
        url: sharedApp.source_url,
        name: sharedApp.name,
        iconEmoji: sharedApp.icon_emoji,
        iconBgColor: sharedApp.icon_bg_color,
      });
      await refresh();
      showToast('App installed ✓', 'success');
      router.replace('/(tabs)');
    } catch {
      Alert.alert('Install failed', 'Could not install the app. Please try again.');
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (error || !sharedApp) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 32 }}
      >
        <Text style={{ fontSize: 52, marginBottom: 16 }}>🔗</Text>
        <Text
          style={{ fontSize: 20, fontWeight: '600', color: '#1C1C1E', textAlign: 'center', marginBottom: 8 }}
        >
          Link not found
        </Text>
        <Text style={{ fontSize: 15, color: '#8E8E93', textAlign: 'center', marginBottom: 32 }}>
          {error ?? 'This share link is no longer active.'}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Text style={{ fontSize: 17, color: '#007AFF' }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      {/* Close */}
      <View style={{ alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 8 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Text style={{ fontSize: 16, color: '#007AFF' }}>Close</Text>
        </TouchableOpacity>
      </View>

      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        {/* App icon */}
        <View
          style={{
            width: 100,
            height: 100,
            borderRadius: 24,
            backgroundColor: sharedApp.icon_bg_color,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.12,
            shadowRadius: 12,
            elevation: 6,
            marginBottom: 20,
          }}
        >
          <Text style={{ fontSize: 44 }}>{sharedApp.icon_emoji}</Text>
        </View>

        {/* Name */}
        <Text
          style={{
            fontSize: 28,
            fontWeight: '700',
            color: '#1C1C1E',
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          {sharedApp.name}
        </Text>

        {/* Shared by */}
        <Text style={{ fontSize: 15, color: '#8E8E93', textAlign: 'center', marginBottom: 6 }}>
          Shared by a Perappos user
        </Text>

        {/* Source URL */}
        {sharedApp.source_url && (
          <Text
            style={{ fontSize: 13, color: '#C7C7CC', textAlign: 'center', marginBottom: 40 }}
            numberOfLines={1}
          >
            {sharedApp.source_url}
          </Text>
        )}

        {/* Install */}
        <TouchableOpacity
          onPress={handleInstall}
          disabled={installing}
          activeOpacity={0.8}
          style={{
            width: '100%',
            height: 54,
            backgroundColor: installing ? '#A8C8FF' : '#007AFF',
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
          }}
        >
          {installing && <ActivityIndicator color="#FFFFFF" size="small" />}
          <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>
            {installing ? 'Installing…' : 'Install App'}
          </Text>
        </TouchableOpacity>

        {/* Cancel */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 16, padding: 8 }}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 17, color: '#8E8E93' }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
