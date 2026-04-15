# Cottix learnings

## Critical patterns (prevention rules — read every session)

- PowerSync sync rules: never use table aliases → rows land in ps_untyped
- PowerSync row IDs: always `${instanceId}/${appId}/${key}` not UUID
- useCallback + PowerSync db: use useRef(db), empty [] deps → prevents re-fire on sync
- PowerSync missing sync rule column: columns absent from sync rules projection return NULL locally → query Supabase directly for those columns instead
- Supabase upsert: onConflict col must have matching UNIQUE constraint in Postgres
- After Supabase write: don't query PowerSync local immediately → pre-seed or use fallback
- StyleSheet.create(): evaluated at load time, can't use hooks → use makeStyles(theme: Colors) called inside component
- WebView reload for sync: location.reload() + window.name is the only universal approach
- PowerSync boolean columns: use column.integer (0/1) → no column.boolean exists
- supabase.rpc(): use .then(undefined, () => {}) for fire-and-forget → .catch() doesn't exist on PostgrestFilterBuilder
- vaultBridge.ts native modules: lazy await import() → static imports crash entire bridge if any module unlinked
- New RPC params: add DEFAULT NULL in SQL + PGRST202 catch-retry in connector → deploy code before migration without breaking uploads
- expo-router modals: use router.dismiss() not router.back() → back() navigates to previous screen (e.g. /add behind create), dismiss() closes the modal presentation matching the native gesture
- wrangler deploy: always pass --config path/to/wrangler.toml when not inside worker dir → running from parent silently deploys the wrong worker (picks up nearest wrangler.jsonc)
- React state + async picker: closeMenu()/setState(null) batches before async resolves → capture target in useRef synchronously before calling close
- Supabase edge functions from app: use supabase.functions.invoke() not manual fetch() → manual fetch() causes Invalid JWT from gateway; refreshSession() triggers PowerSync reconnect + hang
- Supabase RPC INSERT: never cast gen_random_uuid()::TEXT when column is UUID → use gen_random_uuid() directly; always check actual column type before casting
- Supabase error handling: PostgrestError is not an Error instance → extract .message via (e as Record<string,unknown>).message, never String(error) which gives '[object Object]'
- Forgot password mobile: resetPasswordForEmail sends magic link (opens browser, no in-app handler) → use signInWithOtp(shouldCreateUser:false) + verifyOtp(type:'email') + updateUser({password}) for full in-app OTP reset flow
- useWebViewApp bundle load: never call FileSystem.readAsStringAsync when bundle_path is '' → guard with if (bundle_path) before read; empty path resolves to Expo web asset on physical device instead of throwing

## Architecture decisions (why, not what — see docs/context.md for detail)

- Sync: PowerSync + Supabase offline-first. No alternatives considered post-session 4.
- Auth: email+password, OTP confirmation on signup only. Two auth screens intentional.
- Live sync: location.reload() + window.name — event-based approaches fail for useState initializers.
- Merge engine: 3-way merge in bridge-merge-handler.ts. Strategies: noop → fast_path → array/object merge → lww.

## Session log (rolling — keep last 30 days only)

2026-04-15: CF Queue generation (durable jobs, PowerSync watch + polling fallback) · Edit with AI modify flow (appId=conversationId) · modal dismiss fix (router.dismiss) · iOS design system in system prompt · wrangler --config deploy gotcha
2026-04-03: Forgot password OTP flow (magic link → signInWithOtp in-app) · shared_instance_limit data fix migration · add_instance_member UUID cast bug · PostgrestError message extraction fix
2026-04-01: Folders (local SQLite, home browser, move picker) · Join approval (pending/active status, owner UI, Realtime auto-complete) · ThemeContext dark theme fix · Tab bar icon color · Member email in approval UI
2026-03-31: Login UX (forgot password, show/hide, duplicate email) · Settings fixes (app lock, edit profile, appearance) · Dark theme system (lib/theme.ts + 15 files)
2026-03-31: Write attribution (shared_app_data + history table) · _addedBy stamping · VaultAPI.collaboration · activity panel on Manage Group
2026-03-26: API Keys UI + version tracking · installed_apps PK fix (${userId}/${appId})
2026-03-25: Cross-device app list sync · auth lifecycle fixes · HTML add flow · WebView viewport fix
2026-03-24: VaultAPI.secrets + VaultAPI.storage end-to-end · shared shim patched
2026-03-19: Rebranding Perappos → Cottix · Create with AI feature · Cloudflare Worker
2026-03-18: User profiles + subscription plans + promo codes · shared instance freeze on downgrade
2026-03-17: Auth email+password · user-change guard · expo-file-system/legacy
2026-03-16: Cross-device sync fixed · window.name reload pattern
2026-03-13: PowerSync alias bug · 4 compounding sync bugs · worktree deployment issue
