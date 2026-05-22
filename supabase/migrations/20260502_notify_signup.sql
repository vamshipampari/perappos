-- Migration: notify-signup trigger
--
-- Fires the `notify-signup` edge function whenever a new user registers.
-- Uses pg_net for a fire-and-forget HTTP call from the database.
--
-- BEFORE RUNNING THIS MIGRATION:
--   1. Deploy the edge function:
--        supabase functions deploy notify-signup --no-verify-jwt
--   2. Set secrets (use the same secret string in both commands):
--        supabase secrets set RESEND_API_KEY=re_xxxx
--        supabase secrets set NOTIFY_WEBHOOK_SECRET=<your-secret>
--   3. Replace REPLACE_WITH_YOUR_SECRET below with that same secret string.
--   4. Apply this migration: supabase db push (or paste into Supabase SQL editor)

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_signup_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://fpfobytbawcjuextxlfx.supabase.co/functions/v1/notify-signup',
    headers := jsonb_build_object(
                 'Content-Type',      'application/json',
                 'X-Webhook-Secret',  'b1bb3b047f693785ce3090f8f59d20b54cb3553956188ded'
               ),
    body    := jsonb_build_object(
                 'record', jsonb_build_object(
                   'id',         NEW.id::text,
                   'email',      NEW.email,
                   'created_at', NEW.created_at
                 )
               )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify-signup] HTTP call failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_signup_notify ON auth.users;
CREATE TRIGGER on_auth_user_signup_notify
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.notify_signup_on_insert();
