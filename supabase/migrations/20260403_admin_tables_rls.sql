-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Lock down admin analytics views
-- These are VIEWs (not tables), so RLS is not applicable.
-- Instead, revoke SELECT from the authenticated role so app clients cannot
-- query them directly. service_role (edge functions / triggers) retains access.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE SELECT ON admin_daily_metrics FROM authenticated;
REVOKE SELECT ON admin_funnel         FROM authenticated;
REVOKE SELECT ON admin_user_journey   FROM authenticated;
