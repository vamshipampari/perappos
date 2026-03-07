import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../services/supabase';

interface SharedApp {
  id: string;
  app_id: string;
  name: string;
  icon_emoji: string;
  icon_bg_color: string;
  share_code: string;
  is_active: boolean;
  created_at: string;
}

export default function SharedAppsScreen() {
  const [sharedApps, setSharedApps] = useState<SharedApp[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    const { data } = await supabase
      .from('shared_apps')
      .select('*')
      .eq('owner_id', session.user.id)
      .order('created_at', { ascending: false });

    setSharedApps((data as SharedApp[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCopyLink = async (code: string) => {
    await Share.share({ message: `perappos://share/${code}` });
  };

  const handleDeactivate = (item: SharedApp) => {
    Alert.alert(
      'Deactivate Link',
      'Recipients will no longer be able to install this app from the link.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('shared_apps').update({ is_active: false }).eq('id', item.id);
            setSharedApps((prev) =>
              prev.map((a) => (a.id === item.id ? { ...a, is_active: false } : a))
            );
          },
        },
      ]
    );
  };

  const handleReactivate = async (item: SharedApp) => {
    await supabase.from('shared_apps').update({ is_active: true }).eq('id', item.id);
    setSharedApps((prev) =>
      prev.map((a) => (a.id === item.id ? { ...a, is_active: true } : a))
    );
  };

  const handleDelete = (item: SharedApp) => {
    Alert.alert('Delete Link', 'This will permanently remove the share link.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('shared_apps').delete().eq('id', item.id);
          setSharedApps((prev) => prev.filter((a) => a.id !== item.id));
        },
      },
    ]);
  };

  const handleRowPress = (item: SharedApp) => {
    Alert.alert(
      item.name,
      `Code: ${item.share_code} · ${item.is_active ? 'Active' : 'Inactive'}`,
      [
        {
          text: 'Copy Link',
          onPress: () => void handleCopyLink(item.share_code),
        },
        item.is_active
          ? {
              text: 'Deactivate',
              style: 'destructive' as const,
              onPress: () => handleDeactivate(item),
            }
          : {
              text: 'Reactivate',
              onPress: () => void handleReactivate(item),
            },
        {
          text: 'Delete',
          style: 'destructive' as const,
          onPress: () => handleDelete(item),
        },
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F2F2F7' }} edges={['top']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 0.5,
          borderBottomColor: '#E5E5EA',
          backgroundColor: '#F2F2F7',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Text style={{ fontSize: 17, color: '#007AFF' }}>← Back</Text>
        </TouchableOpacity>
        <Text
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 17,
            fontWeight: '600',
            color: '#1C1C1E',
          }}
        >
          Shared Apps
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : sharedApps.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <Text style={{ fontSize: 48, marginBottom: 16 }}>🔗</Text>
          <Text
            style={{
              fontSize: 20,
              fontWeight: '600',
              color: '#1C1C1E',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            No shared apps yet
          </Text>
          <Text style={{ fontSize: 15, color: '#8E8E93', textAlign: 'center' }}>
            Share an app from the home screen or app viewer to create a link.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sharedApps}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handleRowPress(item)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#FFFFFF',
                borderRadius: 12,
                padding: 12,
                gap: 12,
                opacity: item.is_active ? 1 : 0.5,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  backgroundColor: item.icon_bg_color,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 22 }}>{item.icon_emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#1C1C1E' }}>
                  {item.name}
                </Text>
                <Text style={{ fontSize: 13, color: '#8E8E93', marginTop: 2 }}>
                  {item.share_code} · {item.is_active ? 'Active' : 'Inactive'} ·{' '}
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Text style={{ fontSize: 20, color: '#C7C7CC' }}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}
