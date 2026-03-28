# Cottix — Claude Code Protocol & Rules

## Before Starting Any Task

1. Read `.claude/learning.md` — known gotchas, especially around sync and merge
2. Check git status — confirm you're on the right branch
3. Review `docs/status.md` for current sprint context and next-up items
4. Reference `docs/technical.md` for database schema and bridge protocol details

## Coding Standards

- **TypeScript**: Strict mode, no `any`, use path aliases `@/*`
- **Components**: Functional + hooks only (no class components)
- **Styling**: NativeWind `className` prop (Tailwind classes on RN components)
- **Navigation**: expo-router file-based routing only (`app/` directory)
- **Storage**: expo-sqlite for ALL local storage (never AsyncStorage, never expo-sqlite/legacy)
- **Animations**: react-native-reanimated (never Animated API)
- **WebView**: react-native-webview (never iframes)
- **Camera**: expo-camera (never expo-camera/legacy)
- **Haptics**: Use `lib/haptics.ts` wrapper for safe cross-platform haptics

## Design Standards

- iOS-native aesthetic: white backgrounds, system font, subtle gray borders
- Primary blue: `#007AFF` (buttons, links, FAB)
- Label text: `#1C1C1E`, secondary: `#8E8E93`, separator: `#E5E5EA`
- App icon border radius: 14px
- Shadow: subtle (shadowOpacity 0.08–0.1)
- Reanimated spring animations for interactive elements

## File Modification Protocol

- Read files before modifying them
- Never delete without checking git history first
- Always run `npx tsc --noEmit` before considering TypeScript changes complete
- Update `.claude/learning.md` after discovering new gotchas
- Update `docs/status.md` when completing or adding sprint items
- Update `docs/backend-schema.md` after any Supabase migration

## Git Rules

- NEVER commit directly to main
- ALWAYS create a branch before changes: `feature/*`, `fix/*`, `docs/*`
- NEVER modify files in `supabase/migrations/` — create new migrations only
- ALWAYS run `npx tsc --noEmit` before committing

## Sync/Merge Code Rules (Critical — most fragile parts of codebase)

1. **shared_app_data**: Always use natural-key upsert (`onConflict: "instance_id,app_id,key"`), never use PowerSync's compound-string ID
2. **Merge metadata**: All writes to `shared_app_data` must update `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count`
3. **RPC-first**: Use Supabase RPCs for shared instance operations (lookup, member add), not direct table queries
4. **Shim selection**: Personal apps use `vaultShim.ts`, shared apps use `vaultShimSync.ts` — never mix them
5. **Bridge routing**: `ls_set` is fire-and-forget (personal), `ls_set_sync` is request/response (shared merge path)
6. **PowerSync sync rules**: NEVER use table aliases — causes rows to land in `ps_untyped`
7. **PowerSync row IDs**: `shared_app_data` id format is `${instanceId}/${appId}/${key}` — never UUID
8. **instance_members RLS**: Must stay DISABLED — PowerSync sync rules handle access control
9. **useCallback + PowerSync db**: Use `useRef(db)` pattern with empty `[]` deps — prevents re-fire on every sync cycle

## WebView Bridge Rules

- All bridge message types documented in `docs/technical.md`
- New message types must follow existing pattern: `{ type, id?, appId, ... }`
- Request/response messages require a unique `id` for correlation
- Shim uses `injectedJavaScriptBeforeContentLoaded` — NEVER `injectedJavaScript` (runs too late)
- iOS WebKit: replace `window.localStorage` entirely via `Object.defineProperty(window, "localStorage")` — `defineProperty` on the property itself doesn't work
- Bridge responses via `window.__vaultRespond()` + `injectJavaScript` — not `postMessage`
- The shim must pre-populate KV data at load time for synchronous initial reads
- Shared shim must track base versions per key for merge decisions
- Any new `VaultAPI` namespace must be added to BOTH `vaultShim.ts` AND `vaultShimSync.ts`

## Auth Rules

- Auth gate lives ONLY in root `_layout.tsx` — never in individual screens
- Two auth screens are intentional and must stay separate:
  - `app/login.tsx` — mandatory full-screen gate (no close button, `gestureEnabled: false`)
  - `app/auth.tsx` — dismissable modal from Settings → Sign In
- NEVER merge these two screens
- `(auth.uid())::text` NEVER used in RLS policies — `auth.uid()` is already uuid

## Cross-Repo Rules

- perappos owns the DB schema — cottix-hub reads `docs/backend-schema.md`, never defines tables
- After editing `miniapp_api.md` → run `/sync-docs` before shipping
- After any Supabase migration → run `/schema-update`
- cottix-hub reads schema from `../perappos/docs/backend-schema.md`

## Commit Message Format

```
type: Brief description

- Detail about what changed
- Reference to related issues or decisions
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

## When Stuck

1. Check `.claude/learning.md` critical patterns section
2. Check `docs/technical.md` for schema/protocol details
3. Look at git log for how similar problems were solved
4. Add detailed console logging before escalating
5. Document the issue in `.claude/learning.md` if it's a new "never do X again" rule

## Session End Checklist

- [ ] Run `npx tsc --noEmit` to verify type safety
- [ ] Ensure no `any` types were introduced
- [ ] Run `/update-docs` if anything significant changed
- [ ] Run `/capture-learning` if a non-obvious gotcha was discovered
- [ ] Update `docs/status.md` if sprint items changed
