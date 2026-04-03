<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Cottix Expo app. The integration adds PostHog alongside the existing Supabase-based analytics service (`services/analytics.ts`) without replacing it.

**New files created:**
- `src/config/posthog.ts` — PostHog client singleton, configured via `expo-constants` extras
- `app.config.js` — Wraps `app.json` and injects `POSTHOG_PROJECT_TOKEN` / `POSTHOG_HOST` from `.env` at build time

**Files modified:**
- `app/_layout.tsx` — Added `PostHogProvider`, `ScreenTracker` (manual screen tracking for expo-router), `posthog.identify` on sign-in, `posthog.reset` on sign-out
- `app/login.tsx` — Added `posthog.identify` + `user_signed_up` capture after OTP verification
- `app/add.tsx` — Added `app_installed` capture alongside existing `track()` call
- `app/app/[id].tsx` — Added `app_opened_webview` capture with `source_type` property
- `services/collaborationService.ts` — Added `share_created` capture
- `app/join-shared-app.tsx` — Added `share_joined` and `share_join_requested` captures
- `app/(tabs)/settings.tsx` — Added `promo_code_redeemed` capture
- `components/FeedbackSheet.tsx` — Added `feedback_submitted` capture

| Event | Description | File |
|---|---|---|
| `user_signed_up` | User completes OTP verification and creates an account | `app/login.tsx` |
| `user_logged_in` | User successfully signs in (via auth state change) | `app/_layout.tsx` |
| `app_installed` | User installs a new mini-app (URL, ZIP, or HTML) | `app/add.tsx` |
| `app_opened_webview` | User opens a mini-app and WebView finishes loading | `app/app/[id].tsx` |
| `share_created` | User creates a shared collaborative instance | `services/collaborationService.ts` |
| `share_joined` | User joins a shared instance via invite code | `app/join-shared-app.tsx` |
| `share_join_requested` | User requests to join an instance requiring approval | `app/join-shared-app.tsx` |
| `promo_code_redeemed` | User successfully redeems a promo code | `app/(tabs)/settings.tsx` |
| `feedback_submitted` | User submits in-app feedback | `components/FeedbackSheet.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/366172/dashboard/1423059
- **Signup → First App Install (7-day funnel)**: https://us.posthog.com/project/366172/insights/kxa6G2MJ
- **Daily Signups & Logins**: https://us.posthog.com/project/366172/insights/RZIWpfHF
- **App Installs by Source Type**: https://us.posthog.com/project/366172/insights/giJny9rE
- **Collaboration Funnel: Login → Share Created**: https://us.posthog.com/project/366172/insights/n8EKe71l
- **Mini-App Opens (WebView)**: https://us.posthog.com/project/366172/insights/NrC77rcB

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
