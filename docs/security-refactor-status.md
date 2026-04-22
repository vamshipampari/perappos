# Cottix — Security & Refactor Status

Source audit: [docs/security-audit.md](security-audit.md)
Last updated: 2026-04-22 — Phase 1–5 complete; Phase 6a complete, 6b complete

---

## Phase 1 — Zero-risk (babel, SQLite indexes, window.name) `fix/security-phase-1` ✅
- [x] A2: babel-plugin-transform-remove-console — strips console.log/debug/info in prod, keeps error+warn
- [x] P1: SQLite indexes on hot columns — idx_app_data_app_id, idx_apps_source_type, idx_apps_last_opened, idx_apps_instance_id, idx_shared_data_category, idx_app_updates_app_id
- [x] C3: window.name JSON.parse try/catch — already implemented in vaultShimSync.ts (pre-resolved)

## Phase 2 — Bridge hardening (vaultBridge.ts only) `fix/security-phase-2` ✅
- [x] S5: Generic error strings for secrets_* failures — fetch errors now return `'request_failed'`; real error logged to console only
- [x] S9: respond(false) on failed db_delete — wrapped in local try/catch; outer catch no longer reachable for this case
- [x] C6: Distinct error codes — `'permission_denied'` vs `'module_unavailable'` for device_haptic + device_notify

## Phase 3 — Crash / unhandled rejections `fix/security-phase-3` ✅
- [x] C1: useGenerateApp polling — two-arg .then(onFulfilled, onRejected) (PromiseLike has no .catch)
- [x] C2: useUserProfile mutators try/catch + typed error re-throw
- [x] C4: useRestoreApps async setState unmount guard (isMountedRef)

## Phase 4 — App Store compliance `fix/security-phase-4` ✅
- [x] A4: NSFaceIDUsageDescription added to app.json infoPlist — was missing for expo-local-authentication (biometric App Lock); NSPhotoLibraryUsageDescription already set via expo-image-picker plugin
- [x] A3: Guide tab confirmed — 7 static help sections only, no community app list; compliance comment added to guide.tsx

## Phase 5 — CSP injection `fix/security-phase-5` ✅
- [x] S4/A1: CSP_JS injected via injectedJavaScriptBeforeContentLoaded — permissive v1
      Policy: default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'self';
      Skipped if app already sets its own CSP. Tighten connect-src in Phase 6 (after allowlist UI built).

## Phase 6a — injectJavaScript payload safety `fix/security-phase-6a` ✅
- [x] S2: safeInjectJson() exported from vaultBridge.ts — escapes U+2028/U+2029 (JS line terminators valid in JSON but break string literals, allowing peer value injection)
      Used in: respond() in vaultBridge.ts · flushUpdates() in useLiveSyncPush.ts · onLoadEnd buffer flush in app/app/[id].tsx

## Phase 6b — secrets.fetch domain allowlist `fix/security-phase-6b` ✅
- [x] S3: secrets_set stores allowedDomains[] in SecureStore alongside the secret value
      secrets_fetch enforces it: rejects with 'domain_not_allowed' if URL hostname not in list
      Legacy secrets (no domains stored) pass through unchanged (backwards compatible)
      Both shims updated (secrets.set gains optional allowedDomains param)
      MINIAPP_API.md docs updated

---

## Deferred — Post-launch sprint

| ID | Description | File |
|----|-------------|------|
| D2 | _versionCache update before write | services/sync/bridge-merge-handler.ts:225 |
| D3 | JSON.parse value-shape validation in merge path | services/sync/bridge-merge-handler.ts:249 |
| D4 | mergeArraysById empty-string ID guard | services/sync/three-way-merge.ts:40 |
| D5 | Flush _writeQueue before location.reload() | lib/vaultShimSync.ts:71 |
| D6 | Freeze check Supabase fallback on cold start | services/sync/bridge-merge-handler.ts:155 |
| D7 | Deterministic clientWriteId (key+hash+version) | lib/vaultShimSync.ts:171 |
| D8 | Policy decision — leaver's data in shared instances | services/collaborationService.ts |
| D9 | isSuspiciousInit heuristic tuning | services/sync/bridge-merge-handler.ts:370 |
| P2 | Defer reload on active input focus | lib/vaultShimSync.ts |
| P3 | Debounce personal-app ls_set writes | lib/vaultBridge.ts:230 |
| P4 | db.watch() debounce on rapid app switch | hooks/useLiveSyncPush.ts:37 |
| S6 | instance_members isolation integration test | — |
| S7 | Display name sanitization at write time | lib/vaultBridge.ts:164 |
| S8 | Auth deep link nonce | app/_layout.tsx:357 |
| R1 | Unify vaultShim.ts + vaultShimSync.ts into factory | lib/ |
| R2 | vaultBridge.ts handler registry refactor | lib/vaultBridge.ts |
| R3 | app/app/[id].tsx component extraction | app/app/[id].tsx |
| R4 | callRpcWithFallback helper | services/sync/SupabaseConnector.ts |
| R5 | Remove one-time CRUD queue flush from PowerSyncProvider | services/sync/PowerSyncProvider.tsx |

---

## Already Resolved

| ID | Description | Notes |
|----|-------------|-------|
| D1 | transaction.complete() on partial CRUD failure | Already correctly placed after full loop ✓ |
| C5 | bundle_path whitespace-only guard | Already guarded with trim() ✓ |
