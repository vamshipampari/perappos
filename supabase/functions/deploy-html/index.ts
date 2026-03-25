/**
 * deploy-html — Supabase Edge Function
 *
 * Accepts user-supplied HTML and publishes it to Cloudflare Workers KV so it
 * can be served at https://apps.cottix.co/<appId>.
 *
 * POST /functions/v1/deploy-html
 * Headers: Authorization: Bearer <supabase_jwt>
 * Body:    { appId: string, html: string }
 * Returns: { url: string }
 */

const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID")!;
const CF_KV_NAMESPACE_ID = Deno.env.get("CF_KV_NAMESPACE_ID")!;
const CF_API_TOKEN = Deno.env.get("CF_API_TOKEN")!;
const APPS_BASE_URL = Deno.env.get("APPS_BASE_URL") || "https://apps.cottix.co";

const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 MB

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function publishToCloudflare(appId: string, html: string): Promise<string> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/app:${appId}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "text/plain",
    },
    body: html,
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Cloudflare KV write failed: ${resp.status} ${error}`);
  }

  return `${APPS_BASE_URL}/${appId}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ── JWT auth (same local-decode pattern as generate-app) ──────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const token = authHeader.replace(/^bearer\s+/i, "");
    let userId: string;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("malformed JWT");
      const seg = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
      const payload = JSON.parse(atob(padded)) as {
        aud?: string;
        role?: string;
        sub?: string;
        exp?: number;
      };
      const isAuthenticated =
        payload.aud === "authenticated" || payload.role === "authenticated";
      if (!isAuthenticated || !payload.sub) {
        throw new Error(`not authenticated (aud=${payload.aud})`);
      }
      if ((payload.exp ?? 0) < Math.floor(Date.now() / 1000)) {
        throw new Error("token expired");
      }
      userId = payload.sub;
    } catch (err) {
      console.error("JWT decode error:", err instanceof Error ? err.message : err);
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Parse + validate request body ────────────────────────────────────
    let body: { appId?: unknown; html?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { appId, html } = body;

    if (typeof appId !== "string" || appId.trim().length === 0) {
      return json({ error: "appId is required" }, 400);
    }

    if (typeof html !== "string" || html.trim().length === 0) {
      return json({ error: "html is required" }, 400);
    }

    const htmlBytes = new TextEncoder().encode(html).length;
    if (htmlBytes > MAX_HTML_BYTES) {
      return json(
        { error: `HTML too large: ${(htmlBytes / 1024 / 1024).toFixed(1)} MB (max 5 MB)` },
        413
      );
    }

    if (!html.includes("<html") && !html.includes("<!DOCTYPE")) {
      return json({ error: "Content does not appear to be valid HTML" }, 422);
    }

    console.log(`[deploy-html] user=${userId} appId=${appId} bytes=${htmlBytes}`);

    // ── Publish to Cloudflare KV ──────────────────────────────────────────
    const url = await publishToCloudflare(appId.trim(), html);

    return json({ url });
  } catch (err) {
    console.error("[deploy-html] error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
