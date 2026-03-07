# Perappos — Technical Reference

## Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Expo (new arch) | SDK 55 |
| Routing | expo-router | ~55.0.3 |
| Styling | NativeWind (Tailwind for RN) | ^4.2.2 |
| Database | expo-sqlite | ~55.0.10 |
| Animations | react-native-reanimated | 4.2.1 |
| WebView | react-native-webview | 13.16.0 |
| Language | TypeScript | ~5.9.2 |
| React | 19.2.0 | — |
| React Native | 0.83.2 | — |

## File Structure

```
perappos/
├── app/
│   ├── _layout.tsx          Root layout — SQLiteProvider + Stack navigator
│   ├── add.tsx              Modal — add new app (URL or ZIP)
│   ├── app/
│   │   └── [id].tsx         Full-screen WebView for running a mini-app
│   └── (tabs)/
│       ├── _layout.tsx      Tab bar (Home, Discover, Settings)
│       ├── index.tsx        Home screen — app grid
│       ├── discover.tsx     Discover screen (placeholder)
│       └── settings.tsx     Settings screen
├── hooks/
│   ├── useDatabase.ts       useSQLiteContext() wrapper
│   └── useInstalledApps.ts  Reads apps table; exposes refresh(), recordOpen()
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

### `app_data`
Per-app persistent key-value store (accessible via WebView bridge).

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

## NativeWind Setup Notes
- v4 requires `presets: [require('nativewind/preset')]` in tailwind.config.js
- Metro config must use `withNativeWind(config, { input: './global.css' })`
- Babel preset: `['babel-preset-expo', { jsxImportSource: 'nativewind' }]` + `'nativewind/babel'`
- `nativewind-env.d.ts` provides `className` prop types for RN components

## Auth

- Auth provider: Supabase (`@supabase/supabase-js`)
- Sign-in screen: `app/auth.tsx` — two-step email OTP flow
- Supabase client config (`services/supabase.ts`) sets:
  - `persistSession: true`
  - `autoRefreshToken: true`
  - `detectSessionInUrl: false`

### OTP Flow
1. User enters email → `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`
   - Supabase emails a 6-digit code (no magic link / no deep link required)
   - Requires the Supabase email template to include `{{ .Token }}`
2. User enters code → `supabase.auth.verifyOtp({ email, token, type: 'email' })`
3. On success → `router.replace('/(tabs)/settings')`

> **Email template note:** In Supabase Dashboard → Authentication → Email Templates → Magic Link,
> add `{{ .Token }}` to the body so the 6-digit code appears in the email.

### Deep-link handling (retained for future use)
`app/_layout.tsx` still listens for `perappos://auth/callback` via `Linking` in case deep-link
auth is re-enabled (e.g., OAuth providers). Handles both hash-token and PKCE code-exchange flows.
