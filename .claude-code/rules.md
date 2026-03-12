# Perappos — Claude Code Protocol & Rules

## Before Starting Any Task

1. Read `learning.md` — there are known gotchas, especially around sync and merge
2. Check git status — confirm you're on the right branch
3. Review `STATUS.md` for current sprint context and next-up items
4. Reference `TECHNICAL.md` for database schema and bridge protocol details

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
- Shadow: subtle (shadowOpacity 0.08-0.1)
- Reanimated spring animations for interactive elements

## File Modification Protocol

- Read files before modifying them
- Never delete without checking git history first
- Always run `npx tsc --noEmit` before considering TypeScript changes complete
- Update `learning.md` after discovering new gotchas
- Update `STATUS.md` when completing or adding sprint items

## Sync/Merge Code Rules (Critical)

These are the most fragile parts of the codebase:

1. **shared_app_data**: Always use natural-key upsert (`onConflict: "instance_id,app_id,key"`), never use PowerSync's compound-string ID
2. **Merge metadata**: All writes to `shared_app_data` must update `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count`
3. **RPC-first**: Use Supabase RPCs for shared instance operations (lookup, member add), not direct table queries
4. **Shim selection**: Personal apps use `vaultShim.ts`, shared apps use `vaultShimSync.ts` — never mix them
5. **Bridge routing**: `ls_set` is fire-and-forget (personal), `ls_set_sync` is request/response (shared merge path)

## WebView Bridge Rules

- All bridge message types are documented in `TECHNICAL.md`
- New message types must follow the existing pattern: `{ type, id?, appId, ... }`
- Request/response messages require a unique `id` for correlation
- The shim must pre-populate KV data at load time for synchronous initial reads
- Shared shim must track base versions per key for merge decisions

## Commit Message Format

```
type: Brief description

- Detail about what changed
- Reference to related issues or decisions
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

## When Stuck

1. Check `learning.md` "Common Mistakes" section
2. Check `TECHNICAL.md` for schema/protocol details
3. Look at git log for how similar problems were solved
4. Add detailed console logging before escalating
5. Document the issue in `learning.md` if it's new

## Session End Checklist

- [ ] Update `learning.md` with any new discoveries
- [ ] Update `STATUS.md` if sprint items changed
- [ ] Run `npx tsc --noEmit` to verify type safety
- [ ] Ensure no `any` types were introduced
