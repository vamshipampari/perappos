-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: stamp limit columns for all existing users from plan_templates
-- DO NOT run this automatically — run manually AFTER 20260403_per_user_limits.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Stamp all users whose limit columns are still NULL (i.e., not yet set by
-- get_user_profile or admin override) by joining against plan_templates.
-- Users with at least one non-NULL limit column are left untouched to preserve
-- any admin overrides already applied.

UPDATE user_profiles up
SET
  app_limit                  = pt.app_limit,
  shared_instance_limit      = pt.shared_instance_limit,
  members_per_instance_limit = pt.members_per_instance_limit,
  storage_limit_mb           = pt.storage_limit_mb
FROM plan_templates pt
WHERE pt.plan = up.plan
  AND up.app_limit                  IS NULL
  AND up.shared_instance_limit      IS NULL
  AND up.members_per_instance_limit IS NULL
  AND up.storage_limit_mb           IS NULL;

-- Verify: users that still have all-NULL limits after the backfill
-- (should be zero; if not, their plan is missing from plan_templates)
SELECT user_id, plan
FROM user_profiles
WHERE app_limit                  IS NULL
  AND shared_instance_limit      IS NULL
  AND members_per_instance_limit IS NULL
  AND storage_limit_mb           IS NULL;
