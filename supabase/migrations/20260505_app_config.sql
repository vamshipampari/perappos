-- Migration: app_config — remote key/value store for app configuration
-- Non-sensitive global config (same pattern as plan_templates).
-- Not user-specific — correctly excluded from delete_own_account.

CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Non-sensitive config — disable RLS so authenticated clients can read directly.
-- Same pattern as plan_templates. The Supabase JS client requires a valid session
-- before any query from the app, so anon access is not a concern.
ALTER TABLE public.app_config DISABLE ROW LEVEL SECURITY;

-- Seed: full ordered slide list as a JSON array.
-- Edit this value in the Supabase SQL editor to change copy, add/remove/reorder
-- slides without an app rebuild.
--
-- Supported slide types: welcome | video | demo_apps | feature | paywall
--
-- To add an API Keys feature slide before paywall (index 3), run:
--   UPDATE public.app_config
--   SET value = jsonb_insert(
--     value::jsonb, '{3}',
--     '{"type":"feature","icon":"🔑","headline":"Save API keys once, use everywhere",
--       "body":"Store your OpenAI or Anthropic keys securely — the key never touches JavaScript.",
--       "bullets":["Encrypted on-device storage","Works across all mini-apps","Set once, reuse anywhere"]}'::jsonb
--   )::text
--   WHERE key = 'onboarding_slides';
--
-- To remove a slide or reorder: UPDATE public.app_config SET value = '<new JSON>' WHERE key = 'onboarding_slides';

INSERT INTO public.app_config (key, value)
VALUES (
  'onboarding_slides',
  '[
    {
      "type": "welcome",
      "headline": "Turn any AI-built web app into a native mobile app",
      "subtext": "Cottix wraps your vibe-coded apps with offline storage, real-time sync, and native device features — no backend needed."
    },
    {
      "type": "video",
      "heading": "See it in action",
      "video_url": "https://www.youtube.com/embed/dQw4w9WgXcQ"
    },
    {
      "type": "demo_apps",
      "heading": "Here''s what people are building",
      "apps": [
        {"name":"Subtrack","desc":"Subscription tracker","url":"https://apps.cottix.co/demo/subtrack","icon":"📊","color":"#DBEAFE"},
        {"name":"Workout Log","desc":"Track sets, reps & progress","url":"https://apps.cottix.co/demo/workout","icon":"💪","color":"#D1FAE5"},
        {"name":"Expense Snap","desc":"Quick daily expense logger","url":"https://apps.cottix.co/demo/expense","icon":"💸","color":"#FEF3C7"},
        {"name":"Daily Habits","desc":"Habit streaks & check-ins","url":"https://apps.cottix.co/demo/habits","icon":"✅","color":"#E0E7FF"},
        {"name":"Meal Planner","desc":"Weekly meal planning","url":"https://apps.cottix.co/demo/meals","icon":"🍽️","color":"#FCE7F3"}
      ]
    },
    {
      "type": "paywall",
      "headline": "Unlock the full Cottix experience",
      "body": "Go Pro for unlimited apps, cloud sync across devices, and real-time collaboration with your team.",
      "cta": "Start Free Trial",
      "skip": "Maybe later"
    }
  ]'
)
ON CONFLICT (key) DO NOTHING;
