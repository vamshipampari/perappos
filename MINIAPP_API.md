# Cottix Mini-App API Reference

> **For vibe coders:** Add this file to your prompt context when building apps for Cottix.

---

## What is Cottix?

Cottix runs your web app (built with Lovable, Bolt, Replit, Vercel, or any URL) natively on iOS/Android inside a sandboxed WebView. The platform injects a bridge layer (`window.VaultAPI`) that gives your app access to native storage, device features, and real-time collaboration — without any SDK to install.

---

## How to Add Your App to Cottix

| Method | How |
|---|---|
| **URL** | Paste any public URL (Lovable, Bolt, Vercel, Replit, etc.) — Cottix loads it in a WebView |
| **HTML paste / file** | Tap `+` → **FROM HTML** — paste your HTML code or pick a `.html` file. The app is deployed to Cottix's CDN and stored offline-first on device. |
| **Create with AI** | Describe what you want — Cottix generates a full single-file app (coming soon) |

---

## App Structure Requirements

| Rule | Detail |
|---|---|
| **Self-contained** | No server required at runtime. All assets must load from the bundle. |
| **Single HTML entry** | One `index.html` (or standalone `.html` file) with relative asset paths |
| **No backend calls at startup** | If your app hits an API on load, it must handle offline gracefully |
| **External fetches** | `fetch()` works normally during runtime — only the initial bundle must be self-contained |
| **Frameworks** | React, Vue, Svelte, vanilla JS — all work. Just make sure the build output is static HTML/JS/CSS |

### Optional: app metadata tag

Add this `<meta>` tag to the `<head>` of your HTML to pre-fill the Cottix icon, color, and description when the app is imported:

```html
<meta name="cottix-meta" content='{"icon":"🏋️","color":"#D1FAE5","description":"Track your workouts"}' />
```

| Field | Type | Default | Detail |
|---|---|---|---|
| `icon` | emoji string | `✨` | Icon shown on home screen |
| `color` | hex color | `#E0E7FF` | Background color of app icon |
| `description` | string | `''` | Short description (shown during import) |

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
  source_url: 'https://...', // hosted URL (null for ZIPs; Cloudflare URL for HTML apps)
  installed_at: '2026-03-01T10:00:00Z',
  open_count: 42,
  instance_id: 'xyz...'      // non-null if the app is in collaborative mode
}
```

Check `instance_id` to detect whether you're running in shared/collaborative mode.

---

## Secrets — Secure API Key Storage

Cottix lets your mini-app store API keys securely in the device's native keychain (`expo-secure-store`). The secret value **never appears in your JavaScript** — the native bridge injects it into outgoing HTTP requests at the last moment.

Keys are saved **globally** — save once, use in any mini-app on that device.

---

### Save a secret (one-time setup)

```js
await window.VaultAPI.secrets.set('ANTHROPIC_API_KEY', 'sk-ant-api03-...')
// → true  (stored in native keychain, persists across app restarts)
```

Build a simple save UI in your app:
```html
<input type="password" id="apiKey" placeholder="sk-ant-..." />
<button onclick="saveKey()">Save Key</button>
<p id="keyStatus"></p>

<script>
async function saveKey() {
  const key = document.getElementById('apiKey').value.trim()
  if (!key) return
  await window.VaultAPI.secrets.set('ANTHROPIC_API_KEY', key)
  document.getElementById('apiKey').value = ''
  document.getElementById('keyStatus').textContent = '✓ Saved'
}
</script>
```

---

### Make an authenticated API call

Use `secrets.fetch(keyName, requestOptions)` — identical to `fetch()` but with a `{{secret}}` placeholder in headers:

```js
const res = await window.VaultAPI.secrets.fetch('ANTHROPIC_API_KEY', {
  url: 'https://api.anthropic.com/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '{{secret}}',          // ← replaced natively, never exposed in JS
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
  })
})
```

**Response shape:**
```js
// Success
{ status: 200, body: '{"id":"msg_...","content":[...],...}' }

// Key not yet saved — resolves (does NOT reject)
{ error: 'secret_not_found' }
```

> `body` is always a raw string — parse it with `JSON.parse(res.body)`.
> `secrets.fetch` **resolves** for `secret_not_found` — always check `res.error` before calling `JSON.parse`.

---

### Full working pattern — Anthropic chatbot (confirmed working ✅)

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>
  <!-- Step 1: Save key once (can hide this after first save) -->
  <input type="password" id="keyInput" placeholder="sk-ant-api03-…" />
  <button onclick="saveKey()">Save API Key</button>
  <p id="keyStatus"></p>

  <!-- Step 2: Chat -->
  <textarea id="prompt" placeholder="Ask anything…">Explain quantum entanglement simply.</textarea>
  <button onclick="runCall()">▶ Send</button>
  <pre id="output">// response will appear here</pre>

<script>
  async function saveKey() {
    var key = document.getElementById('keyInput').value.trim()
    if (!key) return
    await window.VaultAPI.secrets.set('ANTHROPIC_API_KEY', key)
    document.getElementById('keyInput').value = ''
    document.getElementById('keyStatus').textContent = '✓ Key saved — works in all mini-apps'
  }

  async function runCall() {
    var prompt = document.getElementById('prompt').value.trim()
    if (!prompt) return
    document.getElementById('output').textContent = '…'

    var res = await window.VaultAPI.secrets.fetch('ANTHROPIC_API_KEY', {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '{{secret}}',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (res.error === 'secret_not_found') {
      document.getElementById('output').textContent = 'No API key saved yet. Enter your key above first.'
      return
    }

    var data = JSON.parse(res.body)
    if (res.status !== 200) {
      document.getElementById('output').textContent = 'Error ' + res.status + ': ' + (data.error && data.error.message)
      return
    }

    document.getElementById('output').textContent = data.content[0].text
  }
</script>
</body>
</html>
```

---

### Using other AI/service APIs

The `{{secret}}` placeholder works in any header value:

```js
// OpenAI
await VaultAPI.secrets.fetch('OPENAI_API_KEY', {
  url: 'https://api.openai.com/v1/chat/completions',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer {{secret}}' },
  body: JSON.stringify({ model: 'gpt-4o', messages: [...] })
})

// Any service with a custom key header
await VaultAPI.secrets.fetch('MY_KEY', {
  url: 'https://api.example.com/v1/generate',
  method: 'POST',
  headers: { 'X-API-Key': '{{secret}}', 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '...' })
})
```

---

## Storage — Image Upload

Upload images from the device's photo library to Supabase Storage. The mini-app receives an opaque storage path — binary data never passes through WebView JS.

```js
// 1. Pick an image and upload it to Supabase Storage
const result = await window.VaultAPI.storage.upload()

if (result.cancelled) return   // user dismissed the picker

// result.uri = storage path, e.g. "app123/user456/1711234567890.jpg"

// 2. Get a signed URL (valid for 1 hour) for display or API use
const { url } = await window.VaultAPI.storage.getUrl(result.uri)
document.getElementById('preview').src = url   // display in an <img>

// 3. Pass directly to Anthropic vision — no base64 encoding needed
const res = await window.VaultAPI.secrets.fetch('ANTHROPIC_API_KEY', {
  url: 'https://api.anthropic.com/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '{{secret}}',
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'url', url } },
        { type: 'text', text: 'Describe this image.' }
      ]
    }]
  })
})
```

`storage.upload()` opens the native iOS Photos picker. The image is read natively, converted to bytes, and uploaded to Supabase Storage — the WebView never holds raw image data.

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

// ❌ Avoid — the merge engine works at the key level. One giant blob means the
// whole state conflicts on every concurrent write.
localStorage.setItem('app_state', JSON.stringify(entireAppState))
```

**Key design rules for shared apps:**
- Give array items a stable `id` field — the merge engine uses it
- Keep keys granular (one key per entity type, not one key for everything)
- Expect that values can be updated from another device at any time (design your UI to re-read from `localStorage` after user interactions)
- Live updates from other members appear automatically — the app briefly reloads to apply remote changes. In-app navigation state resets to the home screen on sync

---

## Limitations

| Feature | Status |
|---|---|
| Camera / microphone | ❌ Not available (bridge not yet implemented) |
| File system access | ❌ Not available |
| Secure API key storage | ✅ `VaultAPI.secrets.set/fetch` — global keychain, never exposed to JS |
| External API calls with secret | ✅ `VaultAPI.secrets.fetch` — native HTTP with `{{secret}}` header injection |
| Image upload to cloud | ✅ `VaultAPI.storage.upload` → `getUrl` — confirmed working |
| Geolocation | ✅ Works (native WebView handles it, user prompted for permission) |
| IndexedDB | ❌ Not available — use `localStorage` or `VaultAPI.db` |
| WebSockets / fetch | ✅ Work normally |
| Service Workers | ❌ Not supported in WebView |
| `window.open` / popups | ❌ Blocked — all navigation stays in the same WebView |
| Cookie storage | ❌ Not persisted — use `localStorage` instead |
| Clipboard API | ⚠️ May work on some devices, not guaranteed |
| Push notifications from other users | ❌ Not yet — only local scheduled notifications |
| Background sync | ❌ Sync only runs while app is open |

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

// Secrets — secure API key storage (global, persists across restarts)
await VaultAPI.secrets.set('KEY_NAME', 'value')   // → true
await VaultAPI.secrets.fetch('KEY_NAME', {         // → { status, body } | { error }
  url: 'https://...',
  method: 'POST',
  headers: { 'Authorization': 'Bearer {{secret}}' },
  body: JSON.stringify({ ... })
})

// Storage — image upload to Supabase Storage
const { uri } = await VaultAPI.storage.upload()   // opens native Photos picker → storage path
const { url } = await VaultAPI.storage.getUrl(uri) // → 1-hour signed URL

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

*Last updated: 2026-03-24 — This is a living document.*



