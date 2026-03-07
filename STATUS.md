# Perappos — Status

## Current Sprint: Auth + Core UX Stabilization

### ✅ Completed
- NativeWind v4 fully configured (tailwind.config.js, babel.config.js, metro.config.js, global.css)
- Root layout (`app/_layout.tsx`) with SQLiteProvider + DB initialization via `onInit`
- Database schema: `apps`, `app_data`, `shared_data` tables created on first launch
- `hooks/useDatabase.ts` — thin wrapper around `useSQLiteContext()`
- `hooks/useInstalledApps.ts` — reads apps table, exposes `refresh()` and `recordOpen()`
- Tab bar (`app/(tabs)/_layout.tsx`) — Home, Discover, Settings with Unicode icons
- Home screen (`app/(tabs)/index.tsx`):
  - Large title "Perappos"
  - 3-column app grid with Reanimated press-scale animation
  - Empty state with icon, copy, and "Add Your First App" button
  - FAB (shown only when apps are installed)
- Discover screen — placeholder
- Settings screen — full iOS-style grouped list (rounded cards, inset separators):
  - Account: Sign In modal with email OTP flow (6-digit code)
  - General: Appearance (static), App Lock toggle (biometric via expo-local-authentication, persisted), Auto-Update toggle (persisted to SQLite)
  - Data: Storage Used (live SUM(bundle_size)), Export All Data (JSON via expo-sharing), Clear All Data (destructive confirm)
  - About: version, built-in-Hyderabad tagline
- WebView screen (`app/app/[id].tsx`) — full-screen with header bar, reload button
- Add modal (`app/add.tsx`) — name + URL input, emoji + color pickers, live preview
- Supabase auth integration:
  - Email OTP sign-in (`app/auth.tsx`) — two-step flow: enter email → receive 6-digit code → verify
  - No magic link / deep link required; works reliably on simulator and device
  - Supabase session persisted with `detectSessionInUrl: false`
  - Deep-link listener retained in `app/_layout.tsx` for future OAuth provider support
  - `app/+native-intent.tsx` route redirect retained for `auth/callback` deep links

### 🔜 Next Up
- [ ] ZIP bundle support in add.tsx (expo-document-picker + expo-file-system)
- [ ] App update checking (bundle_hash diff)
- [ ] Swipe-to-delete / long-press context menu on home grid
- [ ] Discover screen: curated template list
- [ ] Settings: per-app permissions panel
- [ ] Shared data bridge (WebView ↔ native via postMessage)

### Known Issues / Decisions Pending
- `+html.tsx` and `+not-found.tsx` from default template remain (harmless)
- Tab icons use Unicode characters; may swap for SF Symbols via `@expo/vector-icons` later
