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
**Status: NOT STARTED**

- [ ] Extract `hooks/useUpdateScanner.ts` — background update scanning
- [ ] Extract `hooks/useAppContextMenu.ts` — menu callbacks + state
- [ ] Refactor `lib/vaultBridge.ts` — `buildSharedWriteMessage()` + `getUserId()` helpers
- [ ] Slim down `app/(tabs)/index.tsx` to ~400 lines
- [ ] Verify: home screen, long-press menu, update scanning, bridge messages

---

## Phase 6: Test Infrastructure
**Status: NOT STARTED**

- [ ] Configure Jest at root level
- [ ] Create `__mocks__/` for RN modules
- [ ] Write `vaultBridge.test.ts`
- [ ] Write `urlFetcher.test.ts`
- [ ] Write `zipInstaller.test.ts`
- [ ] Add `"test": "jest"` to package.json
- [ ] Verify: `npm test` passes

---

## Phase 7: Type Safety + Linting
**Status: NOT STARTED**

- [ ] Fix ~50 `any` usages (shape-classifier, bridge-merge-handler, merge-utils, add.tsx)
- [ ] Add ESLint with `@typescript-eslint/recommended`
- [ ] Add Prettier
- [ ] Add husky + lint-staged pre-commit hooks
- [ ] Verify: `npx eslint .` and `npx tsc --noEmit` pass
