-- Migration: generation_jobs table + html_content on generated_apps
-- Created: 2026-04-14
-- Purpose: Support Cloudflare Queue-based AI generation with durable job tracking

-- ── generation_jobs ────────────────────────────────────────────────────────
-- One row per generation request. Worker B writes status updates via service
-- role (bypasses RLS). PowerSync syncs this to the device so the app can watch
-- progress without polling.

CREATE TABLE public.generation_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending',
  -- pending | generating | deploying | complete | failed
  prompt           TEXT NOT NULL,
  app_id           TEXT,           -- set on complete; matches KV key + generated_apps.app_id
  hosted_url       TEXT,           -- set on complete; https://apps.cottix.co/{app_id}
  progress_chars   INT DEFAULT 0,  -- updated every ~2000 chars during generation
  error_message    TEXT,           -- set on failed
  conversation_id  TEXT,           -- app_id of existing generated_apps row being modified
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

-- RLS: users can read and create their own jobs.
-- Worker B writes via service role and is exempt from RLS.
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own generation jobs"
  ON public.generation_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own generation jobs"
  ON public.generation_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── generated_apps: add html_content ───────────────────────────────────────
-- Stores the generated HTML so the modify flow can retrieve it server-side
-- without the device needing to upload it back.
ALTER TABLE public.generated_apps
  ADD COLUMN IF NOT EXISTS html_content TEXT;
