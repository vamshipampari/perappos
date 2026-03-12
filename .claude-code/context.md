# Perappos — Architecture & Context

**Last Updated**: 2026-03-12

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
7. WebView receives `{ newVersion, newValue? }` acknowledgement

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
- **Auth**: Email OTP sign-in (no magic links)
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

## Key Directories

| Directory | Purpose |
|---|---|
| `app/` | Expo Router pages and layouts |
| `app/(tabs)/` | Tab navigation (Home, Discover, Settings) |
| `app/app/` | WebView runner screen |
| `services/` | Business logic (auth, collaboration, sync) |
| `services/sync/` | PowerSync provider, connector, merge engine |
| `lib/` | WebView bridge, shims, update system |
| `hooks/` | Custom React hooks (useDatabase, useInstalledApps) |
| `utils/` | Utilities (demo app seeding) |
| `components/` | Reusable UI components (Toast, Themed) |
| `assets/` | App icons, splash images |
