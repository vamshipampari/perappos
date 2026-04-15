# Cottix — Product Reference Document

**Last updated**: 2026-04-15 | **Version**: Session 19

> **Executive summary**: Cottix is a React Native mobile app that turns any vibe-coded web app (URL, ZIP, or AI-generated HTML) into a native mobile experience. It provides SQLite persistence, real-time multi-user collaboration via a 3-way merge engine, offline-first behavior, and native device APIs — all without requiring the mini-app author to write any backend code. Think "mini-app container" for AI-generated tools used by small business teams.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Target Users & Strategy](#2-target-users--strategy)
3. [Core Capabilities](#3-core-capabilities)
4. [Business Model](#4-business-model)
5. [Tech Stack](#5-tech-stack)
6. [Architecture](#6-architecture)
7. [Data Model](#7-data-model)
8. [VaultAPI Bridge](#8-vaultapi-bridge)
9. [AI Generation System](#9-ai-generation-system)
10. [Collaboration & Sync](#10-collaboration--sync)
11. [Join Approval Flow](#11-join-approval-flow)
12. [Auth System](#12-auth-system)
13. [Admin Dashboard (cottix-hub)](#13-admin-dashboard-cottix-hub)
14. [Plan Tiers & Gates](#14-plan-tiers--gates)
15. [Current Status](#15-current-status)
16. [Known Limitations & Gotchas](#16-known-limitations--gotchas)
17. [App Store Compliance](#17-app-store-compliance)
18. [Repo Structure](#18-repo-structure)
19. [Critical Constraints](#19-critical-constraints)

---

## 1. Product Overview

**Name**: Cottix  
**Tagline**: Run vibe-coded apps on your phone like native apps.  
**Domain**: cottix.co  
**Mini-apps served at**: apps.cottix.co/{appId}

### Problem

Vibe-coded apps (Claude/ChatGPT/Cursor-generated web apps) are ephemeral:
- `localStorage` gets cleared by the OS
- No home screen presence
- No access to native device APIs
- No real-time multi-user data sharing
- URLs break; no offline support

Cottix wraps web apps into a proper mobile container with persistent storage, collaboration, and native superpowers.

### What it is NOT

- Not an App Store for mini-apps (invite-only, non-browseable — by design for App Store compliance)
- Not a low-code builder (apps are generated externally by AI or written by users)
- Not a competitor to Natively.dev (they handle distribution; Cottix handles distribution + persistence + collaboration)

---

## 2. Target Users & Strategy

**Primary (B2B wedge)**: Small businesses and field teams using AI-built internal tools that need mobile access — inventory trackers, scoreboards, expense logs, tambola games, attendance sheets, etc.

**Secondary**: Individual vibe-coders building for themselves. Lower conversion, higher viral potential.

**Viral mechanism**: Shared app recipients never pay — only the creator pays. One team member buys Pro; the whole team benefits. This drives organic growth.

**Competitor landscape**:
- **Bloom (YC)**: App Clips, 30-day auto-deletion, no offline storage, iOS only. Not a direct threat.
- **Natively.dev**: Wraps web URLs into App Store binaries. Different positioning — distribution only, no persistence or collaboration.

**YC strategy**: Apply when 10 paying customers + $2–5K MRR. Target August 2026 (Winter batch). Pitch: B2B wedge — field teams using AI-built internal tools.

---

## 3. Core Capabilities

### Mini-App Container
- Loads web apps via URL (with BFS asset crawler for offline bundle), ZIP file, or raw HTML paste
- SHA256 hash diffing for auto-update detection
- Splash overlay with app icon/color; header bar with action sheet (update, info, revert, delete)
- Universal viewport fix: `maximum-scale=1.0, user-scalable=no, viewport-fit=cover`; `automaticallyAdjustKeyboardInsets` on iOS

### AI Generation (Create with AI)
- User describes an app → POST to Cloudflare Worker → Cloudflare Queue → Worker consumer → Anthropic claude-sonnet-4-6 → single-file HTML → Cloudflare KV → served at apps.cottix.co/{appId}
- Durable job system: phone polls `generation_jobs` via PowerSync watch (+ 10s polling fallback)
- Rate limit: 20 generations/user/day
- Edit with AI: modify existing generated app — same appId/KV key, conversation history preserved, URL unchanged, user data intact

### Real-Time Collaboration
- Owner creates shared instance → gets invite code
- Members join via invite code → join approval flow (pending → active)
- All members' writes go through 3-way merge engine
- Sync latency: ~1–3 seconds cross-device via PowerSync
- Instance freeze: when owner downgrades plan, writes are blocked (not deleted). Amber banner shown in-app.

### VaultAPI
JavaScript bridge that gives mini-apps native superpowers. Full spec in [Section 8](#8-vaultapi-bridge).

### Cross-Device Sync
Installed apps list syncs across user's devices via PowerSync + Supabase. HTML/ZIP apps sync metadata only (bundle must be re-imported). URL apps restore fully.

### Offline-First
SQLite local storage with WAL mode. PowerSync syncs when online. Apps work with no network.

---

## 4. Business Model

| Tier | Price | App Limit | Shared Instances |
|---|---|---|---|
| Free | $0 | 5 apps | 0 |
| Pro/Beta | ~$9/mo or $79/yr | Unlimited | 5 |
| Team | ~$19/mo | Unlimited | Unlimited |

- Shared app **recipients never pay** — creator pays. Key viral mechanic.
- Annual pricing prioritized for cash flow and churn reduction.
- RevenueCat integration planned but not yet built.

**Active promo codes** (hardcoded in DB):

| Code | Plan | Duration | Max Redemptions |
|---|---|---|---|
| `BETA2026` | beta | 90 days | 100 |
| `PERAPPOS` | beta | Lifetime | 50 |
| `VIBECODER` | beta | 30 days | 200 |

---

## 5. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Mobile framework | Expo (New Architecture) | SDK 55 |
| Language | TypeScript | ~5.9.2, strict mode |
| UI framework | React Native | 0.83.2 |
| React | React | 19.2.0 |
| Routing | expo-router (file-based) | ~55.0.3 |
| Styling | NativeWind v4 (Tailwind for RN) | ^4.2.2 |
| Animations | react-native-reanimated | 4.2.1 |
| WebView | react-native-webview | 13.16.0 |
| Local DB | expo-sqlite (WAL mode) | ~55.0.10 |
| Sync | PowerSync + @powersync/react-native | latest |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) | latest |
| AI generation | Cloudflare Workers + Cloudflare Queues | — |
| Mini-app hosting | Cloudflare Workers KV | — |
| Analytics | PostHog | — |
| Email | Resend | — |
| Admin panel | Vite + React + shadcn/ui (cottix-hub) | — |
| Package manager | Yarn 1.x | — |
| Node | Node 20+ | — |

---

## 6. Architecture

### High-Level Flow

```
User's Phone (React Native)
  ├── expo-sqlite (local)          — app metadata, per-app KV, settings
  ├── PowerSync ↔ Supabase         — cross-device sync, shared app data
  └── WebView (react-native-webview)
        ├── vaultBridge.ts         — native ↔ WebView message routing
        ├── vaultShim.ts           — personal apps: localStorage interceptor + VaultAPI
        └── vaultShimSync.ts       — shared apps: base-version tracking + debounced writes
```

### AI Generation Flow

```
Phone
  └── POST cottix-generator.workers.dev/generate
        → { jobId } immediately returned
        → Cloudflare Queue (durable)
        → CF Worker (queue consumer)
            → fetch current HTML (for modify jobs)
            → Anthropic claude-sonnet-4-6 (streaming)
            → APPS_KV.put('app:{appId}', html)
            → Supabase REST: PATCH generation_jobs (status=complete)
            → Supabase REST: INSERT/UPDATE generated_apps
  Phone watches generation_jobs via PowerSync db.watch()
  → on status=complete: fetch metadata → navigate to preview
```

### Shared Write Flow

```
WebView mini-app
  └── localStorage.setItem(key, value)
        → vaultShimSync.ts: enqueue ls_set_sync with baseVersion + clientWriteId
        → vaultBridge.ts: route to handleSharedWrite()
        → bridge-merge-handler.ts:
            read current shared_app_data row
            choose strategy (noop / fast_path / array_merge / object_merge / lww)
            write back with updated version + merge metadata
        → PowerSync: sync to Supabase
        → PowerSync: deliver to all member devices
        → _VaultSyncPush(): update _cache + window.name + location.reload()
```

### Key Files

| File | Purpose |
|---|---|
| `app/_layout.tsx` | Root layout — SQLiteProvider + PowerSyncProvider + Stack + auth gate |
| `app/login.tsx` | Mandatory full-screen auth gate (no close button) |
| `app/auth.tsx` | Dismissable auth modal (Settings → Sign In) |
| `app/app/[id].tsx` | WebView runner — BFS crawler, update support, live sync watcher |
| `app/create.tsx` | Create with AI — job polling, WebView preview |
| `app/add.tsx` | Add app modal — URL, ZIP, HTML, AI card |
| `lib/vaultBridge.ts` | WebView ↔ native message handler (all bridge types) |
| `lib/vaultShim.ts` | JS shim injected into WebView (personal apps) |
| `lib/vaultShimSync.ts` | Shared-app shim — base version tracking, debounced writes |
| `services/sync/bridge-merge-handler.ts` | 3-way merge engine for shared writes |
| `services/sync/SupabaseConnector.ts` | PowerSync ↔ Supabase CRUD connector |
| `services/sync/PowerSyncProvider.tsx` | PowerSync init, exports powerSyncDb + connector |
| `services/sync/schema.ts` | PowerSync table schema |
| `services/collaborationService.ts` | Shared instance create/join/leave/stop |
| `services/htmlDeployer.ts` | Deploy HTML to Cloudflare KV via edge function |
| `hooks/useInstalledApps.ts` | App list — refresh(), recordOpen() |
| `hooks/useUserProfile.ts` | Plan, limits, promo code redemption |
| `hooks/useGatekeeper.ts` | App install + sharing gates with upgrade prompts |
| `hooks/useGenerateApp.ts` | AI generation job lifecycle hook |
| `hooks/useWebViewApp.ts` | WebView bundle load, shim build, live sync push |

---

## 7. Data Model

### Local SQLite Tables (expo-sqlite — NOT synced)

#### `apps`
Primary store for installed mini-apps.

| Column | Type | Notes |
|---|---|---|
| app_id | TEXT PK | UUID |
| name | TEXT | Display name |
| icon_emoji | TEXT | Default: 📱 |
| icon_bg_color | TEXT | Hex, default: #E5E7EB |
| bundle_path | TEXT | Local path or URL |
| source_type | TEXT | `url` \| `zip` \| `html` |
| source_url | TEXT | Original URL |
| bundle_hash | TEXT | SHA256 for update detection |
| auto_update | INTEGER | Boolean |
| permissions | TEXT | JSON array |
| bundle_size | INTEGER | Bytes |
| installed_at | TEXT | ISO8601 |
| updated_at | TEXT | ISO8601 |
| last_opened | TEXT | ISO8601 |
| open_count | INTEGER | Lifetime opens |
| instance_id | TEXT | Shared namespace ID (NULL if personal) |

#### `app_data`
Per-app KV store (local-only).

| Column | Type | Notes |
|---|---|---|
| app_id | TEXT | FK → apps.app_id |
| key | TEXT | — |
| value | TEXT | JSON string |
| updated_at | TEXT | ISO8601 |
| synced | INTEGER | 0 = local only |

PK: `(app_id, key)`

#### `shared_data`
Cross-app shared data (contacts, vault_secrets, etc.).

| Column | Type | Notes |
|---|---|---|
| category | TEXT | Namespace (e.g. `vault_secrets`) |
| key | TEXT | — |
| value | TEXT | JSON string |
| source_app | TEXT | app_id of last writer |
| updated_at | TEXT | ISO8601 |

PK: `(category, key)`

> API key names are stored here under `category = 'vault_secrets'`. Actual secret values live in `expo-secure-store`.

---

### PowerSync Synced Tables (Supabase)

#### `installed_apps`
Cross-device app list. `id = ${userId}/${appId}` (TEXT, not UUID).

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `${userId}/${appId}` — scoped per user |
| app_id | TEXT | — |
| name | TEXT | — |
| icon_emoji | TEXT | — |
| icon_bg_color | TEXT | — |
| source_type | TEXT | `url` \| `zip` \| `html` \| `demo` |
| source_url | TEXT | — |
| bundle_hash | TEXT | — |
| user_id | TEXT | auth.uid() |

#### `app_data`
Synced KV. `id = ${appId}/${key}` (TEXT, not UUID).

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `${appId}/${key}` |
| user_id | TEXT | auth.uid() |
| app_id | TEXT | — |
| key | TEXT | — |
| value | TEXT | — |
| updated_at | TEXT | ISO8601 |

#### `shared_instances`

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `${instanceId}` |
| instance_id | TEXT | UUID — collaborative namespace |
| app_id | TEXT | — |
| owner_id | TEXT | auth.uid() of creator |
| invite_code | TEXT | Uppercase code shown to users |
| is_frozen | INTEGER | 0/1 — frozen when owner downgrades |
| frozen_at | TEXT | ISO8601 |
| frozen_reason | TEXT | e.g., `plan_downgrade` |

#### `instance_members`
**RLS DISABLED** — PowerSync sync rules handle access control.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | — |
| instance_id | TEXT | FK → shared_instances.instance_id |
| user_id | TEXT | auth.uid() |
| role | TEXT | `owner` \| `member` |
| joined_at | TEXT | ISO8601 |
| status | TEXT | `pending` \| `active` \| `rejected` |
| email | TEXT | Stored at join time; shown to owner |

#### `shared_app_data`
`id = ${instanceId}/${appId}/${key}` (TEXT, not UUID). UNIQUE constraint on `(instance_id, app_id, key)`.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Composite — never UUID |
| instance_id | TEXT | — |
| app_id | TEXT | — |
| key | TEXT | — |
| value | TEXT | JSON string |
| updated_by | TEXT | auth.uid() of last writer |
| updated_at | TEXT | ISO8601 |
| version | INTEGER | Monotonically increasing per natural key |
| last_write_id | TEXT | Idempotency key |
| last_merge_strategy | TEXT | Strategy used for latest write |
| last_conflict_count | INTEGER | Conflicts during last write |
| last_editor_user_id | TEXT | auth.uid() of last writer |
| last_editor_display_name | TEXT | Display name at write time |

#### `shared_app_data_history`
Append-only audit log. INSERT via DB trigger; no direct client writes.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | — |
| instance_id | TEXT | — |
| app_id | TEXT | — |
| key | TEXT | — |
| value | TEXT | Value at time of write |
| editor_user_id | TEXT | auth.uid() |
| editor_display_name | TEXT | Display name |
| written_at | TIMESTAMPTZ | — |
| merge_strategy | TEXT | Strategy used |
| version | INTEGER | Version number |

#### `generation_jobs`
AI generation job tracking.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Job ID |
| user_id | uuid | FK → auth.users |
| status | TEXT | `queued` \| `generating` \| `complete` \| `error` |
| prompt | TEXT | Original user prompt |
| app_id | TEXT | Target app ID (= conversationId for modify jobs) |
| conversation_id | TEXT | For Edit with AI — existing app's ID |
| progress_chars | INTEGER | Characters generated so far |
| hosted_url | TEXT | Final URL when complete |
| error_message | TEXT | Set on failure |
| created_at | TIMESTAMPTZ | — |
| updated_at | TIMESTAMPTZ | — |

---

### Supabase-Only Tables

#### `user_profiles`
Auto-created on `auth.users` INSERT via trigger.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK | FK → auth.users |
| display_name | TEXT | — |
| avatar_emoji | TEXT | — |
| plan | TEXT | `free` \| `beta` \| `pro` \| `team` |
| plan_expires_at | TIMESTAMPTZ | NULL = no expiry |
| app_install_count | INTEGER | Drifts — prefer local SQLite count |
| shared_instance_count | INTEGER | Tracked via RPC |
| promo_code_used | TEXT | Last redeemed code |

#### `generated_apps`

| Column | Type | Notes |
|---|---|---|
| user_id | uuid | — |
| app_id | TEXT | Matches Cloudflare KV key |
| prompt | TEXT | Original prompt |
| title | TEXT | — |
| description | TEXT | — |
| icon_emoji | TEXT | — |
| icon_bg_color | TEXT | — |
| html_size | INTEGER | Bytes |
| hosted_url | TEXT | `https://apps.cottix.co/{appId}` |
| conversation_history | jsonb | For iterative refinement |

#### `promo_codes` / `promo_redemptions`
See [Section 14](#14-plan-tiers--gates).

#### `beta_signups`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | — |
| email | TEXT UNIQUE | — |
| platform | TEXT | `ios` \| `android` \| `both` |
| name | TEXT | — |
| signed_up_at | TIMESTAMPTZ | — |
| status | TEXT | `waitlist` \| `invited` |
| play_store_added | BOOLEAN | — |

---

### Supabase RPCs

| RPC | Signature | Purpose |
|---|---|---|
| `lookup_shared_instance` | `(p_invite_code text)` | Returns instance row for join flow |
| `add_instance_member` | `(p_instance_id text, p_user_id uuid, p_role text)` | Adds owner or member row |
| `get_own_shared_instance` | `(p_app_id text, p_user_id uuid)` | Returns existing instance for app |
| `get_user_profile` | `()` | Returns plan + limits; auto-downgrades expired plans |
| `redeem_promo_code` | `(code_input text)` | Atomic redemption; calls freeze/unfreeze |
| `increment_app_count` | `(delta int)` | ±1 on install/delete |
| `increment_shared_instance_count` | `(delta int)` | ±1 on create/stop |
| `freeze_owner_instances` | `(p_owner_id uuid)` | Called by get_user_profile on expiry |
| `unfreeze_owner_instances` | `(p_owner_id uuid)` | Called by redeem_promo_code on upgrade |
| `upsert_shared_app_data_versioned` | `(..., p_last_editor_user_id TEXT DEFAULT NULL, p_last_editor_display_name TEXT DEFAULT NULL)` | Versioned upsert with attribution |

---

## 8. VaultAPI Bridge

Mini-apps communicate with native via `window.ReactNativeWebView.postMessage(JSON)`. The shim (`vaultShim.ts` for personal apps, `vaultShimSync.ts` for shared apps) is injected via `injectedJavaScriptBeforeContentLoaded` — runs before any page script.

### Bridge Message Types

| Type | Direction | Description |
|---|---|---|
| `ls_set` / `ls_delete` / `ls_clear` | fire-and-forget | localStorage shim for personal apps |
| `ls_set_sync` | request/response | Shared-app write with base-version; goes through merge engine |
| `db_set` / `db_get` / `db_get_all` / `db_delete` | request/response | VaultAPI.db — structured KV store |
| `device_haptic` | request/response | Haptic feedback |
| `device_notify` | request/response | Local notification |
| `device_share` | request/response | Native share sheet |
| `auth_get_user` | request/response | `{ id, email }` of signed-in user |
| `app_get_info` | request/response | App manifest (includes instance_id for shared-mode detection) |
| `secrets_set` | request/response | Store named secret in expo-secure-store (global scope) |
| `secrets_fetch` | request/response | Substitute secret in headers, make native HTTP call, return `{ status, body }`. Secret never reaches WebView. |
| `storage_upload` | request/response | Open Photos picker, upload to Supabase Storage, return `{ uri }` |
| `storage_get_url` | request/response | Create 1-hour signed URL for storage path |
| `collab_get_recent_activity` | request/response | Query shared_app_data_history, return last N events |

### VaultAPI Namespaces

```javascript
window.VaultAPI = {
  db: {
    set(key, value),
    get(key),
    getAll(),
    delete(key)
  },
  device: {
    haptic(style),             // 'light' | 'medium' | 'heavy'
    notify(title, body, delay),
    share(text, url)
  },
  auth: {
    getUser()                  // → { id, email }
  },
  app: {
    getInfo()                  // → { appId, name, instanceId, ... }
  },
  secrets: {
    set(name, value),          // stores in native SecureStore
    fetch(name, requestConfig) // native HTTP proxy with secret substitution
  },
  storage: {
    upload(),                  // → { uri }
    getUrl(uri)                // → { url } (1-hour signed)
  },
  collaboration: {             // shared apps only
    getAttribution(key),       // synchronous — from _attribution cache
    getAllAttribution(),        // synchronous shallow copy
    getItemOwner(arrayKey, itemId), // reads _addedBy from cache
    getRecentActivity(limit)   // async bridge → shared_app_data_history
  }
}
```

> Both `vaultShim.ts` (personal) and `vaultShimSync.ts` (shared) must be updated in lockstep when adding new VaultAPI namespaces. They share no common base.

### Shim Architecture

**Personal (`vaultShim.ts`):**
- Intercepts `window.localStorage` via `Object.defineProperty`
- Pre-populates KV at load time for synchronous initial reads
- Routes writes to PowerSync `app_data` via bridge

**Shared (`vaultShimSync.ts`):**
- Per-key base version tracking (`_keyVersions`)
- Debounced write queue (150ms)
- Client write IDs for idempotency
- Base hash/value payloads for merge decisions
- `window._VaultSyncPush(updates)` receiver: updates `_cache`, `_baseState`, `_keyVersions`; saves cache to `window.name`; calls `location.reload()` with 800ms debounce
- Attribution cache (`_attribution`): seeded from native payload, carried through `window.name` on reload

---

## 9. AI Generation System

### Architecture

```
CF Worker (HTTP endpoint: cottix-generator.workers.dev)
  ├── POST /generate   → create generation_jobs row → CF Queue → return { jobId }
  ├── POST /modify     → same but with conversationId; appId = conversationId
  └── Queue consumer:
        fetch existing HTML (for modify) from generated_apps
        build system prompt (iOS design system — see below)
        call Anthropic claude-sonnet-4-6
        collect full response (stream internally)
        APPS_KV.put('app:{appId}', html)
        PATCH generation_jobs: status=complete, progress_chars, hosted_url
        INSERT/UPDATE generated_apps
```

### iOS Design System Prompt

The worker sends a detailed system prompt instructing Claude to output single-file HTML apps that look like native iPhone apps. Key rules:

- **Mandatory CSS foundation**: CSS variables, reset, `-webkit-tap-highlight-color: transparent`, no scrollbars, `body { overflow: hidden }`, `#app` full viewport
- **Component patterns**: nav bar (44pt), grouped sections (16pt inset), card (white bg, 12pt radius, 0.5pt border), button variants (filled primary, tinted, destructive, plain)
- **Typography**: -apple-system font stack, 34/28/22/17/16/15/13/12pt scale
- **Spacing**: 4pt grid
- **Colors**: `--color-blue: #007AFF`, `--color-bg: #F2F2F7`, `--color-surface: #FFFFFF`, full iOS palette
- **NEVER**: gray buttons, bordered inputs, underlined links, gradients, custom fonts, external resources requiring auth

### Job Lifecycle (Phone Side)

1. `useGenerateApp.ts` POSTs to worker → gets `{ jobId }`
2. Watches `generation_jobs` via `powerSyncDb.watch()` for status changes
3. Polling fallback at 10s intervals (in case PowerSync delayed)
4. On `status === 'complete'`: fetch `generated_apps` metadata → navigate to preview

### Edit with AI (Modify Flow)

- `conversationId` = existing app's `appId`
- Worker sets `job.app_id = conversationId` (not a new ID)
- KV key, hosted_url, and `generated_apps` row all stay consistent with installed app
- Conversation history sent so Claude can see previous turns

---

## 10. Collaboration & Sync

### PowerSync Architecture

PowerSync manages its own SQLite DB (`powersync.db`) separate from expo-sqlite. All writes are tracked and uploaded to Supabase via `SupabaseConnector`.

**Critical rules:**
- Never use table aliases in PowerSync sync rules → rows land in `ps_untyped` instead of proper tables
- PowerSync has no `column.boolean` — use `column.integer`, compare with `=== 1`
- Post-upload local clear gap: after `transaction.complete()`, the row disappears locally until Supabase re-delivers it. Use `_versionCache` Map to preserve version numbers across this gap.
- `usePowerSync()` may return a new `db` reference on each sync cycle — use `useRef(db)` with empty `[]` deps in `useCallback`/`useEffect`

### 3-Way Merge Engine (`bridge-merge-handler.ts`)

| Strategy | Trigger | Behavior |
|---|---|---|
| `noop` | Value unchanged from base | Suppress write |
| `idempotent_skip` | Duplicate `clientWriteId` | Skip silently |
| `init_blocked` | Startup write would clobber fresher shared state | Reject |
| `fast_path` | No concurrent write, no conflict | Accept directly |
| `array_merge` | Both sides have arrays with stable IDs | 3-way merge preserving additions from both sides |
| `object_merge` | Both sides have plain objects | Field-level 3-way merge |
| `lww` | Incompatible types or low-confidence payload | Last-write-wins fallback |
| `frozen` | `shared_instances.is_frozen === 1` | Block all writes; inject `window.__vaultInstanceFrozen = true` |

**`_addedBy` stamping**: New array items get `{ userId, displayName, addedAt }` stamped on merge. Existing items have `_addedBy` always restored from current state (never overwritten).

### Freeze System

When a plan expires:
1. `get_user_profile` RPC detects expiry → calls `freeze_owner_instances(p_owner_id)`
2. `shared_instances.is_frozen = 1` for all owned instances
3. Merge handler rejects all writes with `strategy: 'frozen'`
4. WebView receives `window.__vaultInstanceFrozen = true` event
5. Amber banner shown in `app/[id].tsx` and Manage Group screen

When plan restored:
1. `redeem_promo_code` RPC calls `unfreeze_owner_instances(p_owner_id)`
2. All instances unfrozen; writes resume

### Live Sync Push

After a remote write arrives via PowerSync:
1. `db.watch()` in `app/[id].tsx` detects new `shared_app_data` rows
2. Dedup via `lastPushedVersions` (skip own-write echoes using `ownWriteIds`)
3. 300ms debounce → inject `_VaultSyncPush(updates)` into WebView
4. Shim updates `_cache`, `_baseState`, `_keyVersions` for each key
5. Saves full cache to `window.name` → `location.reload()` with 800ms debounce
6. On reload: shim reads `window.name` for fresh cache (bypasses stale preloaded data)

> Why `location.reload()`? React `useState(() => localStorage.getItem('key'))` initializers only run on component mount. No external event can force React to re-run them. `location.reload()` + `window.name` is the only cross-framework-universal approach. Trade-off: in-app navigation state is lost (app returns to landing screen).

---

## 11. Join Approval Flow

1. User enters invite code → `lookup_shared_instance(p_invite_code)` RPC
2. `add_instance_member(p_instance_id, p_user_id, 'member')` — inserts with `status='pending'`
3. RLS on `shared_app_data` blocks pending members (requires `status = 'active'` in `instance_members`)
4. Owner receives Supabase Realtime notification (requires `REPLICA IDENTITY FULL` on `instance_members`)
5. Owner approves (UPDATE status → `active`) or rejects (DELETE row)
6. Joiner's device: Supabase Realtime detects UPDATE → immediate access grant
7. Fallback: AppState focus event + direct Supabase query for devices without Realtime

---

## 12. Auth System

### Two Auth Screens (intentionally separate)

| Screen | Purpose | Dismissable |
|---|---|---|
| `app/login.tsx` | Mandatory full-screen gate on cold start | No (`gestureEnabled: false`) |
| `app/auth.tsx` | Settings → Sign In modal | Yes |

Never merge these screens.

### Sign-Up Flow
1. Email + password → `supabase.auth.signUp({ email, password })`
2. Supabase sends 6-digit OTP to email
3. `supabase.auth.verifyOtp({ email, token, type: 'signup' })`
4. Navigate to `/(tabs)`

### Sign-In Flow
1. Email + password → `supabase.auth.signInWithPassword({ email, password })`
2. Navigate directly to `/(tabs)` — no OTP step
3. Edge case "Email not confirmed": auto-resend OTP, show verification screen

### User-Change Guard
When a different Supabase user signs in while local data exists:
1. `AuthChangeGuard` in `_layout.tsx` detects mismatch via `useUserChangeGuard`
2. Non-dismissable `UserChangeWarningModal` shown
3. "Continue & Erase": wipes PowerSync + SQLite + bundle cache → re-seeds demo apps → reconnects PowerSync for new user
4. "Cancel": signs out, preserves old data

**Critical**: Count only `source_type != 'demo'` apps. Demo apps are generic seeded content — showing wipe warning with only demos is wrong.

### Auth Gotchas

- `supabase.rpc()` returns `PostgrestFilterBuilder`, not a real Promise. `.catch()` does not exist. Use `.then(undefined, () => {})` for fire-and-forget.
- Use `supabase.functions.invoke()`, never raw `fetch()` for edge functions — raw fetch causes `Invalid JWT` from the Supabase gateway; `refreshSession()` triggers PowerSync reconnect + hang.
- User JWTs use `aud: "authenticated"` (not `role`). Always check `payload.aud === "authenticated"` in edge functions.
- Deploy edge functions with `--no-verify-jwt` when called by user JWTs (ES256 fails the gateway's HS256 check).

---

## 13. Admin Dashboard (cottix-hub)

Located at `../cottix-hub`. Vite + React + shadcn/ui. Reads same Supabase project.

**Schema ownership**: perappos owns all table definitions. cottix-hub reads `perappos/docs/backend-schema.md`, never defines tables.

### Pages

| Page | Content |
|---|---|
| Dashboard | KPI cards (Total Users, DAU, Apps Installed, Shares Created), daily chart, funnel widget, live PostHog event feed |
| Users | User list with plan badges, search, per-user drill-down (plan, install count, joined date), manual plan change |
| Feedback | User feedback/bug reports (mock structure; Supabase table pending) |
| Features | Feature flag management |
| Plans | Plan management |
| Promo Codes | Create/manage promo codes |
| Bugs | Bug tracking |
| Testers | Beta tester list |
| Settings | Admin settings |

---

## 14. Plan Tiers & Gates

### Limits

```typescript
const PLAN_LIMITS = {
  free:  { maxApps: 5,         maxSharedInstances: 0 },
  beta:  { maxApps: Infinity,  maxSharedInstances: 5 },
  pro:   { maxApps: Infinity,  maxSharedInstances: 5 },
  team:  { maxApps: Infinity,  maxSharedInstances: Infinity },
}
```

### Enforcement

- `useGatekeeper.gateAppInstall()` — checks local SQLite count (not drifting Supabase counter) before install
- `useGatekeeper.gateSharedInstance()` — checks plan before creating shared instance
- Both show `Alert.alert` upgrade prompts on limit hit
- Backend enforcement: `shared_instance_limit` table with per-user tracking (prevents API-level bypass)

### Promo Code Redemption

1. `redeem_promo_code(code_input)` RPC — atomic: checks `max_redemptions`, increments count, updates `user_profiles.plan`, inserts `promo_redemptions` row
2. On upgrade: calls `unfreeze_owner_instances` to unfreeze any frozen shared instances
3. On expiry detection (via `get_user_profile`): calls `freeze_owner_instances`

---

## 15. Current Status

**As of 2026-04-15 (Session 19)**

### Done

- Full mini-app container (URL, ZIP, HTML paste)
- AI generation — Cloudflare Queue durable jobs
- Edit with AI (modify flow, appId = conversationId)
- VaultAPI: db, device, auth, app, secrets, storage, collaboration
- Real-time collaboration + 3-way merge engine
- Join approval flow (pending → active, owner approval UI)
- Cross-device app sync
- User profiles + subscription plans + promo codes
- Shared instance freeze on plan downgrade
- Write attribution + `_addedBy` stamping + activity log
- Dark theme system (lib/theme.ts, 15 files)
- Guide tab (7 sections: Overview, Install, Share, API Keys, Tips, Limits, FAQ)
- Admin dashboard (cottix-hub) — basic structure
- PostHog integration (basic)
- Per-user shared instance limit enforcement (backend)

### Pending Manual Steps

| Step | Migration / Command |
|---|---|
| Run generation_jobs migration | `supabase/migrations/20260414_generation_jobs.sql` |
| Run attribution migration | `supabase/migrations/20260330_attribution.sql` |
| Run join approval migrations | `20260401_join_approval.sql` + `20260401_member_email.sql` |
| Run limit fix migration | `supabase/migrations/20260405_fix_updated_by_cast.sql` |
| Set REPLICA IDENTITY | `ALTER TABLE instance_members REPLICA IDENTITY FULL;` |
| PowerSync sync rules | Add: `generation_jobs` table; `is_frozen/frozen_at/frozen_reason` on `shared_instances`; attribution columns on `shared_app_data`; `shared_app_data_history` table; `status/email` on `instance_members` |
| Deploy edge function | `supabase functions deploy deploy-html` |

### Next Up

- [ ] AI generation error recovery — JS error banner in WebView → Regenerate/Report buttons
- [ ] RevenueCat for paid plan upgrades
- [ ] AI-generated app history in Guide tab
- [ ] Edit Profile screen (display_name + avatar emoji picker)
- [ ] Android testing (`npx expo prebuild --clean` + `npx expo run:android`)
- [ ] HTML/ZIP cross-device: "Re-install required" overlay when bundle NULL after restore
- [ ] Remove one-time CRUD queue flush from PowerSyncProvider after confirming clean queues
- [ ] Discover screen: curated template list + AI-generated apps feed
- [ ] Custom domain DNS: apps.cottix.co → Cloudflare Worker route

---

## 16. Known Limitations & Gotchas

### Product Limitations

1. **HTML/ZIP apps don't restore cross-device** — Only metadata syncs. Bundle must be re-imported. URL apps restore fully.
2. **Complex apps may be incomplete** — Apps requiring >8192 output tokens may be cut off. Queue architecture handles this better than SSE; progressive complexity (4k→8k retry) planned.
3. **WebView sync causes navigation reset** — After a live sync push, `location.reload()` returns user to the app's landing screen. In-app navigation state is lost. This is the only universal cross-framework approach.

### Critical Technical Gotchas

| Gotcha | Rule |
|---|---|
| PowerSync sync rules | Never use table aliases (`FROM table t`) → rows land in `ps_untyped` |
| PowerSync row IDs | `shared_app_data` id = `${instanceId}/${appId}/${key}` — never UUID |
| PowerSync booleans | Use `column.integer`, compare with `=== 1` not `=== true` |
| PowerSync db in hooks | Use `useRef(db)` with `[]` deps in `useCallback` — prevents re-fire on every sync cycle |
| PowerSync post-upload gap | Row disappears locally after `transaction.complete()` for up to several seconds — use `_versionCache` to preserve version numbers |
| `instance_members` RLS | Must stay DISABLED — PowerSync sync rules handle access control |
| `shared_app_data` UNIQUE | Exactly ONE UNIQUE constraint on `(instance_id, app_id, key)` — duplicates cause "more than one unique constraint" error |
| Supabase RPC `.catch()` | `supabase.rpc()` is PostgrestFilterBuilder, not a real Promise — `.catch()` doesn't exist. Use `.then(undefined, () => {})` |
| Supabase RLS | Never use `(auth.uid())::text` — `auth.uid()` is already uuid |
| Edge function calls | Always use `supabase.functions.invoke()` — raw `fetch()` causes Invalid JWT + PowerSync reconnect hang |
| Edge function JWT | User JWTs use `aud: "authenticated"` not `role`. Deploy with `--no-verify-jwt`. Decode JWT locally, don't use `auth.getUser()`. |
| SSE in React Native | `response.body` is always null — use `XMLHttpRequest.onprogress` pattern |
| WebView shims | `vaultShim.ts` (personal) and `vaultShimSync.ts` (shared) must be updated in lockstep |
| WebView shim injection | Always use `injectedJavaScriptBeforeContentLoaded`, never `injectedJavaScript` |
| WebView baseUrl | Use `baseUrl: 'http://localhost/'` for HTML bundles — `baseUrl: ''` causes null-origin blocking of external HTTPS on iOS WKWebView |
| Worktree deployment | Claude Code worktree changes don't affect Metro. Copy all modified files to main project (`/Users/vamshipampari/Documents/Workspace/Perappos/perappos`) before testing. |
| wrangler deploy | Always pass `--config path/to/wrangler.toml` — running from project root silently deploys the wrong worker |
| expo-router modals | Use `router.dismiss()` not `router.back()` for modal dismissal |
| expo-router + async | Capture target in `useRef` synchronously before calling `closeMenu()` — state batches before async resolves |
| Native module imports | Use `lazyModule()` with `await import()` in `vaultBridge.ts` — static imports crash entire bridge if any native module unlinked |
| `StyleSheet.create()` | Evaluated at module load time — cannot use hooks. Use `makeStyles(theme: Colors)` called inside component. |
| `Haptics.impactAsync()` | Always `await` or `void` — unhandled Promise causes iOS app state change events + UI flicker |
| `installed_apps` writes | Must write to PowerSync in every install path: `add.tsx handleInstall()`, `appInstaller.ts installUrlApp()`, and any future install entry point |
| CF Worker modify jobs | `appId` must equal `conversationId` — never derive a new appId for modify jobs |
| `seedDemoApps()` | Runs only on DB creation, not on wipe. Must be called explicitly after `confirmWipe()`. |
| User-change guard | Count only `source_type != 'demo'` apps — demo apps should never trigger wipe modal |

---

## 17. App Store Compliance

- Discover tab: invite-only, non-browseable → avoids "app store" appearance to reviewers
- Sharing framed as "data sharing" (shared SQLite context), not app distribution
- HTML code execution kept as GTM differentiator; safeguards: CSP injection + WebView sandboxing (Tier 1), VaultAPI restrictions (Tier 2), static analysis pre-public gallery (Tier 3)

---

## 18. Repo Structure

```
Workspace/
├── perappos/               — This repo: React Native app (schema owner)
│   ├── app/                — expo-router screens
│   ├── components/         — Shared UI components
│   ├── hooks/              — React hooks
│   ├── lib/                — Core utilities (bridge, shims, updates)
│   ├── services/           — Business logic (sync, collaboration, deployer)
│   ├── supabase/
│   │   ├── functions/      — Edge functions (generate-app, deploy-html)
│   │   └── migrations/     — SQL migrations (never modify existing, create new)
│   ├── cottix-generator/   — Cloudflare Worker (AI generation + queue consumer)
│   ├── docs/               — Architecture docs, schema, status
│   └── .claude/            — Claude Code rules, learning log
├── cottix-hub/             — Admin panel (Vite + React, reads perappos schema)
└── cottix-landing/         — Marketing site (cottix.co)
```

**Cross-repo rules:**
- perappos owns DB schema — cottix-hub reads `perappos/docs/backend-schema.md`, never defines tables
- After editing `miniapp_api.md` → run `/sync-docs` before shipping
- After any Supabase migration → run `/schema-update`

---

## 19. Critical Constraints

These are non-negotiable architectural decisions. Violating them causes data loss or sync breakage.

1. **`instance_members` RLS must stay DISABLED** — PowerSync sync rules handle access control. Enabling RLS breaks sync entirely.

2. **`shared_app_data` UNIQUE constraint** — Must be exactly ONE UNIQUE constraint on `(instance_id, app_id, key)`. Duplicate constraints cause upsert failures.

3. **Natural-key upsert for `shared_app_data`** — Always use `onConflict: "instance_id,app_id,key"`. Never use PowerSync's compound-string id as the upsert key.

4. **All merge metadata columns must be present** — `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count` in both PowerSync schema and Supabase table, and in PowerSync sync rules projection.

5. **Shim selection is strict** — Personal apps use `vaultShim.ts`, shared apps use `vaultShimSync.ts`. Never mix. Any new VaultAPI namespace must be added to both.

6. **`app_data.id` and `installed_apps.id` in Supabase must be TEXT** — PowerSync uses composite strings (`${appId}/${key}` and `${userId}/${appId}`) as IDs. UUID type rejects these.

7. **Never use `(auth.uid())::text` in RLS** — `auth.uid()` already returns uuid. The cast introduces bugs where the column type is uuid.

8. **PowerSync sync rules: no table aliases** — Aliases cause rows to land in `ps_untyped`. All column references must be unqualified.

9. **Two auth screens are intentional** — `login.tsx` (mandatory gate) and `auth.tsx` (Settings modal) serve different purposes and must never be merged.

10. **Worktree ≠ running project** — Metro always runs from `/Users/vamshipampari/Documents/Workspace/Perappos/perappos`. Claude Code worktree changes must be explicitly copied to the main project before testing.
