/**
 * usePendingJoinApproval
 *
 * Tracks pending shared-app join requests stored in local SQLite
 * (category = 'pending_joins'). Automatically detects when the owner
 * approves the request and completes the install without any user action:
 *
 *  • On mount — queries Supabase for current status of all pending instances.
 *  • On app foreground — re-checks whenever the user returns to the app.
 *  • Supabase Realtime — subscribes to instance_members changes for instant
 *    detection while the app is open.
 *
 * Returns { pendingJoins } so screens can show a status banner.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useToast } from '@/components/Toast';
import { useDatabase } from '@/hooks/useDatabase';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { joinSharedAppByCode } from '@/services/collaborationService';
import { reconnectPowerSync } from '@/services/sync/PowerSyncProvider';
import { supabase } from '@/services/supabase';

export interface PendingJoin {
  instance_id: string;
  invite_code: string;
  app_name: string;
}

export function usePendingJoinApproval() {
  const db = useDatabase();
  const { refresh } = useInstalledApps();
  const { showToast } = useToast();

  const [pendingJoins, setPendingJoins] = useState<PendingJoin[]>([]);
  const checkingRef = useRef(false);

  // ── Load pending joins from SQLite ──────────────────────────────────────────

  const loadPending = useCallback(async (): Promise<PendingJoin[]> => {
    try {
      const rows = await db.getAllAsync<{ key: string; value: string }>(
        `SELECT key, value FROM shared_data WHERE category = 'pending_joins' ORDER BY updated_at DESC`
      );
      const parsed = rows.map((r) => {
        try {
          const v = JSON.parse(r.value) as { invite_code: string; app_name: string };
          return { instance_id: r.key, invite_code: v.invite_code, app_name: v.app_name };
        } catch {
          return null;
        }
      }).filter((x): x is PendingJoin => x !== null);
      setPendingJoins(parsed);
      return parsed;
    } catch {
      return [];
    }
  }, [db]);

  // ── Complete join for a single approved instance ────────────────────────────

  const completeJoin = useCallback(async (pending: PendingJoin) => {
    try {
      const result = await joinSharedAppByCode(db, pending.invite_code);
      if (result.status === 'already_active') {
        await reconnectPowerSync();
        await refresh();
        showToast(`"${pending.app_name}" is ready — you've been approved!`, 'success');
      }
    } catch {
      // Silently ignore — user can still retry manually.
    }
  }, [db, refresh, showToast]);

  // ── Check Supabase for status changes ───────────────────────────────────────

  const checkAndComplete = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const pending = await loadPending();
      if (pending.length === 0) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const { data: memberRows } = await supabase
        .from('instance_members')
        .select('instance_id, status')
        .eq('user_id', session.user.id)
        .in('instance_id', pending.map((p) => p.instance_id));

      if (!memberRows) return;

      for (const member of memberRows as Array<{ instance_id: string; status: string }>) {
        if (member.status !== 'active') continue;
        const match = pending.find((p) => p.instance_id === member.instance_id);
        if (match) await completeJoin(match);
      }

      // Reload to reflect any cleared records.
      await loadPending();
    } finally {
      checkingRef.current = false;
    }
  }, [loadPending, completeJoin]);

  // ── Mount: initial check ─────────────────────────────────────────────────────

  useEffect(() => {
    void loadPending();
    void checkAndComplete();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── AppState: re-check every time the app comes to foreground ───────────────

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkAndComplete();
    });
    return () => sub.remove();
  }, [checkAndComplete]);

  // ── Supabase Realtime: instant detection while app is open ──────────────────

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user?.id) return;
      const userId = session.user.id;

      channel = supabase
        .channel(`pending-approval-${userId}`)
        .on(
          'postgres_changes' as Parameters<ReturnType<typeof supabase.channel>['on']>[0],
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'instance_members',
            filter: `user_id=eq.${userId}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            if (payload.new?.status === 'active') {
              void checkAndComplete();
            }
          }
        )
        .subscribe();
    });

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pendingJoins };
}
