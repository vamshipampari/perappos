/**
 * notify-signup — Supabase Edge Function
 *
 * Called by a PostgreSQL trigger (via pg_net) whenever a new row is inserted
 * into auth.users. Sends a notification email to the developer via Resend.
 *
 * POST /functions/v1/notify-signup
 * Headers: X-Webhook-Secret: <NOTIFY_WEBHOOK_SECRET>
 * Body: { record: { id, email, created_at } }
 *
 * Deploy: supabase functions deploy notify-signup --no-verify-jwt
 * Secrets:
 *   supabase secrets set RESEND_API_KEY=re_xxxx
 *   supabase secrets set NOTIFY_WEBHOOK_SECRET=<same value as in the migration SQL>
 */

const WEBHOOK_SECRET = Deno.env.get("NOTIFY_WEBHOOK_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const NOTIFY_TO = "vamshipampari007@gmail.com";
const NOTIFY_FROM = "noreply@cottix.co";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = req.headers.get("X-Webhook-Secret");
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    console.warn("[notify-signup] unauthorized — bad or missing secret");
    return new Response("Unauthorized", { status: 401 });
  }

  if (!RESEND_API_KEY) {
    console.error("[notify-signup] RESEND_API_KEY not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  let body: { record?: { id?: string; email?: string; created_at?: string } };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { id, email, created_at } = body.record ?? {};
  if (!email) {
    return new Response("Missing email in record", { status: 400 });
  }

  const signupTime = created_at
    ? new Date(created_at).toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    : "unknown";

  const html = `
    <h2>New Cottix signup</h2>
    <table style="border-collapse:collapse;font-family:sans-serif">
      <tr><td style="padding:4px 12px 4px 0;color:#888">Email</td><td><strong>${email}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888">User ID</td><td>${id ?? "—"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888">Signed up</td><td>${signupTime} IST</td></tr>
    </table>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: NOTIFY_TO,
      subject: `New signup: ${email}`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[notify-signup] Resend error ${res.status}:`, err);
    return new Response("Email send failed", { status: 500 });
  }

  console.log(`[notify-signup] notified for user=${email}`);
  return new Response("OK", { status: 200 });
});
