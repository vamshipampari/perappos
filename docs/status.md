# Cottix — Status

**Last Updated**: 2026-07-28 (Session 20)

## Current Sprint: RevenueCat IAP Integration

### ✅ Session 20 — RevenueCat Android support (2026-07-28)

RevenueCat Android products are now live in the dashboard, attached to the same "Cottix Pro" entitlement and "default_v2" offering used for iOS. Client code was iOS-only until now.

- `services/revenueCat.ts` — `initRevenueCat` now selects the RC public SDK key by `Platform.OS`: `EXPO_PUBLIC_REVENUECAT_IOS_KEY` on iOS, new `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` on Android
- `app/paywall.tsx` — fine-print billing copy is now platform-aware ("Billed via Apple / iOS Settings" vs "Billed via Google Play / Play Store subscriptions"); `getOfferings()`/`purchasePackage()`/`restorePurchases()` and RC error-code handling confirmed already cross-platform, no changes needed
- `app/_layout.tsx` — `initRevenueCat(userId)` call confirmed already ungated by `Platform.OS` (no `Platform` import even present) — runs for both platforms as-is
- **Required before Android testing**: add `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` to `.env` (gitignored, same pattern as the iOS key), then `eas build --platform android --profile preview` for a local test APK, or `--profile production` for a store-track build
- **Build/version audit**: confirmed `app.json` (`version` 1.0.4, iOS `buildNumber` 5, Android `versionCode` 14) matches the most recent finished EAS builds for both platforms (`eas build:list`) — these values are correct but still uncommitted locally (EAS `autoIncrement` writes to `app.json` after a `production`-profile build finishes but does not commit); commit this bump before the next build to keep git in sync

### ✅ Session 19 — RevenueCat Paywall + Delete Account Fix + UX Cleanup (2026-04-28)

**RevenueCat integration (`services/revenueCat.ts`, `app/paywall.tsx`, `app/_layout.tsx`):**
- Added `react-native-purchases` + `react-native-purchases-ui` to `package.json`
- `services/revenueCat.ts` — `initRevenueCat`, `getOfferings`, `purchasePackage`, `restorePurchases`, `getCustomerInfo`, `hasProAccess`
- `app/paywall.tsx` — full paywall screen: yearly/monthly toggle, price display from RC offerings, Start Pro CTA, Restore Purchases, fine print
- `app/_layout.tsx` — `initRevenueCat(userId)` called on auth sign-in
- Route `/paywall` registered as modal in root Stack
- Settings Account section: "Upgrade to Pro" button shown for free-plan users; "Manage Subscription" shown for pro users

**Delete account fix (`supabase/migrations/20260423_delete_user_account.sql`):**
- Fixed `operator does not exist: uuid = text` — removed incorrect `::text` casts from all columns that are `uuid` type in Supabase
- `generation_jobs.user_id` confirmed as `uuid` (not text despite schema docs saying text)
- Added `router.replace('/login')` after `signOut()` — auth row deletion doesn't always trigger `SIGNED_OUT` event

**UX cleanup:**
- Removed "Built with ❤️ in Hyderabad" tagline from Settings
- TypeScript fixes: `refreshProfile` → `refresh`, removed `purchasedViaPlatform` (not in `UserProfileState`)

**App Store submission status:**
- Build 23 submitted to TestFlight via `eas submit`
- Products `com.cottix.app.pro.monthly` + `com.cottix.app.pro.yearly` created in App Store Connect (status: Ready to Submit)
- RevenueCat offerings configured with both products
- Pending: submit app version for review to activate sandbox testing of IAP products

### 🔜 Next Up
- [ ] Submit app version for App Review (attach both subscription products to the version) — required to activate sandbox IAP testing
- [ ] Reply to Apple rejection (Guideline 2.1 + 2.2) with business model explanation + test account
- [ ] Remove RC debug alert from `app/paywall.tsx` before next production build
- [ ] Verify paywall button activates end-to-end with sandbox Apple ID after App Review submission
- [ ] Remove one-time queue flush from `PowerSyncProvider` after confirming clean CRUD queues

---

## Previous Sprint: Queue-Based AI Generation

### ✅ Session 18 — Queue-Based AI Generation + Edit with AI (2026-04-15)

Replaced SSE-streaming `generate-app` edge function with a durable Cloudflare Queue architecture. Apps that used to time out now complete reliably offline-safe.

**Cloudflare Worker (`cottix-generator/src/index.ts`):**
- `fetch` handler: JWT decode, rate limit check (20/day), INSERT `generation_jobs`, enqueue job
- `queue` handler: Anthropic streaming → `APPS_KV.put('app:{appId}', html)` → Supabase REST PATCH `generation_jobs.status = 'complete'`
- Modify flow: `appId = conversationId` so KV key, `generated_apps` row, and installed app stay consistent
- `wrangler deploy --config cottix-generator/wrangler.toml` (not from root — picks up wrong config)

**New PowerSync table (`generation_jobs`):**
- `services/sync/schema.ts` + migration `20260414_generation_jobs.sql`
- Columns: `id`, `user_id`, `app_id`, `status`, `progress_chars`, `error`, `created_at`, `conversation_id`
- PowerSync watches status changes → instant delivery to device without polling

**New hook (`hooks/useGenerateApp.ts`):**
- Submits job via `supabase.functions.invoke()` → gets `jobId` immediately
- `powerSyncDb.watch()` with `result.rows?._array ?? []` pattern for status
- Fetches `title/icon/color/description` from `generated_apps` via Supabase once status = `'complete'`
- AbortController cleanup on `activeJobId` change

**`app/create.tsx` full rewrite:**
- XHR/SSE approach replaced with `useGenerateApp` hook
- Progress bar driven by `progress_chars` from PowerSync
- idle → generating → preview state machine preserved; WebView preview unchanged

**`app/app/[id].tsx`:**
- "Edit with AI" added to three-dot menu for apps with `source_url` matching `apps.cottix.co`
- Routes to `/create?mode=modify&conversationId=<app_id>`

**`app/add.tsx`:**
- "Create with AI" card now routes to `/create` (was "Coming Soon" alert)

**Migrations:**
- `20260414_generation_jobs.sql` — `generation_jobs` table + `html_content` column on `generated_apps`
- `20260405_fix_updated_by_cast.sql` — fix `updated_by` cast bug in SupabaseConnector

---

## Previous Sprint: Guide Tab

### ✅ Session 17 — Guide Tab replacing Discover (2026-03-31)

- Replaced Discover tab (placeholder) with a full interactive Guide tab
- 7 sections via horizontal scrollable tab pills: Overview, Install, Share, API Keys, Tips, Limits, FAQ
- Components: `ExpandableCard`, numbered `StepItem`, `Callout`, `CodeBlock`, `PromptBox`, `BulletRow`
- Refactored into 3 files: `app/(tabs)/guide.tsx` (shell, ~115 lines), `components/guide/GuideAtoms.tsx` (primitives), `components/guide/GuideSections.tsx` (sections + data)
- Search bar navigates to matching section on submit
- Discover route kept with `href: null` to suppress from tab bar without breaking routing

---

## Previous Sprint: Write Attribution + VaultAPI.collaboration

### ✅ Session 16 — Write Attribution + _addedBy Stamping + Activity Panel (2026-03-31)

**Write attribution (`shared_app_data`):**
- Added `last_editor_user_id` and `last_editor_display_name` columns to `shared_app_data` (PowerSync schema + Supabase migration `20260330_attribution.sql`)
- Module-level identity cache (`_bridgeUser`) in `vaultBridge.ts` — warmed at import via `getSession()`, refreshed on `onAuthStateChange`. No per-write `getSession()` call.
- `handleSharedWrite()` in `bridge-merge-handler.ts` now accepts `userDisplayName` and stamps both fields on every write via `writeRow()`
- `SupabaseConnector.uploadData()` passes attribution to `upsert_shared_app_data_versioned` RPC; PGRST202 catch-retry pattern for deploy-before-migration safety
- Fire-and-forget insert into `shared_app_data_history` (append-only audit log) on every PUT

**`_addedBy` stamping on array items:**
- `bridge-merge-handler.ts` array merge path: after `mergeArraysById()`, post-processes `result.merged`
  - New items (not in `currentParsed`): stamped with `{ userId, displayName, addedAt }`
  - Existing items: `_addedBy` always restored from `currentParsed` — never overwritten by merge

**Attribution preload in sync shim:**
- `loadShimPayload` (`useWebViewApp.ts`) fetches `last_editor_user_id`, `last_editor_display_name`, `updated_at` from both PowerSync local and Supabase fallback; builds `preloadedAttribution` map
- `buildSyncShim` extended with `preloadedAttribution` + `instanceId` params
- `_attribution` var in shim IIFE (alongside `_cache`, not inside); seeded from native payload; carried through `window.name` save/restore across `location.reload()`
- `_VaultSyncPush` updates `_attribution[key]` when remote update includes `lastEditorUserId`
- `useLiveSyncPush.ts` watcher now selects and forwards `last_editor_user_id`, `last_editor_display_name`, `updated_at` in push payload

**`VaultAPI.collaboration` surface (shared apps only):**
- `getAttribution(key)` — synchronous from `_attribution`, zero bridge round-trip
- `getAllAttribution()` — synchronous shallow copy of full `_attribution` map
- `getItemOwner(arrayKey, itemId)` — reads `_addedBy` from `_cache` for a specific array item
- `getRecentActivity(limit)` — async bridge call → `collab_get_recent_activity` handler → queries `shared_app_data_history` filtered by `instance_id + app_id`, limit `min(limit, 200)`
- Personal shim stubs all return `null`/`[]`; TypeScript `VaultAPI` interface updated

**Activity panel on Manage Group screen (`app/shared-instance/[instanceId].tsx`):**
- Reads from `shared_app_data_history` (full audit log) instead of `shared_app_data` (last-write per key)
- Always visible — shows "No activity yet." when empty (no longer conditionally hidden)
- Collapsible via tap on section header (chevron `⌄`/`›` toggle, default expanded)
- Key truncated to 20 chars; `relativeTime()` helper reused (already existed in file)

**Migration required:** Run `supabase/migrations/20260330_attribution.sql` in Supabase SQL Editor.
**PowerSync sync rules required:** Add attribution columns to `shared_app_data` projection; add `shared_app_data_history` as synced table.

---

## Previous Sprint: API Keys UI + Version Tracking

### ✅ Session 15 — API Keys Management + Version Display (2026-03-26)

**API Keys section in Settings:**
- New "API Keys" section always visible in Settings (previously didn't exist at all).
- "Add API Key" button opens a `formSheet` modal with name + masked value fields.
- Keys saved to `expo-secure-store` (native SecureStore) + name tracked in SQLite (`shared_data` category `vault_secrets`) so they can be listed.
- Existing keys show with source label (`manual` vs `from app`); tap any key to delete it (removes from SecureStore + SQLite).
- Bridge (`vaultBridge.ts` `secrets_set`) also writes to SQLite so keys set by mini-apps appear in the list.

**Version tracking:**
- Bumped `app.json` version `0.1.0` → `0.2.0`.
- Settings "Version" row now reads dynamically from `Constants.expoConfig.version` instead of hardcoded string.
- EAS `testflight`/`production` profiles already have `autoIncrement: true` for build number.

## Current Sprint: Sharing Fix + Native Module Resilience

### ✅ Session 14 — Shared App RLS Fix + Lazy Native Modules (2026-03-26)

**Shared app join RLS fix (`installed_apps` PK conflict):**
- **Bug**: When user B joined a shared app, PowerSync tried to upsert `installed_apps` with the same `id` (= `app_id`) as user A's row in Supabase. The upsert's UPDATE path failed the RLS `USING (user_id = auth.uid())` check since the existing row belonged to user A.
- **Fix** (`services/sync/SupabaseConnector.ts`): Scoped the Supabase `installed_apps.id` to `${userId}/${appId}` so each user gets a unique row. Added `supabaseRowId()` helper used in PUT, PATCH, and DELETE paths.
- **Supabase migration required**: `ALTER TABLE installed_apps ALTER COLUMN id TYPE TEXT;` (was UUID, now needs to hold `userId/appId` composite strings).

**Lazy native module imports (`lib/vaultBridge.ts`):**
- **Bug**: Top-level `import * as SecureStore from 'expo-secure-store'` (and Haptics, Notifications, Sharing, ImagePicker, FileSystem) crashed the entire WebView bridge at import time if any native module wasn't linked — blocking ALL bridge functionality.
- **Fix**: Replaced all 6 native module static imports with a `lazyModule()` helper that uses `await import(...)` on first use. Each module is loaded only when its specific bridge message type is handled. The bridge now loads cleanly even if native modules are missing.

## Current Sprint: Cross-Device App Sync

### ✅ Session 13 — Cross-Device App List Sync + Settings Count Fix (2026-03-25)

**Settings count consistency fix:**
- `app/(tabs)/settings.tsx`: "Apps installed" now reads local non-demo SQLite count (`apps.filter(a => a.source_type !== 'demo').length`) instead of `profile.app_install_count` from Supabase. The Supabase counter drifts after device wipes and multi-device use — local count always matches the home screen.

**Cross-device app list sync (activates dormant `installed_apps` PowerSync table):**
- `app/add.tsx` `handleInstall()`: after local SQLite INSERT/UPDATE, fire-and-forget write to PowerSync `installed_apps` (id, app_id, name, icon, color, source_type, source_url, bundle_hash)
- `services/appInstaller.ts` `installUrlApp()`: same — ensures join-flow auto-installs also sync
- `hooks/useAppMenuActions.ts` `handleDelete()`: `DELETE FROM installed_apps WHERE id = ?` via `syncDb.execute` alongside existing app_data delete
- `hooks/useAppContextMenu.ts` (home screen long-press delete): same via `powerSyncDb.execute` (direct import)
- `app/(tabs)/settings.tsx` "Clear All Data": `DELETE FROM installed_apps` via `syncDb.execute`
- New `hooks/useRestoreApps.ts`: watches PowerSync `installed_apps` via `db.watch()` with `AbortController`; when local non-demo count = 0 but PowerSync has rows, inserts them into local SQLite `apps` (URL apps restore fully; HTML/ZIP apps restore tile metadata only — bundle re-import needed to open); shows "X apps restored" toast; called from home screen
- `app/(tabs)/index.tsx`: `useRestoreApps()` called on home screen mount

**Supabase `installed_apps` table (already existed):**
- RLS policies confirmed correct (SELECT/INSERT/UPDATE/DELETE scoped to `auth.uid() = user_id`)
- `source_type` CHECK constraint updated: added `'html'` to allowed values (`url | zip | demo | html`)
- PowerSync sync rule `user_installed_apps` already present with `auto_subscribe: true`

## Current Sprint: Bug Fixes + HTML App Import + WebView Polish

### ✅ Session 12 — Auth Lifecycle Fixes + HTML Add Flow + WebView UX (2026-03-25)

**Auth / data-lifecycle bug fixes:**
- **Tab auth guard**: `app/(tabs)/_layout.tsx` now redirects immediately to `/login` via `<Redirect>` if no session — eliminates the flash of home screen that appeared before the root layout's `useEffect` auth check fired
- **User-change wipe modal — demo exclusion**: `checkUserChange()` in `hooks/useUserChangeGuard.ts` now counts only non-demo apps (`source_type != 'demo'`). Previously demo apps triggered the "will erase your data" modal even when the user had no real data.
- **User-change wipe — re-seed after wipe**: `confirmWipe()` now calls `seedDemoApps(db)` after deleting all rows, so the new user starts with the standard 3 demo apps (mirrors fresh install)
- **App limit drift fix**: `useGatekeeper.gateAppInstall()` accepts an optional `localCount` param. `app/add.tsx` passes the local non-demo SQLite count, bypassing the stale Supabase `app_install_count` counter that drifts after device wipes / user-switch wipes

**Add from HTML feature (`supabase/functions/deploy-html/`, `services/htmlDeployer.ts`, `app/add.tsx`):**
- New Supabase edge function `deploy-html` — POST `{ appId, html }` with JWT auth (same local-decode pattern as `generate-app`); validates size ≤ 5 MB + HTML presence; PUTs to Cloudflare KV at `app:{appId}`; returns `{ url }`
- New client service `services/htmlDeployer.ts` — `parseHtmlMeta(html)` extracts title/icon/color from `<title>` and `cottix-meta`/`perappos-meta` tags; `deployHtml(appId, html)` posts to edge function with session Bearer token
- `services/zipInstaller.ts` `sourceType` union extended to `'url' | 'zip' | 'html'`
- `app/add.tsx` — new "FROM HTML" section (between URL and AI card): file picker (`.html` files), paste textarea with monospace font, "Next" button → details step → Install deploys to Cloudflare then writes to SQLite (`bundle_html` + `source_url`). On Cloudflare deploy failure: graceful degradation to local-only (bundle still loads offline via `bundle_html`)

**WebView UX fixes (`app/app/[id].tsx`):**
- Replaced `ANDROID_KEYBOARD_FIX_JS` (Android-only, modifies existing meta only) with universal `VIEWPORT_FIX_JS` that: creates meta if missing, sets `maximum-scale=1.0, user-scalable=no, viewport-fit=cover` (prevents iOS auto-zoom on input focus), adds `interactive-widget=resizes-content` on Android only
- Injection now unconditional (`shimJS + VIEWPORT_FIX_JS` on both iOS and Android)
- Added `automaticallyAdjustKeyboardInsets` → iOS WKWebView resizes viewport instead of panning when keyboard appears; keeps fixed-bottom elements visible
- Added `contentInsetAdjustmentBehavior="never"` → prevents WKWebView extra scroll insets
- Added `overScrollMode="never"` → disables Android over-scroll bounce

## Current Sprint: VaultAPI Secrets + Storage

### ✅ Session 11 — VaultAPI.secrets + VaultAPI.storage (2026-03-24)
- **`VaultAPI.secrets` — fully working ✅**
  - `secrets.set(name, value)` persists API keys to `expo-secure-store` globally (one save works across all mini-apps)
  - `secrets.fetch(name, opts)` reads the key natively, substitutes `{{secret}}` in headers, makes the HTTP call from the native layer, returns `{ status, body }`
  - Secret values never reach WebView JS — only the native bridge injects them at request time
  - SecureStore key: `vault_secret__global__${name}`
- **`VaultAPI.storage` — fully working ✅**
  - `expo-image-picker` opens native Photos picker, reads as base64 via `expo-file-system`, converts to `Uint8Array`, uploads to Supabase Storage `user-media` bucket
  - `storage.getUrl(uri)` returns 1-hour signed URL — confirmed working end-to-end
  - `expo-image-picker` plugin added to `app.json` for iOS `NSPhotoLibraryUsageDescription`
  - Supabase `user-media` bucket RLS policies added (INSERT + SELECT for authenticated users)
- **`vaultShimSync.ts` patched** — shared apps (instance_id set) now have `VaultAPI.secrets` and `VaultAPI.storage` (previously missing; personal-only shim was the only one with these APIs)
- **`expo-image-picker` installed** — replaces `expo-document-picker`; opens native Photos picker instead of Files app
- **Bug fixed**: backtick inside shim template literal in `vaultShim.ts` was breaking TypeScript compilation
- **Bug fixed**: `fetch(file://).blob()` replaced with `FileSystem.readAsStringAsync('base64')` + `Uint8Array` — the only reliable upload path for Supabase in RN native context
- **`MINIAPP_API.md` updated** — full `secrets` documentation; users can now build AI-powered mini-apps that call any LLM API

## Current Sprint: UX Polish + Sync Reliability

### ✅ Completed
- NativeWind v4 fully configured (tailwind.config.js, babel.config.js, metro.config.js, global.css)
- Root layout (`app/_layout.tsx`) with SQLiteProvider + DB initialization via `onInit`
- Database schema: `apps`, `app_data`, `shared_data` tables created on first launch
- `hooks/useDatabase.ts` — thin wrapper around `useSQLiteContext()`
- `hooks/useInstalledApps.ts` — reads apps table, exposes `refresh()` and `recordOpen()`
- Tab bar (`app/(tabs)/_layout.tsx`) — Home, Discover, Settings with Unicode icons
- Home screen (`app/(tabs)/index.tsx`):
  - Large title "Cottix"
  - 3-column app grid with Reanimated press-scale animation
  - Empty state with icon, copy, and "Add Your First App" button
  - FAB (shown only when apps are installed)
- Discover screen — placeholder
- Settings screen — full iOS-style grouped list (rounded cards, inset separators):
  - Account: Sign In modal with email OTP flow (6-digit code)
  - General: Appearance (static), App Lock toggle (biometric via expo-local-authentication, persisted), Auto-Update toggle (persisted to SQLite)
  - Data: Storage Used (live SUM(bundle_size)), Export All Data (JSON via expo-sharing), Clear All Data (destructive confirm)
  - About: version, built-in-Hyderabad tagline
- WebView screen (`app/app/[id].tsx`):
  - Full-screen runner with header bar, three-dot action sheet
  - BFS asset crawler for local bundle loading
  - App-themed splash overlay with cross-fade on load
  - Check for Update / App Info / Revert to Previous Version / Delete App actions
- Add modal (`app/add.tsx`) — name + URL input, emoji + color pickers, live preview
- Supabase auth integration:
  - Email OTP sign-in (`app/auth.tsx`) — two-step flow: enter email → receive 6-digit code → verify
  - No magic link / deep link required; works reliably on simulator and device
  - Supabase session persisted with `detectSessionInUrl: false`
  - Deep-link listener retained in `app/_layout.tsx` for future OAuth provider support
  - `app/+native-intent.tsx` route redirect for `auth/callback` deep links
- PowerSync sync stack:
  - `services/supabase.ts` — Supabase client config
  - `services/sync/schema.ts` — PowerSync schema (`app_data`, `installed_apps`, `session_data`)
  - `services/sync/PowerSyncProvider.tsx` — auth-gated connect/disconnect with logging
  - `services/sync/SupabaseConnector.ts` — CRUD upload with `user_id` on PUT + PATCH, per-op logging
  - Settings: sync status row + "Debug: Check Sync DB" button (shows row count + preview)
- WebView vault bridge (`lib/vaultBridge.ts`):
  - `ls_*` messages: localStorage shim → PowerSync `app_data`
  - `db_*` messages: VaultAPI.db → PowerSync `app_data` with request/response
  - `device_haptic`, `device_notify`, `device_share` — native device APIs
  - `auth_get_user`, `app_get_info` — session and manifest access
- Bundle update system (`lib/appUpdates.ts`) — hash diffing, backup, revert
- Shared instance collaboration:
  - PowerSync schema expanded with `shared_instances`, `instance_members`, `shared_app_data`
  - `shared_app_data` schema now includes merge metadata: `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count`
  - Local `apps` table migration adds `instance_id` for per-app collaboration mode
  - Create flow in app menu now supports `Collaborate` and shows invite code
  - Join flow implemented via Settings → `Join Shared App` with invite-code screen
  - Manage group flow implemented in app menu (`Manage Group`) for leave/stop sharing
  - Home UI shows shared-app badge (👥); app header shows `Shared` pill
  - Shared vs personal data routing implemented in WebView bridge (`app_data` vs `shared_app_data`)
  - Shared apps use a dedicated sync shim (`lib/vaultShimSync.ts`) with base-version tracking, debounced writes, and write acknowledgements
  - Shared `localStorage` writes now flow through `ls_set_sync` and `handleSharedWrite()` for merge-aware conflict handling
  - Merge handler supports no-op suppression, idempotency, init-clobber protection, fast-path writes, object merge, array-by-id merge, and LWW fallback
  - Merge telemetry buffer added for strategy/conflict inspection during shared-write debugging
  - Join lookup now uses Supabase RPC `lookup_shared_instance`
  - Member add now uses Supabase RPC `add_instance_member` (owner + joiner)
- Join flow diagnostics:
  - Step-by-step console logging for lookup/member-add/install
  - 10-second timeout alert when join appears stuck
  - Loading state reset in success/catch/finally paths
- Auth reliability:
  - OTP modal now auto-dismisses when session becomes active (auth state listener)
  - Prevents stuck "Verifying…" UI when token is already issued
- Mandatory onboarding / auth gate (2026-03-16):
  - Native splash stays visible until BOTH deep-link init AND Supabase session check complete
  - Unauthenticated users are redirected to `/login` (full-screen, non-dismissable) on cold start
  - Sign-out automatically redirects back to `/login` via `onAuthStateChange` listener in root layout
  - New `app/login.tsx` — full-screen OTP flow (no close button); on success navigates to `/(tabs)`
  - `app/auth.tsx` kept intact as the dismissable Settings → Sign In modal
- PowerSync upload reliability:
  - `SupabaseConnector` PUT/PATCH for `shared_app_data` now uses direct natural-key upsert (`onConflict: "instance_id,app_id,key"`) — strips PowerSync compound id before sending, preserves all merge metadata columns
  - DELETE for `shared_app_data` uses natural key (`instance_id`, `app_id`, `key`) instead of compound-string id
  - One-time `getCrudBatch` queue flush in `PowerSyncProvider` on connect clears stuck entries with invalid compound-string IDs (remove after first successful run)
- Shared sync reliability (Session 4 — 2026-03-13):
  - **`ls_set` drop regression fixed**: `vaultBridge.ts` now routes `ls_set` for shared apps through `handleSharedWrite` instead of silently dropping
  - **In-memory version cache**: `bridge-merge-handler.ts` `_versionCache` Map survives PowerSync's post-upload local row clear — all write paths update cache, `readCurrentRow` returning null no longer resets version to 1
  - **Stable `loadShimPayload`**: `syncDbRef` pattern in `app/app/[id].tsx` prevents `loadShimPayload` from being recreated on every PowerSync sync, stopping the initial load `useEffect` from re-firing and causing WebView reloads
  - **Supabase fallback in shim preload**: When `shared_app_data` locally empty for a shared app, queries Supabase directly for correct data + versions before personal-fallback
  - **Net result**: Writes from both phones sync correctly and persist. Close+reopen shows full merged state on both devices. ✅
- WebView live sync push (2026-03-16):
  - `lib/vaultShimSync.ts`: Added `window._VaultSyncPush(updates)` receiver inside the shim IIFE — updates `_cache`, `_baseState`, `_keyVersions` for each key only when the remote version is strictly newer; dispatches `StorageEvent` + `vaultSyncUpdate` CustomEvent so apps re-render without a page reload
  - `app/app/[id].tsx`: Added `ownWriteIds` ref + tracking in `handleMessage` (registers `clientWriteId` before the bridge call so the watcher can skip own-write echoes)
  - `app/app/[id].tsx`: Added `pendingRemoteUpdates` buffer ref for updates arriving before WebView ready; `onLoadEnd` now flushes the buffer via `_VaultSyncPush` injection
  - `app/app/[id].tsx`: Added PowerSync watcher `useEffect` — `db.watch(shared_app_data WHERE instance_id+app_id)` with `AbortController` cleanup, `lastPushedVersions` dedup guard, 300ms debounce before inject; uses `syncDbRef.current` to avoid effect re-fires on every sync cycle
  - `lib/vaultBridge.ts` + `services/sync/bridge-merge-handler.ts`: Removed verbose debug `console.log` statements from `ls_set_sync` handler and `readCurrentRow`
  - **Net result**: Remote writes appear in the live WebView within ~1–3 seconds without reloading the page. ✅
- Cross-device sync fix (2026-03-17):
  - **PowerSync sync rules alias bug**: Discovered that table aliases in sync rules (`FROM instance_members im`) cause PowerSync to route rows to `ps_untyped` instead of proper tables. Fixed by removing all aliases from PowerSync dashboard sync rules. Column name prefixes (`im.id` → `id`) and row type mismatch (`im` → `instance_members`) were two compounding bugs.
  - **WebView live re-render via `window.name` reload**: React apps that use `useState(() => localStorage.getItem(...))` don't re-read on cache updates — only on component remount. Tried 3 approaches: (1) `location.reload()` + `window.name` ✅, (2) route restoration across reload ✗, (3) event-based visibilitychange/focus ✗. Final: `_VaultSyncPush` saves state to `window.name` and calls `location.reload()` with 800ms debounce. Shim reads `window.name` at init for fresh data. Trade-off: app navigates to landing screen on reload, but data syncs within ~1s. This is the only universal approach across all frameworks.
  - Cleaned up diagnostic logs from `app/app/[id].tsx`

- Auth flow migrated to email+password (Session 7 — 2026-03-17):
  - `app/login.tsx` + `app/auth.tsx`: replaced email-OTP-only flow with email+password. Signup requires OTP email confirmation (type `signup`); login uses `signInWithPassword` — no OTP step.
  - If a user signed up but never confirmed, login returns "Email not confirmed" → auto-resends OTP and shows verification screen so they can complete signup without a separate sign-up attempt.
  - Toggle between Sign In / Create Account modes on the same screen.
  - `supabase.auth.resend({ type: 'signup' })` used for both the initial confirmation and the Resend button.
- User-change guard + wipe modal (Session 7 — 2026-03-17):
  - `hooks/useUserChangeGuard.ts`: detects when a different Supabase user signs in while local app data exists. Persists `lastUserId` in `expo-sqlite/kv-store`. No modal shown on first login, same-user re-login, or when no local apps exist.
  - `components/UserChangeWarningModal.tsx`: non-dismissable modal ("Different Account Detected") with red "Continue & Erase" + "Cancel". Cancel signs out; confirm wipes PowerSync + SQLite tables + bundle cache then reconnects PowerSync for new user.
  - `app/_layout.tsx`: `AuthChangeGuard` component added inside `<PowerSyncProvider>` tree — subscribes to `SIGNED_IN`/`TOKEN_REFRESHED` events; shows modal when user changes; persists `lastUserId` on same-user sign-ins.
  - `services/sync/PowerSyncProvider.tsx`: `powerSyncDb` and `connector` are now exported so the guard hook can call `disconnectAndClear()` / `connect()` directly.

- Shared instance freeze on plan downgrade (Session 9 — 2026-03-18):
  - **Supabase migration**: Added `is_frozen` (boolean), `frozen_at`, `frozen_reason` columns to `shared_instances` table
  - **Supabase RPCs**: `freeze_owner_instances(p_owner_id)` + `unfreeze_owner_instances(p_owner_id)` — auto-called by `get_user_profile` on expiry detection and `redeem_promo_code` on plan upgrade
  - **PowerSync schema**: `sharedInstances` table now includes `is_frozen: column.integer`, `frozen_at: column.text`, `frozen_reason: column.text`
  - **Merge handler freeze gate**: `handleSharedWrite` checks `shared_instances.is_frozen` before processing writes — returns `strategy: 'frozen'` with `error: 'INSTANCE_FROZEN'` if frozen; fails-open if PowerSync row not yet present
  - **WebView bridge freeze signal**: `vaultBridge.ts` injects `window.__vaultInstanceFrozen = true` + dispatches `vaultInstanceFrozen` CustomEvent when merge handler rejects with `INSTANCE_FROZEN`
  - **App screen frozen banner**: Yellow `#FEF3C7` banner with lock icon shown above WebView in `app/app/[id].tsx` when instance is frozen; powered by `isFrozen` state with initial check on load + live PowerSync `db.watch()` watcher
  - **Manage Group frozen banner**: Same amber banner shown to owner only in `app/shared-instance/[instanceId].tsx` with "Upgrade your plan to resume collaboration" message
  - **⚠️ REQUIRED**: Update PowerSync sync rules dashboard to include `is_frozen`, `frozen_at`, `frozen_reason` in `shared_instances` SELECT projection
- User profile, subscription plans, and promo code redemption (Session 8 — 2026-03-18):
  - **Supabase schema**: `user_profiles` table (plan, avatar, display_name, counts), `promo_codes`, `promo_redemptions` with full RLS
  - **Triggers**: Auto-create `user_profiles` row on `auth.users` INSERT; `updated_at` auto-update trigger
  - **RPCs**: `get_user_profile()` (with plan expiry auto-downgrade), `redeem_promo_code(code_input)` (atomic), `increment_app_count(delta)`, `increment_shared_instance_count(delta)`
  - **Promo codes seeded**: `BETA2026` (90d beta, 100 max), `PERAPPOS` (lifetime beta, 50 max), `VIBECODER` (30d beta, 200 max)
  - **`hooks/useUserProfile.ts`**: Central profile hook with PLAN_LIMITS constant, `redeemPromoCode`, `updateDisplayName`, `updateAvatarEmoji`
  - **`hooks/useGatekeeper.ts`**: Gate functions for app install and shared instance creation with `Alert.alert` upgrade prompts
  - **`components/PromoCodeSheet.tsx`**: Bottom sheet modal for promo code entry with haptic feedback
  - **Settings screen**: Account card with avatar emoji, plan badge (colored pills), expiry date, Redeem Code + Edit Profile buttons
  - **Install gate**: `app/add.tsx` checks `gateAppInstall()` before new installs; fire-and-forget `increment_app_count` on install
  - **Delete tracking**: Count decrements wired in `app/(tabs)/index.tsx`, `app/app/[id].tsx`, `app/(tabs)/settings.tsx` Clear All
  - **Sharing gate**: `app/app/[id].tsx` checks plan before `createSharedInstanceForApp`; count increment on creation
  - **appInstaller.ts**: Count increment wired after `installUrlApp()` for join-flow auto-installs
  - **`services/collaborationService.ts`**: Count decrement in `stopSharingAsOwner()`
  - **Plan tiers**: free (5 apps, no sharing), beta/pro (unlimited apps, 5 shared), team (unlimited everything)

- Bug fixes & UX polish (2026-03-18):
  - **Delete list refresh bug**: After confirming delete in home screen context menu, the FlatList was not updating until navigating away. Root cause: `await refresh()` was called while the Modal was still open — React Native Modal renders in a separate native layer so FlatList state updates behind it don't surface until modal closes. Fix: moved `setMenuVisible(false)` to immediately after the delete succeeds (in `try`), so the slide-out animation runs while `refresh()` executes. SQLite is faster than the animation so the list is already correct when the modal finishes closing.
  - **URL input Devanagari danda**: On Indian-locale iOS keyboards, the period key emits `।` (U+0964, Devanagari danda) instead of `.`, mangling URLs like `netlify.app` → `netlify।app`. Added `onChangeText` normalisation in `app/add.tsx` that replaces `।` → `.`, `॥` → `.`, and curly quotes/apostrophes → straight ASCII equivalents.
  - **OTP top-row number keys blocked**: `keyboardType="number-pad"` suppresses top-row number key events on physical/Bluetooth keyboards (iOS quirk). Changed to `keyboardType="numeric"` in `app/login.tsx` and `app/auth.tsx`. The existing `replace(/[^0-9]/g, '')` filter already strips the decimal point the numeric pad adds.
  - **Missing `autoCorrect`/`spellCheck` on text inputs**: App name field (`add.tsx`) had no guards, allowing Hindi autocorrect to substitute words. OTP fields in `login.tsx` and `auth.tsx` were also missing these props. Added `autoCorrect={false}` + `spellCheck={false}` + correct `autoCapitalize` to all three inputs.

- App name rebranding from Perappos to Cottix (Session 9 — 2026-03-19):
  - **Configuration**: Updated `app.json` (name, slug, scheme, bundleIdentifier)
  - **Package**: Updated `package.json` name field
  - **Documentation**: Updated all `.md` files (`CLAUDE.md`, `TECHNICAL.md`, `README.md`, `MINIAPP_API.md`)
  - **Context files**: Updated `.claude-code/` files (`context.md`, `learning.md`, `rules.md`)
  - **Source code**: Updated all UI strings in app screens (13 files touched)
  - **Database**: Changed DB_NAME from `perappos.db` → `cottix.db`, biometric prompt
  - **Sharing**: Updated share message templates (4 files, 4+ strings each)
  - **Intent handling**: Updated deep link scheme from `perappos://` → `cottix://`
  - **Notes**: Folder paths left unchanged per user preference; `PERAPPOS` promo code kept as-is
- Android SDK environment setup (2026-03-19):
  - Added `ANDROID_HOME` export to `~/.zshrc`
  - Added Android SDK tools to `PATH`
  - First `npx expo prebuild --clean` initiated successfully — downloads Android NDK

- **Create with AI** feature (Session 10 — 2026-03-19):
  - **Cloudflare Worker** (`cottix-apps-worker/`): serves generated HTML from Cloudflare KV at `https://apps.cottix.co/{appId}`; KV namespace bound as `APPS`; health check at `/health`
  - **Supabase Edge Function** (`supabase/functions/generate-app/`): calls Claude Sonnet 4.6 via Anthropic API; streams SSE response with `progress` + `done` + `error` events; publishes HTML to Cloudflare KV; saves record to `generated_apps` table; rate-limits to 20 generations/user/day; supports conversation history for iterative refinement
  - **JWT auth in edge function**: ES256 user JWTs use `aud: "authenticated"` (not `role`); decode locally to avoid unreliable `auth.getUser()` network calls; deployed with `--no-verify-jwt` so Supabase infrastructure skips its own HS256 check
  - **SSE streaming**: Edge function streams `progress: { chars }` events every ~200 chars; app consumes via `XMLHttpRequest.onprogress` (React Native's fetch polyfill doesn't expose `response.body`)
  - **`app/create.tsx`**: State machine (idle → generating → preview → error); idle shows example prompts; generating shows rotating messages + live char counter ("2,450 chars written…"); preview shows app info bar + WebView + Install/Share buttons; type to refine regenerates same app ID (overwrites KV)
  - **`app/add.tsx`**: "Create with AI" card at top; prefill params (`prefillUrl`, `prefillName`, `prefillEmoji`, `prefillColor`) auto-trigger fetch + skip to details step
  - **`app/_layout.tsx`**: `create` registered as modal `Stack.Screen` (slide_from_bottom)
  - **`generated_apps` Supabase table**: `user_id`, `app_id`, `prompt`, `title`, `description`, `icon_emoji`, `icon_bg_color`, `html_size`, `hosted_url`, `conversation_history` (jsonb)
  - **Known limitation**: Complex apps (>8k tokens) may time out; simple apps (counter, todo, etc.) work reliably; streaming gives real-time feedback

### 🔜 Next Up
- [ ] **RUN MIGRATION**: `supabase/migrations/20260330_attribution.sql` in Supabase SQL Editor (adds attribution columns + history table + updated RPC)
- [ ] **RUN MIGRATION**: `supabase/migrations/20260414_generation_jobs.sql` — `generation_jobs` table + `html_content` on `generated_apps`
- [ ] **RUN MIGRATION**: `supabase/migrations/20260405_fix_updated_by_cast.sql` — updated_by cast fix
- [x] **UPDATE POWERSYNC SYNC RULES** (dashboard) — all columns confirmed present in deployed config
  - [ ] Add `generation_jobs` as a new synced table (SELECT all columns, filter by `user_id = auth.uid()`)
- [ ] **DEPLOY**: `wrangler deploy --config cottix-generator/wrangler.toml` (CF Queue worker)
- [ ] Deploy `deploy-html` edge function: `supabase functions deploy deploy-html`
- [ ] Real-device test: end-to-end generate + Edit with AI flow
- [ ] HTML/ZIP apps cross-device: show "Re-install required" overlay on tile when `bundle_html` is NULL after restore (currently opens with error)
- [ ] **AI generation error recovery**:
  - [ ] `create.tsx` preview WebView: inject JS error catcher → show "⚠ App had errors" banner with Regenerate + Report buttons
  - [ ] `app/[id].tsx`: `js_error` handler for `apps.cottix.co` apps → toast "JS error — Edit with AI?"
  - [ ] Report = PostHog `generation_error_reported` event with `{ app_id, error_message, prompt }`
- [ ] **Create with AI — optimizations**:
  - [ ] Show generated app history in Guide tab
  - [ ] Progressive complexity: start 4k tokens, retry 8k if too short
  - [ ] Gifting/sharing generated app links
- [ ] **AI generation error recovery** (Session 19):
  - [ ] `create.tsx` preview WebView: inject JS error catcher → show "⚠ App had errors" banner with Regenerate + Report buttons
  - [ ] `app/[id].tsx`: in `js_error` handler, if `source_url` includes `apps.cottix.co`, show toast "JS error — Edit with AI?" linking to `/create?mode=modify&conversationId=<app_id>`
  - [ ] Report = PostHog `generation_error_reported` event with `{ app_id, error_message, prompt }` — no new table needed
  - [ ] Prompt: already in `generation_jobs.prompt` and `generated_apps.prompt` — accessible for retry/debug
- [ ] Remove one-time queue flush from `PowerSyncProvider` after confirming clean CRUD queues on all devices
- [ ] Show explicit PowerSync connection error reason in Settings (not only Offline/Connected)
- [ ] Add clipboard copy button for invite codes (currently uses share sheet fallback)
- [ ] Strengthen join/create retry UX for intermittent RPC/network failures
- [ ] Discover screen: curated template list + AI-generated apps feed
- [ ] Settings: per-app permissions panel
- [ ] Edit Profile screen (display name + avatar emoji picker)
- [ ] RevenueCat integration for paid plan upgrades

### Known Issues / Decisions Pending
- `+html.tsx` and `+not-found.tsx` from default template remain (harmless)
- Tab icons use Unicode characters; may swap for SF Symbols via `@expo/vector-icons` later
- Supabase RPCs required (should be deployed):
  - `lookup_shared_instance(p_invite_code text)`
  - `add_instance_member(p_instance_id text, p_user_id uuid, p_role text)`
  - `get_own_shared_instance(p_app_id text, p_user_id uuid)`
  - `upsert_shared_app_data_versioned(...)` — versioned upsert used by `SupabaseConnector`
- `shared_app_data` Supabase constraints (must be in place):
  - UNIQUE constraint `shared_app_data_natural_key` on `(instance_id, app_id, key)` — exactly ONE constraint, no duplicates (duplicate constraints cause "more than one unique constraint" error on every upsert after the first insert)
  - Merge columns: `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count`
  - Attribution columns: `last_editor_user_id`, `last_editor_display_name` (added by `20260330_attribution.sql`)
- `shared_app_data_history` table: created by `20260330_attribution.sql`; RLS allows SELECT for instance members
- RLS on `shared_app_data`: INSERT/UPDATE for instance members using `auth.uid()` (uuid — no `::text` cast)
