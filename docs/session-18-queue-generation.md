# Session 18 — Cloudflare Queue-Based AI Generation

**Date:** 2026-04-14  
**Status:** Implemented, awaiting real-device test

---

## What changed

Replaced the SSE-streaming `generate-app` Supabase edge function with a durable Cloudflare Queue architecture. The old edge function timed out for complex apps and lost results if the phone went offline. The new approach is fire-and-forget — the phone gets a job ID immediately and PowerSync delivers status updates.

### New flow
```
RN App → POST cottix-generator.workers.dev/generate
       ← { jobId } immediately
       → CF Queue → CF Worker (queue handler)
                  → Anthropic claude-sonnet-4-6 (streaming)
                  → APPS_KV.put('app:{appId}', html)
                  → Supabase REST: INSERT generated_apps + PATCH generation_jobs
                       → PowerSync sync → RN App watches via powerSyncDb.watch()
```

---

## Files created / modified

### New
| File | Purpose |
|---|---|
| `supabase/migrations/20260414_generation_jobs.sql` | `generation_jobs` table + `html_content` column on `generated_apps` |
| `cottix-generator/src/index.ts` | CF Worker — single file, exports both `fetch` + `queue` handlers |
| `cottix-generator/wrangler.toml` | Queue bindings, KV binding (id `f176620f8f9c4cae9b773e70299a63d5`), vars |
| `cottix-generator/package.json` + `tsconfig.json` | Worker scaffolding |
| `hooks/useGenerateApp.ts` | PowerSync-based hook: submits job, watches status, fetches metadata on complete |

### Modified
| File | Change |
|---|---|
| `services/sync/schema.ts` | Added `generationJobs` PowerSync table |
| `app/create.tsx` | Full rewrite — XHR/SSE → `useGenerateApp` hook; progress bar; WebView preview kept |
| `app/app/[id].tsx` | Added `handleEditWithAI` + "Edit with AI" in three-dot menu (apps.cottix.co only) |
| `app/add.tsx` | Wired "Create with AI" card to `router.push('/create')` (was "Coming Soon" alert) |
| `tsconfig.json` | Excluded `cottix-generator/` from RN type checking |

---

## Key implementation details

### Worker (`cottix-generator/src/index.ts`)
- **`fetch` handler**: local JWT decode (same logic as `generate-app` edge fn lines 205–231), rate limit (20/day from `generated_apps`), INSERT `generation_jobs`, enqueue
- **`queue` handler**: `appId` derived from `jobId` (`jobId.replace(/-/g,'').slice(-8)`) — idempotent on CF retry; streams Anthropic, patches `progress_chars` every 2000 chars; direct `APPS_KV.put('app:${appId}', html)` — no CF API token needed
- Modify flow: if `conversationId` passed → fetch `html_content` from `generated_apps`, build modify prompt wrapping existing HTML
- System prompt: copied verbatim from `generate-app/index.ts` lines 16–36
- Model: `claude-sonnet-4-6`, `max_tokens: 8192`

### Hook (`hooks/useGenerateApp.ts`)
- `powerSyncDb.watch()` with `result.rows?._array ?? []` pattern (matches `useFreezeWatcher.ts`)
- AbortController cleanup on `activeJobId` change
- Fetches `title/icon_emoji/icon_bg_color/description` from `generated_apps` via Supabase once `status === 'complete'`

### `create.tsx` state machine
`idle → submitting → generating → preview | error`  
- `generating` covers `pending | generating | deploying` from PowerSync
- Progress bar: `progress_chars / 8000`, capped at 95% until complete
- Refinement: passes `conversationId: result.appId` to `generate()` — Worker fetches HTML server-side
- "Edit with AI" entry: reads `mode` + `conversationId` from `useLocalSearchParams()`

### `app/[id].tsx` — Edit with AI
- Only shown when `app.source_url?.includes('apps.cottix.co')`
- Queries `generated_apps.html_content` by `hosted_url`; shows alert if missing (old app)
- Navigates to `/create` with `{ mode: 'modify', conversationId: data.app_id }`

---

## Manual steps still required

1. **Supabase SQL editor** — run `supabase/migrations/20260414_generation_jobs.sql`
2. **PowerSync dashboard** — add sync rule:
   ```yaml
   - table: generation_jobs
     columns: [id, user_id, status, prompt, app_id, hosted_url, progress_chars, error_message, conversation_id, created_at, completed_at]
     where: user_id = token_parameters.user_id
   ```
3. **Cloudflare** (if not done):
   ```bash
   cd cottix-generator
   wrangler queues create generation-queue
   wrangler queues create generation-dlq
   wrangler secret put ANTHROPIC_API_KEY
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   wrangler deploy
   ```
4. **`.env`** — add `EXPO_PUBLIC_GENERATOR_URL=https://cottix-generator.{account}.workers.dev`
5. **Restart Metro** after adding the env var

---

## What was NOT changed
- `supabase/functions/generate-app/index.ts` — kept as backup (not called by new flow)
- All merge/sync/bridge code untouched
- Collaboration, shared instances, etc. untouched

---

## Next up (from status.md)
- Test full generation flow on device
- Run `supabase/migrations/20260330_attribution.sql` (from Session 16, still pending)
- Update PowerSync sync rules for attribution columns + history table
- Deploy `deploy-html` edge function
- HTML/ZIP cross-device restore overlay
