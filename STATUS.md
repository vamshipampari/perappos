# Cottix — Status

**Last Updated**: 2026-03-24 (Session 11)

## Current Sprint: VaultAPI Secrets + Storage

### ✅ Session 11 — VaultAPI.secrets + VaultAPI.storage (2026-03-24)
- **`VaultAPI.secrets` — fully working ✅**
  - `secrets.set(name, value)` persists API keys to `expo-secure-store` globally (one save works across all mini-apps)
  - `secrets.fetch(name, opts)` reads the key natively, substitutes `{{secret}}` in headers, makes the HTTP call from the native layer, returns `{ status, body }`
  - Secret values never reach WebView JS — only the native bridge injects them at request time
  - SecureStore key: `vault_secret__global__${name}`
- **`VaultAPI.storage` — image upload not yet working ⚠️**
  - Implementation complete: `expo-image-picker` opens native Photos picker, reads as base64 via `expo-file-system`, converts to `Uint8Array`, uploads to Supabase Storage `user-media` bucket
  - Upload step returning error — likely Supabase `user-media` bucket RLS policy not yet configured
  - `storage.getUrl(uri)` → signed URL path implemented but not tested end-to-end yet
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
- [ ] **Fix `VaultAPI.storage` image upload** — add RLS policies to Supabase `user-media` bucket:
  ```sql
  CREATE POLICY "auth users upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'user-media');
  CREATE POLICY "auth users read"   ON storage.objects FOR SELECT TO authenticated USING  (bucket_id = 'user-media');
  ```
  Then re-test `storage_upload` → `storage_get_url` end-to-end
- [ ] **UPDATE POWERSYNC SYNC RULES**: Add `is_frozen`, `frozen_at`, `frozen_reason` to `shared_instances` SELECT projection in PowerSync dashboard (required for freeze to work on client)
- [ ] Complete `npx expo prebuild --clean` (downloading NDK, ~5-15 min)
- [ ] Run `npx expo run:android` to test build with new Cottix app name
- [ ] **Create with AI — optimizations**:
  - [ ] Custom domain `apps.cottix.co` → point DNS to Cloudflare Worker route
  - [ ] Improve prompt for complex multi-screen apps
  - [ ] Show generated app history in Discover screen
  - [ ] Progressive complexity: start with 4k tokens, retry with 8k if first attempt is too short
  - [ ] Gifting/sharing generated app links
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
- RLS on `shared_app_data`: INSERT/UPDATE for instance members using `auth.uid()` (uuid — no `::text` cast)
