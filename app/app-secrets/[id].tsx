/**
 * app/app-secrets/[id].tsx
 *
 * Secrets management screen for a mini-app.
 * Lists stored secret names (values are never displayed — write-only by design).
 * Allows adding new secrets and deleting existing ones.
 *
 * Navigation: pushed from the three-dot menu in app/app/[id].tsx
 * Route param: id = app.app_id
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  deleteSecret,
  listSecretNames,
  setSecret,
} from '@/services/secretsService';

export default function AppSecretsScreen() {
  const { id: appId } = useLocalSearchParams<{ id: string }>();

  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadNames = useCallback(async () => {
    if (!appId) return;
    try {
      const list = await listSecretNames(appId);
      setNames(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => { void loadNames(); }, [loadNames]);

  const handleDelete = useCallback((name: string) => {
    Alert.alert(
      `Delete "${name}"?`,
      'This secret will be permanently removed from the secure enclave.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!appId) return;
            try {
              await deleteSecret(appId, name);
              setNames((prev) => prev.filter((n) => n !== name));
            } catch {
              Alert.alert('Error', 'Could not delete secret.');
            }
          },
        },
      ]
    );
  }, [appId]);

  const handleAdd = useCallback(async () => {
    const trimName = newName.trim();
    const trimValue = newValue.trim();
    if (!trimName || !trimValue || !appId) return;
    if (names.includes(trimName)) {
      Alert.alert('Already exists', `A secret named "${trimName}" already exists. Saving again will overwrite it.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Overwrite',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await setSecret(appId, trimName, trimValue);
              setAddVisible(false);
              setNewName('');
              setNewValue('');
            } catch {
              Alert.alert('Error', 'Could not save secret.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]);
      return;
    }
    setSaving(true);
    try {
      await setSecret(appId, trimName, trimValue);
      setNames((prev) => [...prev, trimName]);
      setAddVisible(false);
      setNewName('');
      setNewValue('');
    } catch {
      Alert.alert('Error', 'Could not save secret.');
    } finally {
      setSaving(false);
    }
  }, [appId, names, newName, newValue]);

  const handleDismissAdd = useCallback(() => {
    setAddVisible(false);
    setNewName('');
    setNewValue('');
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Secrets</Text>
        <TouchableOpacity onPress={() => setAddVisible(true)} hitSlop={10} style={styles.headerBtn}>
          <Text style={styles.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* ── Info banner ─────────────────────────────────────────────────────── */}
      <View style={styles.infoBanner}>
        <Text style={styles.infoText}>
          🔑 Secrets are stored in the device secure enclave and are never displayed after saving.
          Use them in mini-apps via <Text style={styles.code}>VaultAPI.secrets</Text>.
        </Text>
      </View>

      {/* ── List ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Loading…</Text>
        </View>
      ) : names.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>🔐</Text>
          <Text style={styles.emptyTitle}>No secrets yet</Text>
          <Text style={styles.emptyText}>
            Tap "+ Add" to store an API key or credential securely on this device.
          </Text>
        </View>
      ) : (
        <FlatList
          data={names}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.secretName}>{item}</Text>
                <Text style={styles.secretMask}>••••••••</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleDelete(item)}
                hitSlop={8}
                style={styles.deleteBtn}
              >
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* ── Add secret modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={addVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleDismissAdd}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={styles.modalRoot} edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={handleDismissAdd} hitSlop={10}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Add Secret</Text>
              <TouchableOpacity
                onPress={() => { void handleAdd(); }}
                hitSlop={10}
                disabled={saving || !newName.trim() || !newValue.trim()}
              >
                <Text style={[styles.modalSave, (saving || !newName.trim() || !newValue.trim()) && styles.modalSaveDisabled]}>
                  {saving ? 'Saving…' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.fieldLabel}>NAME</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. OPENAI_KEY"
                placeholderTextColor="#C7C7CC"
                value={newName}
                onChangeText={setNewName}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
              />
              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>VALUE</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="Paste your API key or secret"
                placeholderTextColor="#C7C7CC"
                value={newValue}
                onChangeText={setNewValue}
                secureTextEntry
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={() => { void handleAdd(); }}
              />
              <Text style={styles.fieldHint}>
                Values cannot be viewed after saving — only deleted and re-entered.
              </Text>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },

  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
    paddingHorizontal: 4,
  },
  headerBtn: { width: 72, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerBtnText: { fontSize: 22, color: '#007AFF', lineHeight: 26 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#1C1C1E', textAlign: 'center' },
  addBtn: { fontSize: 16, color: '#007AFF', fontWeight: '500' },

  infoBanner: {
    backgroundColor: '#EAF2FF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#D1E4FF',
  },
  infoText: { fontSize: 13, color: '#3A5A9A', lineHeight: 18 },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 32,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1C1C1E' },
  emptyText: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },

  list: { paddingVertical: 8 },
  separator: { height: 0.5, backgroundColor: '#E5E5EA', marginLeft: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLeft: { flex: 1 },
  secretName: { fontSize: 16, fontWeight: '500', color: '#1C1C1E' },
  secretMask: { fontSize: 13, color: '#8E8E93', marginTop: 2, letterSpacing: 2 },
  deleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFF0F0',
  },
  deleteBtnText: { fontSize: 14, color: '#FF3B30', fontWeight: '500' },

  modalRoot: { flex: 1, backgroundColor: '#F2F2F7' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
  },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#1C1C1E', textAlign: 'center' },
  modalCancel: { fontSize: 16, color: '#8E8E93' },
  modalSave: { fontSize: 16, color: '#007AFF', fontWeight: '600' },
  modalSaveDisabled: { color: '#C7C7CC' },

  modalBody: { padding: 20 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#8E8E93', marginBottom: 8, letterSpacing: 0.5 },
  fieldInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#E5E5EA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1C1E',
  },
  fieldHint: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 12,
    lineHeight: 18,
  },
});
