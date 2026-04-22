# Cottix — Security & Refactor Status

Source audit: [docs/security-audit.md](security-audit.md)
Last updated: 2026-04-22 — Phase 1 + 2 complete

---

## Phase 1 — Zero-risk (babel, SQLite indexes, window.name) `fix/security-phase-1` ✅
- [x] A2: babel-plugin-transform-remove-console — strips console.log/debug/info in prod, keeps error+warn
- [x] P1: SQLite indexes on hot columns — idx_app_data_app_id, idx_apps_source_type, idx_apps_last_opened, idx_apps_instance_id, idx_shared_data_category, idx_app_updates_app_id
- [x] C3: window.name JSON.parse try/catch — already implemented in vaultShimSync.ts (pre-resolved)

## Phase 2 — Bridge hardening (vaultBridge.ts only) `fix/security-phase-2` ✅
- [x] S5: Generic error strings for secrets_* failures — fetch errors now return `'request_failed'`; real error logged to console only
- [x] S9: respond(false) on failed db_delete — wrapped in local try/catch; outer catch no longer reachable for this case
- [x] C6: Distinct error codes — `'permission_denied'` vs `'module_unavailable'` for device_haptic + device_notify

## Phase 3 — Crash / unhandled rejections `fix/security-phase-3`
- [ ] C1: useGenerateApp polling .catch()
- [ ] C2: useUserProfile mutators try/catch + typed error re-throw
- [ ] C4: useRestoreApps async setState unmount guard

## Phase 4 — App Store compliance `fix/security-phase-4`
- [ ] A4: Info.plist permission strings audit (app.json)
- [ ] A3: Guide tab — verify no community app list, add compliance comment

## Phase 5 — CSP injection `fix/security-phase-5`
- [ ] S4/A1: WebView CSP meta injection (permissive v1 — test all demo apps after)

## Phase 6 — Security hardening
- [ ] S2: base64-encode injectJavaScript payloads — useLiveSyncPush.ts + vaultBridge.ts respond() `fix/security-phase-6a`
- [ ] S3: secrets.fetch domain allowlist — vaultBridge.ts + both shims + MINIAPP_API.md `fix/security-phase-6b`

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
