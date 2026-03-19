# PERAPPOS — Expo/React Native Build Prompts
### Skip PWA. Go straight to mobile. Ship APK by end of Week 1.

Working name: Cottix (Personal App OS)
Design: iOS-native feel (clean, white, Apple-like)
Demo apps: Workout Log, Daily Habits, Expense Snap

---

## PRE-FLIGHT: .cursorrules File

Before starting ANY session, create this file in your project root. It tells Cursor exactly what stack to use and prevents hallucination of wrong APIs.

**Create `.cursorrules` in project root:**

```json
{
  "framework": "expo",
  "version": "sdk-55",
  "routing": "expo-router",
  "architecture": "new",
  "preferred_packages": [
    "expo-sqlite",
    "expo-notifications",
    "expo-haptics",
    "expo-file-system",
    "expo-document-picker",
    "expo-local-authentication",
    "expo-sharing",
    "react-native-webview",
    "react-native-reanimated",
    "nativewind"
  ],
  "style": "nativewind (Tailwind for React Native)",
  "state": "react context + expo-sqlite",
  "testing": "manual on device via Expo Go or dev build",
  "rules": [
    "Always use expo-router for navigation (file-based routing in app/ directory)",
    "Use expo-sqlite for ALL local storage, never AsyncStorage",
    "Use expo-sqlite/kv-store for simple key-value needs",
    "Use react-native-webview for loading mini-apps, never iframes",
    "Use NativeWind for styling (className prop on RN components)",
    "Use TypeScript for all files",
    "Use functional components with hooks only",
    "Target Android first, but keep iOS compatibility",
    "Design: iOS-native aesthetic — white backgrounds, system font, subtle gray borders, #007AFF for primary blue",
    "Never use expo-camera/legacy or expo-sqlite/legacy — use current APIs only",
    "For animations use react-native-reanimated, not Animated API"
  ]
}
```

---

## DAY 1: Project Setup + Home Screen (4-6 hours)

### Session 1A: Initialize Project

Run these commands in your terminal FIRST (not in Cursor):

```bash
# Create the project
npx create-expo-app@latest cottix --template tabs
cd cottix

# Install core dependencies
npx expo install expo-sqlite expo-file-system expo-document-picker \
  expo-haptics expo-notifications expo-local-authentication \
  expo-sharing expo-crypto react-native-webview \
  react-native-reanimated nativewind tailwindcss

# Create the .cursorrules file (paste the JSON above)

# Open in Cursor
cursor .
```

### Session 1B: Home Screen + App Grid

Paste into Cursor:

```
I'm building "Cottix" — a mobile app that hosts mini web apps inside WebViews.

FIRST: Set up NativeWind properly:
- Create tailwind.config.js with content pointing to app/**/*.tsx
- Add the NativeWind babel preset to babel.config.js
- Create global.css with @tailwind directives
- Import global.css in app/_layout.tsx

CURRENT TASK: Build the home screen.

Replace the default expo-router tabs with this structure:
app/
  _layout.tsx          — Root layout with SQLite provider
  (tabs)/
    _layout.tsx        — Tab bar: Home, Discover, Settings
    index.tsx          — Home screen (app grid)
    discover.tsx       — Discover/browse templates (placeholder for now)
    settings.tsx       — Settings screen
  app/[id].tsx         — Full-screen WebView for running a mini-app
  add.tsx              — Modal: add new app (URL paste or ZIP upload)

HOME SCREEN (app/(tabs)/index.tsx):
- Top: "Cottix" as large title (like iOS Settings app large title style)
- Below: Grid of installed mini-apps, 3 columns
- Each grid item: 60x60 rounded-rect icon (with colored background + emoji), 
  app name below in 12px gray text
- If no apps installed, show centered empty state:
  Light gray icon of a grid/apps symbol
  "Your personal app home"
  "Add apps built with Lovable, Bolt, Claude, or any web tool"
  [+ Add Your First App] button in iOS blue
- Floating "+" FAB in bottom-right corner (iOS blue, circle, shadow, 56x56)
- Tapping "+" navigates to /add modal
- Tapping an app icon navigates to /app/[id]

DATABASE SETUP:
- Use expo-sqlite with SQLiteProvider wrapping the app in _layout.tsx
- Database name: "cottix.db"
- Initialize tables on first launch:

CREATE TABLE IF NOT EXISTS apps (
    app_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon_emoji TEXT DEFAULT '📱',
    icon_bg_color TEXT DEFAULT '#E5E7EB',
    bundle_path TEXT NOT NULL,
    source_type TEXT DEFAULT 'url',
    source_url TEXT,
    bundle_hash TEXT,
    auto_update INTEGER DEFAULT 1,
    permissions TEXT DEFAULT '[]',
    bundle_size INTEGER DEFAULT 0,
    installed_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_opened TEXT,
    open_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_data (
    app_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    synced INTEGER DEFAULT 0,
    PRIMARY KEY (app_id, key)
);

CREATE TABLE IF NOT EXISTS shared_data (
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source_app TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (category, key)
);

- Create a hook: useInstalledApps() that reads from the apps table
- Create a hook: useDatabase() using useSQLiteContext()

DESIGN DETAILS:
- Background: white (#FFFFFF)
- Text: #1C1C1E (iOS system label color)
- Secondary text: #8E8E93 (iOS secondary label)
- Primary blue: #007AFF
- Grid item tap: subtle scale animation (0.95) using Reanimated
- Tab bar: standard iOS tab bar style, white background, thin top border
- Tab icons: grid.fill (Home), sparkles (Discover), gear (Settings)
  Use simple Unicode or SF Symbol equivalents via text

Make everything TypeScript. Clean, well-structured components.
```

### Session 1C: Settings Screen

```
Build the Settings screen for Cottix (app/(tabs)/settings.tsx):

iOS Settings-style list layout:
- Grouped sections with gray background between groups
- Each row: white background, label left, value/chevron right, thin separator

SECTIONS:

1. "Account" section (placeholder for Phase 2):
   - "Sign In" row with chevron → shows alert "Coming soon — cloud sync & sharing"

2. "General" section:
   - "Appearance" row → value "Light" (just display, no toggle yet)
   - "App Lock" row with toggle → when ON, enables biometric auth via expo-local-authentication
   - "Auto-Update Apps" row with toggle → stores preference in SQLite

3. "Data" section:
   - "Storage Used" row → calculated from apps table (sum of bundle_size)
   - "Export All Data" row → exports all app_data rows as JSON file
   - "Clear All Data" row (red text) → confirms, then deletes all

4. "About" section:
   - "Version" row → "0.1.0"
   - "Built with ❤️ in Hyderabad"
   - "Cottix — Personal App OS"

Use proper iOS-style list components. White rows, rounded group corners, 
thin 0.5px separators with left padding. Subtle chevron (›) for drill-down rows.
```

---

## DAY 2: WebView Container + Bridge (4-6 hours)

### Session 2A: WebView App Screen with Shim Injection

```
Build the mini-app viewer screen for Cottix (app/app/[id].tsx).

This is the MOST IMPORTANT screen. It loads a mini web app inside a WebView 
and injects a JavaScript shim that intercepts localStorage and provides 
native bridges.

SCREEN LAYOUT:
- Thin top bar (44px height, white bg, bottom border):
  - Left: ← back arrow (tapping goes back to home)
  - Center: app name
  - Right: ••• three-dot menu button
- Three-dot menu (iOS-style action sheet via ActionSheetIOS or custom):
  - "Refresh" → reload WebView
  - "Check for Update" → compare source_url bundle hash
  - "App Info" → show app details (source, data size, install date)
  - "Delete App" → confirm dialog, then delete app + data
- Below the top bar: full-screen WebView filling remaining space
- Loading overlay: semi-transparent white + activity indicator while WebView loads
- Error state: if WebView fails to load, show friendly error + "Retry" button

WEBVIEW SETUP:
- Use react-native-webview
- Load HTML from local file system: source={{ uri: bundlePath }}
  where bundlePath is the file:// path to the cached index.html
- Set these WebView props:
  - javaScriptEnabled={true}
  - domStorageEnabled={true}  
  - allowFileAccess={true}
  - originWhitelist={['*']}
  - onMessage={handleMessage}  — receives postMessage from shim
  - injectedJavaScriptBeforeContentLoaded={vaultShimJS}  — THE SHIM

THE VAULT SHIM (most critical code):
Generate this as a string constant that gets injected. Here's exactly what it must do:

1. INTERCEPT localStorage:
   - Override localStorage.setItem → send message to RN via postMessage, 
     also write to in-memory cache
   - Override localStorage.getItem → read from in-memory cache (SYNCHRONOUS)
   - Override localStorage.removeItem → send message to RN, delete from cache
   - Override localStorage.clear → send message to RN, clear cache
   - Override localStorage.key and localStorage.length for completeness

2. PRE-POPULATE CACHE:
   The shim must start by requesting ALL data for this app_id from native.
   Since postMessage is async but localStorage.getItem is sync, we need
   to pre-load data INTO the in-memory cache BEFORE the app's own JS runs.
   
   Strategy: Use injectedJavaScriptBeforeContentLoaded which runs before
   the page's scripts. Send a 'vault_init' message to native. The native
   side responds with all key-value pairs for this app. Store in cache object.
   
   IMPORTANT: There's a timing issue. injectedJavaScriptBeforeContentLoaded
   runs synchronously, but postMessage response is async. So we need to
   ALSO pre-serialize the initial data and include it in the injected JS:
   
   const INITIAL_DATA = ${JSON.stringify(preloadedData)};
   
   Where preloadedData is read from SQLite BEFORE the WebView mounts,
   then embedded directly in the shim string. This makes initial reads
   fully synchronous.

3. PROVIDE VaultAPI:
   window.VaultAPI = {
     db: { get(key), set(key, value), delete(key), getAll() },
     device: { 
       notify(opts), // → triggers expo-notifications
       haptic(style), // → triggers expo-haptics  
       share(opts),   // → triggers expo-sharing
     },
     auth: { getUser() },
     app: { getInfo() },  // → returns app manifest info
   }
   Each method sends a postMessage to RN and returns a Promise.

4. BRIDGE HANDLER (React Native side):
   In the WebView's onMessage handler, parse the message and route to:
   - 'db_set' → INSERT OR REPLACE INTO app_data (app_id, key, value, updated_at)
   - 'db_get' → SELECT value FROM app_data WHERE app_id = ? AND key = ?
   - 'db_delete' → DELETE FROM app_data WHERE app_id = ? AND key = ?
   - 'db_get_all' → SELECT key, value FROM app_data WHERE app_id = ?
   - 'device_notify' → Notifications.scheduleNotificationAsync(...)
   - 'device_haptic' → Haptics.impactAsync(...)
   - 'device_share' → Sharing.shareAsync(...)
   
   After handling, send response back to WebView via:
   webviewRef.current.postMessage(JSON.stringify({ type: 'vault_response', id, result }))

CRITICAL DETAILS:
- The pre-loaded data approach solves the synchronous localStorage problem
- Every write goes to BOTH the in-memory cache AND native SQLite
- Reads always come from the in-memory cache (instant, synchronous)
- The cache and SQLite stay in sync because every write updates both
- Each app gets its own namespace: app_data rows are filtered by app_id

TypeScript throughout. Clean separation: shim generation in one file, 
bridge handler in another, WebView screen composing both.
```

### Session 2B: Test with Inline Demo App

```
Add a way to test the WebView + shim by creating an inline test app.

Create a utility function: createDemoApp(appId, name, emoji, bgColor, htmlContent)
that:
1. Creates a directory in the app's file system: FileSystem.documentDirectory + 'apps/' + appId + '/'
2. Writes the htmlContent as index.html in that directory
3. Inserts a row into the apps SQLite table
4. Returns the app record

Then create 3 demo apps using this function. Run this on first launch 
(check if apps table is empty):

DEMO APP 1: "Workout Log" (💪, #DBEAFE light blue)
Single HTML file, self-contained, all CSS and JS inline.
- Mobile-optimized, iOS aesthetic (white bg, -apple-system font, #007AFF blue)
- Title "Workout Log" + today's date
- Quick-add pills for: Push-ups, Squats, Deadlift, Bench, Running, Pull-ups
- Tapping a pill opens a simple form below it: sets × reps, weight (optional)
- "Log Exercise" button saves to localStorage (which the shim intercepts!)
- Today's exercises shown as a clean list below
- "This Week" section: total workouts count
- Uses localStorage.setItem('workouts_YYYY-MM-DD', JSON.stringify(exercises))
- Swipe or long-press to delete an entry
- ALL styling inline. NO external CDN or dependencies. Must work offline.

DEMO APP 2: "Daily Habits" (✅, #D1FAE5 light green)
Single HTML file, self-contained.
- Title "Daily Habits" + streak counter "🔥 X day streak"
- List of 5 default habits with tap-to-toggle circles (○ → ●):
  "Drink 2L Water", "Exercise 30min", "Read 20min", "No junk food", "Sleep by 11pm"
- "+" button to add custom habit (prompt for name)
- Progress bar at bottom: "3 of 5 complete"
- 30-day calendar heatmap: 
  Row of small squares (like GitHub contribution graph)
  Gray = no data, light green = partial, dark green = all done
- Streak logic: consecutive days with ALL habits marked done
- localStorage keys: 'habits_list', 'habits_YYYY-MM-DD'

DEMO APP 3: "Expense Snap" (💰, #FEF3C7 light orange)
Single HTML file, self-contained.
- Title "Expense Snap" + month selector (< February 2026 >)
- "Add Expense" button → bottom sheet form:
  Amount (large input, ₹ prefix since user is in India),
  Category dropdown: 🍕 Food, 🚗 Transport, 🛍️ Shopping, 📱 Bills, 
  🏥 Health, 🎮 Entertainment, 📦 Other
  Note (optional text), Date (defaults to today)
- Monthly summary: Total Spent card, Daily Average, Top Category
- Expense list grouped by date, newest first
- Each row: category emoji, note, ₹amount right-aligned
- Simple pie chart in pure CSS/SVG (no libraries)
- localStorage keys: 'expenses_YYYY-MM'

IMPORTANT: These demo apps must use ONLY localStorage for storage. 
They should NOT know about VaultAPI. The whole point is that they 
"just work" because the shim intercepts localStorage transparently.
This proves that ANY web app using localStorage will work in Cottix.

After creating the demos, the home screen should show all 3 in the grid.
Tapping one should open it in the WebView, and data should PERSIST 
across app restarts (because the shim saves to SQLite, not actual localStorage).
```

---

## DAY 3-4: URL Import + ZIP Import (4-6 hours)

### Session 3A: Add App Screen (URL + ZIP Import)

```
Build the "Add App" screen for Cottix (app/add.tsx).

This should be presented as a modal (expo-router modal route).

DESIGN (iOS-native):
- Top bar: "Cancel" left, "Add App" title center
- White background, grouped form sections

SECTION 1: "From URL" 
- Large text input with placeholder: "Paste app URL (lovable.dev, bolt.host, vercel.app...)"
- Below input: auto-detected platform badge when URL matches known pattern:
  *.lovable.dev → "Lovable" badge with purple accent
  *.bolt.host → "Bolt" badge with orange accent
  *.vercel.app → "Vercel" badge with black accent
  *.netlify.app → "Netlify" badge with teal accent
  *.replit.dev → "Replit" badge with blue accent
  Other → "Web App" generic badge
- "Add App" button (iOS blue, full width, rounded)
- When tapped:
  1. Show loading state: "Downloading app..."
  2. Fetch the HTML from the URL
  3. Parse the HTML: extract <title>, find favicon from <link rel="icon">, 
     find all <script src="...">, <link href="..."> CSS files
  4. Download all linked assets (JS, CSS, images) 
  5. Rewrite asset URLs in HTML to point to local file paths
  6. Save everything to FileSystem.documentDirectory/apps/{generated_app_id}/
  7. Insert into apps table with source_type='url', source_url=the URL
  8. Generate SHA-256 hash of the bundle (for update detection)
  9. Navigate to home screen, show success toast

SECTION 2: "From ZIP File"
- Divider: "── or ──"
- "Upload ZIP File" button (outline style)
- Uses expo-document-picker to let user select a .zip file
- When selected:
  1. Show loading: "Extracting app..."
  2. Extract ZIP (use JSZip library — npx expo install jszip)
  3. Find index.html in the extracted contents (search root and one level deep)
  4. If no index.html found, show error: "No index.html found in this ZIP"
  5. Copy all extracted files to FileSystem.documentDirectory/apps/{id}/
  6. Insert into apps table with source_type='zip'
  7. Navigate home, show success toast

SECTION 3: "App Details" (shown after URL fetch or ZIP extract succeeds)
- App name (auto-detected, editable text field)
- Icon: show a grid of 12 emoji options to pick from:
  📱💪✅💰📊🎯📝🛒🎨🔧📚🎮
- Icon background color: show 8 color swatches to pick from:
  #DBEAFE (blue), #D1FAE5 (green), #FEF3C7 (yellow), #FCE7F3 (pink),
  #E0E7FF (indigo), #FEE2E2 (red), #F3E8FF (purple), #E5E7EB (gray)
- "Install App" final confirmation button

TECHNICAL NOTES:
- For URL fetching, use the fetch API
- Asset rewriting: replace src="/assets/index.js" with src="file:///...local.../assets/index.js"
- Handle relative and absolute URLs in asset references
- Handle base href if present
- Set a 30-second timeout on fetch operations
- Bundle size limit: if total downloaded exceeds 10MB, warn user
- Generate app_id using expo-crypto: Crypto.randomUUID()
```

### Session 3B: Auto-Update Detection

```
Add app update detection to Cottix.

1. Create a utility function: checkForUpdates(app) that:
   - Only works for source_type='url' apps
   - Fetches the source_url HTML
   - Computes SHA-256 hash
   - Compares with stored bundle_hash
   - Returns { available: boolean, newHash?: string }

2. Create a background check that runs when the app opens:
   - Loop through all installed apps where auto_update = 1 and source_type = 'url'
   - Check for updates (with a 10-second timeout per app, max 3 concurrent)
   - If update found, set a flag in a local "updates_available" state
   - Show a small red dot badge on the app's icon on the home screen

3. In the app/[id].tsx three-dot menu, "Check for Update" button:
   - Shows spinner while checking
   - If update available: "Update available! Download now?"
   - If confirmed: download new bundle, replace old one, keep all app_data
   - Show success: "Updated to latest version ✓"
   - If no update: "Already up to date ✓"

4. Add "Revert to Previous Version" in App Info:
   - Before any update, copy the old bundle to a backup directory
   - Store backup path in a new app_updates table
   - If user taps Revert → swap back to old bundle
   - Keep backups for 7 days, then auto-cleanup

5. Long-press context menu on home screen app icons:
   Show iOS-style context menu (use react-native ContextMenu or 
   custom implementation with Reanimated):
   - "Open"
   - "Check for Update" (show "Update Available!" if flagged)
   - "Replace App Code" → navigate to add screen pre-filled for replacement
   - "App Info" → show details modal
   - "Export Data" → export this app's KV data as JSON
   - "Delete" (red, destructive)
```

---

## DAY 5-6: Native Features + Polish (4-6 hours)

### Session 4A: Native Features Integration

```
Add native device features to the Cottix bridge.

Extend the WebView bridge handler (onMessage) to support these:

1. NOTIFICATIONS (expo-notifications):
   When shim sends { action: 'device_notify', title, body, delay_seconds }:
   - Request notification permissions if not already granted
   - Schedule a local notification:
     Notifications.scheduleNotificationAsync({
       content: { title, body },
       trigger: delay_seconds ? { seconds: delay_seconds } : null
     })
   - Return { success: true } to WebView

2. HAPTICS (expo-haptics):
   When shim sends { action: 'device_haptic', style }:
   - style = 'light' → Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
   - style = 'medium' → Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
   - style = 'heavy' → Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
   - style = 'success' → Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

3. SHARE (expo-sharing):
   When shim sends { action: 'device_share', text, url }:
   - Sharing.shareAsync(url || '', { dialogTitle: text })

4. APP LOCK (expo-local-authentication):
   - In _layout.tsx, check if app lock is enabled (from settings)
   - If yes, on app foreground (useAppState hook), show biometric prompt
   - LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Cottix' })
   - If fails, show "Locked" screen with retry button
   - Store lock preference in expo-sqlite/kv-store

5. Also update the demo apps to USE these features:
   In workout-log.html: add a "Remind me to workout" button that calls:
     window.VaultAPI?.device.notify({ title: 'Time to workout! 💪', body: 'Your daily reminder', delay_seconds: 3600 })
   
   In habit-streak.html: when all habits are checked off, call:
     window.VaultAPI?.device.haptic('success')
   
   In expense-snap.html: add "Share Monthly Report" button that calls:
     window.VaultAPI?.device.share({ text: 'My February expenses: ₹12,500 total' })
   
   NOTE: Use optional chaining (VaultAPI?.) so these apps STILL work 
   in a regular browser (VaultAPI will be undefined, calls are silently skipped).
   The apps must remain fully functional without VaultAPI — it's a bonus, not a dependency.
```

### Session 4B: Visual Polish + UX

```
Polish the Cottix app to feel premium and iOS-native:

1. HOME SCREEN POLISH:
   - Large title that collapses on scroll (like iOS Settings):
     "Cottix" in 34px bold when scrolled to top → shrinks to 17px in nav bar on scroll
   - App grid items: on tap, scale to 0.92 with spring animation (Reanimated), 
     then navigate on release
   - Pull-to-refresh on home screen: checks for updates on all URL-sourced apps
   - App count subtitle: "3 apps installed" in secondary gray below title

2. WEBVIEW POLISH:
   - When opening an app, smooth slide-in from right (iOS push animation)
   - While WebView loads: show the app's icon + name centered on white bg
     (like an app splash screen), then cross-fade to WebView when loaded
   - Set WebView opacity to 0, when onLoadEnd fires, animate opacity to 1
   - Back gesture: iOS swipe-from-left-edge to go back to home

3. ADD APP MODAL:
   - Slide up from bottom (iOS sheet style)
   - Drag handle at top (small gray pill, 36x5px, centered)
   - Swipe down to dismiss
   - Keyboard avoiding: input stays visible when keyboard appears

4. TAB BAR:
   - White background with subtle top border (0.5px, #E5E7EB)
   - Active tab: iOS blue (#007AFF)
   - Inactive tab: gray (#8E8E93)
   - Tab labels: "Home", "Discover", "Settings"

5. TOAST NOTIFICATIONS:
   - Create a simple toast component that slides down from top
   - Green for success: "App installed ✓", "Updated ✓"
   - Red for errors: "Could not download app"
   - Auto-dismiss after 3 seconds
   - Use Reanimated for slide animation

6. HAPTIC FEEDBACK ON INTERACTIONS:
   - Light haptic on tab switch
   - Medium haptic on app install
   - Light haptic on toggle switches in settings
   - Success haptic when all habits completed (already in demo app)

7. EMPTY STATE IMPROVEMENTS:
   - Discover tab: "Coming soon — browse and share app templates"
     with a soft illustration placeholder (large emoji: 🔮)
```

---

## DAY 7: Build APK + First Users (2-4 hours)

### Session 5: Build Configuration

```
Configure Cottix for production Android build:

1. Update app.json / app.config.ts:
{
  "expo": {
    "name": "Cottix",
    "slug": "cottix",
    "version": "0.1.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "cottix",
    "userInterfaceStyle": "light",
    "newArchEnabled": true,
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#FFFFFF"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#FFFFFF"
      },
      "package": "com.cottix.app",
      "permissions": [
        "NOTIFICATIONS",
        "VIBRATE"
      ]
    },
    "ios": {
      "bundleIdentifier": "com.cottix.app",
      "supportsTablet": true
    },
    "plugins": [
      "expo-router",
      "expo-sqlite",
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#007AFF"
        }
      ]
    ]
  }
}

2. Create a simple app icon:
   - Generate a 1024x1024 PNG: white background, centered text "P" in 
     iOS blue (#007AFF), bold rounded font. Or use an emoji-based design.
   - Save as assets/icon.png, assets/adaptive-icon.png, assets/splash.png
   (For now, even a simple colored square with a letter is fine — polish later)

3. Create eas.json for build configuration:
{
  "cli": { "version": ">= 3.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "apk"
      }
    }
  }
}

4. Build the APK:
   eas build --platform android --profile preview
   
   This generates a shareable .apk file. Download it and send to testers.

5. For local builds (faster iteration, free):
   npx expo prebuild --platform android
   cd android && ./gradlew assembleRelease
   
   The APK will be at android/app/build/outputs/apk/release/app-release.apk
```

### Sharing Your First APK

```
After the build completes:

1. Download the APK from EAS dashboard (or from local build output)
2. Upload to Google Drive / WeTransfer / direct share
3. Send to your first 10-20 testers:
   - Friends who know vibe-coding
   - People from X/Twitter #vibecoding who showed interest
   - Lovable/Bolt Discord community members

4. Include a short message:
   "Hey! I built Cottix — it turns any web app (from Lovable, Bolt, Claude) 
    into a mobile app with one tap. Paste a URL, it becomes an app.
    
    Here's the APK: [link]
    
    Try this: open any app you've built in Lovable/Bolt, copy the deployed URL, 
    paste it in Cottix. Let me know what breaks!"

5. Create a feedback channel:
   - Telegram group or Discord server
   - Or just collect feedback via DMs
```

---

## WHAT YOU SHOULD HAVE BY END OF WEEK 1

| Feature | Status |
|---------|--------|
| Expo app with iOS-native design | ✅ |
| Home screen with app grid | ✅ |
| 3 pre-installed demo apps (workout, habits, expenses) | ✅ |
| WebView container that loads mini-apps | ✅ |
| vault-shim.js intercepting localStorage | ✅ |
| Data persists across app restarts (SQLite) | ✅ |
| URL import (paste Lovable/Bolt URL → app installs) | ✅ |
| ZIP import | ✅ |
| Push notifications from mini-apps | ✅ |
| Haptic feedback | ✅ |
| Share from mini-apps | ✅ |
| Biometric app lock | ✅ |
| Auto-update detection for URL-sourced apps | ✅ |
| Shareable Android APK | ✅ |
| Settings screen | ✅ |

| NOT in Week 1 | When |
|---------------|------|
| Cloud sync | Week 7 |
| Sharing / multi-user | Week 9 |
| Marketplace | Week 10 |
| Subscriptions / payments | Week 11 |
| iOS build | Week 13 |
| AI quick edit | Week 16 |

---

## DAILY SCHEDULE (Suggested)

```
Week 1 — Full-time, all-in:

Day 1 (Mon):  Session 1A + 1B + 1C — Project setup, home screen, settings
Day 2 (Tue):  Session 2A + 2B — WebView + shim + bridge + demo apps
Day 3 (Wed):  Session 3A — URL import + ZIP import
Day 4 (Thu):  Session 3B — Auto-update detection + long-press menus
Day 5 (Fri):  Session 4A — Native features (notifications, haptics, share, app lock)
Day 6 (Sat):  Session 4B — Visual polish + animations + UX details
Day 7 (Sun):  Session 5 — Build APK + send to first testers + post on X
```

---

## TROUBLESHOOTING GUIDE (Common Cursor/Expo Issues)

| Problem | Fix |
|---------|-----|
| "Cannot find native module ExpoSQLite" | You're running in Expo Go — expo-sqlite needs a dev build. Run `npx expo run:android` or use EAS Build |
| WebView shows white screen | Check that file:// path to index.html is correct. Use `FileSystem.getInfoAsync(path)` to verify file exists |
| localStorage interception doesn't work | Make sure shim uses `injectedJavaScriptBeforeContentLoaded` not `injectedJavaScript` — the latter runs AFTER the page loads, too late |
| Data not persisting | Check SQLite writes are actually happening — add console.log in the bridge handler. Verify app_id matches |
| NativeWind styles not applying | Make sure babel.config.js has nativewind/babel preset, and tailwind.config.js content paths are correct |
| EAS Build fails | Run `npx expo-doctor` to check dependency compatibility. Make sure eas.json is valid JSON |
| Animations janky | Make sure react-native-reanimated babel plugin is in babel.config.js |

---

*Open Cursor. Create the project. Paste Session 1A commands. Start building.*

*By Sunday you'll have a real Android app on your phone that loads web apps 
with persistent storage and native features. That's more than anyone else 
in the vibe-coding space has shipped as a container.*

*Let's go. 🚀*
