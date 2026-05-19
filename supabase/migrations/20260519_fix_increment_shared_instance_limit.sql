-- Fix increment_shared_instance_count to properly block free users.
--
-- Two gaps in the previous implementation:
-- 1. limit = 0 → outer IS NOT NULL check passes, but 0 >= 0 evaluates to true
--    on the FIRST call, so this case actually worked — but the explicit check
--    below makes the intent unambiguous.
-- 2. limit IS NULL (limits not yet stamped for a new user) + plan = 'free'
--    → outer IS NOT NULL check FAILS → treated as unlimited → free user slips through.
--
-- The new function handles all three cases explicitly before falling through
-- to the numeric-limit check.

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

  IF delta > 0 THEN
    -- Case 1: sharing explicitly disabled (free plan stamps this to 0)
    IF v_profile.shared_instance_limit = 0 THEN
      RETURN json_build_object('error', 'shared_instance_limit_exceeded', 'limit', 0);
    END IF;

    -- Case 2: timing race — limits not yet stamped for a new free user
    IF v_profile.shared_instance_limit IS NULL AND v_profile.plan = 'free' THEN
      RETURN json_build_object('error', 'shared_instance_limit_exceeded', 'limit', 0);
    END IF;

    -- Case 3: finite non-zero limit — enforce count
    IF v_profile.shared_instance_limit IS NOT NULL
       AND v_profile.shared_instance_count >= v_profile.shared_instance_limit THEN
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
