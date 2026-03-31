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
import { log } from '@/lib/logger';
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
import { useTheme, type Colors } from '@/lib/theme';

interface SharedInstanceRow {
  instance_id: string;
  app_id: string;
  app_name: string;
  invite_code: string;
  owner_id: string;
  is_frozen?: number; // 0 = active, 1 = frozen (PowerSync stores booleans as integers)
}

interface MemberRow {
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
}

interface ActivityRow {
  key: string;
  editor_display_name: string | null;
  editor_user_id: string | null;
  written_at: string | null;
  version: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCode(code: string): string {
  return code.toUpperCase().split('').join(' ');
}

function truncateId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(theme: Colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.groupedBackground,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.groupedBackground,
      padding: 32,
    },
    emoji: {
      fontSize: 48,
      marginBottom: 12,
    },
    errorTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: theme.label,
      textAlign: 'center',
      marginBottom: 6,
    },
    errorSub: {
      fontSize: 15,
      color: theme.labelSecondary,
      textAlign: 'center',
    },
    link: {
      fontSize: 17,
      color: theme.primary,
    },

    // Header
    header: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.groupedBackground,
      paddingHorizontal: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.labelTertiary,
    },
    backBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backText: {
      fontSize: 22,
      color: theme.primary,
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
      color: theme.label,
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
      color: theme.primary,
    },

    // Frozen banner
    frozenBanner: {
      backgroundColor: '#FEF3C7',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: '#F59E0B',
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    frozenBannerText: {
      fontSize: 13,
      color: '#92400E',
      textAlign: 'center',
      lineHeight: 18,
    },

    // Content
    scrollContent: {
      padding: 20,
      gap: 8,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.labelSecondary,
      marginBottom: 6,
      marginTop: 12,
      letterSpacing: 0.3,
    },
    card: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      overflow: 'hidden',
      paddingVertical: 12,
      paddingHorizontal: 16,
    },

    // Invite code
    inviteCode: {
      fontSize: 36,
      fontWeight: '700',
      color: theme.label,
      letterSpacing: 4,
      textAlign: 'center',
      paddingVertical: 8,
      fontVariant: ['tabular-nums'],
    },
    inviteHint: {
      fontSize: 13,
      color: theme.labelSecondary,
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
      borderColor: theme.primary,
    },
    codeBtnFill: {
      backgroundColor: theme.primary,
    },
    codeBtnOutlineText: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.primary,
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
      backgroundColor: theme.groupedBackground,
    },
    roleBadgeText: {
      fontSize: 12,
      fontWeight: '600',
    },
    roleBadgeOwnerText: {
      color: theme.primary,
    },
    roleBadgeMemberText: {
      color: theme.labelSecondary,
    },
    memberUserId: {
      flex: 1,
      fontSize: 14,
      color: theme.labelSecondary,
      fontFamily: 'monospace',
    },
    separator: {
      height: 0.5,
      backgroundColor: theme.separator,
    },
    emptyText: {
      fontSize: 14,
      color: theme.labelSecondary,
      textAlign: 'center',
      paddingVertical: 8,
    },

    // Actions
    actionRow: {
      paddingVertical: 10,
    },
    destructiveText: {
      fontSize: 17,
      color: theme.destructive,
      fontWeight: '500',
      marginBottom: 4,
    },
    actionSub: {
      fontSize: 13,
      color: theme.labelSecondary,
      lineHeight: 18,
    },

    // Activity panel
    activityHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
      marginTop: 12,
    },
    activityChevron: {
      fontSize: 16,
      color: theme.labelSecondary,
      lineHeight: 20,
    },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 10,
    },
    activityDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.primary,
      opacity: 0.55,
      flexShrink: 0,
    },
    activityContent: {
      flex: 1,
      gap: 2,
    },
    activityKey: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.label,
      fontFamily: 'monospace',
    },
    activityMeta: {
      fontSize: 12,
      color: theme.labelSecondary,
    },
    activityVersion: {
      fontSize: 11,
      color: theme.labelTertiary,
      fontVariant: ['tabular-nums'],
    },
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SharedInstanceScreen() {
  const params = useLocalSearchParams<{ instanceId: string | string[] }>();
  const instanceId = Array.isArray(params.instanceId) ? params.instanceId[0] : params.instanceId;
  const db = useDatabase();
  const { db: syncDb } = usePowerSync();
  const { showToast } = useToast();
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [instance, setInstance] = useState<SharedInstanceRow | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'owner' | 'member' | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const [activityRows, setActivityRows] = useState<ActivityRow[]>([]);
  const [activityCollapsed, setActivityCollapsed] = useState(false);

  // ── Load data ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    try {
      log.info('[manage-group] loading instanceId:', instanceId);

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      setMyUserId(userId);

      // 1. Try PowerSync local first — fast path.
      let instanceRow = await syncDb.getOptional<SharedInstanceRow>(
        'SELECT * FROM shared_instances WHERE instance_id = ?',
        [instanceId]
      );

      // 2. Retry up to 3 s — PowerSync may still be syncing on first open.
      if (!instanceRow) {
        for (let attempt = 0; attempt < 15 && !instanceRow; attempt++) {
          await new Promise<void>((r) => setTimeout(r, 200));
          instanceRow = await syncDb.getOptional<SharedInstanceRow>(
            'SELECT * FROM shared_instances WHERE instance_id = ?',
            [instanceId]
          );
        }
      }

      // 3. Supabase fallback — covers the case where PowerSync sync is lagging
      //    or the RLS SELECT policy allows direct reads (it should for members).
      if (!instanceRow && userId) {
        log.info('[manage-group] local miss — trying Supabase fallback');
        try {
          // Direct query: SELECT RLS on shared_instances should allow members to
          // read instances they belong to. If this is blocked, the user needs to
          // fix their RLS SELECT policy on shared_instances.
          const { data: remoteRows } = await supabase
            .from('shared_instances')
            .select('instance_id, app_id, app_name, invite_code, owner_id')
            .eq('instance_id', instanceId)
            .limit(1);

          const remote = (remoteRows as SharedInstanceRow[] | null)?.[0] ?? null;

          if (!remote) {
            // RLS blocked or row not found — try owner-only RPC as last resort.
            const appRow = await db.getFirstAsync<{ app_id: string }>(
              'SELECT app_id FROM apps WHERE instance_id = ?',
              [instanceId]
            );
            if (appRow?.app_id) {
              const { data: rpcData } = await supabase.rpc('get_own_shared_instance', {
                p_app_id: appRow.app_id,
                p_user_id: userId,
              });
              const rpcRow = (rpcData as SharedInstanceRow[] | null)?.[0] ?? null;
              if (rpcRow) {
                instanceRow = rpcRow;
              }
            }
          } else {
            instanceRow = remote;
          }

          // Pre-seed PowerSync local so subsequent opens don't need the fallback.
          if (instanceRow) {
            try {
              await syncDb.execute(
                `INSERT OR REPLACE INTO shared_instances
                 (instance_id, app_id, app_name, app_source_url, owner_id, invite_code)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  instanceRow.instance_id,
                  instanceRow.app_id,
                  instanceRow.app_name,
                  (instanceRow as { app_source_url?: string | null }).app_source_url ?? null,
                  instanceRow.owner_id,
                  instanceRow.invite_code,
                ]
              );
            } catch (seedErr) {
              log.warn('[manage-group] pre-seed failed:', seedErr);
            }
          }
        } catch (fallbackErr) {
          log.warn('[manage-group] Supabase fallback error:', fallbackErr);
        }
      }

      // 4. Load members from PowerSync local.
      let memberRows = await syncDb.getAll<MemberRow>(
        'SELECT user_id, role, joined_at FROM instance_members WHERE instance_id = ? ORDER BY role DESC, joined_at ASC',
        [instanceId]
      );

      // If we have the instance (possibly from fallback) but no members in local,
      // synthesise a row for the current user so the Actions section is shown.
      if (instanceRow && memberRows.length === 0 && userId) {
        const myGuessedRole: 'owner' | 'member' =
          instanceRow.owner_id === userId ? 'owner' : 'member';
        memberRows = [{ user_id: userId, role: myGuessedRole, joined_at: '' }];
      }

      // 5. Load recent activity from shared_app_data_history (full audit log).
      let activity: ActivityRow[] = [];
      if (instanceRow) {
        try {
          activity = await syncDb.getAll<ActivityRow>(
            `SELECT key, editor_display_name, editor_user_id, written_at, version
             FROM shared_app_data_history
             WHERE instance_id = ?
             ORDER BY written_at DESC
             LIMIT 20`,
            [instanceId]
          );
        } catch (actErr) {
          log.warn('[manage-group] activity load failed:', actErr);
        }
      }

      log.info('[manage-group] result — instance found:', !!instanceRow, 'members:', memberRows.length);

      setInstance(instanceRow ?? null);
      setIsFrozen(instanceRow?.is_frozen === 1);
      setMembers(memberRows);
      setActivityRows(activity);

      if (userId && memberRows.length > 0) {
        const mine = memberRows.find((m) => m.user_id === userId);
        setMyRole(mine?.role ?? null);
      }
    } catch (e) {
      log.error('[SharedInstanceScreen] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [instanceId, db, syncDb]);

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
          `Join my "${instance.app_name}" on Cottix!\n` +
          `Open Cottix → Settings → Join Shared App → Code: ${code}`,
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
        <ActivityIndicator size="large" color={theme.primary} />
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

      {/* ── Frozen banner (owner sees this when plan has expired) ──────── */}
      {isFrozen && myRole === 'owner' && (
        <View style={styles.frozenBanner}>
          <Text style={styles.frozenBannerText}>
            ⏸️ This shared app is paused. Upgrade your plan to resume collaboration.
          </Text>
        </View>
      )}

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
                <ActivityIndicator color={theme.destructive} style={{ paddingVertical: 16 }} />
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

        {/* ── Section 4: Recent Activity ────────────────────────────────── */}
        <TouchableOpacity
          onPress={() => setActivityCollapsed((c) => !c)}
          activeOpacity={0.7}
          style={styles.activityHeader}
        >
          <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 0 }]}>
            RECENT ACTIVITY{activityRows.length > 0 ? ` · ${activityRows.length}` : ''}
          </Text>
          <Text style={styles.activityChevron}>{activityCollapsed ? '›' : '⌄'}</Text>
        </TouchableOpacity>
        {!activityCollapsed && (
          <View style={styles.card}>
            {activityRows.length === 0 ? (
              <Text style={styles.emptyText}>No activity yet.</Text>
            ) : (
              activityRows.map((row, i) => {
                const editor = row.editor_display_name
                  || (row.editor_user_id ? truncateId(row.editor_user_id) : 'Unknown');
                const truncKey = row.key.length > 20 ? `${row.key.slice(0, 20)}…` : row.key;
                const when = relativeTime(row.written_at);
                return (
                  <View key={`${row.key}-${i}`}>
                    {i > 0 && <View style={styles.separator} />}
                    <View style={styles.activityRow}>
                      <View style={styles.activityDot} />
                      <View style={styles.activityContent}>
                        <Text style={styles.activityKey} numberOfLines={1}>{truncKey}</Text>
                        <Text style={styles.activityMeta} numberOfLines={1}>
                          {editor}{when ? ` · ${when}` : ''}
                        </Text>
                      </View>
                      {row.version != null && (
                        <Text style={styles.activityVersion}>v{row.version}</Text>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
