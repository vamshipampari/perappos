# Cottix — Manual Test Cases

**Version:** 0.2.0
**Last Updated:** 2026-03-28
**Platform Coverage:** iOS (primary) · Android
**Devices Needed:** 2× physical devices or simulators recommended for sync/collaboration tests

---

## How to Use This Document

- **Priority:** P0 = ship blocker · P1 = major regression · P2 = important · P3 = edge case / nice-to-have
- **Status column:** ✅ Pass · ❌ Fail · ⚠️ Partial · ⬜ Not yet tested
- Each section has a brief **Preconditions** block — set up state before running cases in that section.
- Regression tags (`[REG-xxx]`) flag areas where known bugs have been fixed and must not regress.

---

## Table of Contents

1. [Authentication & Onboarding](#1-authentication--onboarding)
2. [App Installation](#2-app-installation)
3. [Home Screen & App Grid](#3-home-screen--app-grid)
4. [WebView Runner & Bridge](#4-webview-runner--bridge)
5. [VaultAPI — Mini-App APIs](#5-vaultapi--mini-app-apis)
6. [Settings Screen](#6-settings-screen)
7. [API Keys Management](#7-api-keys-management)
8. [Plan Tiers, Limits & Promo Codes](#8-plan-tiers-limits--promo-codes)
9. [Sharing & Collaboration](#9-sharing--collaboration)
10. [Cross-Device Sync](#10-cross-device-sync)
11. [App Updates & Versioning](#11-app-updates--versioning)
12. [Create with AI](#12-create-with-ai)
13. [Data Management](#13-data-management)
14. [Performance & Resilience](#14-performance--resilience)
15. [Regression Checklist](#15-regression-checklist)

---

## 1. Authentication & Onboarding

### Preconditions
- App freshly installed OR signed out
- Valid email address accessible during test

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| AUTH-01 | Full sign-up flow | P0 | 1. Open app cold<br>2. Verify login screen appears (no close button, not dismissable)<br>3. Tap "Create Account"<br>4. Enter valid email + password (8+ chars)<br>5. Tap Sign Up<br>6. Enter 6-digit OTP from email<br>7. Tap Verify | App navigates to home screen. Demo apps visible. PowerSync connects. | ⬜ |
| AUTH-02 | Sign-up with weak password | P1 | Enter password < 6 chars → tap Sign Up | Inline validation error shown. No network call fired. | ⬜ |
| AUTH-03 | Sign-up with invalid email | P1 | Enter "notanemail" → tap Sign Up | Inline validation error. | ⬜ |
| AUTH-04 | Sign-up with already-registered email | P1 | Use existing email → complete signup | Supabase returns error. User-visible error message shown (not crash). | ⬜ |
| AUTH-05 | Wrong OTP code | P1 | Enter 6-digit OTP, change one digit → Verify | Error message shown: "Invalid or expired code". Stays on OTP screen. | ⬜ |
| AUTH-06 | Expired OTP code | P2 | Wait 10 mins after signup → enter original code | Error shown. Resend button available. | ⬜ |
| AUTH-07 | Resend OTP cooldown | P2 | On OTP screen, tap Resend | Button disabled for 60s with countdown. After 60s, re-enabled. | ⬜ |
| AUTH-08 | Sign-in flow (existing user) | P0 | 1. Choose "Sign In" mode<br>2. Enter correct email + password<br>3. Tap Sign In | Navigates directly to home screen — no OTP step. | ⬜ |
| AUTH-09 | Sign-in with wrong password | P1 | Enter correct email, wrong password | Error message: "Invalid login credentials". Stays on login screen. | ⬜ |
| AUTH-10 | Sign-in — email not confirmed | P1 | Sign up but do NOT verify OTP, then attempt sign in | Auto-resends OTP, navigates to OTP verification screen. Error not shown raw. | ⬜ |
| AUTH-11 | Login screen cannot be dismissed | P0 | Swipe down on login screen | Screen does not dismiss. No back button visible. | ⬜ |
| AUTH-12 | Sign out | P0 | Settings → Sign Out → Confirm | Redirected to `/login`. Home screen not accessible without re-auth. PowerSync disconnects. | ⬜ |
| AUTH-13 | Sign out then back in | P1 | Sign out → sign back in with same account | App data preserved. Same apps appear. | ⬜ |
| AUTH-14 | Auth modal from Settings (dismissable) | P1 | Sign out → Settings → Sign In (modal) | Modal appears with close button. Dismissable by swipe. | ⬜ |
| AUTH-15 | Auth modal on success closes | P1 | Settings → Sign In modal → successfully sign in | Modal dismisses automatically. Settings screen updates with account info. | ⬜ |
| AUTH-16 | User-switch guard triggers | P1 [REG-01] | 1. Sign in as User A, install 1+ real apps<br>2. Sign out<br>3. Sign in as User B | Non-dismissable "Different Account Detected" modal appears. | ⬜ |
| AUTH-17 | User-switch: cancel keeps User A data | P1 | In user-switch modal → tap Cancel | Signs out User B. Returns to login. User A data still intact. | ⬜ |
| AUTH-18 | User-switch: erase and continue | P1 | In user-switch modal → "Continue & Erase" | SQLite wiped. Demo apps re-seeded. PowerSync reconnects for User B. | ⬜ |
| AUTH-19 | User-switch guard skips for demo-only | P1 [REG-02] | 1. Fresh install (only demo apps exist)<br>2. Sign in as User B | User-switch modal does NOT appear. | ⬜ |
| AUTH-20 | App Lock — enable with biometrics | P2 | Settings → App Lock toggle ON | Biometric prompt appears. On success, toggle turns on. | ⬜ |
| AUTH-21 | App Lock — biometric required on next open | P2 | Enable App Lock, background app, reopen | Biometric prompt shown before home screen visible. | ⬜ |
| AUTH-22 | App Lock — cancel biometric | P2 | Biometric prompt → cancel | App remains locked. Prompt shown again on retry. | ⬜ |
| AUTH-23 | OTP on Bluetooth keyboard | P2 [REG-03] | Physical Bluetooth keyboard → type 6-digit OTP | All digits register correctly (no blocked number key rows). | ⬜ |
| AUTH-24 | Cold start — auth check before home screen | P0 | Kill app → reopen while signed in | Splash stays until auth check completes. No flash of login screen for authenticated user. | ⬜ |

---

## 2. App Installation

### Preconditions
- Signed-in user
- Test URLs handy: a simple Lovable/Bolt app, a plain HTML page

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| INST-01 | Add app from URL | P0 | Add modal → paste URL → Next → Install | App appears in grid. Metadata (name, emoji, color) fetched. Bundle saved locally. | ⬜ |
| INST-02 | URL with metadata auto-fill | P1 | Add URL for a Lovable/v0 app | Title, icon, and color auto-extracted from page `<title>` and meta tags. | ⬜ |
| INST-03 | Custom name override | P1 | Change auto-filled name before installing | Custom name shown in grid tile. | ⬜ |
| INST-04 | Custom emoji/color | P1 | Change emoji and color before installing | Tile reflects chosen emoji and background color. | ⬜ |
| INST-05 | Add app from ZIP | P1 | Select ZIP file → install | App extracted, HTML entry detected, metadata parsed, app installs. | ⬜ |
| INST-06 | ZIP without index.html | P2 | Upload ZIP with no HTML entry point | Graceful error shown. App not installed. | ⬜ |
| INST-07 | Add app from HTML file | P1 | Pick `.html` file → install | File parsed, deployed to Cloudflare KV, saved locally, app appears in grid. | ⬜ |
| INST-08 | HTML paste flow | P1 | Paste HTML in textarea → install | Same as INST-07. | ⬜ |
| INST-09 | HTML too large (> 5 MB) | P1 | Try installing HTML > 5 MB | Error shown: size exceeds limit. App not installed. | ⬜ |
| INST-10 | HTML deploy Cloudflare failure — graceful fallback | P2 | Disconnect network during HTML install → install | Warning shown but app installs with local `bundle_html` fallback. Works offline. | ⬜ |
| INST-11 | Install gate at free limit (5 apps) | P0 | Install 5 apps on free plan, attempt 6th | Gate alert shown: "Upgrade to install more apps". 6th app NOT installed. | ⬜ |
| INST-12 | Install gate uses local count (not Supabase) | P1 [REG-04] | Clear All Data, reinstall 5 apps, attempt 6th | Local SQLite count used, not stale Supabase counter. Gate triggers correctly at 5. | ⬜ |
| INST-13 | Beta plan bypasses 5-app gate | P1 | Redeem BETA2026, try installing 6+ apps | No gate. Apps install freely. | ⬜ |
| INST-14 | Duplicate URL install | P2 | Install same URL twice | Second install shows existing entry (no duplicate tile) OR updates existing. | ⬜ |
| INST-15 | Invalid URL | P1 | Enter "not-a-url" in URL field | Inline error shown. Fetch not initiated. | ⬜ |
| INST-16 | URL with Devanagari danda | P1 [REG-05] | On Indian keyboard, type a URL like `netlify।app` | `।` normalised to `.`. URL is valid. | ⬜ |
| INST-17 | Network unavailable during URL install | P1 | Airplane mode → add URL app | Error message. App NOT partially installed. | ⬜ |
| INST-18 | Install counter increments | P1 | Install app, check Settings account card | App count increments (local count). | ⬜ |
| INST-19 | Delete counter decrements | P1 | Delete installed app, check Settings | App count decrements. | ⬜ |
| INST-20 | Cancel mid-install | P2 | Start URL install → tap Cancel during asset fetch | No orphaned app in grid. No partial DB row. | ⬜ |
| INST-21 | Add app auto-correct blocked | P2 [REG-06] | Type app name with autocorrect ON | Autocorrect/spellcheck does not mangle app name. | ⬜ |

---

## 3. Home Screen & App Grid

### Preconditions
- At least 3 apps installed (mix of URL and demo)

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| HOME-01 | App grid renders all non-demo installs | P0 | Install 2 real apps. View home | Both real apps + demo apps shown in grid. | ⬜ |
| HOME-02 | Empty state (no apps) | P1 | Clear all data → view home | Empty state illustration + "Add Your First App" button shown. No FAB. | ⬜ |
| HOME-03 | FAB visible with apps | P1 | Install 1 app → view home | FAB (+) visible in bottom-right corner. | ⬜ |
| HOME-04 | FAB hidden when no apps | P1 | Clear all data → view home | FAB hidden. Only empty state button shows. | ⬜ |
| HOME-05 | App count subtitle | P1 | Install 3 apps → view title area | Subtitle shows "3 apps installed" (non-demo count only). | ⬜ |
| HOME-06 | Large title collapses on scroll | P2 | Scroll down in app grid | Large "Cottix" title collapses to small nav title. Subtitle fades. | ⬜ |
| HOME-07 | Tap app → opens WebView | P0 | Tap any app tile | App runner opens, WebView loads. | ⬜ |
| HOME-08 | Long-press → context menu | P0 | Long-press any app tile | Action sheet appears with correct actions. | ⬜ |
| HOME-09 | Context menu: Open | P1 | Long-press → Open | Same as tapping — opens WebView. | ⬜ |
| HOME-10 | Context menu: Delete | P0 | Long-press → Delete → Confirm | App removed from grid. Count decrements. No app data remains. | ⬜ |
| HOME-11 | Delete refreshes list immediately | P1 [REG-07] | Delete app → observe grid | Grid updates without navigating away (no stale tile visible). | ⬜ |
| HOME-12 | Context menu: App Info | P1 | Long-press → App Info | Modal shows: name, URL, size, installed date, open count. | ⬜ |
| HOME-13 | Context menu: Share App | P1 | Long-press → Share App | Native iOS/Android share sheet opens with app URL. | ⬜ |
| HOME-14 | Context menu: Manage Group (shared app) | P1 | For a shared app: Long-press → Manage Group | Navigates to shared instance management screen. | ⬜ |
| HOME-15 | Shared app badge (👥) shows | P1 | App with `instance_id` set | 👥 badge visible on tile. | ⬜ |
| HOME-16 | Pull-to-refresh triggers update scan | P2 | Pull down on home screen | Spinner shows. Update badges appear on outdated apps. | ⬜ |
| HOME-17 | Reanimated press animation | P3 | Tap and hold app tile briefly | Scale-down animation plays. Spring back on release. | ⬜ |
| HOME-18 | Demo apps excluded from count | P1 [REG-02] | Fresh install (3 demo apps) | Count shows "0 apps installed" not "3". | ⬜ |
| HOME-19 | App order: sorted by installed_at DESC | P2 | Install apps A, B, C | C shows first, A last. | ⬜ |
| HOME-20 | Context menu: Export Data | P2 | Long-press → Export Data | Native share sheet opens with JSON file of app's KV data. | ⬜ |

---

## 4. WebView Runner & Bridge

### Preconditions
- At least 1 non-demo app installed
- App has stored data (open it, interact with it)

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| WEB-01 | App loads from URL | P0 | Open URL-type app | WebView loads app from remote URL. No blank screen. | ⬜ |
| WEB-02 | App loads from local bundle | P0 | Open bundled app (ZIP/HTML) | WebView loads from local bundle. Works in airplane mode. | ⬜ |
| WEB-03 | Shim injected — localStorage intercepted | P0 | Open app, use `localStorage.setItem('test','1')` via devtools or console | Bridge message fired. Value saved to PowerSync `app_data`. | ⬜ |
| WEB-04 | localStorage reads are synchronous | P0 | Open app that reads localStorage on init | Data available immediately (pre-populated from shim payload). No async delay. | ⬜ |
| WEB-05 | App header shows name | P1 | Open any app | Correct app name shown in navigation header. | ⬜ |
| WEB-06 | Three-dot menu opens | P1 | Tap ··· icon in app header | Action sheet opens with options. | ⬜ |
| WEB-07 | Three-dot menu: App Info | P1 | ··· → App Info | Modal shows app metadata. | ⬜ |
| WEB-08 | Three-dot menu: Share | P1 | ··· → Share App | Share sheet opens. | ⬜ |
| WEB-09 | Three-dot menu: Delete | P1 | ··· → Delete → Confirm | Returns to home. App removed from grid. | ⬜ |
| WEB-10 | Three-dot menu: Collaborate | P1 | ··· → Collaborate | Shared instance create flow starts. | ⬜ |
| WEB-11 | iOS viewport fix — no auto-zoom on focus | P1 [REG-08] | Open app with text input, tap input field on iOS | No viewport zoom. Keyboard appears but content does not zoom. | ⬜ |
| WEB-12 | Android keyboard resizes viewport | P1 | Open app with input, tap field on Android | Content above keyboard remains visible (viewport resizes, not pan). | ⬜ |
| WEB-13 | `automaticallyAdjustKeyboardInsets` (iOS) | P1 | Open app with bottom-fixed element, tap input | Bottom-fixed button stays above keyboard. | ⬜ |
| WEB-14 | Over-scroll disabled (Android) | P2 | Android: try to over-scroll content | No over-scroll glow / bounce effect. | ⬜ |
| WEB-15 | Splash overlay cross-fades on load | P2 | Open app | App-themed splash (icon + background) visible, then cross-fades out when WebView is ready. | ⬜ |
| WEB-16 | `open_count` increments on open | P2 | Open app 3 times, check App Info | Open count = 3. `last_opened` timestamp updated. | ⬜ |
| WEB-17 | Back navigation works | P1 | Press back/swipe from WebView | Returns to home screen. | ⬜ |
| WEB-18 | Frozen instance banner shows | P0 | Shared app with `is_frozen = 1` | Yellow amber banner with lock icon visible above WebView. | ⬜ |
| WEB-19 | Frozen: `window.__vaultInstanceFrozen` injected | P1 | Open frozen shared app, check JS console | `window.__vaultInstanceFrozen === true` + `vaultInstanceFrozen` event fired. | ⬜ |
| WEB-20 | WebView debug enabled in dev mode | P3 | Run dev build, open Safari/Chrome devtools | WebView inspectable from desktop browser devtools. | ⬜ |

---

## 5. VaultAPI — Mini-App APIs

### Preconditions
- A test mini-app that exercises each VaultAPI (use the Cottix debug/demo app or a custom HTML snippet)
- Signed-in user with valid session

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| VAULT-01 | `VaultAPI.db.set(key, value)` | P0 | Call `VaultAPI.db.set('myKey', {data: 1})` | Returns `true`. Value saved to PowerSync `app_data`. | ⬜ |
| VAULT-02 | `VaultAPI.db.get(key)` | P0 | After VAULT-01, call `VaultAPI.db.get('myKey')` | Returns `{data: 1}` synchronously (pre-populated). | ⬜ |
| VAULT-03 | `VaultAPI.db.getAll()` | P1 | After setting 3 keys, call `VaultAPI.db.getAll()` | Returns object with all 3 key-value pairs. | ⬜ |
| VAULT-04 | `VaultAPI.db.delete(key)` | P1 | Delete a key, then get it | `get` returns `null`. | ⬜ |
| VAULT-05 | `VaultAPI.auth.getUser()` | P0 | Call `VaultAPI.auth.getUser()` | Returns `{id: "<uuid>", email: "<email>"}` matching signed-in user. | ⬜ |
| VAULT-06 | `VaultAPI.app.getInfo()` | P1 | Call `VaultAPI.app.getInfo()` | Returns app manifest: id, name, instanceId (null if personal). | ⬜ |
| VAULT-07 | `VaultAPI.device.haptic('medium')` | P2 | Call haptic from mini-app | Device vibrates (physical device required). | ⬜ |
| VAULT-08 | `VaultAPI.device.notify({title, body})` | P2 | Call notify, check notifications | Local notification scheduled. Appears after delay. | ⬜ |
| VAULT-09 | `VaultAPI.device.share({url})` | P2 | Call share with a URL | Native share sheet opens with correct content. | ⬜ |
| VAULT-10 | `VaultAPI.secrets.set(name, value)` | P0 | Set secret "OPENAI_KEY" with a test value | Returns `true`. Stored in SecureStore. Appears in Settings → API Keys. | ⬜ |
| VAULT-11 | `VaultAPI.secrets.fetch(name, {url, headers})` | P0 | Call secrets.fetch with `{{secret}}` in Authorization header | HTTP call made natively. `{{secret}}` substituted with stored value. Response returned. Secret never in WebView. | ⬜ |
| VAULT-12 | `secrets.fetch` — secret not found | P1 | Call `secrets.fetch('NONEXISTENT_KEY', ...)` | Returns `{error: 'secret_not_found'}` (resolved, not rejected). No crash. | ⬜ |
| VAULT-13 | `VaultAPI.storage.upload()` | P1 | Call `storage_upload` | Photos picker opens. Selecting image uploads to Supabase `user-media`. Returns `{uri: path}`. | ⬜ |
| VAULT-14 | `VaultAPI.storage.upload()` — cancel | P1 | Call `storage_upload`, cancel picker | Returns `{cancelled: true}`. No error thrown. | ⬜ |
| VAULT-15 | `VaultAPI.storage.getUrl(uri)` | P1 | After upload, call `getUrl(uri)` | Returns a valid 1-hour signed URL. URL accessible in browser. | ⬜ |
| VAULT-16 | VaultAPI.secrets available in shared app | P1 [REG-09] | Open shared app, call `VaultAPI.secrets.set(...)` | Works — shared shim includes secrets API. No `undefined` error. | ⬜ |
| VAULT-17 | VaultAPI.storage available in shared app | P1 [REG-09] | Open shared app, call `VaultAPI.storage.upload()` | Works — shared shim includes storage API. | ⬜ |
| VAULT-18 | Native module crash isolation | P1 [REG-10] | Simulate missing native module (dev build) | Bridge continues functioning for other message types. Module error isolated. | ⬜ |
| VAULT-19 | localStorage.clear() | P1 | Call `localStorage.clear()` | All keys for this app removed from PowerSync `app_data`. | ⬜ |
| VAULT-20 | localStorage.removeItem(key) | P1 | Set key, then remove it | Key removed. `getItem` returns null. | ⬜ |

---

## 6. Settings Screen

### Preconditions
- Signed-in user with a few apps installed

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| SET-01 | Account card shows correct email | P0 | Open Settings | Email matches signed-in account. | ⬜ |
| SET-02 | Plan badge shows correct plan | P0 | Open Settings | Correct plan badge color and label (Free/Beta/Pro/Team). | ⬜ |
| SET-03 | Plan expiry shown if applicable | P1 | Open Settings with time-limited plan | Expiry date shown below plan badge. | ⬜ |
| SET-04 | App count matches home screen | P0 [REG-04] | Install 3 apps → open Settings | "Apps installed" count = 3 (local count, not Supabase counter). Matches home screen. | ⬜ |
| SET-05 | Shared instance count shown (beta/pro) | P1 | Create 1 shared instance → Settings | Shared count row shows "1 / 5". | ⬜ |
| SET-06 | Redeem Code button opens sheet | P1 | Tap "Redeem Code" | `PromoCodeSheet` modal appears. | ⬜ |
| SET-07 | Promo code BETA2026 redeems | P0 | Enter BETA2026 → Redeem | Success toast. Plan changes to Beta. Badge updates. | ⬜ |
| SET-08 | Promo code PERAPPOS redeems (lifetime) | P0 | Enter PERAPPOS → Redeem | Plan = Beta, no expiry date shown. | ⬜ |
| SET-09 | Promo code VIBECODER redeems | P1 | Enter VIBECODER → Redeem | Plan = Beta for 30 days. Expiry shown. | ⬜ |
| SET-10 | Invalid promo code rejected | P1 | Enter "NOTACODE" → Redeem | Error shown: invalid code. Plan unchanged. | ⬜ |
| SET-11 | Already-used code rejected | P2 | Redeem same code twice | Error on second attempt. | ⬜ |
| SET-12 | Auto-Update toggle persists | P1 | Toggle Auto-Update OFF, close Settings, reopen | Toggle remains OFF. | ⬜ |
| SET-13 | Storage Used is accurate | P1 | Check after installing apps | Sum of all `bundle_size` values shown in human-readable format (e.g., "2.4 MB"). | ⬜ |
| SET-14 | Export All Data | P1 | Tap Export All Data | Native share sheet opens with a JSON file containing all app KV data. | ⬜ |
| SET-15 | Clear All Data — confirmation required | P0 | Tap Clear All Data | Confirmation dialog appears. Destructive red button labeled "Clear". | ⬜ |
| SET-16 | Clear All Data — actually clears | P0 | Confirm Clear All Data | All installed apps removed. Demo apps re-seeded. PowerSync rows cleared. | ⬜ |
| SET-17 | Clear All Data — demo apps re-seeded | P1 [REG-11] | Confirm Clear → check home | 3 demo apps appear. Normal apps gone. | ⬜ |
| SET-18 | Version number reads from app.json | P1 | Check Settings → About → Version | Shows "0.2.0" (or current version). Not hardcoded. | ⬜ |
| SET-19 | Debug Sync button shows row count | P2 | Tap "Check Sync DB" | Modal shows count of PowerSync rows per table + sample rows with merge metadata. | ⬜ |
| SET-20 | Feedback Sheet opens | P2 | Tap Feedback | Sheet modal appears with text input. | ⬜ |
| SET-21 | Feedback submits successfully | P2 | Enter feedback text → submit | Success toast. No error. | ⬜ |
| SET-22 | Sign out requires confirmation | P1 | Tap Sign Out | Confirmation dialog shown. | ⬜ |

---

## 7. API Keys Management

### Preconditions
- Signed-in user
- Settings screen open

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| KEY-01 | API Keys section always visible | P0 | Open Settings | "API Keys" section present even with no keys. | ⬜ |
| KEY-02 | Add API Key opens form | P0 | Tap "Add API Key" | Form sheet opens with Name + Value fields. | ⬜ |
| KEY-03 | Add key with name + value | P0 | Enter name "OPENAI" + value → Save | Key appears in list with label "OPENAI" and source "manual". | ⬜ |
| KEY-04 | Value is masked/hidden in list | P1 | Add key → view list | Value not shown in plain text in the list row. | ⬜ |
| KEY-05 | Key saved to SecureStore | P1 | Add key, kill app, reopen Settings | Key still listed (persists across app launches). | ⬜ |
| KEY-06 | Key name saved to SQLite | P1 | Add key, check `shared_data` category `vault_secrets` | Name row exists. Value NOT stored in SQLite (only in SecureStore). | ⬜ |
| KEY-07 | Tap key row → delete confirmation | P1 | Tap any key in list | Confirmation modal: "Delete Key?" with destructive button. | ⬜ |
| KEY-08 | Delete key removes from SecureStore | P0 | Confirm delete | Key removed from list. Cannot be retrieved from SecureStore. | ⬜ |
| KEY-09 | Delete key removes SQLite entry | P1 | Confirm delete | `shared_data` row removed. Key does not reappear on app relaunch. | ⬜ |
| KEY-10 | Key set by mini-app appears in list | P1 | Mini-app calls `VaultAPI.secrets.set('API_K', 'val')` → open Settings | Key shown with source label "from app". | ⬜ |
| KEY-11 | "from app" key can be deleted manually | P1 | Tap "from app" key → delete | Removed from list + SecureStore. | ⬜ |
| KEY-12 | Empty name rejected | P1 | Open Add Key form, leave name blank → Save | Validation error. Key not saved. | ⬜ |
| KEY-13 | Empty value rejected | P1 | Leave value blank → Save | Validation error. Key not saved. | ⬜ |
| KEY-14 | Duplicate key name overwrites | P2 | Add "OPENAI" twice with different values | Second value wins (SecureStore `set` is idempotent). List shows one entry. | ⬜ |
| KEY-15 | Key persists after Clear All Data | P2 | Clear All Data → check API Keys | SecureStore keys should remain (they are device-level, not app data). | ⬜ |

---

## 8. Plan Tiers, Limits & Promo Codes

### Preconditions
- One test account on free plan
- One test account on beta/pro plan

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| PLAN-01 | Free plan: 5-app install limit | P0 | Free account: install 5 apps, try 6th | Gate alert on 6th. Correct CTA to upgrade. | ⬜ |
| PLAN-02 | Free plan: sharing disabled | P0 | Free account: ··· → Collaborate | Gate alert. Cannot create shared instance. | ⬜ |
| PLAN-03 | Beta plan: unlimited app installs | P0 | Beta account: install 10+ apps | No gate triggered. | ⬜ |
| PLAN-04 | Beta plan: up to 5 shared instances | P1 | Beta account: create 5 shared instances, try 6th | Gate alert on 6th. | ⬜ |
| PLAN-05 | Team plan: unlimited shared instances | P1 | Team account: create 6+ shared instances | No gate triggered. | ⬜ |
| PLAN-06 | Plan badge — free is gray | P2 | Free account → Settings | Badge color gray, label "Free". | ⬜ |
| PLAN-07 | Plan badge — beta is purple | P2 | Beta account → Settings | Badge color purple, label "Beta". | ⬜ |
| PLAN-08 | Plan badge — pro is blue | P2 | Pro account → Settings | Badge color blue, label "Pro". | ⬜ |
| PLAN-09 | Plan badge — team is green | P2 | Team account → Settings | Badge color green, label "Team". | ⬜ |
| PLAN-10 | Expired plan auto-downgrades | P1 | Use account with expired beta plan | `get_user_profile` RPC auto-downgrades to Free. Badge updates next open. | ⬜ |
| PLAN-11 | Expired plan triggers shared instance freeze | P1 | Allow beta to expire | Shared instances frozen. Amber banner shown on shared apps. | ⬜ |
| PLAN-12 | Redeem code unfreezes instances | P1 | Frozen instances → redeem PERAPPOS | Instances unfrozen. Amber banner disappears. Writes resume. | ⬜ |
| PLAN-13 | Max redemptions enforced | P2 | Attempt to redeem BETA2026 after 100 redemptions | Error: "Code has reached its maximum redemptions." | ⬜ |
| PLAN-14 | Promo code case-insensitive | P2 | Enter "beta2026" (lowercase) | Code accepted (or normalised server-side). | ⬜ |
| PLAN-15 | Gate alert has correct plan name in CTA | P2 | Hit install gate on free plan | Alert shows "Upgrade to Beta/Pro" (not "Upgrade to plan"). | ⬜ |

---

## 9. Sharing & Collaboration

### Preconditions
- Two physical devices or two simulator instances
- Device A: beta plan user (owner)
- Device B: any signed-in user (member)

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| COLLAB-01 | Create shared instance | P0 | Device A: Open app → ··· → Collaborate | Invite code generated in uppercase. Instance created in Supabase. | ⬜ |
| COLLAB-02 | Invite code is unique | P1 | Create 3 different shared instances | Each has a different invite code. | ⬜ |
| COLLAB-03 | Join shared app from Settings | P0 | Device B: Settings → Join Shared App → enter code | App appears on Device B. `instance_id` set. | ⬜ |
| COLLAB-04 | Join installs app if not present | P1 | Device B doesn't have the app → joins | App auto-installed locally. | ⬜ |
| COLLAB-05 | Shared app shim used after join | P0 | Device B: open joined app | Shared shim (`vaultShimSync`) injected — not personal shim. | ⬜ |
| COLLAB-06 | Write on Device A syncs to Device B | P0 | Device A: set `localStorage.setItem('color','red')` | Within ~3s, Device B sees `color = 'red'` without restart. | ⬜ |
| COLLAB-07 | Write on Device B syncs to Device A | P0 | Device B: set `localStorage.setItem('count','42')` | Device A receives update within ~3s. | ⬜ |
| COLLAB-08 | Concurrent writes — merge resolves | P0 | Both devices write to same key simultaneously | No data loss. Merged value visible on both devices. Strategy logged. | ⬜ |
| COLLAB-09 | Array merge preserves order | P1 | Both add items to an array key | All items from both writes present in merged array. No duplicates. | ⬜ |
| COLLAB-10 | Object merge preserves non-conflicting fields | P1 | Device A sets `{name:'Alice'}`, Device B sets `{age:30}` for same key | Merged: `{name:'Alice', age:30}`. Neither field lost. | ⬜ |
| COLLAB-11 | Shared write rejected when frozen | P0 | Freeze instance → Device A writes | Write rejected. `INSTANCE_FROZEN` error returned. Amber banner shown. | ⬜ |
| COLLAB-12 | Shared app header shows "Shared" pill | P1 | Open a shared app | "Shared" pill visible in header. | ⬜ |
| COLLAB-13 | Manage Group screen shows members | P1 | Owner: open Manage Group | Member list shows owner + all joined members. | ⬜ |
| COLLAB-14 | Leave group (member) | P1 | Member: Manage Group → Leave | Member removed. App still locally installed but `instance_id` cleared. | ⬜ |
| COLLAB-15 | Stop sharing (owner) | P1 | Owner: Manage Group → Stop Sharing | All members lose sync. `instance_id` cleared for all. Instance count decrements. | ⬜ |
| COLLAB-16 | Invalid invite code rejected | P1 | Join with code "XXXXXXXX" | Error: "Instance not found." No install triggered. | ⬜ |
| COLLAB-17 | Join flow 10s timeout alert | P2 | Simulate slow network during join | Alert appears after 10s: "Join appears stuck." | ⬜ |
| COLLAB-18 | Duplicate join ignored | P2 | Member tries to join same instance twice | No duplicate membership. No error crash. | ⬜ |
| COLLAB-19 | Frozen banner shows on Manage Group (owner) | P1 | Owner with frozen instance: open Manage Group | Amber frozen banner visible. "Upgrade plan" CTA shown. | ⬜ |
| COLLAB-20 | Merge telemetry visible in debug | P3 | Open Debug Sync after concurrent writes | Merge strategies logged in debug view. | ⬜ |
| COLLAB-21 | Same instance — multiple devices owner re-links | P2 | Owner's 2nd device: Collaborate on same app | Returns existing invite code (no new instance created). | ⬜ |

---

## 10. Cross-Device Sync

### Preconditions
- Two devices signed in as the SAME user
- PowerSync connected on both

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| SYNC-01 | App installed on Device A appears on Device B | P0 | Device A: install URL app → wait 10s → check Device B | App tile appears on Device B (cross-device restore). | ⬜ |
| SYNC-02 | App deleted on Device A removed from Device B | P1 | Delete app on Device A | After sync, app tile disappears on Device B. | ⬜ |
| SYNC-03 | App data syncs across devices | P0 | Device A: save data in app → switch to Device B | Same data available in app on Device B. | ⬜ |
| SYNC-04 | Cross-device restore on fresh install | P0 | Wipe Device B, reinstall app, sign in | `useRestoreApps()` restores app tiles from PowerSync. Toast: "X apps restored". | ⬜ |
| SYNC-05 | HTML/ZIP apps show "re-install required" after restore | P1 | Wipe Device B. Device A has a ZIP app | ZIP app tile appears on Device B but cannot open (no bundle). Re-import prompt shown. | ⬜ |
| SYNC-06 | Restore does not duplicate existing apps | P2 | Both devices have same app locally | `useRestoreApps()` does not create duplicate tiles. | ⬜ |
| SYNC-07 | PowerSync offline: queues writes | P1 | Airplane mode → write data in app → reconnect | Writes queued. After reconnect, data syncs to Supabase. | ⬜ |
| SYNC-08 | Sync status indicator correct | P2 | Settings: check sync status while connected vs offline | Shows "Connected" / "Offline" correctly. | ⬜ |
| SYNC-09 | SupabaseConnector — natural key upsert for shared_app_data | P0 | Two devices write shared data simultaneously | No duplicate rows. UNIQUE constraint on `(instance_id, app_id, key)` not violated. | ⬜ |
| SYNC-10 | In-memory version cache survives row clear | P1 [REG-12] | Write shared data → immediately write again before sync confirms | Second write uses correct version (from `_versionCache`, not PowerSync local row). No version regression. | ⬜ |
| SYNC-11 | PowerSync row IDs — no UUID format | P1 | Check Debug Sync | `shared_app_data` IDs are `instanceId/appId/key`, not UUIDs. | ⬜ |
| SYNC-12 | instance_members RLS disabled | P0 | Attempt to query `instance_members` as a member | Row returned (RLS disabled — PowerSync sync rules control access). | ⬜ |
| SYNC-13 | No sync rule aliases (ps_untyped check) | P0 [REG-13] | Debug Sync → check ps_untyped count | ps_untyped should have 0 rows. All rows land in correct tables. | ⬜ |

---

## 11. App Updates & Versioning

### Preconditions
- A URL app installed with a known bundle hash
- App has a "previous version" backup (applied one update)

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| UPD-01 | Check for Update — no update available | P1 | App is current → long-press → Check for Update | Toast: "App is up to date." No badge shown. | ⬜ |
| UPD-02 | Check for Update — update available | P1 | Modify source URL content → pull-to-refresh | Update badge appears on app icon. | ⬜ |
| UPD-03 | Apply update | P0 | Update badge visible → tap "Replace App Code" | New bundle downloaded. Hash updated in SQLite. Badge clears. | ⬜ |
| UPD-04 | Revert to previous version | P1 | After applying update → ··· → Revert to Previous | Previous bundle restored. Hash reverted. | ⬜ |
| UPD-05 | Revert option only shown after update | P2 | Fresh install → check menu | "Revert to Previous Version" NOT in menu (no backup exists). | ⬜ |
| UPD-06 | Auto-update toggle respects setting | P1 | Set Auto-Update OFF | Pull-to-refresh does not auto-download updates. Badge may show but no silent replace. | ⬜ |
| UPD-07 | Update check timeout | P2 | Simulate slow network → check for update | Update check does not hang indefinitely. Timeout error shown. | ⬜ |
| UPD-08 | Bundle hash mismatch detection | P1 | After update, `bundle_hash` in DB must change | Old hash ≠ new hash. Stored correctly in `apps` table. | ⬜ |

---

## 12. Create with AI

### Preconditions
- Signed-in user (beta plan or below with generation credits)
- Network connected

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| AI-01 | Create with AI card visible in Add modal | P0 | Open Add modal | "Create with AI" card shown at top of options. | ⬜ |
| AI-02 | Enter prompt → stream starts | P0 | Create screen → enter prompt → Generate | SSE stream starts. Rotating progress messages shown. Live char counter updates. | ⬜ |
| AI-03 | Preview shown after generation | P0 | Wait for generation to complete | Preview screen shows: app info bar (title, emoji, color) + WebView preview. | ⬜ |
| AI-04 | Refine prompt regenerates same appId | P1 | In preview: type new refinement → Generate | Same `appId` used. Cloudflare KV entry overwritten. Preview updates. | ⬜ |
| AI-05 | Install generated app | P0 | Preview → Install | App added to home grid. Opens via WebView from `apps.cottix.co/{appId}`. | ⬜ |
| AI-06 | Share generated app | P1 | Preview → Share | Share sheet opens with URL `apps.cottix.co/{appId}`. | ⬜ |
| AI-07 | Generation SSE progress messages | P2 | Watch during generation | Several rotating messages shown (not stuck on one). Char count increments. | ⬜ |
| AI-08 | Generation failure (network drop) | P1 | Drop network mid-generation | Error state shown with retry option. | ⬜ |
| AI-09 | Generation failure (edge function timeout) | P2 | Send very complex prompt | Graceful error shown. Not a blank screen or crash. | ⬜ |
| AI-10 | Rate limit enforced (20/day) | P2 | Generate 21 apps in a day (or simulate with test account) | 21st request returns rate limit error. | ⬜ |
| AI-11 | Example prompts shown in idle state | P2 | Open Create screen before entering prompt | Example prompts visible. Tapping one fills the input. | ⬜ |
| AI-12 | Generated app saved to `generated_apps` Supabase table | P1 | After generation, check Supabase | Row inserted with `user_id, app_id, prompt, title, icon, color, hosted_url`. | ⬜ |

---

## 13. Data Management

### Preconditions
- A few apps installed with data in them

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| DATA-01 | Export All Data — contains all apps | P1 | Settings → Export All Data | JSON includes all app KV data keyed by app name/ID. | ⬜ |
| DATA-02 | Export All Data — empty state | P2 | Export when no app data | Valid JSON exported (empty object or empty array, not crash). | ⬜ |
| DATA-03 | Clear All Data wipes SQLite | P0 | Confirm Clear All Data → check home | All apps gone. Storage Used = 0 (or near 0). | ⬜ |
| DATA-04 | Clear All Data clears PowerSync | P1 | After clear → Debug Sync | `installed_apps` rows = 0. `app_data` rows = 0. | ⬜ |
| DATA-05 | Clear All Data doesn't remove SecureStore keys | P1 | Add API key → Clear All Data | API keys listed in Settings after clear (SecureStore is device-level). | ⬜ |
| DATA-06 | app_data persists across app kills | P0 | Write data in mini-app → kill app → reopen | Data available immediately (from pre-seeded shim payload). | ⬜ |
| DATA-07 | shared_data persists across app kills | P1 | Store API key name → kill app → check Settings | API key still listed. | ⬜ |
| DATA-08 | Bundle cache size matches displayed size | P2 | Install apps → check "Storage Used" | Displayed size matches actual disk usage of bundle files. | ⬜ |

---

## 14. Performance & Resilience

### Preconditions
- Varies per test

---

| ID | Test Case | Priority | Steps | Expected Result | Status |
|----|-----------|----------|-------|-----------------|--------|
| PERF-01 | App grid renders 20+ apps | P1 | Install 20 apps | Grid scrolls smoothly. No frame drops. | ⬜ |
| PERF-02 | WebView loads under 3s (URL app, good network) | P1 | Open URL app on WiFi | Splash fades within 3s. | ⬜ |
| PERF-03 | WebView loads offline (local bundle) | P0 | Airplane mode → open bundled app | App loads from local bundle. No network error. | ⬜ |
| PERF-04 | App with 100+ KV entries loads fast | P2 | Insert 100 keys via `app_data`, open app | Initial shim preload completes. App loads without noticeable delay. | ⬜ |
| PERF-05 | Multiple quick opens don't cause race conditions | P2 | Rapidly tap same app tile 5 times | No duplicate WebView stacks. Only one instance opened. | ⬜ |
| PERF-06 | Background/foreground cycle preserves state | P1 | Open app, switch to background, foreground | App resumes from same state. No reload unless sync triggered. | ⬜ |
| PERF-07 | Auth token refresh in background | P1 | Leave app for 60 min → foreground | Still signed in. PowerSync reconnects automatically. | ⬜ |
| PERF-08 | Cold start time (authenticated user) | P2 | Kill and restart app | Home screen appears within 2s. Demo apps load within 1s. | ⬜ |
| PERF-09 | Memory: no leak on repeated app opens | P2 | Open/close 10 apps in succession | No noticeable memory growth. App remains responsive. | ⬜ |
| PERF-10 | Shared sync push doesn't trigger reload loop | P1 | Watch PowerSync watcher with both devices writing | No reload loop. Each sync cycle fires at most once per key update. | ⬜ |
| PERF-11 | Network switch (WiFi → Cellular) | P1 | Move from WiFi to cellular during sync | PowerSync reconnects. Data continues syncing. No permanent disconnect. | ⬜ |
| PERF-12 | Supabase edge function cold start | P2 | First AI generation after period of inactivity | Edge function cold start may add 1-3s delay. Not shown as error. | ⬜ |
| PERF-13 | App with emoji in name renders correctly | P3 | Install app named "My 🚀 App" | Emoji renders in grid tile, header, and app info. | ⬜ |
| PERF-14 | Very long app name truncates in grid | P3 | Install app with 80-char name | Name truncated with ellipsis in grid tile and header. No layout overflow. | ⬜ |
| PERF-15 | Concurrent installs (install 2 apps quickly) | P2 | Tap install twice before first completes | Both complete. No race in SQLite. No double-counting. | ⬜ |

---

## 15. Regression Checklist

Quick smoke test after any change. Run before every release.

| ID | Description | Regression For | Status |
|----|-------------|----------------|--------|
| REG-01 | User switch guard fires when different user signs in | AUTH-16 | ⬜ |
| REG-02 | Demo apps don't trigger user-switch guard or inflate count | AUTH-19, HOME-18 | ⬜ |
| REG-03 | Bluetooth/physical keyboard OTP entry works | AUTH-23 | ⬜ |
| REG-04 | App count uses local SQLite (not Supabase) | INST-12, SET-04 | ⬜ |
| REG-05 | Devanagari danda normalised in URL input | INST-16 | ⬜ |
| REG-06 | App name input ignores autocorrect | INST-21 | ⬜ |
| REG-07 | Home screen list refreshes after delete without nav away | HOME-11 | ⬜ |
| REG-08 | iOS viewport does not zoom on text input focus | WEB-11 | ⬜ |
| REG-09 | Shared app shim has VaultAPI.secrets + VaultAPI.storage | VAULT-16/17 | ⬜ |
| REG-10 | Missing native module does not kill entire bridge | VAULT-18 | ⬜ |
| REG-11 | Demo apps re-seeded after Clear All Data | SET-17 | ⬜ |
| REG-12 | Version cache survives PowerSync row clear gap | SYNC-10 | ⬜ |
| REG-13 | No rows land in ps_untyped (sync rule alias bug) | SYNC-13 | ⬜ |
| REG-14 | Promo code PERAPPOS grants lifetime beta | SET-08 | ⬜ |
| REG-15 | instance_members RLS remains DISABLED | SYNC-12 | ⬜ |
| REG-16 | shared_app_data UNIQUE constraint (no duplicates) | SYNC-09 | ⬜ |
| REG-17 | Frozen instance banner visible on shared app screen | WEB-18 | ⬜ |
| REG-18 | confirmWipe re-seeds demo apps after user switch | AUTH-18 | ⬜ |
| REG-19 | Both shims (personal + shared) updated for any new VaultAPI | VAULT-16/17 | ⬜ |
| REG-20 | installed_apps PK scoped to userId/appId (no RLS conflict) | SYNC-01 | ⬜ |

---

## Notes & Known Limitations

- **ZIP/HTML apps** cannot be restored cross-device — only URL and AI-generated apps fully restore.
- **Discover tab** is a placeholder — no tests required yet.
- **Edit Profile** button is disabled — skip.
- **Android** tests require a physical device or well-configured emulator with Play Services for notifications and haptics.
- **Network simulation:** Use iOS Settings → Developer → Network Link Conditioner, or Android emulator network throttling.
- **PostHog analytics** events can be verified via PostHog dashboard — check event names match after each significant action.
- **PowerSync sync rules** changes (e.g., adding `is_frozen` columns) must be tested separately in the PowerSync dashboard before these test cases can fully pass.
