import { useEffect, useState } from 'react';

import { log } from '@/lib/logger';
import { supabase } from '@/services/supabase';
import { powerSyncDb } from '@/services/sync/PowerSyncProvider';

const GENERATOR_URL = process.env.EXPO_PUBLIC_GENERATOR_URL!;

// ---------- Types ----------

export interface GenerationJob {
  id: string;
  status: string;          // pending | generating | deploying | complete | failed
  prompt: string;
  app_id: string | null;
  hosted_url: string | null;
  progress_chars: number;
  error_message: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface GenerationMeta {
  title: string;
  icon: string;
  color: string;
  description: string;
}

// ---------- Hook ----------

export function useGenerateApp() {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [meta, setMeta] = useState<GenerationMeta | null>(null);

  // Primary: watch generation_jobs via PowerSync (real-time, zero network overhead).
  // Requires the generation_jobs sync rule to be added in the PowerSync dashboard.
  // Pattern matches useFreezeWatcher.ts: for-await + AbortController + rows._array.
  useEffect(() => {
    if (!activeJobId) {
      setJob(null);
      setMeta(null);
      return;
    }

    const abortController = new AbortController();

    (async () => {
      try {
        for await (const result of powerSyncDb.watch(
          'SELECT * FROM generation_jobs WHERE id = ? LIMIT 1',
          [activeJobId],
          { signal: abortController.signal, throttleMs: 500 },
        )) {
          if (abortController.signal.aborted) break;
          const rows = (result.rows?._array ?? []) as GenerationJob[];
          if (rows.length > 0) {
            setJob(rows[0]);
          }
        }
      } catch (err: unknown) {
        const e = err as { name?: string } | null;
        if (e?.name !== 'AbortError') {
          log.warn('[useGenerateApp] watch error:', err);
        }
      }
    })();

    return () => abortController.abort();
  }, [activeJobId]);

  // Fallback: poll Supabase directly every 3 s while the job is not yet terminal.
  // Kicks in when the PowerSync sync rule for generation_jobs isn't configured,
  // or during the brief window before PowerSync syncs the row.
  // Stops automatically once status reaches complete | failed.
  const isDone = job?.status === 'complete' || job?.status === 'failed';
  useEffect(() => {
    if (!activeJobId || isDone) return;

    const interval = setInterval(() => {
      void supabase
        .from('generation_jobs')
        .select('*')
        .eq('id', activeJobId)
        .single()
        .then(({ data }) => {
          if (data) setJob(data as unknown as GenerationJob);
        });
    }, 3000);

    return () => clearInterval(interval);
  }, [activeJobId, isDone]);

  // When job completes, fetch display metadata from generated_apps.
  // Keeps generation_jobs lightweight (no title/icon columns needed there).
  useEffect(() => {
    if (job?.status !== 'complete' || !job.app_id) return;

    void supabase
      .from('generated_apps')
      .select('title, description, icon_emoji, icon_bg_color')
      .eq('app_id', job.app_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setMeta({
            title: data.title as string ?? 'My App',
            icon: data.icon_emoji as string ?? '✨',
            color: data.icon_bg_color as string ?? '#E0E7FF',
            description: data.description as string ?? '',
          });
        }
      });
  }, [job?.status, job?.app_id]);

  /** Submit a new generation job. Returns the jobId. */
  async function generate(params: {
    prompt: string;
    conversationId?: string;
  }): Promise<string> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('Please sign in to create apps.');

    const res = await fetch(`${GENERATOR_URL}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        ...(params.conversationId ? { conversationId: params.conversationId } : {}),
      }),
    });

    if (!res.ok) {
      let errMsg = `Server error ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        errMsg = body.error ?? errMsg;
      } catch {
        // ignore parse failure
      }
      throw new Error(errMsg);
    }

    const { jobId } = (await res.json()) as { jobId: string };
    setActiveJobId(jobId);
    return jobId;
  }

  /** Reset state — call after user installs or dismisses. */
  function clearJob(): void {
    setActiveJobId(null);
    setJob(null);
    setMeta(null);
  }

  const isActive =
    job?.status === 'pending' ||
    job?.status === 'generating' ||
    job?.status === 'deploying';
  const isComplete = job?.status === 'complete';
  const isFailed = job?.status === 'failed';

  return {
    generate,
    clearJob,
    activeJob: job,
    meta,
    isActive,
    isComplete,
    isFailed,
  };
}
