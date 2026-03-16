# Perappos — Learnings & Gotchas

**Last Updated**: 2026-03-16
**Session Count**: 5

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

8. **CRITICAL ARCHITECTURE ISSUE — WebView shared_app_data read-back gap** (discovered 2026-03-13)
   - **Symptom**: Data written to `shared_app_data` after the shared instance is created is NOT shown in the WebView. Other devices' writes never appear.
   - **Root cause**: `vaultShimSync.ts` embeds ALL data once at page load into JavaScript constants (`_cache`, `_baseState`, `_keyVersions`). This is static — the WebView never re-queries the database after initialization. Writes from THIS device update `_cache` via the bridge's `newValue` acknowledgement. But there is NO mechanism to push data from PowerSync sync (other devices' writes) into the WebView's live `_cache`.
   - **Note**: Data loss (A2 missing from Supabase) turned out to be a separate bug — see entry #9.
   - **Fix approach**: After PowerSync receives new `shared_app_data` rows, inject JavaScript into the WebView to update the shim's `_cache` (e.g., `webViewRef.current?.injectJavaScript(...)` with a `window._VaultSyncUpdate({key, value, version})` call).
   - **Current status**: NOT FIXED — needs dedicated session to implement the sync push mechanism

9. **Mistake**: Migration uses wrong row ID format → duplicate rows → non-deterministic reads + stale shim preload → data loss (discovered 2026-03-13, FIXED)
   - **Cause**: `collaborationService.ts` migration loop used `Crypto.randomUUID()` as the PowerSync row ID for migrated `shared_app_data` rows. But `bridge-merge-handler.ts` `writeRow()` uses `makeRowId()` = `` `${instanceId}/${appId}/${key}` ``. This created TWO rows in PowerSync for the same `(instance_id, app_id, key)` natural key: one with a UUID id (from migration, version=1) and one with the compound id (from the first user write, version=2). `readCurrentRow()` used `LIMIT 1` without `ORDER BY`, so it non-deterministically picked either row. When A3 happened to read the UUID row (version=1) as base, it computed `newVersion=2` and wrote to the compound-id row, silently overwriting A2.
   - **Fix in `collaborationService.ts`**: Changed `Crypto.randomUUID()` to `` `${instanceId}/${app.app_id}/${row.key}` `` so migrated rows use the same compound key format as `writeRow()`. `INSERT OR REPLACE` then correctly updates the same row on subsequent writes.
   - **Fix in `bridge-merge-handler.ts`**: Added `ORDER BY version DESC` before `LIMIT 1` in `readCurrentRow()` as a defence-in-depth measure — even if duplicate rows exist (from previous bad migrations), we always pick the highest-version one.
   - **Fix in `app/app/[id].tsx` `loadShimPayload`**: Added `ORDER BY version DESC` to the `shared_app_data` preload query AND a `if (row.key in preloadedData) continue` guard in the loop. Without this, the shim could be preloaded with the stale UUID row (version=1) instead of the latest compound-key row — causing every subsequent `baseVersion` sent by the shim to be wrong, and `readCurrentRow()` to then compute `newVersion = stale_version + 1` on each write (effectively resetting version to 1+1=2 every time instead of incrementing).
   - **Prevention**: Any direct PowerSync `INSERT` into a table that is also written by a handler must use the SAME row ID format as that handler. For `shared_app_data`, that is `` `${instanceId}/${appId}/${key}` ``. Also, any preload query over a PowerSync table that may have duplicate rows for the same logical key MUST include `ORDER BY` + deduplication guard.

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
- **`getSession()` is called outside `SQLiteProvider`** — it uses the Supabase client's own SQLite storage (separate from the app's main `perappos.db`), so it works before `SQLiteProvider` renders.
- **`gestureEnabled: false` + `animation: 'fade'`** on the login Stack.Screen prevents swipe-back from exposing the home screen before auth.
- **Sign-out redirect** is handled centrally in root layout via `onAuthStateChange`, not in each individual screen's sign-out handler.

16. **PATTERN — Two auth screens for different auth contexts**
    - `app/login.tsx`: Mandatory entry-point gate. Full-screen. No back gesture. Routes to `/(tabs)` on success.
    - `app/auth.tsx`: Optional re-auth modal (e.g. account section in Settings). Has a Close button. Uses `router.back()` on success.
    - **Prevention**: Never reuse the same auth screen component for both contexts. Conflating them leads to either (a) the gate being dismissable or (b) the modal having no escape.

## To-Do for Next Session

- [ ] **CRITICAL #1**: Implement WebView live sync push — watch PowerSync `shared_app_data` changes → inject JS `window._VaultSyncUpdate({key, value, version})` into the live WebView. This is the only remaining shared-collaboration gap. Data is correct on open/reopen; it just doesn't appear live.
- [ ] Remove debug `console.log` statements added during session 4 debugging (in `bridge-merge-handler.ts` readCurrentRow, and `vaultBridge.ts` ls_set_sync handler) once live sync push is working
- [ ] Show explicit PowerSync connection error in Settings
- [ ] Add clipboard copy for invite codes
- [ ] Strengthen join/create retry UX
- [ ] Discover screen: curated template list
- [ ] Settings: per-app permissions panel
