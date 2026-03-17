# Perappos — Architecture & Context

**Last Updated**: 2026-03-17 (Session 7)

## System Overview

Perappos is a personal app OS that lets users install web apps from URLs or ZIPs, run them in sandboxed WebViews with native bridge APIs, and collaborate on shared app state in real-time.

```
+-----------------------+
|    Expo Router        |  File-based navigation
|    (app/ directory)   |
+-----------+-----------+
            |
  +---------+---------+
  |                   |
  v                   v
+--------+    +----------------+
| Tabs   |    | WebView Runner |
| (Home, |    | (app/[id].tsx) |
| Disc., |    +-------+--------+
| Sett.) |            |
+--------+     +------+------+
               |             |
               v             v
        +-----------+  +-----------+
        | vaultShim |  | vaultShim |
        | (personal)|  | Sync      |
        |           |  | (shared)  |
        +-----+-----+  +-----+-----+
              |               |
              v               v
        +-----------+  +----------------+
        | vaultBridge|  | bridge-merge-  |
        | (native)  |  | handler (3-way)|
        +-----+-----+  +-------+--------+
              |                 |
     +--------+--------+       |
     |                 |       |
     v                 v       v
+---------+    +------------------+
| expo-   |    | PowerSync DB     |
| sqlite  |    | (powersync.db)   |
| (local) |    +--------+---------+
+---------+             |
                        v
                +---------------+
                | Supabase      |
                | (remote sync) |
                +---------------+
```

## Data Flow

### Personal App Data
1. Mini-app calls `localStorage.setItem()` or `window.VaultAPI.db.set()`
2. `vaultShim.ts` intercepts and sends JSON message to native
3. `vaultBridge.ts` routes to expo-sqlite `app_data` table (scoped by `app_id`)
4. If user is signed in, PowerSync syncs `app_data` to Supabase

### Shared App Data (Collaboration)
1. Mini-app calls `localStorage.setItem()` in shared mode
2. `vaultShimSync.ts` tracks base version, debounces, sends `ls_set_sync` message
3. `vaultBridge.ts` validates shared context, forwards to `handleSharedWrite()`
4. `bridge-merge-handler.ts` reads current row, picks merge strategy (noop/fast_path/array_merge/object_merge/lww)
5. Writes merged result to PowerSync `shared_app_data` with updated merge metadata
6. PowerSync syncs to Supabase; other members receive the merged state
7. WebView receives `{ newVersion, newValue? }` acknowledgement; shim updates `_cache` and `_baseState`

**✅ Fixed (Session 4):** Writes from the current device now reliably reach Supabase and persist correctly. Four bugs were fixed: (1) `ls_set` was silently dropped for shared apps, (2) PowerSync post-upload local clear caused `readCurrentRow` to return null → version=1 → versioned RPC rejected all writes (fixed with `_versionCache`), (3) `loadShimPayload`'s `useCallback` dep on `syncDb` caused the initial load `useEffect` to re-fire on every sync → WebView reloaded with wrong data (fixed with `syncDbRef` pattern), (4) personal-fallback loaded version=0 for all keys → all writes rejected (fixed with Supabase direct-query fallback).

**✅ Fixed (Session 6):** Remote updates from other devices now appear in the live WebView. A PowerSync `db.watch()` watcher in `app/app/[id].tsx` detects `shared_app_data` changes, filters own-write echoes via `ownWriteIds` ref, and injects `_VaultSyncPush(updates)` into the WebView. The shim saves state to `window.name` and calls `location.reload()` (800ms debounce) — this is the only universal approach that works across all frameworks since most vibe-coded apps use `useState(() => localStorage.getItem(...))` which only reads on mount. Trade-off: the app navigates to its landing screen on reload. See `learning.md` entries #17 and #18.

### App Installation (URL)
1. Fetch HTML from URL
2. BFS crawl: parse `<script src>`, `<link href>`, `<img src>` on same origin
3. Download assets to `{DocumentDirectory}/apps/{id}/`, maintaining paths
4. Scan JS for `import()` / `from` references for code-split chunks
5. Rewrite HTML paths from absolute to relative
6. Store metadata in `apps` table
7. Load in WebView via `file://` URI

## External Integrations

### Supabase
- **Auth**: Email + password. Signup requires OTP email confirmation; login uses `signInWithPassword` (no OTP step). Login is mandatory at startup (`app/login.tsx`) — unauthenticated users are gated at the root layout before seeing any app content.
- **Database**: Shared instance tables, app data sync
- **RPCs**: `lookup_shared_instance`, `add_instance_member`
- **RLS**: Enforced on all tables; shared writes need member-of-instance check
- **Config location**: `.env` (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY)

### PowerSync
- **Purpose**: Offline-first sync between expo-sqlite and Supabase
- **Config location**: `.env` (EXPO_PUBLIC_POWERSYNC_URL)
- **Tables synced**: `app_data`, `installed_apps`, `session_data`, `shared_instances`, `instance_members`, `shared_app_data`
- **CRUD upload**: `SupabaseConnector.ts` handles PUT/PATCH/DELETE with special logic for `shared_app_data` (natural-key upsert)

### EAS (Expo Application Services)
- **Build profiles**: iOS TestFlight, Android preview
- **Project ID**: `2ebec141-aefa-43b8-b6f3-377add3fcc4d`
- **Bundle ID**: `com.perappos.app`

## Environment Setup

- **Node.js**: 20+
- **Package manager**: Yarn 1.x
- **iOS**: Xcode required
- **Android**: Android Studio required
- **Required env vars**: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_POWERSYNC_URL`

## Auth & Navigation Gate

The root layout (`app/_layout.tsx`) enforces authentication before any content is shown:

1. `SplashScreen.preventAutoHideAsync()` — native splash locked on app start
2. Parallel: deep-link init (`isDeepLinkReady`) + `supabase.auth.getSession()` (`sessionChecked`)
3. Splash hidden only once **both** flags are true
4. If no session → `router.replace('/login')` (full-screen, `gestureEnabled: false`)
5. If session exists → user lands directly on `/(tabs)`
6. `onAuthStateChange` listener in root layout handles sign-out → auto-redirects to `/login`

Two auth screens exist:
- `app/login.tsx` — mandatory full-screen login (no close button); replaces to `/(tabs)` on success. Shows Sign In and Create Account modes with a toggle.
- `app/auth.tsx` — dismissable modal used from Settings → "Sign In" (post-login account mgmt). Same email+password flow.

### User-change guard (`AuthChangeGuard` + `useUserChangeGuard`)
`AuthChangeGuard` sits inside `<PowerSyncProvider>` (so it has access to both SQLite and PowerSync contexts). On every `SIGNED_IN`/`TOKEN_REFRESHED` event it calls `useUserChangeGuard.checkUserChange(userId)`:
- Reads `lastUserId` from `expo-sqlite/kv-store`.
- If IDs differ AND local `apps` table has rows → shows `UserChangeWarningModal`.
- "Continue & Erase": calls `powerSyncDb.disconnectAndClear()`, wipes SQLite tables, deletes bundle cache, persists new `lastUserId`, reconnects PowerSync.
- "Cancel": calls `supabase.auth.signOut()` → root layout redirects to `/login`, old data intact.
- First login / same user / no local data → no modal; just persists `lastUserId`.

`powerSyncDb` and `connector` are exported from `services/sync/PowerSyncProvider.tsx` so the guard hook can call them without going through React context.

## Key Directories

| Directory | Purpose |
|---|---|
| `app/` | Expo Router pages and layouts |
| `app/(tabs)/` | Tab navigation (Home, Discover, Settings) |
| `app/app/` | WebView runner screen |
| `services/` | Business logic (auth, collaboration, sync) |
| `services/sync/` | PowerSync provider, connector, merge engine |
| `lib/` | WebView bridge, shims, update system |
| `hooks/` | Custom React hooks (useDatabase, useInstalledApps, useUserChangeGuard) |
| `utils/` | Utilities (demo app seeding) |
| `components/` | Reusable UI components (Toast, Themed) |
| `assets/` | App icons, splash images |
