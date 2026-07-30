# Android release process

How to build and ship an Android release (Open Testing or Production) via EAS.

## One-time setup (required before the first automated submit)

`eas submit --platform android` needs a Google Play service account key. This only has to be done once per Play Console developer account.

1. In [Google Cloud Console](https://console.cloud.google.com), open (or create) the GCP project linked to the Play Console developer account.
2. IAM & Admin → Service Accounts → Create Service Account (e.g. `eas-play-submit`). No GCP-project-level roles are needed.
3. Keys → Add Key → JSON, and download it.
4. In Play Console → Setup → API access, link the GCP project if not already linked, find the new service account, click "Grant access", and give it at least the **Release manager** permission for the Cottix app (needs to manage releases and app bundles).
5. Confirm the service account shows as **Active** with the granted app-level permission before submitting.
6. Save the downloaded key at the repo root as `google-service-account.json`. This filename is gitignored — **never commit it**. Run `git status` after downloading to confirm it doesn't show as staged/untracked-and-added.

## Build

```bash
eas build --platform android --profile production
```

This produces an `.aab` (app bundle) with `versionCode` read from `app.json` (`appVersionSource: "local"` in `eas.json`), auto-incremented on each build (`autoIncrement: "versionCode"`).

**Do not use `npm run android`** (`expo run:android`) for a release build — that's a local dev command that builds from the native `android/` folder, which is gitignored and can silently drift out of sync with `app.json`'s versionCode.

## Submit

```bash
npm run submit:android:beta        # → Open Testing track
npm run submit:android:production  # → Production track
```

Each of these runs `eas submit --platform android --profile <beta|production>`, which reads `serviceAccountKeyPath` from `eas.json`, uploads the most recent finished build's `.aab`, and attaches it directly to the specified Play Console track — no manual upload needed.

### Track name mapping

Google Play Developer API track names don't match the Play Console UI labels one-to-one:

| Play Console UI label | API / `eas.json` track name |
|---|---|
| Internal testing | `internal` |
| Closed testing | `alpha` |
| Open testing | `beta` |
| Production | `production` |

## Verify

After submit completes, check Play Console → Testing/Production → the release should show the new `versionCode` and rollout status.

## If you ever need to upload manually

If `eas submit` isn't set up yet or the service account is misconfigured, you can always fall back to a manual upload:

1. Find the build artifact: `eas build:list --platform android --limit 1` (or the [expo.dev](https://expo.dev) dashboard) → grab the `.aab` download URL.
2. Play Console → Cottix app → Testing → the relevant track → the release draft → "App bundles" → Upload the `.aab`.
3. Confirm the uploaded bundle's version code matches what you expect before saving — this is the only way to catch a stale/wrong file.
4. Save → Review release → confirm the rollout summary shows the bundle added with the right version code → Start rollout.

(This is exactly what "no app bundles were added" / "doesn't allow existing users to upgrade" errors in Play Console mean: the release draft has no bundle attached yet. Attaching one resolves both.)
