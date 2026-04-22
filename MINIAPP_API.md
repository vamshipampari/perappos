# Cottix Mini-App API Reference

---

## ✂️ Prompt Snippet — Add this to the end of your AI prompt

> Copy and paste this when building apps with Lovable, Bolt, Claude, v0, or any AI tool. It tells the AI everything it needs to know about the Cottix platform.

```
This app will run inside Cottix — a mobile app container for iOS/Android.

STORAGE: Use localStorage for all persistence. Cottix intercepts it and saves to native SQLite.
Values must be strings — use JSON.stringify/parse. Data survives app restarts.
For structured data, use granular keys (one per entity type, not one giant blob).
Give array items a stable `id` field for collaboration support.

NATIVE FEATURES (all optional — use window.VaultAPI?.X so the app still works in a browser):
- Haptics:       await window.VaultAPI?.device.haptic('light'|'medium'|'heavy'|'success'|'error')
- Notifications: await window.VaultAPI?.device.notify({ title, body, delay_seconds? })
- Share sheet:   await window.VaultAPI?.device.share({ text?, url? })
- Auth:          await window.VaultAPI?.auth.getUser() → { id, email } | null
- Secure API calls: await VaultAPI.secrets.has('MY_KEY') → bool | .set('MY_KEY', val) | .fetch('MY_KEY', { url, method, headers: { 'Authorization': 'Bearer {{secret}}' }, body })
- Image upload:  const { uri } = await window.VaultAPI?.storage.upload(); const { url } = await window.VaultAPI?.storage.getUrl(uri)

CONSTRAINTS:
- No IndexedDB, no Service Workers, no cookies, no window.open
- fetch() and WebSockets work normally
- Geolocation works (user is prompted for permission)
- The app bundle must be self-contained (no server needed to serve HTML/JS/CSS)
- MOBILE: Design for mobile screens first. The UI must work well inside an iOS/Android WebView, be responsive on narrow widths, avoid desktop-only layouts, and use touch-friendly tap targets.
- fetch() and API calls work fine at runtime — just handle offline/network errors gracefully
- API KEYS: If the app needs API keys, explicitly tell the user which keys are required, the exact Cottix secret names to save (for example `OPENAI_API_KEY`), and which API calls use each key. Include a short setup section in the final output.
- PRIVACY: In collaborative/shared mode, ALL members of a shared instance can see ALL data.
  There is no per-user data isolation. Do not build apps where users should only see their own
  data (e.g. a trainer tracking multiple clients — all clients would see each other's data).

OPTIONAL meta tag in <head> to set icon/color:
<meta name="cottix-meta" content='{"icon":"🏋️","color":"#D1FAE5","description":"Track your workouts"}' />
```

---

## What is Cottix?

Cottix runs your web app (Lovable, Bolt, Replit, any URL) natively on iOS/Android inside a sandboxed WebView. It injects `window.VaultAPI` — a bridge to native storage, device features, and real-time collaboration. No SDK to install.

---

## Storage

### `localStorage` — use this for everything

Cottix intercepts it and persists to native SQLite. API is identical to web.

```js
localStorage.setItem('score', '42')   // persisted to device
localStorage.getItem('score')          // → '42' (synchronous)
localStorage.removeItem('score')
localStorage.clear()
```

> Values must be strings. Use `JSON.stringify` / `JSON.parse` for objects.
> Data is scoped per app and survives close/reopen.
> In shared/collaborative mode, writes are automatically synced across all members.

**Handy helpers:**
```js
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)) }
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
```

### `VaultAPI.db` — confirmed async writes

Same storage as `localStorage` but Promise-based. Use when you need write confirmation.

```js
await VaultAPI.db.set('key', 'value')    // → true
await VaultAPI.db.get('key')             // → string | null
await VaultAPI.db.delete('key')          // → true
await VaultAPI.db.getAll()               // → { key: value, ... }
```

---

## Device Features

All via `window.VaultAPI.device`. Examples below omit `?.` for brevity — use `window.VaultAPI?.device.*` for browser compatibility.

```js
// Haptics
await VaultAPI.device.haptic('light')      // 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

// Local notifications
await VaultAPI.device.notify({ title: 'Done!', body: 'Your timer finished.', delay_seconds: 3600 })
// Returns false if user denied permission

// Native share sheet
await VaultAPI.device.share({ text: 'Check this out', url: 'https://...' })
```

---

## Auth & App Info

```js
const user = await VaultAPI.auth.getUser()
// → { id: 'uuid', email: 'user@example.com' } | null

const info = await VaultAPI.app.getInfo()
// → { app_id, name, source_url, installed_at, open_count, instance_id }
// instance_id is non-null when the app is in collaborative/shared mode
```

---

## Secrets — Secure API Key Storage

API keys are stored in the device keychain. The value **never appears in JS** — the native bridge injects it at HTTP request time via a `{{secret}}` placeholder.

Keys are **global** — saved once, usable in all mini-apps on that device.

```js
// Check if a key is already saved (works even if saved from another app or Settings)
const exists = await VaultAPI.secrets.has('ANTHROPIC_API_KEY')  // → true | false

// Save a key (show this UI to the user once)
await VaultAPI.secrets.set('ANTHROPIC_API_KEY', 'sk-ant-...')   // → true

// Recommended: restrict which domains this key may be sent to.
// secrets_fetch will return { error: 'domain_not_allowed' } for any other host.
await VaultAPI.secrets.set('ANTHROPIC_API_KEY', 'sk-ant-...', ['api.anthropic.com'])

// Make an authenticated request
const res = await VaultAPI.secrets.fetch('ANTHROPIC_API_KEY', {
  url: 'https://api.anthropic.com/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '{{secret}}',           // ← replaced natively
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
  })
})

// Response
// { status: 200, body: '{"content":[...]}' }   ← body is always a raw string
// { error: 'secret_not_found' }                 ← resolves, does NOT reject

const data = JSON.parse(res.body)
```

> Always check `res.error` before calling `JSON.parse`. Works with any API — put `{{secret}}` anywhere in headers.

---

## Storage — Image Upload

Opens the native Photos picker. Image is uploaded natively to Supabase Storage — binary data never touches WebView JS.

```js
const result = await VaultAPI.storage.upload()
if (result.cancelled) return

const { url } = await VaultAPI.storage.getUrl(result.uri)  // 1-hour signed URL
document.getElementById('preview').src = url
```

Pass `url` directly to Anthropic Vision or any image API — no base64 encoding needed.

---

## Collaborative Mode

When a user shares their app via invite code, all members share synced state in real-time. **No code changes needed** — the bridge handles it.

For best results:
- Give array items a stable `id` field (used by the merge engine)
- Use granular keys — one per entity type, not one giant blob
- Live updates from other members trigger a brief app reload — in-app navigation resets to home

**Privacy limitation:** All members of a shared instance can see all data — there is no per-user isolation. Collaborative mode is designed for apps where a shared view is the point (shared todo list, team tracker, group expense split). It is **not suitable** for apps where each user should only see their own data — for example, a fitness trainer managing multiple clients would expose every client's data to all other clients.

```js
// ✅ Good
localStorage.setItem('todos', JSON.stringify([
  { id: 'a1b2', text: 'Buy milk', done: false }
]))

// ❌ Avoid
localStorage.setItem('app_state', JSON.stringify(entireAppState))
```

---

## Limitations

| Feature | Status |
|---|---|
| `localStorage` / `VaultAPI.db` | ✅ Works, persisted to SQLite |
| `fetch()` / WebSockets | ✅ Work normally |
| Geolocation | ✅ Works (permission prompt) |
| Secure API key calls | ✅ `VaultAPI.secrets.fetch` |
| Image upload | ✅ `VaultAPI.storage.upload` |
| IndexedDB | ❌ Not available |
| Service Workers | ❌ Not supported |
| `window.open` / popups | ❌ Blocked |
| Cookie storage | ❌ Not persisted — use `localStorage` |
| Camera / microphone | ❌ Not yet |
| File system access | ❌ Not yet |
| Background sync | ❌ Sync runs while app is open only |

---

## Quick Reference

```js
// Storage
localStorage.setItem(key, value)
localStorage.getItem(key)                           // synchronous
await VaultAPI.db.set(key, value)                  // confirmed async write
await VaultAPI.db.getAll()                          // → { key: value, ... }

// Device
await VaultAPI.device.haptic('medium')
await VaultAPI.device.notify({ title, body, delay_seconds? })
await VaultAPI.device.share({ text?, url? })

// Auth & App
await VaultAPI.auth.getUser()                       // → { id, email } | null
await VaultAPI.app.getInfo()                        // → { app_id, name, instance_id, ... }

// Secrets
await VaultAPI.secrets.has('KEY')                               // → true/false
await VaultAPI.secrets.set('KEY', 'value')
await VaultAPI.secrets.fetch('KEY', { url, method, headers: { 'X-Key': '{{secret}}' }, body })

// Image
const { uri } = await VaultAPI.storage.upload()
const { url } = await VaultAPI.storage.getUrl(uri)
```

---

*Last updated: 2026-03-31*
