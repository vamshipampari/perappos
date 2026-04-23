# perappos — Cottix mobile app

## Ecosystem

Part of the Cottix ecosystem. See parent `../CLAUDE.md` for cross-repo context.
Sibling repos: `../cottix-hub` (admin panel) · `../cottix-landing` (cottix.co)
Both perappos and cottix-hub share the same Supabase project.

## Reference docs (loaded on demand — not every session)

See docs/context.md for full architecture, data flows, session history
See @docs/backend-schema.md for DB schema, RPCs, RLS, constraints
See @docs/status.md for current sprint status and next-up items
See @docs/technical.md for bridge protocol, merge strategies, NativeWind setup
See @docs/product.md for business decisions and positioning
See @.claude/rules.md for ALL hard constraints — read before touching sync/merge/auth code
See @.claude/learning.md for distilled gotchas — read before touching sync/merge code

## Commands

- Dev: `npx expo start`
- iOS sim: `npx expo run:ios`
- Android: `npx expo run:android`
- Typecheck: `npx tsc --noEmit`
- Single test: `npx jest path/to/file.test.ts`
- EAS preview build: `eas build --platform ios --profile preview`
- Deploy edge function: `supabase functions deploy <name>`

## Stack

Expo SDK 55 (New Arch) · TypeScript strict · NativeWind v4 · expo-sqlite (WAL mode)
PowerSync · Supabase · react-native-webview · expo-router · react-native-reanimated
Package manager: Yarn 1.x · Node 20+

## Key files

| File                                    | Purpose                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `app/_layout.tsx`                       | Root layout — SQLiteProvider + PowerSyncProvider + Stack + auth gate  |
| `app/login.tsx`                         | Mandatory full-screen auth gate (no close button)                     |
| `app/auth.tsx`                          | Dismissable auth modal (Settings → Sign In)                           |
| `app/app/[id].tsx`                      | WebView runner — BFS asset crawler, update support, live sync watcher |
| `app/create.tsx`                        | Create with AI — SSE streaming, WebView preview                       |
| `app/add.tsx`                           | Add app modal — URL, ZIP, HTML, AI card                               |
| `lib/vaultBridge.ts`                    | WebView ↔ native message handler (all bridge types)                   |
| `lib/vaultShim.ts`                      | JS shim injected into WebView — personal apps                         |
| `lib/vaultShimSync.ts`                  | Shared-app shim — base version tracking, debounced writes             |
| `services/sync/bridge-merge-handler.ts` | 3-way merge engine for shared writes                                  |
| `services/sync/SupabaseConnector.ts`    | PowerSync ↔ Supabase CRUD connector                                   |
| `services/sync/PowerSyncProvider.tsx`   | PowerSync init, exports powerSyncDb + connector                       |
| `services/sync/schema.ts`               | PowerSync table schema                                                |
| `services/collaborationService.ts`      | Shared instance create/join/leave/stop                                |
| `services/htmlDeployer.ts`              | Deploy HTML to Cloudflare KV via edge function                        |
| `hooks/useInstalledApps.ts`             | App list — refresh(), recordOpen()                                    |
| `hooks/useUserProfile.ts`               | Plan, limits, promo code redemption                                   |
| `hooks/useGatekeeper.ts`                | App install + sharing gates with upgrade prompts                      |
| `hooks/useUserChangeGuard.ts`           | Detects user switch → wipe confirmation                               |

## Architecture quick ref

- Routing: expo-router file-based (`app/` directory)
- Local DB: expo-sqlite — app metadata + per-app KV
- Sync DB: PowerSync → Supabase — cross-device + shared data
- WebView bridge: `vaultBridge.ts` + `vaultShim.ts` — mini-apps use `window.VaultAPI`
- Shared writes: `vaultShimSync.ts` → `bridge-merge-handler.ts` — 3-way merge
- Auth: email+password — signup needs OTP confirmation, login does not
- Secrets: stored in `expo-secure-store`, never touch WebView JS
- Storage: `expo-image-picker` → Supabase Storage `user-media` bucket
- AI generation: Edge Function → Anthropic API → Cloudflare KV → `apps.cottix.co/{appId}`

## Supabase dependencies

- RPCs: `lookup_shared_instance`, `add_instance_member`, `get_user_profile`, `redeem_promo_code`
- `shared_app_data`: UNIQUE(instance_id, app_id, key) — required for upsert
- `shared_app_data` merge columns: `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count`
- `instance_members` RLS: DISABLED — PowerSync handles access
- `installed_apps.id`: TEXT composite `${userId}/${appId}` (not UUID)
- `app_data.id`: TEXT composite `${appId}/${key}` (not UUID)

## Plan tiers

- free: 5 apps, no sharing · beta/pro: unlimited apps, 5 shared · team: unlimited
- Promo codes: BETA2026 · PERAPPOS · VIBECODER

## Known limitations / pending items

- UPDATE POWERSYNC SYNC RULES: add `is_frozen`, `frozen_at`, `frozen_reason` to `shared_instances`
- Deploy `deploy-html` edge function: `supabase functions deploy deploy-html`
- Remove one-time CRUD queue flush from `PowerSyncProvider` after confirming clean queues
- `+html.tsx` and `+not-found.tsx`: default template files, harmless
