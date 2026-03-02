# Perappos

Your personal app OS. Install, organize, and run AI-generated web apps — from Lovable, Bolt, Vercel, Replit, or any URL — directly on your phone, with no browser needed.

---

## What it does

Vibe-coding tools like Lovable and Bolt let anyone build a web app in minutes. The problem: every app lives as a separate browser tab with no shared home. Perappos is that home.

- **Install from URL** — paste a link to any web app. Perappos downloads the HTML, CSS, and JS bundle to your device, so apps work offline and load instantly.
- **Install from ZIP** — export your project as a ZIP and sideload it directly.
- **Run natively** — each app opens in a full-screen WebView with its own sandboxed local storage.
- **Organize** — pick an emoji icon and color for each app. Your home grid, your rules.

---

## Screenshots

> Coming soon.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Expo SDK 55 (New Architecture) |
| Routing | expo-router (file-based) |
| Styling | NativeWind v4 (Tailwind CSS for React Native) |
| Database | expo-sqlite (WAL mode) |
| WebView | react-native-webview |
| Animations | react-native-reanimated 4 |
| Language | TypeScript 5.9 |

---

## Project structure

```
perappos/
├── app/
│   ├── _layout.tsx          Root layout — SQLiteProvider + Stack navigator
│   ├── add.tsx              Modal — add app via URL or ZIP
│   ├── app/[id].tsx         Full-screen WebView runner for a mini-app
│   └── (tabs)/
│       ├── index.tsx        Home screen — 3-column app grid
│       ├── discover.tsx     Discover curated apps
│       └── settings.tsx     Settings (app lock, storage, export)
├── components/
│   └── Toast.tsx            Lightweight toast notification
├── hooks/
│   ├── useDatabase.ts       useSQLiteContext() wrapper
│   └── useInstalledApps.ts  Reads apps table; exposes refresh(), recordOpen()
├── lib/
│   ├── vaultBridge.ts       WebView ↔ native postMessage bridge (localStorage shim)
│   └── appUpdates.ts        Background update-check logic (SHA-256 hash diff)
└── utils/
    ├── createDemoApp.ts     Seeds demo apps on first launch
    └── demoAppsHtml.ts      Self-contained HTML for bundled demo apps
```

---

## Database schema

### `apps`

| Column | Type | Notes |
|---|---|---|
| app_id | TEXT PK | UUID |
| name | TEXT | Display name |
| icon_emoji | TEXT | Grid icon |
| icon_bg_color | TEXT | Hex color |
| bundle_path | TEXT | Local FS path (no `file://` prefix) |
| bundle_html | TEXT | In-memory HTML for demo/zip apps (viewer fallback) |
| source_type | TEXT | `url` · `bundle` · `zip` · `demo` |
| source_url | TEXT | Original URL (url-type apps) |
| bundle_hash | TEXT | SHA-256 of bundle for update detection |
| bundle_size | INTEGER | Bytes |
| installed_at | TEXT | ISO 8601 |
| open_count | INTEGER | Lifetime open count |

### `app_data`
Per-app key-value store, accessible from the WebView via `window.Vault`. Primary key: `(app_id, key)`.

### `shared_data`
Cross-app shared data (contacts, preferences, etc.). Primary key: `(category, key)`.

---

## How URL import works

1. Fetch the page HTML (30 s timeout).
2. Parse every `<script src>`, `<link href>`, and `<img src>` pointing at the same origin.
3. **BFS crawl** — download each asset to `{DocumentDirectory}/apps/{id}/`, maintaining the original path structure (`/assets/index-abc.js` → `{appDir}/assets/index-abc.js`).
4. For each JS file, scan for `import("…")` and `from "…"` references and enqueue any new chunks (handles Vite code-splitting).
5. Rewrite HTML attribute paths from root-relative (`/assets/x.js`) to relative (`./assets/x.js`).
6. Save the modified `index.html`.
7. Load in WebView via `file://` URI with `allowUniversalAccessFromFileURLs` enabled so ES-module imports resolve across files.

---

## Getting started

### Prerequisites

- Node.js 20+
- Yarn 1.x (`npm i -g yarn`)
- Expo CLI (`npm i -g expo-cli`)
- Xcode (iOS) or Android Studio (Android)

### Install

```bash
git clone https://github.com/vamshipampari/perappos.git
cd perappos
yarn install
```

### Run

```bash
# iOS simulator
yarn ios

# Android emulator
yarn android

# Expo Go (limited — no file-system access)
yarn start
```

### Build (EAS)

```bash
npx eas build --platform ios --profile preview
npx eas build --platform android --profile preview
```

---

## WebView bridge

Mini-apps can persist data via a `window.Vault` API injected before page load:

```js
// Inside your mini-app
await Vault.setItem('key', 'value');
const value = await Vault.getItem('key');
await Vault.removeItem('key');
const all = await Vault.getAllItems();
```

Data is stored in the `app_data` SQLite table, scoped to the app's `app_id`. Reads are synchronous on first load (preloaded key-value map embedded in the shim).

---

## Contributing

Issues and PRs welcome. The project uses TypeScript throughout — run `npx tsc --noEmit` before submitting.

---

## License

MIT
