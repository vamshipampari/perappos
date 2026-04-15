/**
 * cottix-generator — Cloudflare Worker
 *
 * fetch handler  (Worker A): HTTP receiver — validates JWT, rate-limits, enqueues job
 * queue handler  (Worker B): queue consumer — streams from Anthropic, writes KV + Supabase
 *
 * Deploy:
 *   wrangler queues create generation-queue
 *   wrangler queues create generation-dlq
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
 *   wrangler deploy
 */

// ---------- Types ----------

export interface Env {
  GENERATION_QUEUE: Queue;
  APPS_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  APPS_HOST: string;
  POSTHOG_PROJECT_TOKEN: string;
  POSTHOG_HOST: string;
}

interface QueueMessage {
  jobId: string;
  userId: string;
  prompt: string;
  conversationId: string | null;
  submittedAt: number; // unix ms — used to calculate total generation time
}

interface AppMetadata {
  title: string;
  icon: string;
  color: string;
  description: string;
}

// ---------- Constants ----------

const MAX_GENERATIONS_PER_DAY = 20;
const PROGRESS_UPDATE_INTERVAL_CHARS = 2000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---------- System Prompt (copied from generate-app edge function) ----------

const SYSTEM_PROMPT = `You are an expert iOS app developer. You build single-file HTML apps that are visually indistinguishable from native iPhone apps — the quality of Apple's own built-in apps (Clock, Reminders, Notes, Calculator). Every pixel must look intentional and polished.

━━━ FUNCTIONAL RULES ━━━
1. Output ONLY a single HTML file. No explanations, no markdown fences, no commentary. Raw HTML starting with <!DOCTYPE html>.
2. ALL CSS inline in <style>. ALL JavaScript inline in <script>. NO external resources, NO CDN links, NO imports whatsoever.
3. <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover"> must be in <head>.
4. Use localStorage for ALL data persistence. Key prefix: short app name (e.g. "tambola_", "tracker_").
5. FULLY FUNCTIONAL — every button works, all data saves/loads, all features implemented. No placeholders, no mockups.
6. <title> tag required. Short, descriptive app name.
7. Cottix metadata tag required in <head>:
   <meta name="cottix-meta" content='{"icon":"EMOJI","color":"HEX","description":"SHORT_DESCRIPTION"}'>
   Use a fitting emoji. Pastel background colors only: #DBEAFE #D1FAE5 #FEF3C7 #FCE7F3 #E0E7FF #FEE2E2 #F3E8FF #E5E7EB
8. NEVER include any HTML comments in the output.

━━━ MANDATORY CSS FOUNDATION ━━━
Every app MUST open its <style> block with this exact reset and design system. Do not omit or modify it:

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
* { -webkit-tap-highlight-color: transparent; }
::-webkit-scrollbar { display: none; }

:root {
  --bg:      #F2F2F7;
  --surface: #FFFFFF;
  --label:   #1C1C1E;
  --label2:  #3C3C43;
  --label3:  #8E8E93;
  --sep:     rgba(60,60,67,0.18);
  --blue:    #007AFF;
  --green:   #34C759;
  --red:     #FF3B30;
  --orange:  #FF9500;
  --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 20px;
}

html, body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
  background: var(--bg);
  color: var(--label);
  -webkit-font-smoothing: antialiased;
  font-size: 17px;
  line-height: 1.4;
}

button { font-family: inherit; font-size: inherit; border: none; background: none; cursor: pointer; }
input, textarea, select { font-family: inherit; font-size: 16px; border: none; outline: none; background: none; color: var(--label); }
input::placeholder, textarea::placeholder { color: var(--label3); }

━━━ COMPONENT PATTERNS — use these for all UI ━━━

SCREEN LAYOUT:
  Always wrap in a full-height flex column:
  <div style="display:flex;flex-direction:column;height:100dvh;overflow:hidden">
    <div class="nav-bar">...</div>
    <div style="flex:1;overflow-y:auto;padding-bottom:max(env(safe-area-inset-bottom),24px)">
      ...content...
    </div>
  </div>

NAVIGATION BAR (required on every screen):
  .nav-bar {
    display: flex; align-items: flex-end; justify-content: center; position: relative;
    padding-top: env(safe-area-inset-top);
    min-height: calc(44px + env(safe-area-inset-top));
    padding-bottom: 11px;
    background: rgba(255,255,255,0.92);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-bottom: 0.5px solid var(--sep);
    flex-shrink: 0;
  }
  Nav title: font-size 17px, font-weight 600, color var(--label)
  Nav action buttons (left/right): position absolute, bottom 11px, color var(--blue), font-size 17px

LARGE TITLE PAGE HEADER (dashboard / home screens):
  padding: calc(env(safe-area-inset-top) + 12px) 16px 4px;
  font-size: 34px; font-weight: 700; letter-spacing: -0.5px;
  Subtitle/date below: font-size 15px, color var(--label3), margin-top 4px

GROUPED SECTION (the primary layout pattern — use everywhere):
  .section { margin: 24px 16px 0; }
  .section-header { font-size: 13px; color: var(--label3); text-transform: uppercase; letter-spacing: 0.3px; padding: 0 4px 6px; }
  .section-body { background: var(--surface); border-radius: var(--r-md); overflow: hidden; }
  .row { display: flex; align-items: center; padding: 12px 16px; min-height: 44px; border-bottom: 0.5px solid var(--sep); gap: 12px; }
  .row:last-child { border-bottom: none; }
  .row-label { flex: 1; font-size: 17px; }
  .row-value { font-size: 17px; color: var(--label3); }
  Disclosure arrow: content '›', font-size 22px, color var(--label3), margin-left 4px

CARD (floating content block — for stats, summaries):
  background: var(--surface); border-radius: var(--r-lg); padding: 16px; margin: 16px 16px 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.04);

BUTTONS — exact styles required:
  Primary (main action, full-width):
    background: var(--blue); color: #fff; border-radius: var(--r-md);
    height: 50px; width: 100%; font-size: 17px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
  Tinted:
    background: rgba(0,122,255,0.12); color: var(--blue); border-radius: var(--r-md); height: 44px; font-size: 17px; font-weight: 600; padding: 0 20px;
  Destructive:
    background: rgba(255,59,48,0.1); color: var(--red); border-radius: var(--r-md); height: 44px; font-size: 17px; font-weight: 600; padding: 0 20px;
  Plain text:
    color: var(--blue); font-size: 17px; height: 44px; padding: 0 8px;
  Icon button (circle):
    width 36px; height 36px; border-radius 50%; background rgba(0,0,0,0.06); display flex; align-items center; justify-content center;
  ALL buttons active state: transform: scale(0.97); opacity: 0.85; transition: all 0.1s;

FAB (floating action button, e.g. + button):
  position: fixed; bottom: calc(env(safe-area-inset-bottom) + 20px); right: 20px;
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--blue); color: #fff; font-size: 26px; font-weight: 300;
  box-shadow: 0 4px 16px rgba(0,122,255,0.4);
  display: flex; align-items: center; justify-content: center;

TEXT INPUTS:
  Always inside a section-body row — NEVER a standalone bordered box:
  <div class="row"><input style="flex:1" placeholder="Name"></div>
  Multiline textarea: min-height 80px, padding 12px 0, resize none

EMPTY STATE:
  Centered column, padding 60px 32px:
  Large emoji (52px) → bold title (20px/600) → subtitle (15px, var(--label3), line-height 1.5)

NUMBERS / STATS (e.g. score displays, counters):
  font-size: 64px; font-weight: 700; letter-spacing: -2px; line-height: 1;
  Use tabular-nums: font-variant-numeric: tabular-nums;

BADGES / PILLS:
  display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 100px;
  font-size: 13px; font-weight: 600;
  Primary: background var(--blue), color #fff
  Secondary: background rgba(0,0,0,0.08), color var(--label2)

DIVIDERS: height 0.5px; background: var(--sep); margin: 0 (inside section-body rows only, never floating)

━━━ TYPOGRAPHY SCALE ━━━
Large Title  34px / 700 / tracking -0.5px  — page/dashboard headers
Title 1      28px / 700                    — modal headers
Title 2      22px / 700                    — section titles, card headers
Headline     17px / 600                    — list row labels, prominent text
Body         17px / 400                    — default body text
Subhead      15px / 400                    — secondary descriptions
Caption      13px / 400 / var(--label3)    — metadata, timestamps
Label-sm     11px / 600 / uppercase / tracking 0.5px / var(--label3) — section headers

━━━ SPACING SYSTEM ━━━
Use ONLY these values: 4 8 12 16 20 24 32 40 48px.
Screen edge margins: always 16px. Between sections: 24px. Within cards: 16px. Row height minimum: 44px.

━━━ NEVER DO ━━━
✗ Default browser button appearance (gray background, raised border, system styling) — EVERY button must be styled
✗ Input fields with visible borders in default state — use the section/row pattern instead
✗ Blue underlined links or purple visited links
✗ box-shadow with blur > 20px, or opacity > 0.15 for shadows
✗ Gradient backgrounds on screens (flat var(--bg) only)
✗ Colors outside the design system palette (no random hex values like #4a90e2, #ff6b6b)
✗ outline or border on focused inputs — always outline: none
✗ Odd spacing: 7px, 9px, 11px, 13px margins — use the 4pt grid
✗ Non-system fonts: no Google Fonts, no Arial, no Times New Roman, no Comic Sans
✗ Text-align: center for body text (only for empty states and numeric displays)
✗ Animate with setTimeout/setInterval for visual effects — use CSS transitions
✗ Animations longer than 250ms
✗ More than 2 accent colors in one app
✗ Cluttered screens — when in doubt, add padding and whitespace
✗ HTML comments in the output

OUTPUT: Raw HTML only. Nothing else.`;

function buildModifyPrompt(existingHtml: string, userInstruction: string): string {
  return `You are modifying an existing app. Output the COMPLETE updated HTML file.
Preserve ALL existing localStorage key names exactly — user data depends on them.
Only change what the user asks. Keep all other functionality intact.

<current_app>
${existingHtml}
</current_app>

User request: ${userInstruction}

Output the complete updated HTML file. Remember: raw HTML only, no markdown fences.`;
}

// ---------- Helpers ----------

/**
 * Derive a stable 8-char appId from a UUID jobId.
 * Idempotent: CF queue retries produce the same appId → same KV key → no duplicates.
 */
function appIdFromJobId(jobId: string): string {
  return jobId.replace(/-/g, '').slice(-8);
}

function extractMetadata(html: string): AppMetadata {
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch?.[1] ?? 'My App';

  const metaMatch = html.match(/<meta\s+name="(?:cottix|perappos)-meta"\s+content='({.*?})'/i);
  let icon = '✨';
  let color = '#E0E7FF';
  let description = '';

  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]) as { icon?: string; color?: string; description?: string };
      icon = meta.icon ?? icon;
      color = meta.color ?? color;
      description = meta.description ?? description;
    } catch {
      // ignore
    }
  }

  return { title, icon, color, description };
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```html?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
}

/** Decode a Supabase user JWT locally — no network call needed. */
function decodeUserId(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  const seg = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = seg + '='.repeat((4 - (seg.length % 4)) % 4);
  const payload = JSON.parse(atob(padded)) as {
    aud?: string;
    role?: string;
    sub?: string;
    exp?: number;
  };
  const isAuthenticated = payload.aud === 'authenticated' || payload.role === 'authenticated';
  if (!isAuthenticated || !payload.sub) {
    throw new Error(`not authenticated (aud=${String(payload.aud)}, role=${String(payload.role)})`);
  }
  if (payload.exp !== undefined && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token expired');
  }
  return payload.sub;
}

/** Lightweight Supabase REST PATCH — no SDK required in CF Workers. */
async function supabasePatch(
  env: Env,
  table: string,
  filter: string,
  body: Record<string, unknown>,
): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

async function supabaseGet(
  env: Env,
  table: string,
  filter: string,
  select = '*',
): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?${filter}&select=${select}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) return [];
  return (await res.json()) as Record<string, unknown>[];
}

// ---------- Analytics ----------

/**
 * Fire-and-forget PostHog event from the CF Worker.
 * Never awaited — analytics must never block the critical path.
 */
function captureEvent(
  env: Env,
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {},
): void {
  if (!env.POSTHOG_PROJECT_TOKEN || env.POSTHOG_PROJECT_TOKEN === 'phc_your_token_here') return;
  void fetch(`${env.POSTHOG_HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: env.POSTHOG_PROJECT_TOKEN,
      event,
      distinct_id: distinctId,
      properties: { ...properties, $lib: 'cottix-generator-worker' },
    }),
  }).catch(() => { /* never let analytics failure crash the worker */ });
}

// ---------- Worker A: HTTP Receiver (fetch handler) ----------

async function handleFetch(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 1. Validate JWT
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing auth' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let userId: string;
  try {
    userId = decodeUserId(token);
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 2. Rate limit — count today's generated_apps rows for this user
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rateRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/generated_apps?user_id=eq.${userId}&created_at=gte.${today.toISOString()}&select=app_id`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    },
  );
  const contentRange = rateRes.headers.get('Content-Range') ?? '';
  // Content-Range format: "0-0/N" or "*/N"
  const totalCount = parseInt(contentRange.split('/')[1] ?? '0', 10);
  if (totalCount >= MAX_GENERATIONS_PER_DAY) {
    captureEvent(env, userId, 'generation_rate_limited', {
      daily_count: totalCount,
      limit: MAX_GENERATIONS_PER_DAY,
    });
    return new Response(
      JSON.stringify({ error: 'Daily generation limit reached', limit: MAX_GENERATIONS_PER_DAY }),
      { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // 3. Parse body
  let body: { prompt?: string; conversationId?: string };
  try {
    body = (await request.json()) as { prompt?: string; conversationId?: string };
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const prompt = body.prompt?.trim() ?? '';
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Prompt is required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 4. Create generation_jobs row and get the UUID back
  const jobInsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/generation_jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      user_id: userId,
      status: 'pending',
      prompt,
      conversation_id: body.conversationId ?? null,
    }),
  });

  if (!jobInsertRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to create job' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const [jobRow] = (await jobInsertRes.json()) as Array<{ id: string }>;
  const jobId = jobRow.id;

  // 5. Enqueue — phone can die after this, job is durable
  const submittedAt = Date.now();
  await env.GENERATION_QUEUE.send({
    jobId,
    userId,
    prompt,
    conversationId: body.conversationId ?? null,
    submittedAt,
  } satisfies QueueMessage);

  captureEvent(env, userId, 'generation_started', {
    job_id: jobId,
    prompt_length: prompt.length,
    is_modify: Boolean(body.conversationId),
  });

  return new Response(JSON.stringify({ jobId }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ---------- Worker B: Queue Consumer (queue handler) ----------

async function processJob(job: QueueMessage, env: Env): Promise<void> {
  const { jobId, userId, prompt, conversationId, submittedAt } = job;
  const jobStartedAt = Date.now();

  // For modify jobs: reuse conversationId as appId so the KV key and hosted_url
  // stay the same. The app on the user's home screen refreshes to the new HTML
  // without needing a reinstall, and the metadata lookup in the hook works because
  // generated_apps still has a row at this app_id.
  // For new jobs: derive a fresh appId from jobId (idempotent on CF retry).
  const appId = conversationId ?? appIdFromJobId(jobId);

  // Mark generating
  await supabasePatch(env, 'generation_jobs', `id=eq.${jobId}`, { status: 'generating' });

  // Fetch existing HTML if this is a modify job
  let existingHtml: string | null = null;
  if (conversationId) {
    const rows = await supabaseGet(
      env,
      'generated_apps',
      `app_id=eq.${conversationId}`,
      'html_content',
    );
    existingHtml = (rows[0]?.html_content as string | null) ?? null;
  }

  // Build messages for Anthropic
  const systemPrompt = existingHtml
    ? SYSTEM_PROMPT // modify instructions are embedded in the user message via buildModifyPrompt
    : SYSTEM_PROMPT;
  const userContent = existingHtml ? buildModifyPrompt(existingHtml, prompt) : prompt;
  const messages = [{ role: 'user', content: userContent }];

  // Stream from Anthropic
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    throw new Error(`Anthropic API error: ${anthropicRes.status} ${errText}`);
  }

  // Read SSE stream and assemble full HTML
  let html = '';
  let progressChars = 0;
  let lastProgressUpdate = Date.now();

  const reader = anthropicRes.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const event = JSON.parse(raw) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          html += event.delta.text ?? '';
          progressChars += (event.delta.text ?? '').length;
        }
      } catch {
        // malformed SSE line — skip
      }
    }

    // Update progress_chars in Supabase every ~2000 chars
    if (Date.now() - lastProgressUpdate > 2000) {
      await supabasePatch(env, 'generation_jobs', `id=eq.${jobId}`, {
        progress_chars: progressChars,
      });
      lastProgressUpdate = Date.now();
    }
  }

  if (!html.trim()) {
    throw new Error('Empty response from Anthropic');
  }

  html = stripMarkdownFences(html);

  if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
    throw new Error('Generation did not produce valid HTML');
  }

  // Mark deploying
  await supabasePatch(env, 'generation_jobs', `id=eq.${jobId}`, {
    status: 'deploying',
    progress_chars: progressChars,
  });

  // Write to KV — same key format as cottix-apps-worker reads
  await env.APPS_KV.put(`app:${appId}`, html, {
    metadata: { userId, generatedAt: new Date().toISOString() },
  });

  const hostedUrl = `${env.APPS_HOST}/${appId}`;
  const metadata = extractMetadata(html);
  const htmlSize = new TextEncoder().encode(html).length;

  // Save to generated_apps (INSERT for new, PATCH for modify)
  if (conversationId) {
    // Update existing row — preserve original prompt, update html + metadata
    await fetch(`${env.SUPABASE_URL}/rest/v1/generated_apps?app_id=eq.${conversationId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        html_content: html,
        html_size: htmlSize,
        title: metadata.title,
        description: metadata.description,
        icon_emoji: metadata.icon,
        icon_bg_color: metadata.color,
      }),
    });
  } else {
    // Insert new row
    await fetch(`${env.SUPABASE_URL}/rest/v1/generated_apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        app_id: appId,
        prompt,
        title: metadata.title,
        description: metadata.description,
        icon_emoji: metadata.icon,
        icon_bg_color: metadata.color,
        html_size: htmlSize,
        hosted_url: hostedUrl,
        html_content: html,
      }),
    });
  }

  // Mark complete — PowerSync delivers this to the device
  const completedAt = new Date().toISOString();
  await supabasePatch(env, 'generation_jobs', `id=eq.${jobId}`, {
    status: 'complete',
    app_id: appId,
    hosted_url: hostedUrl,
    progress_chars: progressChars,
    completed_at: completedAt,
  });

  captureEvent(env, userId, 'generation_completed', {
    job_id: jobId,
    app_id: appId,
    is_modify: Boolean(conversationId),
    prompt_length: prompt.length,
    html_size: htmlSize,
    title: metadata.title,
    // total wall-clock time from HTTP request to CF Queue job completing
    duration_seconds: submittedAt ? Math.round((Date.now() - submittedAt) / 1000) : null,
    // just the LLM + KV write time (excludes queue wait)
    processing_seconds: Math.round((Date.now() - jobStartedAt) / 1000),
    progress_chars: progressChars,
  });
}

// ---------- Default Export ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleFetch(request, env);
    } catch (err) {
      console.error('[cottix-generator] fetch error:', err);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    // max_batch_size = 1, so always one message
    const message = batch.messages[0];
    const job = message.body;

    try {
      await processJob(job, env);
      message.ack();
    } catch (err) {
      console.error('[cottix-generator] queue error for job', job.jobId, ':', err);
      // Update job to failed state
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await supabasePatch(env, 'generation_jobs', `id=eq.${job.jobId}`, {
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      });
      captureEvent(env, job.userId, 'generation_failed', {
        job_id: job.jobId,
        is_modify: Boolean(job.conversationId),
        prompt_length: job.prompt.length,
        error_message: errorMessage,
        duration_seconds: job.submittedAt ? Math.round((Date.now() - job.submittedAt) / 1000) : null,
      });
      // Don't retry after marking failed — avoid flooding the user with duplicate errors
      message.ack();
    }
  },
} satisfies ExportedHandler<Env>;
