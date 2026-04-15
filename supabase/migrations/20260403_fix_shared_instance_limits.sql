-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: recount shared_instance_count from real data + fix per-user limit overrides
-- Run in Supabase SQL Editor AFTER 20260403_per_user_limits.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Recount shared_instance_count from actual shared_instances rows ────────
-- The shared_instance_count counter can drift when:
--   - increment/decrement RPC calls fail (network, missing function pre-migration)
--   - the user deleted shared instances before decrement was wired up
--
-- This sets the count to the real number of non-frozen owned instances.

UPDATE user_profiles up
SET shared_instance_count = (
  SELECT COUNT(*)
  FROM shared_instances si
  WHERE si.owner_id = up.user_id
    AND (si.is_frozen = FALSE OR si.is_frozen IS NULL)
);

-- ── 2. Apply promo-code limit overrides to existing users ────────────────────
-- Users who redeemed a promo code BEFORE the per_user_limits migration was
-- applied did not get limit columns stamped from the override columns.
-- This re-stamps them now so the actual user_profiles columns match the intent.

WITH new_limits AS (
  SELECT
    up.user_id,
    COALESCE(pc.shared_instance_limit_override, pt.shared_instance_limit) AS shared_instance_limit,
    COALESCE(pc.app_limit_override,             pt.app_limit)             AS app_limit,
    pt.members_per_instance_limit,
    pt.storage_limit_mb
  FROM user_profiles up
  JOIN promo_codes    pc ON pc.code     = up.promo_code_used
  JOIN plan_templates pt ON pt.plan     = up.plan
  WHERE pc.shared_instance_limit_override IS NOT NULL
    AND (up.shared_instance_limit IS NULL
         OR pc.shared_instance_limit_override > up.shared_instance_limit)
)
UPDATE user_profiles
SET
  shared_instance_limit      = nl.shared_instance_limit,
  app_limit                  = nl.app_limit,
  members_per_instance_limit = nl.members_per_instance_limit,
  storage_limit_mb           = nl.storage_limit_mb
FROM new_limits nl
WHERE user_profiles.user_id = nl.user_id;

-- ── 3. Verify: show current state of all users (sanity check) ────────────────
SELECT
  user_id,
  plan,
  promo_code_used,
  app_install_count,
  shared_instance_count,
  app_limit,
  shared_instance_limit,
  members_per_instance_limit
FROM user_profiles
ORDER BY created_at;
