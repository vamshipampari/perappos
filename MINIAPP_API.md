# Cottix Mini-App API Reference

> **For vibe coders:** Add this file to your prompt context when building apps for Cottix.

---

## What is Cottix?

Cottix runs your web app (built with Lovable, Bolt, Replit, Vercel, or any URL) natively on iOS/Android inside a sandboxed WebView. The platform injects a bridge layer (`window.VaultAPI`) that gives your app access to native storage, device features, and real-time collaboration — without any SDK to install.

---

## App Structure Requirements

| Rule | Detail |
|---|---|
| **Self-contained** | No server required at runtime. All assets must load from the bundle. |
| **Single HTML entry** | One `index.html` with relative asset paths |
| **No backend calls at startup** | If your app hits an API on load, it must handle offline gracefully |
| **No IndexedDB** | Use `localStorage` or `VaultAPI.db` instead (see below) |
| **External fetches** | `fetch()` works normally during runtime — only the initial bundle must be self-contained |
| **Frameworks** | React, Vue, Svelte, vanilla JS — all work. Just make sure the build output is static HTML/JS/CSS |

---

## Storage

### `localStorage` — Simplest option

Works exactly like web `localStorage`. Cottix intercepts it and persists data to native SQLite automatically.

```js
localStorage.setItem('score', '42')         // persisted to device
localStorage.getItem('score')               // → '42' (synchronous)
localStorage.removeItem('score')
localStorage.clear()
```

**Rules:**
- Values must be strings. Stringify objects: `JSON.stringify(obj)`
- Data is scoped per app (other apps cannot read your keys)
- Survives app close/reopen
- If the app is in **shared/collaborative mode**, writes are synced across all members with 3-way merge

---

### `sessionStorage` — In-memory only

Cleared when the app is closed. Not persisted. Same API as `localStorage`.

```js
sessionStorage.setItem('draft', 'hello')
sessionStorage.getItem('draft')   // → 'hello' (until app closes)
```

---

### `VaultAPI.db` — Explicit async KV store

Same underlying storage as `localStorage` but Promise-based. Use this when you need to confirm a write succeeded.

```js
// Set
await window.VaultAPI.db.set('key', 'value')   // → true

// Get
const val = await window.VaultAPI.db.get('key')   // → string | null

// Delete
await window.VaultAPI.db.delete('key')   // → true

// Get all keys for this app
const all = await window.VaultAPI.db.getAll()   // → { key: value, ... }
```

**All values are strings.** Serialize complex data:
```js
await window.VaultAPI.db.set('settings', JSON.stringify({ theme: 'dark', fontSize: 16 }))
const settings = JSON.parse(await window.VaultAPI.db.get('settings'))
```

---

### Choosing between `localStorage` and `VaultAPI.db`

| Use case | Recommendation |
|---|---|
| Simple state, counters, settings | `localStorage` |
| Need write confirmation | `VaultAPI.db.set()` |
| Read all app data at startup | `VaultAPI.db.getAll()` |
| Collaborative shared app | `localStorage` (the bridge handles sync automatically) |

---

## Device Features

All device APIs return Promises and are available via `window.VaultAPI.device`.

---

### Haptic Feedback

```js
await window.VaultAPI.device.haptic('medium')
```

| Style | Effect |
|---|---|
| `'light'` | Soft tap |
| `'medium'` | Standard tap (default) |
| `'heavy'` | Strong tap |
| `'success'` | Success notification pulse |
| `'warning'` | Warning notification pulse |
| `'error'` | Error notification pulse |

---

### Local Notifications

```js
// Immediate notification
await window.VaultAPI.device.notify({
  title: 'Timer done!',
  body: 'Your 5-minute timer has finished.'
})

// Delayed notification (seconds from now)
await window.VaultAPI.device.notify({
  title: 'Reminder',
  body: 'Don\'t forget to log today.',
  delay_seconds: 3600   // 1 hour
})
```

Returns `false` if the user denies notification permission.

---

### Native Share Sheet

```js
// Share text
await window.VaultAPI.device.share({ text: 'Check out this score: 9001' })

// Share a URL
await window.VaultAPI.device.share({ url: 'https://example.com/result/42' })
```

---

## Auth

```js
const user = await window.VaultAPI.auth.getUser()
// Signed in  → { id: 'uuid', email: 'user@example.com' }
// Signed out → null
```

Use this to personalize your app if the user is signed in to Cottix. You don't need to implement your own auth — Cottix handles it.

---

## App Info

```js
const info = await window.VaultAPI.app.getInfo()
```

Returns:
```js
{
  app_id: 'abc123',          // unique ID assigned by Cottix
  name: 'My Habit Tracker',  // display name user gave the app
  source_url: 'https://...', // original URL (null for ZIPs)
  installed_at: '2026-03-01T10:00:00Z',
  open_count: 42,
  instance_id: 'xyz...'      // non-null if the app is in collaborative mode
}
```

Check `instance_id` to detect whether you're running in shared/collaborative mode.

---

## Collaborative Mode (Shared Apps)

When a Cottix user shares their app with others (via invite code), all members run the same app with **shared, synced state**.

**You don't need to change your code.** The bridge automatically:
- Routes `localStorage` writes through a 3-way merge engine
- Syncs data to all members in real-time
- Handles conflicts gracefully (arrays merge by item, objects merge by field, last-write-wins as fallback)

**Best practices for collaboration-friendly apps:**

```js
// ✅ Good — store data as structured objects, easier to merge
localStorage.setItem('todos', JSON.stringify([
  { id: 'a1b2', text: 'Buy milk', done: false },
  { id: 'c3d4', text: 'Walk dog', done: true }
]))

// ✅ Good — give array items stable unique IDs
// The merge engine uses IDs to track additions/removals per member

// ❌ Avoid — storing everything in one giant blob
localStorage.setItem('app_state', JSON.stringify(entireAppState))
// Concurrent writes from different members will conflict more often
```

**Key design rules for shared apps:**
- Give array items a stable `id` field — the merge engine uses it
- Keep keys granular (one key per entity type, not one key for everything)
- Expect that values can be updated from another device at any time (design your UI to re-read from `localStorage` after user interactions)
- Live sync push to a running WebView is not yet implemented — data from other members appears after the app is closed and reopened

---

## Limitations

| Feature | Status |
|---|---|
| Camera / microphone | ❌ Not available (bridge not yet implemented) |
| File system access | ❌ Not available |
| Geolocation | ✅ Works (native WebView handles it, user prompted for permission) |
| IndexedDB | ❌ Not available — use `localStorage` or `VaultAPI.db` |
| WebSockets / fetch | ✅ Work normally |
| Service Workers | ❌ Not supported in WebView |
| `window.open` / popups | ❌ Blocked — all navigation stays in the same WebView |
| Cookie storage | ❌ Not persisted — use `localStorage` instead |
| Clipboard API | ⚠️ May work on some devices, not guaranteed |

---

## Quick Reference

```js
// Storage
localStorage.setItem(key, value)           // fire-and-forget persist
localStorage.getItem(key)                  // synchronous read
await VaultAPI.db.set(key, value)          // confirmed write → true
await VaultAPI.db.get(key)                 // → string | null
await VaultAPI.db.getAll()                 // → { key: value, ... }

// Device
await VaultAPI.device.haptic('medium')
await VaultAPI.device.notify({ title, body, delay_seconds? })
await VaultAPI.device.share({ text? , url? })

// Auth & App
await VaultAPI.auth.getUser()              // → { id, email } | null
await VaultAPI.app.getInfo()               // → { app_id, name, instance_id, ... }

// Collaboration detection
const { instance_id } = await VaultAPI.app.getInfo()
const isShared = !!instance_id
```

---

## Data Modeling Tips

```js
// Serialize everything to string before storing
localStorage.setItem('config', JSON.stringify({ theme: 'dark' }))
const config = JSON.parse(localStorage.getItem('config') ?? '{}')

// Use a helper to reduce boilerplate
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)) }
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback }
  catch { return fallback }
}

// Namespace keys if your app has multiple data types
save('todos:list', [...])
save('todos:filter', 'active')
save('user:prefs', { notifications: true })
```

---

*Last updated: 2026-03-14 — This is a living document.*
