# Cottix learnings

## Critical patterns (prevention rules — read every session)

- PowerSync sync rules: never use table aliases → rows land in ps_untyped
- PowerSync row IDs: always `${instanceId}/${appId}/${key}` not UUID
- RLS on instance_members: keep DISABLED → PowerSync sync rules handle access
- useCallback + PowerSync db: use useRef(db), empty [] deps → prevents re-fire on sync
- iOS WebKit localStorage: replace window.localStorage entirely, don't defineProperty
- Supabase upsert: onConflict col must have matching UNIQUE constraint in Postgres
- After Supabase write: don't query PowerSync local immediately → pre-seed or use fallback
- Worktree fixes: always copy to main project → worktree has no node_modules
- Duplicate UNIQUE constraints: check with pg_constraint before adding → breaks upsert
- WebView reload for sync: location.reload() + window.name is the only universal approach
- PowerSync boolean columns: use column.integer (0/1) → no column.boolean exists
- supabase.rpc(): use .then(undefined, () => {}) for fire-and-forget → .catch() doesn't exist on PostgrestFilterBuilder
- Edge functions + user JWTs: deploy with --no-verify-jwt → decode JWT locally via atob() with base64url padding
- vaultBridge.ts native modules: lazy await import() → static imports crash entire bridge if any module unlinked

## Architecture decisions (why, not what — see docs/context.md for detail)

- Sync: PowerSync + Supabase offline-first. No alternatives considered post-session 4.
- Auth: email+password, OTP confirmation on signup only. Two auth screens intentional.
- Live sync: location.reload() + window.name — event-based approaches fail for useState initializers.
- Merge engine: 3-way merge in bridge-merge-handler.ts. Strategies: noop → fast_path → array/object merge → lww.

## Session log (rolling — keep last 30 days only)

2026-03-26: API Keys UI + version tracking · installed_apps PK fix (${userId}/${appId})
2026-03-25: Cross-device app list sync · auth lifecycle fixes · HTML add flow · WebView viewport fix
2026-03-24: VaultAPI.secrets + VaultAPI.storage end-to-end · shared shim patched
2026-03-19: Rebranding Perappos → Cottix · Create with AI feature · Cloudflare Worker
2026-03-18: User profiles + subscription plans + promo codes · shared instance freeze on downgrade
2026-03-17: Auth email+password · user-change guard · expo-file-system/legacy
2026-03-16: Cross-device sync fixed · window.name reload pattern
2026-03-13: PowerSync alias bug · 4 compounding sync bugs · worktree deployment issue
