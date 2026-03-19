# Cottix — Claude Code Guidelines

## Project Context

- **Project**: Cottix
- **Purpose**: Personal app OS for iOS/Android — install, organize, and run AI-generated web apps (from Lovable, Bolt, Vercel, Replit, or any URL) natively on your phone
- **Tech Stack**: Expo SDK 55 (New Arch) + TypeScript + NativeWind v4 + expo-sqlite + PowerSync + Supabase + react-native-webview
- **Current Status**: Core features complete. Shared collaboration with 3-way merge engine shipped. Working on sync reliability and UX polish.

## Architecture Quick Reference

- **File-based routing**: expo-router in `app/` directory
- **Local DB**: expo-sqlite (WAL mode) for app metadata + per-app KV store
- **Sync DB**: PowerSync → Supabase for cross-device and shared data
- **WebView bridge**: `lib/vaultBridge.ts` + `lib/vaultShim.ts` — mini-apps use `window.Vault` API
- **Shared writes**: `lib/vaultShimSync.ts` → `bridge-merge-handler.ts` — 3-way merge with conflict resolution
- **Auth**: Supabase email OTP (no magic links, no deep links needed)

See `.claude-code/context.md` for full architecture details.

## Critical Rules

1. Always read `.claude-code/learning.md` for known gotchas before modifying sync/merge code
2. Check `.claude-code/rules.md` for coding standards and protocols
3. Reference `.claude-code/context.md` for architecture decisions
4. Reference `TECHNICAL.md` for database schema and bridge protocol details
5. Reference `STATUS.md` for current sprint status and next-up items

## Coding Standards

- **TypeScript**: Strict mode, no `any`, path aliases via `@/*`
- **Components**: Functional components with hooks only
- **Styling**: NativeWind (Tailwind `className` on RN components), iOS-native aesthetic
- **Navigation**: expo-router file-based routing only
- **Storage**: expo-sqlite for ALL local storage (never AsyncStorage)
- **Animations**: react-native-reanimated (never legacy Animated API)
- **WebView**: react-native-webview for mini-apps (never iframes)
- **Design tokens**: Primary blue `#007AFF`, labels `#1C1C1E`, secondary `#8E8E93`, separator `#E5E5EA`

## Key Files

| File | Purpose |
|---|---|
| `app/_layout.tsx` | Root layout — SQLiteProvider + PowerSyncProvider + Stack |
| `app/app/[id].tsx` | WebView runner for mini-apps |
| `lib/vaultBridge.ts` | WebView ↔ native message handler |
| `lib/vaultShim.ts` | JS shim injected into WebView |
| `lib/vaultShimSync.ts` | Shared-app shim with merge support |
| `services/sync/bridge-merge-handler.ts` | 3-way merge engine for shared writes |
| `services/sync/SupabaseConnector.ts` | PowerSync ↔ Supabase CRUD connector |
| `services/sync/schema.ts` | PowerSync table schema |
| `services/collaborationService.ts` | Shared instance create/join/leave logic |
| `hooks/useInstalledApps.ts` | App list hook with refresh/recordOpen |

## Subagents

- **code-reviewer**: Security, performance, code quality reviews
- **test-writer**: Test generation and coverage improvement
- **refactorer**: Safe refactoring planning and execution
- **documenter**: API docs, README, architecture docs

## Supabase Dependencies

- RPCs: `lookup_shared_instance(p_invite_code)`, `add_instance_member(p_instance_id, p_user_id, p_role)`
- RLS on `shared_app_data` must allow INSERT/UPDATE for instance members
- `shared_app_data` needs merge columns: `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count`
- Unique constraint `(instance_id, app_id, key)` on `shared_app_data` for upsert

## Known Limitations

- `app_data.id` in Supabase must be TEXT (not UUID) — PowerSync uses `${appId}/${key}` as composite ID
- Web platform has limited support (no file system access)
- Tab icons use Unicode characters (may swap for SF Symbols later)
- `+html.tsx` and `+not-found.tsx` are default template files (harmless)
