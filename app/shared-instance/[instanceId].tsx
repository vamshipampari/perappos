/**
 * Shared Instance Management Screen
 *
 * Reachable from:
 *   - WebView header 👥 pill (for shared apps)
 *   - Three-dot menu "Manage Group" action
 *   - Home screen long-press "Manage Group" menu item
 *
 * Shows invite code, member list, and owner/member actions.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/Toast';
import { useDatabase } from '@/hooks/useDatabase';
import { usePowerSync } from '../../services/sync/PowerSyncProvider';
import { leaveSharedGroup, stopSharingAsOwner } from '../../services/collaborationService';
import { supabase } from '../../services/supabase';

interface SharedInstanceRow {
  instance_id: string;
  app_id: string;
  app_name: string;
  invite_code: string;
  owner_id: string;
}

interface MemberRow {
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCode(code: string): string {
  return code.toUpperCase().split('').join(' ');
}

function truncateId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SharedInstanceScreen() {
  const params = useLocalSearchParams<{ instanceId: string | string[] }>();
  const instanceId = Array.isArray(params.instanceId) ? params.instanceId[0] : params.instanceId;
  const db = useDatabase();
  const { db: syncDb } = usePowerSync();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [instance, setInstance] = useState<SharedInstanceRow | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'owner' | 'member' | null>(null);

  // ── Load data ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    try {
      console.log('[manage-group] instanceId from params:', instanceId);
      console.log('[manage-group] typeof instanceId:', typeof instanceId);

      const [{ data: { session } }, instanceRow, memberRows] = await Promise.all([
        supabase.auth.getSession(),
        syncDb.getOptional<SharedInstanceRow>(
          'SELECT * FROM shared_instances WHERE instance_id = ?',
          [instanceId]
        ),
        syncDb.getAll<MemberRow>(
          'SELECT user_id, role, joined_at FROM instance_members WHERE instance_id = ? ORDER BY role DESC, joined_at ASC',
          [instanceId]
        ),
      ]);
      const all = await syncDb.getAll<{ instance_id: string }>('SELECT instance_id FROM shared_instances');
      console.log('[manage-group] all instance_ids in local DB:', all);

      const userId = session?.user?.id ?? null;
      setMyUserId(userId);
      setInstance(instanceRow ?? null);
      setMembers(memberRows);

      if (userId && memberRows.length > 0) {
        const mine = memberRows.find((m) => m.user_id === userId);
        setMyRole(mine?.role ?? null);
      }
    } catch (e) {
      console.error('[SharedInstanceScreen] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [instanceId, syncDb]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Copy code ────────────────────────────────────────────────────────────────

  const handleCopyCode = useCallback(async () => {
    if (!instance) return;
    try {
      await Share.share({ message: instance.invite_code.toUpperCase() });
    } catch {
      // dismissed — not an error
    }
  }, [instance]);

  // ── Share invite ─────────────────────────────────────────────────────────────

  const handleShareCode = useCallback(async () => {
    if (!instance) return;
    const code = instance.invite_code.toUpperCase();
    try {
      await Share.share({
        message:
          `Join my "${instance.app_name}" on Perappos!\n` +
          `Open Perappos → Settings → Join Shared App → Code: ${code}`,
      });
    } catch {
      // dismissed
    }
  }, [instance]);

  // ── Stop sharing (owner) ─────────────────────────────────────────────────────

  const handleStopSharing = useCallback(() => {
    if (!instance) return;
    Alert.alert(
      'Stop sharing?',
      'This will end collaboration for everyone. You keep a personal snapshot of the latest shared data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop Sharing',
          style: 'destructive',
          onPress: async () => {
            setActing(true);
            try {
              await stopSharingAsOwner(db, syncDb, instance.app_id, instance.instance_id);
              showToast('Sharing stopped', 'success');
              router.replace('/(tabs)');
            } catch (e) {
              Alert.alert(
                'Could not stop sharing',
                e instanceof Error ? e.message : 'Please try again.'
              );
            } finally {
              setActing(false);
            }
          },
        },
      ]
    );
  }, [db, instance, showToast, syncDb]);

  // ── Leave group (member) ─────────────────────────────────────────────────────

  const handleLeaveGroup = useCallback(() => {
    if (!instance) return;
    Alert.alert(
      'Leave group?',
      'You will keep a personal snapshot of the latest shared data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setActing(true);
            try {
              await leaveSharedGroup(db, syncDb, instance.app_id, instance.instance_id);
              showToast('Left group', 'success');
              router.replace('/(tabs)');
            } catch (e) {
              Alert.alert(
                'Could not leave group',
                e instanceof Error ? e.message : 'Please try again.'
              );
            } finally {
              setActing(false);
            }
          },
        },
      ]
    );
  }, [db, instance, showToast, syncDb]);

  // ── Render: loading ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </SafeAreaView>
    );
  }

  if (!instance) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emoji}>🔗</Text>
        <Text style={styles.errorTitle}>Group not found</Text>
        <Text style={styles.errorSub}>This shared group is no longer available.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={styles.link}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const code = instance.invite_code.toUpperCase();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {instance.app_name}
          </Text>
          <View style={styles.sharedPill}>
            <Text style={styles.sharedPillText}>Shared</Text>
          </View>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>

        {/* ── Section 1: Invite Code ───────────────────────────────────── */}
        <Text style={styles.sectionLabel}>INVITE CODE</Text>
        <View style={styles.card}>
          <Text style={styles.inviteCode}>{formatCode(code)}</Text>
          <Text style={styles.inviteHint}>Share this code so others can join</Text>
          <View style={styles.codeButtons}>
            <TouchableOpacity
              onPress={handleCopyCode}
              style={[styles.codeBtn, styles.codeBtnOutline]}
              activeOpacity={0.7}
            >
              <Text style={styles.codeBtnOutlineText}>Copy Code</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleShareCode}
              style={[styles.codeBtn, styles.codeBtnFill]}
              activeOpacity={0.7}
            >
              <Text style={styles.codeBtnFillText}>Share Code</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Section 2: Members ───────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>
          MEMBERS{members.length > 0 ? ` · ${members.length}` : ''}
        </Text>
        <View style={styles.card}>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>No members found yet.</Text>
          ) : (
            members.map((member, i) => {
              const isMe = member.user_id === myUserId;
              return (
                <View key={member.user_id}>
                  {i > 0 && <View style={styles.separator} />}
                  <View style={styles.memberRow}>
                    <View
                      style={[
                        styles.roleBadge,
                        member.role === 'owner' ? styles.roleBadgeOwner : styles.roleBadgeMember,
                      ]}
                    >
                      <Text
                        style={[
                          styles.roleBadgeText,
                          member.role === 'owner'
                            ? styles.roleBadgeOwnerText
                            : styles.roleBadgeMemberText,
                        ]}
                      >
                        {member.role === 'owner' ? 'Owner' : 'Member'}
                      </Text>
                    </View>
                    <Text style={styles.memberUserId} numberOfLines={1}>
                      {truncateId(member.user_id)}
                      {isMe ? ' (you)' : ''}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ── Section 3: Actions ───────────────────────────────────────── */}
        {myRole !== null && (
          <>
            <Text style={styles.sectionLabel}>ACTIONS</Text>
            <View style={styles.card}>
              {acting ? (
                <ActivityIndicator color="#FF3B30" style={{ paddingVertical: 16 }} />
              ) : myRole === 'owner' ? (
                <TouchableOpacity
                  onPress={handleStopSharing}
                  style={styles.actionRow}
                  activeOpacity={0.7}
                >
                  <Text style={styles.destructiveText}>Stop Sharing</Text>
                  <Text style={styles.actionSub}>
                    Ends collaboration for everyone. You keep a data snapshot.
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleLeaveGroup}
                  style={styles.actionRow}
                  activeOpacity={0.7}
                >
                  <Text style={styles.destructiveText}>Leave Group</Text>
                  <Text style={styles.actionSub}>
                    Removes you from this group. You keep a data snapshot.
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
    padding: 32,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 6,
  },
  errorSub: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
  },
  link: {
    fontSize: 17,
    color: '#007AFF',
  },

  // Header
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#C6C6C8',
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    fontSize: 22,
    color: '#007AFF',
    lineHeight: 26,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    flexShrink: 1,
  },
  sharedPill: {
    backgroundColor: '#E8F1FF',
    borderWidth: 1,
    borderColor: '#BBD7FF',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sharedPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#007AFF',
  },

  // Content
  scrollContent: {
    padding: 20,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C6C70',
    marginBottom: 6,
    marginTop: 12,
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },

  // Invite code
  inviteCode: {
    fontSize: 36,
    fontWeight: '700',
    color: '#1C1C1E',
    letterSpacing: 4,
    textAlign: 'center',
    paddingVertical: 8,
    fontVariant: ['tabular-nums'],
  },
  inviteHint: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 16,
  },
  codeButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  codeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  codeBtnOutline: {
    borderWidth: 1.5,
    borderColor: '#007AFF',
  },
  codeBtnFill: {
    backgroundColor: '#007AFF',
  },
  codeBtnOutlineText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007AFF',
  },
  codeBtnFillText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Members
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  roleBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  roleBadgeOwner: {
    backgroundColor: '#E8F1FF',
  },
  roleBadgeMember: {
    backgroundColor: '#F2F2F7',
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  roleBadgeOwnerText: {
    color: '#007AFF',
  },
  roleBadgeMemberText: {
    color: '#6C6C70',
  },
  memberUserId: {
    flex: 1,
    fontSize: 14,
    color: '#3C3C43',
    fontFamily: 'monospace',
  },
  separator: {
    height: 0.5,
    backgroundColor: '#E5E5EA',
  },
  emptyText: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    paddingVertical: 8,
  },

  // Actions
  actionRow: {
    paddingVertical: 10,
  },
  destructiveText: {
    fontSize: 17,
    color: '#FF3B30',
    fontWeight: '500',
    marginBottom: 4,
  },
  actionSub: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 18,
  },
});
