# Cottix — Learnings & Gotchas

**Last Updated**: 2026-03-19
**Session Count**: 9

## Architecture Insights

- PowerSync maintains its own SQLite DB (`powersync.db`) separate from expo-sqlite — they are two different databases
- `app_data.id` in Supabase must be TEXT, not UUID, because PowerSync uses `${appId}/${key}` as a composite row ID
- Shared collaboration uses invite codes (6-char uppercase) stored in `shared_instances`, looked up via Supabase RPCs (not direct table queries) to bypass RLS
- The WebView bridge uses a request/response pattern with unique IDs for async operations, and fire-and-forget for localStorage writes

## Common Mistakes & How to Avoid Them

1. **Mistake**: Using compound-string IDs for `shared_app_data` in Supabase
   - **Cause**: PowerSync generates compound IDs like `instance/app/key` but Supabase expects UUIDs
   - **Fix**: Strip PowerSync compound ID and upsert by natural key `(instance_id, app_id, key)`
   - **Prevention**: Always use natural-key upsert with `onConflict` for `shared_app_data`

2. **Mistake**: Querying shared tables directly instead of using RPCs
   - **Cause**: Supabase RLS blocks direct queries from non-owner users
   - **Fix**: Use RPCs like `lookup_shared_instance` and `add_instance_member`
   - **Prevention**: Always check if an RPC exists before writing direct table queries for shared data

3. **Mistake**: OTP modal getting stuck in "Verifying..." state
   - **Cause**: Auth state listener not detecting already-active session
   - **Fix**: Added `getSession()` check + `onAuthStateChange` listener to auto-dismiss
   - **Prevention**: Always check session state when showing auth modals

4. **Mistake**: Stuck CRUD queue entries in PowerSync
   - **Cause**: Invalid compound-string IDs from before the natural-key migration
   - **Fix**: One-time queue flush on connect (in `PowerSyncProvider`)
   - **Note**: Remove the queue flush code after first successful run on all devices

## Dependencies & Their Quirks

- **PowerSync**: CRUD queue can get stuck if upload fails repeatedly — monitor with debug button in Settings
- **NativeWind v4**: Requires specific babel/metro/tailwind config (preset + wrapper), see `TECHNICAL.md` NativeWind section
- **expo-sqlite**: WAL mode is default; `onInit` callback in `SQLiteProvider` is the right place for schema migrations
- **Supabase OTP**: Email template must include `{{ .Token }}` for the 6-digit code to appear
- **react-native-webview**: `allowUniversalAccessFromFileURLs` must be true for ES module imports to work across files loaded via `file://`

## Merge Engine Learnings

- The 3-way merge in `bridge-merge-handler.ts` uses these strategies in priority order: noop → idempotent_skip → init_blocked → fast_path → array_merge → object_merge → lww
- Array merge requires stable `_id` fields on array items to work correctly
- Object merge does field-level comparison; additions from both sides are kept
- `init_blocked` prevents apps from overwriting fresh shared state during startup initialization
- Merge telemetry buffer exists for debugging strategy/conflict counts

## Deployment Gotchas

- EAS builds require iOS/Android specific profiles in `eas.json`
- Supabase schema must match PowerSync schema exactly — missing merge columns will break shared writes
- PowerSync sync rules must include all merge metadata columns in `shared_app_data` projection
- Supabase RLS must allow INSERT/UPDATE for instance members on `shared_app_data`

## Code Review Findings (2026-03-12)

From code-reviewer agent on `bridge-merge-handler.ts`:
- **High**: Noop guard hash comparison may be logically inverted (line ~137) — needs verification
- **High**: `resolveRowId` has a race condition (SELECT + UUID gen not atomic)
- **Medium**: `JSON.parse` in merge path has no targeted try/catch — malformed JSON falls through to generic error
- **Medium**: No size/depth limit on parsed JSON before merge
- **Low**: Debug `console.log` statements in production paths
- **Low**: Possibly unused `deepEqual` import from merge-utils
- **Low**: Telemetry buffer eviction is not bounded safely

5. **Mistake**: Using `(auth.uid())::text` in RLS policy on a table where `user_id` is `uuid`
   - **Cause**: `auth.uid()` returns `uuid`; casting to `::text` makes `IN (SELECT user_id ...)` fail with `operator does not exist: text = uuid`
   - **Fix**: Use `auth.uid()` directly without cast; both sides are `uuid`
   - **Prevention**: Never add `::text` cast to `auth.uid()` in RLS unless the column is explicitly TEXT

6. **Mistake**: Querying PowerSync local immediately after writing to Supabase (timing gap)
   - **Cause**: `createSharedInstanceForApp` inserts `shared_instances` into Supabase but PowerSync hasn't synced the row back to local yet. Screen queries PowerSync local → null → "Group not found"
   - **Fix**: After the Supabase insert succeeds, also write the same row to PowerSync local via `syncDb.execute(INSERT OR REPLACE INTO shared_instances ...)`. PowerSync will reconcile on the next sync cycle.
   - **Prevention**: Whenever you create a row in Supabase and immediately navigate to a screen that reads from PowerSync local, pre-seed PowerSync local.

7. **Mistake**: Supabase upsert fails silently when `onConflict` references a non-existent constraint
   - **Cause**: `SupabaseConnector.uploadData` uses `onConflict: "instance_id,app_id,key"` but the UNIQUE constraint was never added to the table. PostgreSQL returns "there is no unique or exclusion constraint matching the ON CONFLICT specification"
   - **Fix**: Add `ALTER TABLE public.shared_app_data ADD CONSTRAINT shared_app_data_natural_key UNIQUE (instance_id, app_id, key)` in Supabase SQL editor
   - **Prevention**: Every `upsert({ onConflict: "col1,col2" })` requires a corresponding UNIQUE or EXCLUSION constraint to exist in Postgres. Create the constraint in Supabase migration SQL when defining the schema.

8. **CRITICAL ARCHITECTURE ISSUE — WebView shared_app_data read-back gap** (discovered 2026-03-13, FIXED 2026-03-16)
   - **Symptom**: Data written to `shared_app_data` after the shared instance is created is NOT shown in the WebView. Other devices' writes never appear.
   - **Root cause**: `vaultShimSync.ts` embeds ALL data once at page load into JavaScript constants (`_cache`, `_baseState`, `_keyVersions`). This is static — the WebView never re-queries the database after initialization. Writes from THIS device update `_cache` via the bridge's `newValue` acknowledgement. But there is NO mechanism to push data from PowerSync sync (other devices' writes) into the WebView's live `_cache`.
   - **Note**: Data loss (A2 missing from Supabase) turned out to be a separate bug — see entry #9.
   - **Fix**: Added `window._VaultSyncPush(updates)` receiver in `vaultShimSync.ts` (updates `_cache`/`_baseState`/`_keyVersions` + fires `StorageEvent` + `vaultSyncUpdate` CustomEvent). In `app/app/[id].tsx`, a PowerSync `db.watch()` watcher feeds remote changes through a 300ms debounce → `injectJavaScript(_VaultSyncPush(...))`. Own-write echo prevention via `ownWriteIds` ref. Pre-load buffering via `pendingRemoteUpdates` ref flushed in `onLoadEnd`.
   - **Current status**: FIXED — remote writes appear in the live WebView within ~1–3 seconds without page reload

9. **Mistake**: Migration uses wrong row ID format → duplicate rows → non-deterministic reads + stale shim preload → data loss (discovered 2026-03-13, FIXED)
   - **Cause**: `collaborationService.ts` migration loop used `Crypto.randomUUID()` as the PowerSync row ID for migrated `shared_app_data` rows. But `bridge-merge-handler.ts` `writeRow()` uses `makeRowId()` = `` `${instanceId}/${appId}/${key}` ``. This created TWO rows in PowerSync for the same `(instance_id, app_id, key)` natural key: one with a UUID id (from migration, version=1) and one with the compound id (from the first user write, version=2). `readCurrentRow()` used `LIMIT 1` without `ORDER BY`, so it non-deterministically picked either row. When A3 happened to read the UUID row (version=1) as base, it computed `newVersion=2` and wrote to the compound-id row, silently overwriting A2.
   - **Fix in `collaborationService.ts`**: Changed `Crypto.randomUUID()` to `` `${instanceId}/${app.app_id}/${row.key}` `` so migrated rows use the same compound key format as `writeRow()`. `INSERT OR REPLACE` then correctly updates the same row on subsequent writes.
   - **Fix in `bridge-merge-handler.ts`**: Added `ORDER BY version DESC` before `LIMIT 1` in `readCurrentRow()` as a defence-in-depth measure — even if duplicate rows exist (from previous bad migrations), we always pick the highest-version one.
   - **Fix in `app/app/[id].tsx` `loadShimPayload`**: Added `ORDER BY version DESC` to the `shared_app_data` preload query AND a `if (row.key in preloadedData) continue` guard in the loop. Without this, the shim could be preloaded with the stale UUID row (version=1) instead of the latest compound-key row — causing every subsequent `baseVersion` sent by the shim to be wrong, and `readCurrentRow()` to then compute `newVersion = stale_version + 1` on each write (effectively resetting version to 1+1=2 every time instead of incrementing).
   - **Prevention**: Any direct PowerSync `INSERT` into a table that is also written by a handler must use the SAME row ID format as that handler. For `shared_app_data`, that is `` `${instanceId}/${appId}/${key}` ``. Also, any preload query over a PowerSync table that may have duplicate rows for the same logical key MUST include `ORDER BY` + deduplication guard.

## Build & Environment Setup

### Android SDK Configuration (2026-03-19)
- **Problem**: `npx expo run:android` fails with "SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path"
- **Solution**: Add `ANDROID_HOME` export to `~/.zshrc` + add tools/platform-tools to `PATH`:
  ```bash
  export ANDROID_HOME="/Users/vamshipampari/Library/Android/sdk"
  export PATH="$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH"
  ```
- **Then**: Run `source ~/.zshrc` to reload shell and test with `echo $ANDROID_HOME`
- **First build**: `npx expo prebuild --clean` downloads Android NDK (~5-15 min depending on internet). This is one-time only.
- **Prevention**: Always set ANDROID_HOME in shell profile when setting up dev environment for React Native projects

## Dependencies & Their Quirks

- **PowerSync**: CRUD queue can get stuck if upload fails repeatedly — monitor with debug button in Settings. The pending CRUD count is shown in the debug panel as of 2026-03-13.
- **NativeWind v4**: Requires specific babel/metro/tailwind config (preset + wrapper), see `TECHNICAL.md` NativeWind section
- **expo-sqlite**: WAL mode is default; `onInit` callback in `SQLiteProvider` is the right place for schema migrations
- **Supabase OTP**: Email template must include `{{ .Token }}` for the 6-digit code to appear
- **react-native-webview**: `allowUniversalAccessFromFileURLs` must be true for ES module imports to work across files loaded via `file://`

## Merge Engine Learnings

- The 3-way merge in `bridge-merge-handler.ts` uses these strategies in priority order: noop → idempotent_skip → init_blocked → fast_path → array_merge → object_merge → lww
- Array merge requires stable `_id` fields on array items to work correctly
- Object merge does field-level comparison; additions from both sides are kept
- `init_blocked` prevents apps from overwriting fresh shared state during startup initialization — but may also block legitimate early user writes if `pageAge < 3000ms` and `hadInteraction = false`
- The `hadInteraction` flag in the shim is set to `true` only on `touchstart` or `keydown` events — if the app writes via code (not user gesture), `hadInteraction` stays false even for legitimate writes
- Merge telemetry buffer exists for debugging strategy/conflict counts

## Deployment Gotchas

- EAS builds require iOS/Android specific profiles in `eas.json`
- Supabase schema must match PowerSync schema exactly — missing merge columns will break shared writes
- Supabase `shared_app_data` needs `UNIQUE (instance_id, app_id, key)` constraint for `onConflict` upsert to work
- PowerSync sync rules must include all merge metadata columns in `shared_app_data` projection
- Supabase RLS must allow INSERT/UPDATE for instance members on `shared_app_data` — use `auth.uid()` (uuid), not `(auth.uid())::text`
- Run Expo from the main project directory `/Users/vamshipampari/Documents/Workspace/Perappos/perappos` — worktrees have no `node_modules` and will crash Metro

## Code Review Findings (2026-03-12)

From code-reviewer agent on `bridge-merge-handler.ts`:
- **High**: Noop guard hash comparison may be logically inverted (line ~137) — needs verification
- **High**: `resolveRowId` has a race condition (SELECT + UUID gen not atomic)
- **Medium**: `JSON.parse` in merge path has no targeted try/catch — malformed JSON falls through to generic error (FIXED 2026-03-12)
- **Medium**: No size/depth limit on parsed JSON before merge
- **Low**: Debug `console.log` statements in production paths (FIXED 2026-03-12)
- **Low**: Possibly unused `deepEqual` import from merge-utils
- **Low**: Telemetry buffer eviction is not bounded safely

## Session 3 Work (2026-03-13) — What Was Fixed

1. **Supabase unique constraint**: Added `UNIQUE (instance_id, app_id, key)` to fix stuck CRUD queue (user must run SQL in Supabase dashboard)
2. **RLS policy**: Corrected `auth.uid()` usage without `::text` cast
3. **"Group not found" bug**: `collaborationService.ts` now pre-seeds PowerSync local `shared_instances` and `instance_members` after create/join so Manage Group screen works immediately
4. **Debug panel**: Now shows pending CRUD count so user can diagnose stuck queue
5. **SupabaseConnector.ts**: Fixed TS type errors in DELETE path for `shared_app_data`
6. **Data loss (A2 missing) + version always 1**: Fixed row ID mismatch in `collaborationService.ts` migration — changed `Crypto.randomUUID()` to `` `${instanceId}/${app.app_id}/${row.key}` `` so migrated rows share the same compound key as `writeRow()`. Added `ORDER BY version DESC` to `readCurrentRow()` in `bridge-merge-handler.ts` as defence-in-depth. Fixed `loadShimPayload` in `app/app/[id].tsx` to add `ORDER BY version DESC` + deduplication guard so the shim is always preloaded with the highest-version row per key (not a stale UUID migration row).

10. **CRITICAL DEPLOYMENT ISSUE — all Session-3 worktree fixes were NOT in the main project** (discovered 2026-03-13, FIXED)
    - **Cause**: All Session-3 code fixes were only in the worktree directory (`/.claude/worktrees/eloquent-hodgkin`), NOT in the main project that Expo/Metro actually runs from (`/Users/vamshipampari/.../perappos`). The iOS sim was running the OLD buggy code.
    - **Fix**: Copied all 6 fixed files from worktree to main project: `services/collaborationService.ts`, `app/app/[id].tsx`, `app/join-shared-app.tsx`, `services/sync/SupabaseConnector.ts`, `services/sync/bridge-merge-handler.ts`, `app/(tabs)/settings.tsx`.
    - **Prevention**: When fixes are made in a worktree, ALWAYS copy them to the main project immediately. The worktree has no `node_modules` and can't run Metro — it is only a code-editing environment. The sim always runs from the main project directory.

11. **Manage Group "Group not found" — Supabase fallback added** (2026-03-13, FIXED)
    - **Cause**: `app/shared-instance/[instanceId].tsx` only queried PowerSync local for `shared_instances`. If PowerSync hadn't synced yet (or RLS blocks sync), the row wasn't there.
    - **Fix**: Added 3-step load strategy: (1) try PowerSync local, (2) retry up to 3 s, (3) Supabase direct query fallback + RPC owner fallback. Also synthesises a member row for the current user if instance found but no members in local DB. Pre-seeds PowerSync local when fallback succeeds.
    - **Prevention**: Any screen that reads from PowerSync and is navigated to immediately after a Supabase write must have either pre-seeding OR a Supabase fallback.

## REQUIRED Supabase SQL — MUST RUN IN SUPABASE DASHBOARD

These changes cannot be made in code. Run them in Supabase → SQL Editor:

```sql
-- 1. UNIQUE constraint for natural-key upsert (required for SupabaseConnector onConflict)
--    PostgreSQL doesn't support IF NOT EXISTS for ADD CONSTRAINT — use DO block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'shared_app_data_natural_key'
      AND table_name = 'shared_app_data'
  ) THEN
    ALTER TABLE public.shared_app_data
      ADD CONSTRAINT shared_app_data_natural_key UNIQUE (instance_id, app_id, key);
  END IF;
END $$;

-- 2. Fix RLS on shared_app_data — allow members to INSERT/UPDATE
-- (Remove any existing policy that uses ::text cast)
DROP POLICY IF EXISTS "Members can write shared_app_data" ON public.shared_app_data;
CREATE POLICY "Members can write shared_app_data"
ON public.shared_app_data FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM instance_members
    WHERE instance_members.instance_id = shared_app_data.instance_id
      AND instance_members.user_id = auth.uid()   -- auth.uid() is uuid, no ::text cast
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM instance_members
    WHERE instance_members.instance_id = shared_app_data.instance_id
      AND instance_members.user_id = auth.uid()
  )
);

-- 3. Fix RLS on shared_instances — allow members to SELECT their instances
-- (needed for the Manage Group Supabase fallback + PowerSync sync)
DROP POLICY IF EXISTS "Members can read shared_instances" ON public.shared_instances;
CREATE POLICY "Members can read shared_instances"
ON public.shared_instances FOR SELECT
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM instance_members
    WHERE instance_members.instance_id = shared_instances.instance_id
      AND instance_members.user_id = auth.uid()
  )
);
```

**If data keeps clearing on app reopen**: The UNIQUE constraint (#1) and RLS fix (#2) are the most critical. Without the UNIQUE constraint, `SupabaseConnector` uploads fail silently, PowerSync retries, then eventually overwrites local data with the empty Supabase state.

12. **CRITICAL DB BUG — duplicate UNIQUE constraints on shared_app_data caused stuck CRUD queue** (discovered 2026-03-13, FIXED)
    - **Symptom**: Version always stays at 1 in Supabase; writes after the first insert never propagate.
    - **Root cause**: Three UNIQUE constraints existed on `(instance_id, app_id, key)`: `shared_app_data_instance_app_key_unique`, `shared_app_data_instance_id_app_id_key_key`, `shared_app_data_natural_key`. PostgreSQL throws "there is more than one unique constraint matching the ON CONFLICT specification" when an upsert hits a conflict (every write after initial insert). CRUD queue stuck permanently on version=2.
    - **Fix**: Dropped the two duplicate constraints. Only `shared_app_data_natural_key` remains.
    - **Prevention**: Never add multiple UNIQUE constraints on identical column sets. Verify with `SELECT conname FROM pg_constraint WHERE conrelid = 'table'::regclass AND contype = 'u'` before adding.

13. **CRITICAL CODE BUG — WebView sends `ls_set` after instance creation, bridge drops writes** (discovered 2026-03-13, FIXED)
    - **Symptom**: All writes made right after creating the shared instance (before "Open App" was tapped) were silently lost.
    - **Root cause**: `setApp(updatedApp)` updates the manifest `instance_id` immediately. The WebView is still running the OLD local shim (sends `ls_set`). `vaultBridge.ts:147` drops `ls_set` for shared apps. Everything between create and manual reload was dropped.
    - **Fix**: Added `setTimeout(() => refreshWebView(), 0)` right after `rebuildShimForApp` in `handleCollaborate`. `setTimeout(0)` lets React commit the new `shimJS` prop before the reload fires. Replaced "Open App" button with "Done".
    - **Prevention**: Whenever `setApp` changes `instance_id`, reload the WebView immediately. Never rely on the user to manually trigger it.

## Session 4 Work (2026-03-13) — What Was Fixed (Shared Sync Reliability)

Context: User confirmed "it worked day before yesterday before commit `7cf2d8c`". Four compounding root causes were identified and fixed via first-principles analysis + console logs.

### Root Causes Identified

**Bug A — `ls_set` silently dropped for shared apps (regression in `7cf2d8c`)**
- `vaultBridge.ts` was dropping `ls_set` messages for shared apps instead of routing through `handleSharedWrite`. Any write made before the WebView was reloaded with the sync shim was silently lost.
- Fixed: `ls_set` now routes through `handleSharedWrite` (same as `ls_set_sync`).

**Bug B — PowerSync post-upload local clear → `readCurrentRow` returns null → version=1 → versioned RPC rejects**
- After `SupabaseConnector.uploadData()` calls `transaction.complete()`, PowerSync removes the local write entry from `shared_app_data`. There is a window (until the sync service re-delivers the confirmed row) where the table is empty.
- `readCurrentRow` returned null → `Math.max(0, baseVersion=0) + 1 = 1` → Supabase already had version=3 → `3 < 1 = false` → REJECTED silently.
- Fixed: Added `_versionCache = new Map<string, number>()` module-level in `bridge-merge-handler.ts`. After every successful `writeRow()`, cache is updated with `newVersion`. When `readCurrentRow` returns null, `Math.max(dbVersion ?? 0, cachedVersion, baseVersion) + 1` uses the cache to compute a version higher than anything Supabase has.

**Bug C — `loadShimPayload` useCallback re-creates on every PowerSync sync → initial load `useEffect` re-fires → WebView reloads**
- `loadShimPayload` had `[syncDb]` in its `useCallback` deps. PowerSync internally creates a new `syncDb` reference on each sync cycle → new `loadShimPayload` ref → the initial load `useEffect` (which had `loadShimPayload` in its deps) re-fired after every successful upload → `setShimJS` called with new value → `injectedJavaScriptBeforeContentLoaded` prop changed → WebView reloaded.
- Fixed: `syncDbRef = useRef(syncDb)` + `syncDbRef.current = syncDb` (updated inline in render). `loadShimPayload` uses `syncDbRef.current` with empty deps `[]` → stable reference → useEffect never re-fires again.

**Bug D — `personal-fallback` after reload → shim initializes with version=0 for all keys → all subsequent writes rejected**
- When the WebView reloaded (from Bug C) and `shared_app_data` was locally empty (from Bug B), `loadShimPayload` fell back to querying `app_data` (single-user data, version=0). Shim initialised with `_keyVersions = { all: 0 }`. All `ls_set_sync` messages sent `baseVersion=0` → `newVersion = max(0, 0, 0)+1 = 1` → Supabase had version=4+ → REJECTED.
- Fixed: When `shared_app_data` is locally empty for a shared app, query Supabase directly (`supabase.from('shared_app_data').select(...)`) before falling back to `app_data`. This gives the shim correct data AND correct `_keyVersions`. Only falls through to `personal-fallback` if Supabase also returns nothing (brand new instance).

### Key Insight: The Cascade
These four bugs compounded into a single symptom: "only the first write after sharing ever worked". Once the first write succeeded (BB at version=3), PowerSync cleared local rows (Bug B) → useEffect re-fired (Bug C) → personal-fallback loaded (Bug D) → all subsequent writes rejected (Bug B again). The version cache (Fix B) and stable `loadShimPayload` (Fix C) break the cascade entirely.

### What Remains After Session 4

**Not yet fixed — WebView live sync push (other devices' data)**
- Data from OTHER devices' writes (that arrive via PowerSync sync) never appears in the live WebView unless the user closes and reopens the app.
- Root cause: `vaultShimSync.ts` embeds all `shared_app_data` once at page load into static JS constants (`_cache`, `_baseState`, `_keyVersions`). There is no mechanism to push PowerSync sync events into the running WebView.
- Required fix: Watch PowerSync `shared_app_data` for changes (`usePowerSyncWatchedQuery` or equivalent), then inject JS into the live WebView: `webViewRef.current?.injectJavaScript("window._VaultSyncUpdate({key, value, version})")`.
- This is the #1 priority for the next session.

14. **ARCHITECTURE PATTERN — PowerSync post-upload local clear is expected, not a bug**
    - **Behaviour**: After `SupabaseConnector.uploadData()` calls `transaction.complete()`, PowerSync removes the optimistic local write from the sync tables. The row returns once the sync service delivers the confirmed Supabase row. This gap can be 0ms–several seconds.
    - **Impact on queries**: Any `SELECT` on a PowerSync table in this window returns 0 rows for recently-written data, even though the data is safely in Supabase.
    - **Impact on code**: Any logic that reads-then-writes (like `readCurrentRow` in `bridge-merge-handler.ts`) must account for this gap. Never assume a row you just wrote is still locally present.
    - **Fix pattern**: Use an in-memory cache (see `_versionCache` in `bridge-merge-handler.ts`) for any write metadata that must survive this gap. Also add a Supabase direct-query fallback in preload paths (`loadShimPayload`) for when local is empty but remote has data.

15. **ARCHITECTURE PATTERN — `useCallback` deps leak PowerSync reference changes into UI effects**
    - **Behaviour**: `usePowerSync()` returns a `db` object that may get a new JavaScript reference on each sync cycle/state change, even if the underlying connection is the same.
    - **Impact**: Any `useCallback` or `useMemo` that captures this `db` in its deps array will get a new function reference on every sync. If that function is itself in a `useEffect` deps array, the effect re-fires on every sync.
    - **Pattern**: `const syncDbRef = useRef(syncDb); syncDbRef.current = syncDb;` — update the ref inline in render (no `useEffect` needed). Pass the ref to any `useCallback` with empty `[]` deps. The callback always reads the latest `syncDb` through `syncDbRef.current` without the callback itself needing to be recreated.
    - **When to apply**: Any hook or callback that (a) is called in response to user actions (not in a render cycle) and (b) would cause visual side-effects if its deps change. Specifically: `loadShimPayload`, `rebuildShimForApp`, any database-reading callback that triggers `setState`.

## Session 5 Work (2026-03-16) — Mandatory Auth Gate / Onboarding

**Goal**: Enforce splash → login → home flow. Users could previously bypass auth entirely.

### What Was Done
- **`app/_layout.tsx`**: Added `sessionChecked` + `hasSession` states. `supabase.auth.getSession()` runs on mount; `onAuthStateChange` subscription handles sign-in/sign-out reactively. Splash now gated on `isDeepLinkReady && sessionChecked`. Post-ready effect redirects to `/login` if no session. `SIGNED_OUT` event triggers `router.replace('/login')` automatically.
- **`app/login.tsx`**: New full-screen OTP login screen (no close button, `gestureEnabled: false`). On OTP success: `router.replace('/(tabs)')`. Root layout handles the "already logged in" case — login screen is never shown to returning users.
- **`app/auth.tsx`**: Untouched. Still the dismissable modal for Settings → Sign In.

### Pattern Learned — Auth Gate in expo-router root layout

**Don't** gate navigation inside each screen. **Do** gate it in the root layout:
```typescript
// 1. Check session on mount
supabase.auth.getSession().then(({ data: { session } }) => {
  setHasSession(!!session);
  setSessionChecked(true);
});

// 2. Subscribe for reactive changes
supabase.auth.onAuthStateChange((event, session) => {
  setHasSession(!!session);
  if (event === 'SIGNED_OUT') router.replace('/login');
});

// 3. Gate early return (keeps native splash visible)
if (!isDeepLinkReady || !sessionChecked) return null;

// 4. Post-ready redirect effect
useEffect(() => {
  if (!isDeepLinkReady || !sessionChecked) return;
  if (!hasSession) router.replace('/login');
}, [isDeepLinkReady, sessionChecked, hasSession, router]);
```

### Key Design Decisions
- **Two auth screens** are intentional: `login.tsx` (gate, mandatory) vs `auth.tsx` (modal, optional re-auth from Settings). Do not merge them — they serve different flows.
- **`getSession()` is called outside `SQLiteProvider`** — it uses the Supabase client's own SQLite storage (separate from the app's main `cottix.db`), so it works before `SQLiteProvider` renders.
- **`gestureEnabled: false` + `animation: 'fade'`** on the login Stack.Screen prevents swipe-back from exposing the home screen before auth.
- **Sign-out redirect** is handled centrally in root layout via `onAuthStateChange`, not in each individual screen's sign-out handler.

16. **PATTERN — Two auth screens for different auth contexts**
    - `app/login.tsx`: Mandatory entry-point gate. Full-screen. No back gesture. Routes to `/(tabs)` on success.
    - `app/auth.tsx`: Optional re-auth modal (e.g. account section in Settings). Has a Close button. Uses `router.back()` on success.
    - **Prevention**: Never reuse the same auth screen component for both contexts. Conflating them leads to either (a) the gate being dismissable or (b) the modal having no escape.

16. **CRITICAL — PowerSync sync rules: never use table aliases**
    - **Symptom**: `shared_app_data`, `instance_members`, `shared_instances` all empty in local PowerSync DB despite data existing in Supabase. Rows land in `ps_untyped` instead of proper tables.
    - **Root cause (two compounding bugs)**:
      1. **Column name prefix**: `SELECT im.id, im.instance_id FROM instance_members im` produces column names `im.id`, `im.instance_id` instead of `id`, `instance_id`. PowerSync schema expects bare column names → schema mismatch → `ps_untyped`.
      2. **Table alias as row type**: `FROM instance_members im` causes PowerSync to use `im` as the row type instead of `instance_members`. Even after fixing column names with `AS` aliases, the row type `im` doesn't match any local schema table → still goes to `ps_untyped`.
    - **Fix**: Remove ALL table aliases from PowerSync sync rules. Use bare table names everywhere. For JOINs, use the full table name: `shared_instances.instance_id = instance_members.instance_id`.
    - **Diagnostic**: Query `SELECT id, type, data FROM ps_untyped LIMIT 10` in the PowerSync local DB. If rows appear with unexpected `type` values (like `im`, `sad`, `si`), the sync rules have alias problems.
    - **Prevention**: Never use `FROM table_name alias` in PowerSync sync rules. Always use the full table name.

17. **PATTERN — `window.name` reload for WebView live sync re-render (FINAL APPROACH)**
    - **Problem**: Most AI-generated/vibe-coded React apps use `useState(() => localStorage.getItem('key'))` which only reads on mount. No event-based approach (StorageEvent, visibilitychange, focus/blur) can trigger a re-read. Users must navigate to a different page and back to see remote updates.
    - **Solution**: After `_VaultSyncPush` updates `_cache`, save state to `window.name` (survives same-origin `location.reload()`) and call `location.reload()` with an 800ms debounce. The shim's IIFE checks `window.name` at init — if it finds a `__vault` marker, it uses the saved cache/versions instead of the stale preloaded data. The app mounts fresh and reads correct values from `localStorage.getItem()` → `_cache`.
    - **Key detail**: `window.name` is a string property that persists across same-origin navigations and reloads within the same WebView context. We clear it immediately after reading to avoid stale reads on subsequent reloads.
    - **Trade-off**: The app navigates to its landing/home screen on reload (in-app navigation state is lost). Route restoration was attempted (intercepting `history.pushState`/`replaceState`/`popstate`/`hashchange`) but doesn't work for local bundle apps loaded via `{ html: bundleHtml }` where the URL context is `about:blank` and many apps use `MemoryRouter`. The 800ms debounce batches rapid multi-key updates into a single reload.
    - **Why this is the right trade-off**: `location.reload()` is the ONLY approach that works across ALL frameworks/architectures (React, Vue, Svelte, vanilla JS). Event-based approaches only work for specific frameworks (React Query, SWR) and fail for the common `useState` initializer pattern that most vibe-coded apps use.

18. **FAILED APPROACHES — WebView live re-render without reload**
    - **StorageEvent dispatch**: `window.dispatchEvent(new StorageEvent('storage', {...}))` — React apps don't re-render from StorageEvent because `useState` initializers don't re-read.
    - **visibilitychange on document only**: React Query / TanStack Query / SWR listen on `window`, not `document`. The native `visibilitychange` event fires on `document` and does NOT bubble to `window`. Must dispatch on BOTH targets.
    - **visibilitychange on both document + window**: Even when dispatched correctly (hidden→visible cycle with `Object.defineProperty` to fake `document.hidden`/`document.visibilityState`), this only works for apps using React Query's `refetchOnWindowFocus: true`. Most vibe-coded apps use raw `useState(() => localStorage.getItem(...))` with no refetch mechanism.
    - **focus/blur cycle on window**: SWR refetches on `window` focus. Same limitation — only works for SWR apps, not raw `useState`.
    - **Route restoration after reload** (intercepting `history.pushState`/`replaceState`/`popstate`/`hashchange`, saving to `window.name`, restoring via `history.replaceState` + `PopStateEvent`): Doesn't work for local bundle apps loaded via `{ html: bundleHtml }` — URL context is `about:blank`, apps may use `MemoryRouter`, and initialization logic often redirects to `/` regardless.
    - **Conclusion**: No event-based approach can universally force React `useState` initializers to re-read. The only universal mechanism is full component remount via `location.reload()`.

## Session 6 Work (2026-03-17) — Cross-Device Sync Fix + Live Re-render

### What Was Done
1. **PowerSync sync rules alias bug**: Discovered and documented that table aliases in sync rules cause rows to land in `ps_untyped` instead of proper tables (see entry #16).
2. **WebView live re-render**: Tried 3 approaches for showing remote updates in-place:
   - Attempt 1: `location.reload()` + `window.name` — data works instantly (~1s), but app goes to landing screen ✅ (kept)
   - Attempt 2: Route restoration across reload — failed (local bundle `about:blank` context, `MemoryRouter`)
   - Attempt 3: Event-based (visibilitychange + focus/blur on window) — doesn't trigger re-render for most apps
   - **Final decision**: Reverted to attempt 1. `location.reload()` is the only universal approach that works across all frameworks. Landing screen trade-off is acceptable.
3. **Diagnostic log cleanup**: Removed verbose PowerSync debugging logs from `app/app/[id].tsx`.

### Key Insight
The fundamental limitation is that `useState(() => localStorage.getItem('key'))` — the most common pattern in vibe-coded apps — only reads on component mount. No external event can force React to re-run `useState` initializers. The only way to re-run them is to unmount+remount (reload or navigate away+back). This is not a bug to fix but a React architecture constraint to work around.

## Session 7 Work (2026-03-17) — Auth Overhaul + User-Change Guard

### What Was Done

1. **Auth switched to email+password** (`app/login.tsx`, `app/auth.tsx`):
   - Signup: `supabase.auth.signUp({ email, password })` → OTP email confirmation step (`type: 'signup'`)
   - Login: `supabase.auth.signInWithPassword()` — no OTP step
   - "Email not confirmed" error on login → auto-resend OTP and show verification screen
   - Toggle between Sign In / Create Account modes on the same screen
   - Resend uses `supabase.auth.resend({ type: 'signup', email })` — 60s cooldown

2. **User-change guard** (`hooks/useUserChangeGuard.ts`, `components/UserChangeWarningModal.tsx`, `app/_layout.tsx`):
   - `lastUserId` stored in `expo-sqlite/kv-store` (same storage as Supabase auth session)
   - `checkUserChange()` skips modal when: first login (`lastUserId = null`), same user, or no local apps
   - Wipe sequence: `disconnectAndClear()` → DELETE all SQLite tables → delete bundle cache dir → persist new `lastUserId` → reconnect PowerSync
   - `powerSyncDb` and `connector` exported from `PowerSyncProvider.tsx` to allow direct access outside React context

3. **`expo-file-system` legacy import** (gotcha — see entry #19 below)

19. **Gotcha — `expo-file-system` `deleteAsync` deprecation warning**
    - **Symptom**: `Error: Method deleteAsync imported from "expo-file-system" is deprecated.`
    - **Cause**: Expo SDK 55+ moved the legacy filesystem API to a separate entry point
    - **Fix**: `import * as FileSystem from 'expo-file-system/legacy'` instead of `'expo-file-system'`
    - **Prevention**: In Expo SDK 55+, always import from `expo-file-system/legacy` for `deleteAsync`, `getInfoAsync`, `downloadAsync`, `copyAsync`, `moveAsync`, `readAsStringAsync`, `writeAsStringAsync`. The new API uses `File` and `Directory` class instances.

20. **PATTERN — User-change guard: `AuthChangeGuard` must sit inside `<SQLiteProvider>` + `<PowerSyncProvider>`**
    - **Reason**: The guard hook needs `useSQLiteContext()` (to query `apps` table) and direct access to `powerSyncDb` (to disconnect + reconnect). Both are unavailable outside their providers.
    - **Pattern**: Create a child component (`AuthChangeGuard`) that renders inside the provider tree. Wire `supabase.auth.onAuthStateChange` inside this component — NOT in the outer `RootLayout`. The outer layout handles navigation redirects; the inner guard handles data wipe gating.
    - **Key**: `SIGNED_IN` and `TOKEN_REFRESHED` events both need to be handled — `INITIAL_SESSION` fires on mount when a session already exists and is caught by the `getSession()` call on mount.

21. **PATTERN — `expo-sqlite/kv-store` `Storage` is async and safe for cross-feature state**
    - Supabase auth already uses `Storage` from `expo-sqlite/kv-store` as its session storage. This means we can use the same `Storage` for lightweight flags like `lastUserId` without any additional setup.
    - `Storage.getItem(key)` / `Storage.setItem(key, value)` follow the `AsyncStorage` interface and persist across app restarts.
    - Using the same storage engine as Supabase auth means the session and `lastUserId` are both in the same SQLite KV DB and can be cleared together if needed.

22. **Gotcha — `supabase.rpc()` returns a `PostgrestFilterBuilder`, not a native `Promise`**
    - **Symptom**: `TS2551: Property 'catch' does not exist on type 'PostgrestFilterBuilder<...>'`
    - **Cause**: The Supabase client's `.rpc()` returns a `PostgrestFilterBuilder` which is a thenable (has `.then()`) but not a full `Promise`, so `.catch()` is not available directly on it.
    - **Fix**: Use `.then(undefined, () => {})` for fire-and-forget error suppression, or `await` in a try/catch.
    - **Pattern for fire-and-forget RPC calls**:
      ```typescript
      void supabase.rpc('my_rpc', { param: value }).then(undefined, () => {});
      ```
    - **Prevention**: Never chain `.catch()` directly on `supabase.rpc()`. Also, `.then(() => {}).catch(() => {})` won't work because `.then()` on a `PromiseLike` returns another `PromiseLike`, not a full `Promise`. Always use two-argument `.then(onFulfilled, onRejected)`.

23. **PATTERN — Plan limits should be client-side constants, not database fields**
    - **Reason**: Plan limits (maxApps, maxSharedInstances) are business rules that change infrequently. Fetching them from the DB on every check adds latency and complexity.
    - **Implementation**: Define `PLAN_LIMITS` as a `const` in `hooks/useUserProfile.ts`. The profile RPC returns only `plan` (string), and the client looks up limits locally.
    - **Exception**: Plan _grants_ (promo code redemption, subscription events) must happen server-side via `SECURITY DEFINER` RPCs to prevent client-side manipulation.

24. **PATTERN — User profile count tracking is best-effort (fire-and-forget)**
    - **Reason**: `app_install_count` and `shared_instance_count` in `user_profiles` are for limit enforcement, not audit logs. If a network call fails, the user's UX should not be blocked.
    - **Implementation**: All `increment_app_count` and `increment_shared_instance_count` RPC calls use `.then(undefined, () => {})` pattern — they never `await` and never show errors to the user.
    - **Trade-off**: Counts may drift if the app crashes between a DB write and the RPC call. The RPC uses `GREATEST(0, count + delta)` to prevent negative counts.
    - **When to fix drift**: The `get_user_profile` RPC is the right place to add a reconciliation query later (count actual rows in `apps` table) if drift becomes a problem.

## Session 8 Work (2026-03-18) — User Profile, Subscription & Promo Codes

### What Was Done
1. **Supabase schema**: `user_profiles`, `promo_codes`, `promo_redemptions` tables with full RLS
2. **Triggers**: Auto-create `user_profiles` on `auth.users` INSERT; `updated_at` auto-update
3. **RPCs**: `get_user_profile` (auto-downgrades expired plans), `redeem_promo_code` (atomic), `increment_app_count`, `increment_shared_instance_count`
4. **Promo codes seeded**: `BETA2026` (90d beta), `PERAPPOS` (lifetime beta), `VIBECODER` (30d beta)
5. **`hooks/useUserProfile.ts`**: Central profile hook with `PLAN_LIMITS` constant
6. **`hooks/useGatekeeper.ts`**: Gate functions for install + sharing, with `Alert.alert` prompts
7. **`components/PromoCodeSheet.tsx`**: Bottom sheet modal for promo code entry
8. **Settings screen**: Account card with avatar, plan badge (colored pills), expiry, Redeem Code button
9. **`app/add.tsx`**: Gate on install + count increment
10. **`app/(tabs)/index.tsx`**: Count decrement on delete
11. **`app/app/[id].tsx`**: Sharing gate + count increment on create; decrement on delete
12. **`services/appInstaller.ts`**: Count increment on auto-install (join flow)
13. **`services/collaborationService.ts`**: Count decrement in `stopSharingAsOwner`

### Key Gotcha (entry #22)
All fire-and-forget RPC calls must use `.then(undefined, () => {})`, NOT `.catch()` — see entry #22.

## Session 9 Work (2026-03-18) — Shared Instance Freeze on Plan Downgrade

### What Was Done
1. **Supabase migration**: Added `is_frozen`, `frozen_at`, `frozen_reason` columns to `shared_instances`
2. **Supabase RPCs**: `freeze_owner_instances(p_owner_id)` + `unfreeze_owner_instances(p_owner_id)` (SECURITY DEFINER, called from `get_user_profile` on expiry and `redeem_promo_code` on upgrade)
3. **`services/sync/schema.ts`**: Added `is_frozen: column.integer`, `frozen_at: column.text`, `frozen_reason: column.text` to `sharedInstances` table — PowerSync booleans use `column.integer` (0/1)
4. **`services/sync/bridge-merge-handler.ts`**: Added `'frozen'` to `MergeStrategy` union. Freeze check at top of `handleSharedWrite` — queries `shared_instances.is_frozen` via PowerSync local, fails-open if query errors
5. **`lib/vaultBridge.ts`**: After `handleSharedWrite` returns `INSTANCE_FROZEN` error, injects `window.__vaultInstanceFrozen = true` and dispatches `vaultInstanceFrozen` CustomEvent into WebView
6. **`app/app/[id].tsx`**: `isFrozen` state; freeze status check in load `useEffect`; PowerSync watcher for live `shared_instances` freeze status changes; frozen banner UI (yellow `#FEF3C7`, amber border)
7. **`app/shared-instance/[instanceId].tsx`**: `is_frozen` field on `SharedInstanceRow`; `isFrozen` state set from load; frozen banner UI shown to owner only

### REQUIRED Dashboard Action (PowerSync)
After adding freeze columns, update the PowerSync sync rules dashboard to include `is_frozen`, `frozen_at`, `frozen_reason` in the `shared_instances` SELECT projection. Without this, the columns will not sync to client devices.

25. **PATTERN — PowerSync boolean columns must use `column.integer`, not `column.text` or `column.boolean`**
    - **Reason**: PowerSync maps SQLite types to its own column types. There is no `column.boolean` type — booleans are stored as SQLite integers (0/1).
    - **In schema.ts**: Declare boolean columns as `column.integer`
    - **In query comparisons**: Compare with `=== 1` (not `=== true`): `instanceRows[0].is_frozen === 1`
    - **Prevention**: Any Supabase `BOOLEAN` column that syncs through PowerSync must use `column.integer` in the PowerSync schema definition.

26. **PATTERN — Freeze check is fail-open (not fail-closed)**
    - **Reason**: On first launch or when PowerSync hasn't synced `shared_instances` yet, the local row may not exist. Blocking writes in this case would prevent legitimate new instances from receiving their first write.
    - **Implementation**: The freeze check in `handleSharedWrite` wraps the PowerSync query in `try/catch`. If the query throws or returns 0 rows, the write proceeds normally.
    - **When to change**: If false negatives (writes succeeding during freeze) become a problem, add a Supabase direct-query fallback. For now, the tradeoff (rare false negative vs. legitimate write blocking) favors fail-open.

27. **BUG — FlatList behind a React Native Modal doesn't visibly update until modal closes**
    - **Symptom**: After confirming delete in the home screen context menu, the deleted app stayed in the list until navigation away-and-back.
    - **Root cause**: `performMenuDelete` called `await refresh()` (→ `setApps(newList)`) while the Modal was still open (`menuVisible = true`). React Native Modal renders in its own native layer — FlatList updates behind an open Modal may be deferred and only commit once the Modal native layer tears down. `finally { setMenuVisible(false) }` ran after `refresh()` completed, too late.
    - **Fix**: Move `setMenuVisible(false)` to the `try` block immediately after the DB deletes, BEFORE `await refresh()`. The Modal's slide-out animation (~300ms) runs concurrently; SQLite is fast (~10–30ms) so the list is already updated when the animation finishes. Also added `setMenuVisible(false)` to the `catch` block so the modal always closes.
    - **Prevention**: When a list state update needs to be visible, dismiss the Modal covering it BEFORE or DURING the update, not after.

28. **BUG — Indian-locale keyboards emit `।` (Devanagari danda, U+0964) instead of `.` in URL fields**
    - **Symptom**: `https://netlify.app` arrived as `https://netlify।app` — dots replaced with the Devanagari danda character.
    - **Root cause**: Hindi/Marathi keyboards on iOS map the period key to `।` rather than `.`. The URL keyboard type does not override this.
    - **Fix**: Added `onChangeText` normalisation in the URL TextInput (`app/add.tsx`): `.replace(/।/g, '.').replace(/॥/g, '.')` plus curly-quote → straight-quote replacements.
    - **Prevention**: Any input expecting ASCII punctuation (URLs, codes) should normalise danda characters if targeting Indian locales.

29. **BUG — `keyboardType="number-pad"` suppresses top-row number keys on physical keyboards**
    - **Symptom**: OTP code could not be entered with top-row number keys on a Bluetooth/hardware keyboard; only numpad keys worked.
    - **Root cause**: iOS `number-pad` restricts input to the numeric keypad and suppresses key events from the top-row number row on physical keyboards.
    - **Fix**: Use `keyboardType="numeric"` instead. Both show the same on-screen numeric keyboard, but `"numeric"` accepts all digit sources. The existing `replace(/[^0-9]/g, '')` filter strips the decimal point.
    - **Prevention**: For digit-only inputs, always prefer `"numeric"` over `"number-pad"` unless you're certain no physical keyboard will ever be attached.

30. **PATTERN — All non-prose text inputs need `autoCorrect={false}` + `spellCheck={false}`**
    - **Symptom**: App name and OTP fields were susceptible to Hindi autocorrect substituting Devanagari words for English text on an Indian-locale device.
    - **Rule**: Any input that is NOT free-form prose (emails, passwords, URLs, codes, names, OTPs) should have both `autoCorrect={false}` and `spellCheck={false}`. Set `autoCapitalize` explicitly: `"none"` for codes/emails/URLs, `"words"` for names, `"characters"` for short all-caps codes.
    - **Note**: These prevent word substitution but do NOT prevent the keyboard from switching language — that requires the user to change iOS Settings → General → Keyboard.

## To-Do for Next Session

- [ ] Update PowerSync sync rules dashboard to include `is_frozen`, `frozen_at`, `frozen_reason` in `shared_instances` projection
- [ ] Remove one-time CRUD queue flush from `PowerSyncProvider.tsx` after confirming clean CRUD queues on all devices
- [ ] Show explicit PowerSync connection error in Settings
- [ ] Add clipboard copy for invite codes
- [ ] Strengthen join/create retry UX
- [ ] Discover screen: curated template list
- [ ] Settings: per-app permissions panel
- [ ] Edit Profile screen (display name + avatar emoji picker)
- [ ] RevenueCat integration for paid plan upgrades
- [ ] Consider: For VaultAPI-aware apps, provide a `window.addEventListener('vaultSyncUpdate', ...)` pattern so apps that opt in can update without reload
