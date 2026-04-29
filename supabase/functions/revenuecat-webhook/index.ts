/**
 * revenuecat-webhook — Supabase Edge Function
 *
 * Receives RevenueCat subscription lifecycle events and persists plan changes
 * to user_profiles. RC's app_user_id is set to the Supabase auth user_id at
 * SDK init time (see services/revenueCat.ts initRevenueCat).
 *
 * POST /functions/v1/revenuecat-webhook
 * Headers: Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
 *          Also accepts the raw secret for backwards compatibility
 * Body: RevenueCat webhook payload
 *
 * Deploy: supabase functions deploy revenuecat-webhook --no-verify-jwt
 * Secret: supabase secrets set REVENUECAT_WEBHOOK_SECRET=<random>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Events that mean the user has or continues active pro access
const UPGRADE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
]);

// Events that mean the subscription has fully ended
const EXPIRY_EVENTS = new Set([
  "EXPIRATION",
]);

// CANCELLATION means "will expire at period end" — keep pro until then
const CANCELLATION_EVENT = "CANCELLATION";

function getAuthToken(header: string | null): string | null {
  if (!header) return null;

  const bearerPrefix = "Bearer ";
  if (header.startsWith(bearerPrefix)) {
    return header.slice(bearerPrefix.length).trim();
  }

  return header.trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Validate shared secret
  const authToken = getAuthToken(req.headers.get("Authorization"));
  if (!WEBHOOK_SECRET || authToken !== WEBHOOK_SECRET) {
    console.warn("[revenuecat-webhook] unauthorized — bad or missing secret");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const event = payload.event as Record<string, unknown> | undefined;
  if (!event) {
    return new Response("Missing event", { status: 400 });
  }

  const eventType = event.type as string | undefined;
  const userId = event.app_user_id as string | undefined;

  console.log(`[revenuecat-webhook] type=${eventType} user=${userId}`);

  if (!userId || !eventType) {
    return new Response("Missing event type or user id", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (UPGRADE_EVENTS.has(eventType)) {
    // Set plan to pro with the expiry date RC provides
    const expirationMs = event.expiration_at_ms as number | null | undefined;
    const planExpiresAt = expirationMs ? new Date(expirationMs).toISOString() : null;

    // Fetch pro limits from plan_templates so they are stamped alongside the plan.
    // get_user_profile() only re-stamps when ALL FOUR limit columns are NULL — existing
    // users have free-plan values set, so we must stamp here explicitly.
    const { data: tpl } = await supabase
      .from("plan_templates")
      .select("app_limit, shared_instance_limit, members_per_instance_limit, storage_limit_mb")
      .eq("plan", "pro")
      .single();

    const { error } = await supabase
      .from("user_profiles")
      .update({
        plan: "pro",
        plan_expires_at: planExpiresAt,
        app_limit: tpl?.app_limit ?? null,
        shared_instance_limit: tpl?.shared_instance_limit ?? null,
        members_per_instance_limit: tpl?.members_per_instance_limit ?? null,
        storage_limit_mb: tpl?.storage_limit_mb ?? null,
      })
      .eq("user_id", userId);

    if (error) {
      console.error(`[revenuecat-webhook] update error (${eventType}):`, error.message);
      return new Response("DB error", { status: 500 });
    }

    // Unfreeze any shared instances that were frozen due to a prior downgrade
    await supabase.rpc("unfreeze_owner_instances", { p_owner_id: userId }).then(
      undefined,
      (e: unknown) => console.warn("[revenuecat-webhook] unfreeze error:", e)
    );

    console.log(`[revenuecat-webhook] upgraded user=${userId} expires=${planExpiresAt}`);

  } else if (eventType === CANCELLATION_EVENT) {
    // User cancelled but keeps access until period end.
    // Update plan_expires_at so the auto-downgrade RPC fires at the right time.
    const expirationMs = event.expiration_at_ms as number | null | undefined;
    const planExpiresAt = expirationMs ? new Date(expirationMs).toISOString() : null;

    const { error } = await supabase
      .from("user_profiles")
      .update({ plan_expires_at: planExpiresAt })
      .eq("user_id", userId);

    if (error) {
      console.error("[revenuecat-webhook] cancellation update error:", error.message);
      return new Response("DB error", { status: 500 });
    }

    console.log(`[revenuecat-webhook] cancelled user=${userId} expires=${planExpiresAt}`);

  } else if (EXPIRY_EVENTS.has(eventType)) {
    // Subscription fully expired — downgrade to free and stamp free limits
    const { data: tpl } = await supabase
      .from("plan_templates")
      .select("app_limit, shared_instance_limit, members_per_instance_limit, storage_limit_mb")
      .eq("plan", "free")
      .single();

    const { error } = await supabase
      .from("user_profiles")
      .update({
        plan: "free",
        plan_expires_at: null,
        app_limit: tpl?.app_limit ?? 5,
        shared_instance_limit: tpl?.shared_instance_limit ?? 0,
        members_per_instance_limit: tpl?.members_per_instance_limit ?? 0,
        storage_limit_mb: tpl?.storage_limit_mb ?? 100,
      })
      .eq("user_id", userId);

    if (error) {
      console.error("[revenuecat-webhook] expiry update error:", error.message);
      return new Response("DB error", { status: 500 });
    }

    // Freeze shared instances owned by this user
    await supabase.rpc("freeze_owner_instances", { p_owner_id: userId }).then(
      undefined,
      (e: unknown) => console.warn("[revenuecat-webhook] freeze error:", e)
    );

    console.log(`[revenuecat-webhook] expired → free user=${userId}`);

  } else {
    // BILLING_ISSUE, TEST, TRANSFER, etc. — log and return 200 (don't retry)
    console.log(`[revenuecat-webhook] unhandled event type=${eventType}, ignoring`);
  }

  return new Response("OK", { status: 200 });
});
