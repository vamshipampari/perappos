# Perappos — Learnings & Gotchas

**Last Updated**: 2026-03-12
**Session Count**: 1

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

## To-Do for Next Session

- [ ] Remove one-time queue flush from PowerSyncProvider (after confirmed clean on all devices)
- [ ] Show explicit PowerSync connection error in Settings
- [ ] Add clipboard copy for invite codes
- [ ] Strengthen join/create retry UX
- [ ] Discover screen: curated template list
- [ ] Settings: per-app permissions panel
