-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Per-user limit enforcement system
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. plan_templates ────────────────────────────────────────────────────────
-- Stores the default limit values per plan tier.
-- NULL means unlimited in all limit columns.

CREATE TABLE IF NOT EXISTS plan_templates (
  plan                       TEXT PRIMARY KEY,
  app_limit                  INTEGER,        -- NULL = unlimited
  shared_instance_limit      INTEGER,        -- NULL = unlimited; 0 = sharing disabled
  members_per_instance_limit INTEGER,        -- NULL = unlimited; 0 = no external members
  storage_limit_mb           INTEGER,        -- NULL = unlimited
  display_name               TEXT NOT NULL DEFAULT ''
);

-- Seed from the PLAN_LIMITS object that existed client-side:
--   free:  5 apps, 0 shared instances, 0 members per instance
--   beta:  unlimited apps, 5 shared, 5 members per instance
--   pro:   unlimited apps, 5 shared, 5 members per instance
--   team:  unlimited apps, unlimited shared, 20 members per instance
INSERT INTO plan_templates
  (plan, app_limit, shared_instance_limit, members_per_instance_limit, storage_limit_mb, display_name)
VALUES
  ('free', 5,    0,    0,    100,  'Free'),
  ('beta', NULL, 5,    5,    1000, 'Beta'),
  ('pro',  NULL, 5,    5,    1000, 'Pro'),
  ('team', NULL, NULL, 20,   5000, 'Team')
ON CONFLICT (plan) DO UPDATE SET
  app_limit                  = EXCLUDED.app_limit,
  shared_instance_limit      = EXCLUDED.shared_instance_limit,
  members_per_instance_limit = EXCLUDED.members_per_instance_limit,
  storage_limit_mb           = EXCLUDED.storage_limit_mb,
  display_name               = EXCLUDED.display_name;

-- plan_templates is non-sensitive config — disable RLS so any authenticated
-- client can read it without needing an explicit policy.
ALTER TABLE plan_templates DISABLE ROW LEVEL SECURITY;

-- ── 2. Limit columns on user_profiles ────────────────────────────────────────
-- NULL = unlimited (set per-user overrides in admin; plan changes stamp these).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS app_limit                  INTEGER,
  ADD COLUMN IF NOT EXISTS shared_instance_limit      INTEGER,
  ADD COLUMN IF NOT EXISTS members_per_instance_limit INTEGER,
  ADD COLUMN IF NOT EXISTS storage_limit_mb           INTEGER;

-- ── 3. Override columns on promo_codes ───────────────────────────────────────
-- When set, these override the plan_templates defaults on redemption.

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS app_limit_override             INTEGER,
  ADD COLUMN IF NOT EXISTS shared_instance_limit_override INTEGER;

-- ── 4. get_user_profile ──────────────────────────────────────────────────────
-- Stamps limit columns from plan_templates when all four are NULL (new user or
-- plan change). Returns full user_profiles row as JSON including limit columns.
-- DROP first: CREATE OR REPLACE cannot change an existing function's return type.

DROP FUNCTION IF EXISTS get_user_profile();

CREATE OR REPLACE FUNCTION get_user_profile()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile user_profiles%ROWTYPE;
  v_tpl     plan_templates%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Auto-create profile if missing (new user)
  INSERT INTO user_profiles (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_profile FROM user_profiles WHERE user_id = v_uid;

  -- Auto-downgrade if plan has expired
  IF v_profile.plan <> 'free'
     AND v_profile.plan_expires_at IS NOT NULL
     AND v_profile.plan_expires_at < NOW() THEN
    PERFORM freeze_owner_instances(v_uid);
    SELECT * INTO v_tpl FROM plan_templates WHERE plan = 'free';
    UPDATE user_profiles
    SET plan                       = 'free',
        app_limit                  = v_tpl.app_limit,
        shared_instance_limit      = v_tpl.shared_instance_limit,
        members_per_instance_limit = v_tpl.members_per_instance_limit,
        storage_limit_mb           = v_tpl.storage_limit_mb
    WHERE user_id = v_uid;
    SELECT * INTO v_profile FROM user_profiles WHERE user_id = v_uid;
  END IF;

  -- Stamp limit columns from plan_templates if all four are NULL.
  -- This handles: new users, users who existed before this migration,
  -- and plan changes that updated `plan` but didn't write limit columns.
  IF v_profile.app_limit IS NULL
     AND v_profile.shared_instance_limit IS NULL
     AND v_profile.members_per_instance_limit IS NULL
     AND v_profile.storage_limit_mb IS NULL THEN
    SELECT * INTO v_tpl FROM plan_templates WHERE plan = v_profile.plan;
    IF FOUND THEN
      UPDATE user_profiles
      SET app_limit                  = v_tpl.app_limit,
          shared_instance_limit      = v_tpl.shared_instance_limit,
          members_per_instance_limit = v_tpl.members_per_instance_limit,
          storage_limit_mb           = v_tpl.storage_limit_mb
      WHERE user_id = v_uid;
      SELECT * INTO v_profile FROM user_profiles WHERE user_id = v_uid;
    END IF;
  END IF;

  RETURN row_to_json(v_profile);
END;
$$;

-- ── 5. increment_app_count ───────────────────────────────────────────────────
-- Returns { "success": true } on success.
-- Returns { "error": "app_limit_exceeded", "limit": N } if the user is at their
-- app limit (only checked when delta > 0; decrements always succeed).

DROP FUNCTION IF EXISTS increment_app_count(INT);

CREATE OR REPLACE FUNCTION increment_app_count(delta INT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile user_profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_profile FROM user_profiles WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RETURN json_build_object('success', TRUE);
  END IF;

  -- Limit check: only on increment; NULL limit = unlimited
  IF delta > 0
     AND v_profile.app_limit IS NOT NULL
     AND v_profile.app_install_count >= v_profile.app_limit THEN
    RETURN json_build_object('error', 'app_limit_exceeded', 'limit', v_profile.app_limit);
  END IF;

  UPDATE user_profiles
  SET app_install_count = GREATEST(0, app_install_count + delta)
  WHERE user_id = v_uid;

  RETURN json_build_object('success', TRUE);
END;
$$;

-- ── 6. increment_shared_instance_count ──────────────────────────────────────
-- Returns { "success": true } on success.
-- Returns { "error": "shared_instance_limit_exceeded", "limit": N } if at limit
-- (only checked when delta > 0; decrements always succeed).

DROP FUNCTION IF EXISTS increment_shared_instance_count(INT);

CREATE OR REPLACE FUNCTION increment_shared_instance_count(delta INT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile user_profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_profile FROM user_profiles WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RETURN json_build_object('success', TRUE);
  END IF;

  -- Limit check: only on increment; NULL limit = unlimited; 0 = sharing disabled
  IF delta > 0 AND v_profile.shared_instance_limit IS NOT NULL THEN
    IF v_profile.shared_instance_count >= v_profile.shared_instance_limit THEN
      RETURN json_build_object(
        'error', 'shared_instance_limit_exceeded',
        'limit', v_profile.shared_instance_limit
      );
    END IF;
  END IF;

  UPDATE user_profiles
  SET shared_instance_count = GREATEST(0, shared_instance_count + delta)
  WHERE user_id = v_uid;

  RETURN json_build_object('success', TRUE);
END;
$$;

-- ── 7. add_instance_member ───────────────────────────────────────────────────
-- Checks members_per_instance_limit on the instance owner before inserting.
-- Returns { "success": true } or { "error": "members_per_instance_limit_exceeded", "limit": N }.

DROP FUNCTION IF EXISTS add_instance_member(TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION add_instance_member(
  p_instance_id TEXT,
  p_user_id     UUID,
  p_role        TEXT
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id UUID;
  v_owner    user_profiles%ROWTYPE;
  v_count    INT;
BEGIN
  -- Look up the instance owner
  SELECT owner_id INTO v_owner_id
  FROM shared_instances
  WHERE instance_id = p_instance_id;

  -- Check member limit on the owner's profile (skip for the owner themselves)
  IF v_owner_id IS NOT NULL AND p_role <> 'owner' THEN
    SELECT * INTO v_owner FROM user_profiles WHERE user_id = v_owner_id;

    IF FOUND AND v_owner.members_per_instance_limit IS NOT NULL THEN
      SELECT COUNT(*) INTO v_count
      FROM instance_members
      WHERE instance_id = p_instance_id
        AND status = 'active';

      IF v_count >= v_owner.members_per_instance_limit THEN
        RETURN json_build_object(
          'error', 'members_per_instance_limit_exceeded',
          'limit', v_owner.members_per_instance_limit
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO instance_members (id, instance_id, user_id, role, joined_at)
  VALUES (gen_random_uuid(), p_instance_id, p_user_id, p_role, NOW())
  ON CONFLICT DO NOTHING;

  RETURN json_build_object('success', TRUE);
END;
$$;

-- ── 8. redeem_promo_code ─────────────────────────────────────────────────────
-- After applying the promo, stamps limit columns on the user's profile from
-- plan_templates. If the promo code has override columns set, those take
-- precedence over the template defaults.

DROP FUNCTION IF EXISTS redeem_promo_code(TEXT);

CREATE OR REPLACE FUNCTION redeem_promo_code(code_input TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_code     promo_codes%ROWTYPE;
  v_tpl      plan_templates%ROWTYPE;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Already redeemed?
  IF EXISTS (
    SELECT 1 FROM promo_redemptions WHERE user_id = v_uid AND code = code_input
  ) THEN
    RETURN json_build_object('success', FALSE, 'error', 'Code already redeemed');
  END IF;

  -- Find the code
  SELECT * INTO v_code FROM promo_codes WHERE code = code_input;
  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'Invalid code');
  END IF;

  -- Max redemptions reached?
  IF v_code.max_redemptions IS NOT NULL
     AND v_code.redemption_count >= v_code.max_redemptions THEN
    RETURN json_build_object('success', FALSE, 'error', 'Code has expired');
  END IF;

  -- Compute expiry
  v_expires := CASE
    WHEN v_code.duration_days IS NOT NULL
      THEN NOW() + (v_code.duration_days || ' days')::INTERVAL
    ELSE NULL
  END;

  -- Get plan template for the granted plan
  SELECT * INTO v_tpl FROM plan_templates WHERE plan = v_code.plan;

  -- Stamp profile: plan + limits. Code override columns take precedence over template.
  UPDATE user_profiles
  SET plan                       = v_code.plan,
      plan_expires_at            = v_expires,
      promo_code_used            = code_input,
      app_limit                  = COALESCE(v_code.app_limit_override,             v_tpl.app_limit),
      shared_instance_limit      = COALESCE(v_code.shared_instance_limit_override, v_tpl.shared_instance_limit),
      members_per_instance_limit = v_tpl.members_per_instance_limit,
      storage_limit_mb           = v_tpl.storage_limit_mb
  WHERE user_id = v_uid;

  -- Record redemption
  INSERT INTO promo_redemptions (user_id, code, redeemed_at)
  VALUES (v_uid, code_input, NOW());

  -- Increment redemption counter
  UPDATE promo_codes
  SET redemption_count = redemption_count + 1
  WHERE code = code_input;

  -- Unfreeze any frozen instances now that plan is upgraded
  PERFORM unfreeze_owner_instances(v_uid);

  RETURN json_build_object(
    'success', TRUE,
    'plan',    v_code.plan,
    'message', 'Code redeemed! Your plan has been upgraded to ' || v_code.plan || '.'
  );
END;
$$;
