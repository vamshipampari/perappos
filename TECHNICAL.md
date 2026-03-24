# Cottix — Technical Reference

## Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Expo (new arch) | SDK 55 |
| Routing | expo-router | ~55.0.3 |
| Styling | NativeWind (Tailwind for RN) | ^4.2.2 |
| Local DB | expo-sqlite | ~55.0.10 |
| Sync DB | PowerSync (`@powersync/react-native`) | latest |
| Backend | Supabase (`@supabase/supabase-js`) | latest |
| Animations | react-native-reanimated | 4.2.1 |
| WebView | react-native-webview | 13.16.0 |
| Language | TypeScript | ~5.9.2 |
| React | 19.2.0 | — |
| React Native | 0.83.2 | — |

## File Structure

```
cottix/
├── app/
│   ├── _layout.tsx          Root layout — SQLiteProvider + PowerSyncProvider + Stack navigator
│   ├── login.tsx            Full-screen gate — mandatory OTP sign-in (no close, gestureEnabled:false)
│   ├── auth.tsx             Modal — dismissable OTP sign-in (Settings → Sign In)
│   ├── add.tsx              Modal — add new app (URL or ZIP)
│   ├── join-shared-app.tsx  Screen — join collaborative app via invite code
│   ├── shared-apps.tsx      Screen — legacy shared link management
│   ├── +native-intent.tsx   Deep-link redirect for auth/callback
│   ├── app/
│   │   └── [id].tsx         Full-screen WebView runner (BFS asset crawler, update support)
│   ├── share/
│   │   └── [code].tsx       Legacy deep-link route fallback for shared links
│   └── (tabs)/
│       ├── _layout.tsx      Tab bar (Home, Discover, Settings)
│       ├── index.tsx        Home screen — app grid
│       ├── discover.tsx     Discover screen (placeholder)
│       └── settings.tsx     Settings screen (sync status, debug button)
├── services/
│   ├── supabase.ts          Supabase client (persistSession, autoRefreshToken)
│   ├── collaborationService.ts  Shared instance create/join/leave/stop logic
│   ├── appInstaller.ts       Reusable URL app installer helper
│   └── sync/
│       ├── PowerSyncProvider.tsx  PowerSync DB init, auth-gated connect/disconnect
│       ├── SupabaseConnector.ts   PowerSync backend connector (fetchCredentials, uploadData)
│       ├── bridge-merge-handler.ts Merge-aware shared write path for `shared_app_data`
│       └── schema.ts              PowerSync table schema (personal + shared tables)
├── lib/
│   ├── vaultBridge.ts       WebView → native message handler (db/ls/device/auth/app ops)
│   ├── vaultShim.ts         JS shim injected into WebView before page load
│   ├── vaultShimSync.ts     Shared-app shim with base tracking, debounced writes, write acks
│   └── appUpdates.ts        Bundle hash diffing + backup/revert logic
├── hooks/
│   ├── useDatabase.ts         useSQLiteContext() wrapper
│   ├── useInstalledApps.ts    Reads apps table; exposes refresh(), recordOpen()
│   └── useUserChangeGuard.ts  Detects user switch, drives wipe confirmation flow
├── utils/
│   └── createDemoApp.ts     Seeds demo apps on first launch
├── global.css               @tailwind directives
├── tailwind.config.js       NativeWind preset + custom colors
├── babel.config.js          babel-preset-expo + nativewind/babel
├── metro.config.js          withNativeWind wrapper
└── nativewind-env.d.ts      NativeWind type reference
```

## Database Schema

### `apps`
Primary store for installed mini-apps.

| Column | Type | Default | Notes |
|---|---|---|---|
| app_id | TEXT PK | — | UUID |
| name | TEXT | — | Display name |
| icon_emoji | TEXT | 📱 | Shown in grid icon |
| icon_bg_color | TEXT | #E5E7EB | Hex color for icon background |
| bundle_path | TEXT | — | Local path or URL (for URL-type apps mirrors source_url) |
| source_type | TEXT | 'url' | 'url' or 'zip' |
| source_url | TEXT | NULL | Original URL |
| bundle_hash | TEXT | NULL | SHA256 of bundle for update detection |
| auto_update | INTEGER | 1 | Boolean |
| permissions | TEXT | '[]' | JSON array of permission strings |
| bundle_size | INTEGER | 0 | Bytes |
| installed_at | TEXT | datetime('now') | ISO8601 |
| updated_at | TEXT | datetime('now') | ISO8601 |
| last_opened | TEXT | NULL | ISO8601 |
| open_count | INTEGER | 0 | Lifetime open count |
| instance_id | TEXT | NULL | Shared namespace ID when app is collaborative |

### `app_data` (expo-sqlite — app metadata / non-synced)
Per-app persistent key-value store for local-only data.

| Column | Type | Notes |
|---|---|---|
| app_id | TEXT | FK → apps.app_id |
| key | TEXT | — |
| value | TEXT | JSON string |
| updated_at | TEXT | ISO8601 |
| synced | INTEGER | 0 = local only |

PK: `(app_id, key)`

### `shared_data`
Cross-app shared data (e.g., contacts, preferences).

| Column | Type | Notes |
|---|---|---|
| category | TEXT | Namespace (e.g., 'contacts') |
| key | TEXT | — |
| value | TEXT | JSON string |
| source_app | TEXT | app_id that last wrote this |
| updated_at | TEXT | ISO8601 |

PK: `(category, key)`

### PowerSync shared tables

| Table | Key columns | Notes |
|---|---|---|
| `shared_instances` | `instance_id`, `app_id`, `owner_id`, `invite_code` | Collaborative group namespace per app |
| `instance_members` | `instance_id`, `user_id`, `role` | Membership list (`owner` / `member`) |
| `shared_app_data` | `instance_id`, `app_id`, `key`, `value`, `updated_by`, `updated_at`, `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count` | Shared KV rows synced across members with merge metadata |

## Key Hooks

### `useDatabase()`
```ts
import { useDatabase } from '@/hooks/useDatabase';
const db = useDatabase(); // → SQLiteDatabase
```
Must be used inside a component wrapped by `SQLiteProvider`.

### `useInstalledApps()`
```ts
import { useInstalledApps } from '@/hooks/useInstalledApps';
const { apps, loading, error, refresh, recordOpen } = useInstalledApps();
```
- `apps` — `InstalledApp[]` sorted by `installed_at DESC`
- `refresh()` — re-fetches from DB (call after insert/delete)
- `recordOpen(appId)` — bumps `open_count` and sets `last_opened`

## Design Tokens

| Token | Value | Usage |
|---|---|---|
| Primary blue | `#007AFF` | Buttons, links, FAB |
| Label | `#1C1C1E` | Primary text |
| Secondary label | `#8E8E93` | Captions, placeholders |
| Separator | `#E5E5EA` | Borders, dividers |
| System background | `#FFFFFF` | Screen backgrounds |
| System gray 6 | `#F2F2F7` | Grouped content bg |

## Navigation Routes

| Route | Presentation | Description |
|---|---|---|
| `/(tabs)` | Stack | Tab navigator root |
| `/(tabs)/index` | Tab | Home screen |
| `/(tabs)/discover` | Tab | Discover screen |
| `/(tabs)/settings` | Tab | Settings screen |
| `/auth` | Modal | Email OTP sign-in |
| `/add` | Modal | Add new app |
| `/app/[id]` | Full-screen modal | WebView runner |
| `/join-shared-app` | Card | Join shared app via invite code |
| `/shared-apps` | Card | Legacy shared link management |
| `/share/[code]` | Modal | Legacy deep-link fallback, redirects user to join flow |

## PowerSync Sync Schema (`services/sync/schema.ts`)

PowerSync manages its own SQLite DB (`powersync.db`) separate from expo-sqlite.
All writes to these tables are tracked and uploaded to Supabase via `SupabaseConnector`.

| Table | Key columns | Notes |
|---|---|---|
| `app_data` | `id TEXT` (= `${appId}/${key}`), `user_id`, `app_id`, `key`, `value`, `updated_at` | Synced KV store for mini-app data |
| `installed_apps` | `id TEXT`, `app_id`, `name`, `icon_emoji`, `source_type`, `bundle_hash`, etc. | Reserved for future cross-device app sync |
| `session_data` | `id TEXT`, `app_id`, `session_id`, `key`, `value`, `created_at` | Reserved for ephemeral session state |
| `shared_instances` | `id TEXT`, `instance_id`, `app_id`, `owner_id`, `invite_code` | Shared namespaces user belongs to |
| `instance_members` | `id TEXT`, `instance_id`, `user_id`, `role`, `joined_at` | Members in user-visible shared namespaces |
| `shared_app_data` | `id TEXT`, `instance_id`, `app_id`, `key`, `value`, `updated_by`, `updated_at`, `version`, `last_write_id`, `last_merge_strategy`, `last_conflict_count` | Shared KV rows for collaborative apps with merge/conflict state |

> **Supabase schema note:** The `app_data.id` column in Supabase must be `TEXT` (not `UUID`),
> because PowerSync uses `${appId}/${key}` as a stable composite row ID.
> Run `ALTER TABLE app_data ALTER COLUMN id TYPE TEXT;` if needed.

### PowerSync Connection lifecycle
- `PowerSyncProvider` wraps the app and calls `powerSyncDb.connect(connector)` when a Supabase session exists
- On sign-out, `powerSyncDb.disconnect()` is called
- `SupabaseConnector.fetchCredentials()` provides the PowerSync endpoint URL + Supabase JWT
- `SupabaseConnector.uploadData()` processes the CRUD queue and:
  - attaches `user_id` for personal tables (`app_data`, `installed_apps`, `session_data`)
  - attaches `updated_by` for `shared_app_data`
  - for `shared_app_data` PUT/PATCH: strips the PowerSync compound-string `id` field and upserts by natural key (`onConflict: "instance_id,app_id,key"`), preserving all merge metadata columns
  - for `shared_app_data` DELETE: uses natural key (`instance_id`, `app_id`, `key`) instead of the PowerSync compound-string id

## WebView Bridge (`lib/vaultBridge.ts`)

Mini-apps communicate with native via `window.ReactNativeWebView.postMessage(JSON)`.
The bridge handler (`handleVaultMessage`) routes by `type`:

| Type | Direction | Description |
|---|---|---|
| `ls_set` / `ls_delete` / `ls_clear` | fire-and-forget | localStorage shim for local apps, or fallback shared writes/deletes routed by collaboration mode |
| `ls_set_sync` | request/response | Shared-app write with base-version metadata; handled by merge-aware path before writing `shared_app_data` |
| `db_set` / `db_get` / `db_get_all` / `db_delete` | request/response | VaultAPI.db — reads/writes personal or shared KV store based on collaboration mode |
| `device_haptic` | request/response | Trigger haptic feedback |
| `device_notify` | request/response | Schedule a local notification |
| `device_share` | request/response | Native share sheet (URL or text) |
| `auth_get_user` | request/response | Returns `{ id, email }` for signed-in user |
| `app_get_info` | request/response | Returns app manifest (includes `instance_id` for shared-mode detection) |
| `secrets_set` | request/response | Stores named secret in `expo-secure-store`; global scope (`vault_secret__global__${name}`) — one save per key name works across all mini-apps. Returns `true`. |
| `secrets_fetch` | request/response | Reads stored secret, substitutes `{{secret}}` in request headers, makes native HTTP call, returns `{ status: number, body: string }`. Never exposes secret to WebView JS. Returns `{ error: 'secret_not_found' }` (resolved, not rejected) when key is absent. |
| `storage_upload` | request/response | Opens native Photos picker (`expo-image-picker`), reads file as base64 via `expo-file-system`, converts to `Uint8Array`, uploads to Supabase Storage `user-media`. Returns `{ uri: storagePath, cancelled: false }` or `{ cancelled: true }`. Requires `user-media` bucket INSERT RLS policy. |
| `storage_get_url` | request/response | Creates a 1-hour signed URL from Supabase Storage for a path returned by `storage_upload`. Returns `{ url: string }`. |

The shim (`lib/vaultShim.ts`) is injected via `injectedJavaScriptBeforeContentLoaded` and:
- Intercepts `localStorage.setItem/getItem/removeItem/clear` and routes them to the bridge
- Exposes `window.VaultAPI.db`, `window.VaultAPI.device`, `window.VaultAPI.auth`, `window.VaultAPI.app`, `window.VaultAPI.secrets`, `window.VaultAPI.storage`
- Pre-populates KV data read at load time so initial reads are synchronous
- **Critical**: `vaultShim.ts` (personal apps) and `vaultShimSync.ts` (shared apps) are completely separate files. Any new VaultAPI namespace must be added to BOTH.

For shared apps, `lib/vaultShimSync.ts` is used instead of the basic shim. It adds:
- Per-key base version tracking
- Debounced write queue (`150ms`)
- Client write IDs for idempotency
- Base hash / base value payloads for merge decisions
- Native acknowledgements so the WebView cache can adopt merged values returned by the bridge

## Shared Write Merge Path

Shared app `localStorage` writes do not go directly to SQLite. The current flow is:

1. Shared app loads `vaultShimSync`
2. `localStorage.setItem()` enqueues `ls_set_sync`
3. `lib/vaultBridge.ts` validates shared context and forwards the payload to `handleSharedWrite()`
4. `services/sync/bridge-merge-handler.ts` reads the current `shared_app_data` row and chooses a strategy
5. The resulting row is written back to the PowerSync DB with updated merge metadata
6. The WebView receives `{ newVersion, newValue? }` and updates its local cache/base state

### Merge strategies

- `noop`: suppress write when the value is unchanged from the last known base
- `idempotent_skip`: ignore duplicate client write IDs
- `init_blocked`: reject suspicious startup writes that would clobber fresher shared state
- `fast_path`: accept write when there is no newer remote version
- `array_merge`: three-way merge for arrays with stable item IDs
- `object_merge`: field-level three-way merge for plain objects
- `lww`: last-write-wins fallback for incompatible or low-confidence payloads

### Merge metadata columns

`shared_app_data` carries extra columns used by the merge path:

- `version`: monotonically increasing per natural key
- `last_write_id`: last accepted client write ID
- `last_merge_strategy`: strategy used for the latest write
- `last_conflict_count`: number of conflicts observed during that write

These columns must exist in both the PowerSync schema and the Supabase table, and PowerSync sync rules must include them in the `shared_app_data` projection.

## NativeWind Setup Notes
- v4 requires `presets: [require('nativewind/preset')]` in tailwind.config.js
- Metro config must use `withNativeWind(config, { input: './global.css' })`
- Babel preset: `['babel-preset-expo', { jsxImportSource: 'nativewind' }]` + `'nativewind/babel'`
- `nativewind-env.d.ts` provides `className` prop types for RN components

## Auth

- Auth provider: Supabase (`@supabase/supabase-js`)
- Sign-in screens: `app/login.tsx` (mandatory gate) and `app/auth.tsx` (Settings modal)
- Supabase client config (`services/supabase.ts`) sets:
  - `persistSession: true`
  - `autoRefreshToken: true`
  - `detectSessionInUrl: false`

### Auth Flow (email + password)

#### Sign Up
1. User enters email + password → `supabase.auth.signUp({ email, password })`
2. Supabase sends a 6-digit OTP confirmation code to the email
3. User enters code → `supabase.auth.verifyOtp({ email, token, type: 'signup' })`
4. On success the screen navigates to `/(tabs)`

> **Email template note:** In Supabase Dashboard → Authentication → Email Templates → Confirm signup,
> ensure `{{ .Token }}` is present in the body so the 6-digit code appears in the email.

#### Sign In
1. User enters email + password → `supabase.auth.signInWithPassword({ email, password })`
2. On success: navigates directly to `/(tabs)` — no OTP step
3. Edge case — "Email not confirmed": auto-resends OTP and shows the verification screen so the user can complete signup

#### Resend confirmation code
- `supabase.auth.resend({ type: 'signup', email })` — used by both the initial signup confirmation and the "Resend code" button on the OTP screen.
- 60-second cooldown timer prevents spam.

### User-change guard
When a different Supabase user signs in while local app data exists, `AuthChangeGuard` (in `_layout.tsx`) detects the mismatch via `useUserChangeGuard` and shows `UserChangeWarningModal`. The modal is not dismissable — user must choose "Continue & Erase" (wipes everything, switches to new user) or "Cancel" (signs out, preserves old data). See `hooks/useUserChangeGuard.ts` for wipe sequence.

### Deep-link handling (retained for future use)
`app/_layout.tsx` still listens for `cottix://auth/callback` via `Linking` in case deep-link
auth is re-enabled (e.g., OAuth providers). Handles both hash-token and PKCE code-exchange flows.

## Collaboration Flow (Shared Data)

### Create shared instance
1. User taps `Collaborate` in app menu.
2. App checks existing shared instance for `(owner_id, app_id)` in Supabase:
   - If found: shows existing invite code and re-links local `apps.instance_id`.
   - If not found: creates `shared_instances` row and adds owner via RPC:
     - `add_instance_member(p_instance_id, p_user_id, p_role)`
3. Existing personal `app_data` rows are migrated to `shared_app_data`.
4. Invite code is shown prominently in uppercase.

### Join shared instance
1. User opens `Join Shared App` and enters invite code.
2. Lookup uses RPC (not direct table query):
   - `lookup_shared_instance(p_invite_code)`
3. Membership is added via RPC:
   - `add_instance_member(p_instance_id, p_user_id, p_role='member')`
4. App installs shared app locally if needed, then sets `apps.instance_id`.

### Join diagnostics
- Join flow logs:
  - lookup result + error
  - member-add result + error
  - install result
- A 10-second timeout reports stuck state in an alert.

## Supabase Storage

Mini-apps can upload files via `VaultAPI.storage`. Files land in the `user-media` bucket.

**Storage path format:** `{appId}/{userId}/{timestamp}.{ext}`

**Required RLS policies on `user-media`:**
```sql
-- Allow authenticated users to upload
CREATE POLICY "auth users upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-media');

-- Allow authenticated users to read (needed for signed URL creation)
CREATE POLICY "auth users read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'user-media');
```

**Upload implementation note:** `fetch(file://).blob()` is unreliable in the React Native native context for Supabase uploads. The correct approach is `FileSystem.readAsStringAsync(uri, { encoding: 'base64' })` → `atob()` → `Uint8Array` → `supabase.storage.upload()`. See `lib/vaultBridge.ts` `storage_upload` case.

**Signed URLs:** `storage_get_url` creates 1-hour signed URLs via `supabase.storage.createSignedUrl()`. These are publicly readable within the signing window — suitable for passing directly to external APIs (e.g., Anthropic vision API).

## Supabase Requirements

The shared-sync path depends on Supabase matching the client schema:

- `shared_app_data` must include `version`, `last_write_id`, `last_merge_strategy`, and `last_conflict_count`
- PowerSync sync rules must select those columns for `shared_app_data`
- Supabase RLS on `shared_app_data` must allow `INSERT` and `UPDATE` for users who are members of the target `instance_id` (required for the natural-key upsert path in `SupabaseConnector`)
- The unique constraint `(instance_id, app_id, key)` must exist on `shared_app_data` for the `onConflict` upsert to work correctly
