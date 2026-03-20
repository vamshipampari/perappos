# Cottix Refactoring Tracker

Tracks progress across multi-session refactoring effort. Started 2026-03-20.

---

## Phase 1: Foundation — Types, Logger, Cleanup
**Status: COMPLETE** (2026-03-20)

- [x] Create `types/index.ts` — centralize `InstalledApp`, `AppManifest`, `RawMessage`, `Phase`, re-export `SharedWriteMessage`
- [x] Create `lib/logger.ts` — `__DEV__`-gated logger with prefix support
- [x] Update all imports to use `@/types` for shared types (7 files updated)
- [x] Replace `console.log/warn/error` with logger calls (14 app files updated)
- [x] Delete `app/shared-apps.tsx` (deprecated, zero imports)
- [x] Remove unused dep: `@react-native-async-storage/async-storage`
- [x] Verify: `npx tsc --noEmit` passes (0 app errors)

---

## Phase 2: Extract Shared UI Components
**Status: COMPLETE** (2026-03-20)

- [x] Extract `components/ActionSheet.tsx` from `app/app/[id].tsx` (~325 lines removed)
- [x] Extract `components/AppIcon.tsx` — shared icon with update dot + shared badge
- [x] Update `app/app/[id].tsx` to import ActionSheet + AppIcon (removed inline component + `sheet` StyleSheet)
- [x] Refactor `app/(tabs)/index.tsx` context menu — replaced ~95-line inline Modal with ActionSheet; replaced inline icon block with AppIcon
- [x] Verify: `npx tsc --noEmit` passes (0 app errors)

---

## Phase 3: Decompose `app/app/[id].tsx` (1,356 → 466 lines)
**Status: COMPLETE** (2026-03-20)

- [x] Extract `hooks/useWebViewApp.ts` — state machine, loadShimPayload, initial load, auth session, ownWriteIds prune
- [x] Extract `hooks/useLiveSyncPush.ts` — PowerSync db.watch() watcher for remote updates
- [x] Extract `hooks/useFreezeWatcher.ts` — initial check + live freeze status watcher
- [x] Extract `hooks/useAppMenuActions.ts` — handleCollaborate, handleManageGroup, handleCheckUpdate, handleAppInfo, handleDelete
- [x] Slim down `app/app/[id].tsx` to 466 lines (hook calls + JSX + styles)
- [x] Verify: `npx tsc --noEmit` passes (0 app errors)

---

## Phase 4: Decompose `app/add.tsx` (1,194 → 488 lines)
**Status: COMPLETE** (2026-03-20)

- [x] Extract `services/urlFetcher.ts` — platform detection, title/favicon extraction, fetchUrlMetadata
- [x] Extract `services/zipInstaller.ts` — ZIP extraction, path rewriting, ParsedBundle type
- [x] Extract `components/EmojiPicker.tsx`
- [x] Extract `components/ColorPicker.tsx`
- [x] Slim down `app/add.tsx` to step state machine + JSX (488 lines)
- [x] Verify: `npx tsc --noEmit` passes (0 app errors)

---

## Phase 5: Decompose Home Screen + vaultBridge
**Status: COMPLETE** (2026-03-20)

- [x] Extract `hooks/useUpdateScanner.ts` — background update scanning with concurrency pool + useFocusEffect
- [x] Extract `hooks/useAppContextMenu.ts` — all 8 menu callbacks + state (visible, target, busy)
- [x] Refactor `lib/vaultBridge.ts` — extract `getUserId()` helper (dedup 4x session calls) + `buildSharedWriteMessage()` (dedup ls_set_sync)
- [x] Slim down `app/(tabs)/index.tsx` — 708 → 344 lines
- [x] Verify: `npx tsc --noEmit` passes (0 app errors)

---

## Phase 6: Test Infrastructure
**Status: COMPLETE** (2026-03-20)

- [x] Create `jest.config.js` — Node env, babel-jest transform, `@/*` moduleNameMapper, ignores worktrees
- [x] Write `services/__tests__/urlFetcher.test.ts` — 40 tests for detectPlatform, extractTitle, isBinaryExt, extractFaviconUrl
- [x] Write `lib/__tests__/vaultBridge.test.ts` — 17 tests covering all message types (ls_set, ls_delete, ls_clear, db_get/set/delete/get_all, ls_set_sync, auth_get_user, app_get_info, device_haptic, unknown)
- [x] Add `"test": "jest"` to package.json scripts
- [x] Verify: `npm test` passes — 82 tests across 3 suites (includes pre-existing merge.test.ts)

---

## Phase 7: Type Safety + Linting
**Status: COMPLETE** (2026-03-20)

- [x] Fix `any` in `services/sync/merge-utils.ts` — `deepEqual`/`isPlainObject` now use `unknown` + type narrowing
- [x] Fix `any` in `services/sync/shape-classifier.ts` — `parsed: unknown` + type predicate filter
- [x] Fix `any` in `services/sync/bridge-merge-handler.ts` — `PowerSyncDB` interface uses `SqlParam[]` + `unknown[]`
- [x] Create `.eslintrc.js` — `@typescript-eslint/recommended` + `react-hooks` plugin, `no-explicit-any: warn`
- [x] Create `.prettierrc` — single quotes, trailing commas, 100 char width
- [x] Add `eslint`, `prettier`, `@typescript-eslint/*`, `eslint-plugin-react-hooks`, `@types/jest` devDependencies
- [x] Add `lint`, `format`, `test` scripts to `package.json`
- [x] Exclude `**/__tests__/**` from `tsconfig.json` app type checking
- [x] Verify: `npx eslint .` — 0 errors, 21 warnings (accepted `any` in JSZip/jszip interfaces)
- [x] Verify: `npx tsc --noEmit` — 0 errors
