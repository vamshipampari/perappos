import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps } from '@/hooks/useInstalledApps';

const EMOJI_OPTIONS = ['📱', '🚀', '💡', '🎯', '🛠️', '📊', '🎨', '🔥', '⚡', '🌐'];
const BG_COLOR_OPTIONS = [
  '#E5E7EB', '#DBEAFE', '#D1FAE5', '#FEF3C7', '#FCE7F3',
  '#EDE9FE', '#FEE2E2', '#F0FDF4', '#FFF7ED', '#F0F9FF',
];

export default function AddScreen() {
  const db = useDatabase();
  const { refresh } = useInstalledApps();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('📱');
  const [selectedBg, setSelectedBg] = useState('#E5E7EB');
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && url.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || saving) return;

    const trimmedUrl = url.trim();
    const trimmedName = name.trim();

    // Basic URL validation
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      Alert.alert('Invalid URL', 'Please enter a URL starting with http:// or https://');
      return;
    }

    try {
      setSaving(true);
      const appId = await Crypto.randomUUID();

      await db.runAsync(
        `INSERT INTO apps (app_id, name, icon_emoji, icon_bg_color, bundle_path, source_type, source_url)
         VALUES (?, ?, ?, ?, ?, 'url', ?)`,
        appId,
        trimmedName,
        selectedEmoji,
        selectedBg,
        trimmedUrl, // bundle_path mirrors source_url for URL-type apps
        trimmedUrl
      );

      await refresh();
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Failed to save app. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 20 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Name field */}
          <View>
            <Text style={labelStyle}>App Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="My App"
              placeholderTextColor="#C7C7CC"
              style={inputStyle}
              returnKeyType="next"
              autoFocus
            />
          </View>

          {/* URL field */}
          <View>
            <Text style={labelStyle}>App URL</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://myapp.lovable.app"
              placeholderTextColor="#C7C7CC"
              style={inputStyle}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
            <Text style={{ fontSize: 12, color: '#8E8E93', marginTop: 6 }}>
              Paste the URL of any web app — Lovable, Bolt, Claude artifacts, etc.
            </Text>
          </View>

          {/* Emoji picker */}
          <View>
            <Text style={labelStyle}>Icon</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {EMOJI_OPTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => setSelectedEmoji(emoji)}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    backgroundColor: selectedBg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: selectedEmoji === emoji ? 2 : 0,
                    borderColor: '#007AFF',
                  }}
                >
                  <Text style={{ fontSize: 24 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Color picker */}
          <View>
            <Text style={labelStyle}>Background Color</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {BG_COLOR_OPTIONS.map((color) => (
                <TouchableOpacity
                  key={color}
                  onPress={() => setSelectedBg(color)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: color,
                    borderWidth: selectedBg === color ? 3 : 1.5,
                    borderColor: selectedBg === color ? '#007AFF' : '#E5E5EA',
                  }}
                />
              ))}
            </View>
          </View>

          {/* Preview */}
          <View>
            <Text style={labelStyle}>Preview</Text>
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 14,
                  backgroundColor: selectedBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.1,
                  shadowRadius: 4,
                  elevation: 2,
                }}
              >
                <Text style={{ fontSize: 28 }}>{selectedEmoji}</Text>
              </View>
              <Text style={{ marginTop: 8, fontSize: 12, color: '#1C1C1E' }}>
                {name || 'App Name'}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Save button */}
        <View style={{ padding: 20 }}>
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave || saving}
            activeOpacity={0.8}
            style={{
              backgroundColor: canSave ? '#007AFF' : '#C7C7CC',
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>
              {saving ? 'Adding…' : 'Add App'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const labelStyle = {
  fontSize: 13,
  fontWeight: '600' as const,
  color: '#8E8E93',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginBottom: 8,
};

const inputStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 10,
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 16,
  color: '#1C1C1E',
  borderWidth: 0.5,
  borderColor: '#E5E5EA',
};
