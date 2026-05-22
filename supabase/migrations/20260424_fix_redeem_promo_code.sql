-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: redeem_promo_code crash + safe freeze/unfreeze functions
--
-- Root cause: redeem_promo_code calls PERFORM unfreeze_owner_instances() which
-- was deployed directly in the Supabase dashboard (not tracked in git) and was
-- likely modified when the admin limit override system was added, breaking it.
-- Dropping + recreating all three functions fixes any stale %ROWTYPE cache too.
--
-- Run in Supabase SQL Editor → paste → Run
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. freeze_owner_instances ────────────────────────────────────────────────
-- Called by get_user_profile when a plan expires.
-- Simple UPDATE — no %ROWTYPE, no limit column logic.

DROP FUNCTION IF EXISTS public.freeze_owner_instances(UUID);

CREATE FUNCTION public.freeze_owner_instances(p_owner_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE shared_instances
  SET is_frozen     = TRUE,
      frozen_at     = NOW(),
      frozen_reason = 'plan_downgrade'
  WHERE owner_id = p_owner_id
    AND (is_frozen = FALSE OR is_frozen IS NULL);
END;
$$;


-- ── 2. unfreeze_owner_instances ──────────────────────────────────────────────
-- Called by redeem_promo_code after a successful upgrade.
-- Simple UPDATE — no %ROWTYPE, no limit column logic.

DROP FUNCTION IF EXISTS public.unfreeze_owner_instances(UUID);

CREATE FUNCTION public.unfreeze_owner_instances(p_owner_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE shared_instances
  SET is_frozen     = FALSE,
      frozen_at     = NULL,
      frozen_reason = NULL
  WHERE owner_id = p_owner_id
    AND is_frozen = TRUE;
END;
$$;


-- ── 3. redeem_promo_code ─────────────────────────────────────────────────────
-- DROP first forces a full recompile → busts any stale %ROWTYPE cache.
-- Uses correct promo_codes column names: plan_granted, current_redemptions,
-- is_active, expires_at (actual DB schema differs from original migration).
--
-- Admin override preservation: limit columns that were manually set to a more
-- generous value than the plan template are kept (NULL = unlimited always wins).

DROP FUNCTION IF EXISTS redeem_promo_code(TEXT);

CREATE FUNCTION public.redeem_promo_code(code_input TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_code    promo_codes%ROWTYPE;
  v_tpl     plan_templates%ROWTYPE;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Already redeemed?
  IF EXISTS (
    SELECT 1 FROM promo_redemptions
    WHERE user_id = v_uid AND code = code_input
  ) THEN
    RETURN json_build_object('success', FALSE, 'error', 'Code already redeemed');
  END IF;

  -- Find the code
  SELECT * INTO v_code FROM promo_codes WHERE code = code_input;
  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'Invalid code');
  END IF;

  -- Code inactive?
  IF v_code.is_active = FALSE THEN
    RETURN json_build_object('success', FALSE, 'error', 'Invalid code');
  END IF;

  -- Code expired by date?
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at < NOW() THEN
    RETURN json_build_object('success', FALSE, 'error', 'Code has expired');
  END IF;

  -- Max redemptions reached?
  IF v_code.max_redemptions IS NOT NULL
     AND v_code.current_redemptions >= v_code.max_redemptions THEN
    RETURN json_build_object('success', FALSE, 'error', 'Code has expired');
  END IF;

  -- Compute expiry
  v_expires := CASE
    WHEN v_code.duration_days IS NOT NULL
      THEN NOW() + (v_code.duration_days || ' days')::INTERVAL
    ELSE NULL
  END;

  -- Get plan template for the granted plan
  SELECT * INTO v_tpl FROM plan_templates WHERE plan = v_code.plan_granted;

  -- Stamp profile: plan + limits.
  -- Priority: code override > keep admin-set generous override > plan template.
  -- NULL (unlimited) always beats a numeric cap.
  UPDATE user_profiles
  SET
    plan                  = v_code.plan_granted,
    plan_expires_at       = v_expires,
    promo_code_used       = code_input,

    app_limit             = CASE
      WHEN v_code.app_limit_override IS NOT NULL  THEN v_code.app_limit_override
      WHEN v_tpl.app_limit IS NULL                THEN NULL
      WHEN app_limit IS NULL                      THEN NULL
      ELSE GREATEST(app_limit, v_tpl.app_limit)
    END,

    shared_instance_limit = CASE
      WHEN v_code.shared_instance_limit_override IS NOT NULL THEN v_code.shared_instance_limit_override
      WHEN v_tpl.shared_instance_limit IS NULL               THEN NULL
      WHEN shared_instance_limit IS NULL                     THEN NULL
      ELSE GREATEST(shared_instance_limit, v_tpl.shared_instance_limit)
    END,

    members_per_instance_limit = COALESCE(v_tpl.members_per_instance_limit, members_per_instance_limit),
    storage_limit_mb           = COALESCE(v_tpl.storage_limit_mb, storage_limit_mb)

  WHERE user_id = v_uid;

  -- Record redemption
  INSERT INTO promo_redemptions (user_id, code, redeemed_at)
  VALUES (v_uid, code_input, NOW());

  -- Increment redemption counter
  UPDATE promo_codes
  SET current_redemptions = current_redemptions + 1
  WHERE code = code_input;

  -- Unfreeze any instances frozen by a previous plan downgrade
  PERFORM unfreeze_owner_instances(v_uid);

  RETURN json_build_object(
    'success', TRUE,
    'plan',    v_code.plan_granted,
    'message', 'Code redeemed! Your plan has been upgraded to ' || v_code.plan_granted || '.'
  );
END;
$$;
