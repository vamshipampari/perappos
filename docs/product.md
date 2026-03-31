# Cottix — Product decisions

## Core positioning

WebView container that turns any vibe-coded web app into a native mobile app with:

- SQLite persistence (not clearable by OS like localStorage)
- Native homescreen presence
- Real-time multi-user collaboration without backend work
- Native device APIs (haptics, notifications, share, camera, photos)
- Offline-first behavior
  No App Store submission required for mini-apps themselves.

## Target market

Primary: Small businesses and field teams using AI-built internal tools needing mobile access (B2B wedge)
Secondary: Individual vibe-coders building for themselves (lower conversion, higher viral potential)

## Competitor positioning

- Bloom (YC): App Clips, 30-day auto-deletion, no offline storage, iOS only. Not a real threat.
- Natively.dev: Wraps web URLs into App Store binaries. Different positioning — they're distribution, we're distribution + persistence + collaboration layer.

## App Store compliance rules

- Discover tab: invite-only and non-browseable — avoids "app store" appearance to reviewers
- Sharing framed as "data sharing" (shared SQLite context), not app distribution
- HTML code execution kept (GTM differentiator); CSP injection + WebView sandboxing as safeguards

## Pricing

- Free: 5 apps, no sharing
- Pro/Beta: ~$9/month or $79/year — unlimited apps, 5 shared instances
- Team: ~$19/month — unlimited everything
- Shared app recipients NEVER pay — creator pays. This is the viral growth mechanism.
- Annual pricing strategically important for cash flow and churn reduction.
- Active promo codes: BETA2026 (90d) · PERAPPOS (lifetime) · VIBECODER (30d)

## Feature decisions log

- [2026-03-13] HTML code execution: keep feature (GTM differentiator). Tiered safeguards: CSP + sandboxing (Tier 1), VaultAPI restrictions (Tier 2), static analysis (Tier 3 pre-public gallery).
- [2026-03-24] Secrets: domain allowlisting per secret is the critical security control. secrets.fetch() proxy pattern — native substitutes secret + makes HTTP call, never exposes raw key to WebView.
- [2026-03-24] API keys are account-level not app-level — single SecureStore entry per key name, works across all mini-apps.
- [2026-03-19] AI generation: Supabase Edge Function → Claude Sonnet 4.6 → Cloudflare KV → apps.cottix.co/{appId}. Rate limit: 20/user/day.
- [2026-03-18] Shared instance freeze: when owner downgrades plan, existing shared instances freeze (not deleted). Unfreeze on upgrade. Owner sees amber banner.
- [2026-03-31] Discover tab replaced with Guide tab: interactive onboarding + help reference (7 sections: Overview, Install, Share, API Keys, Tips, Limits, FAQ). Discover was a placeholder with no content; Guide serves both first-time users and power users looking up how things work.
- [2026-03-XX] Admin panel: defer until non-technical team needs it. Retool when the time comes.
- [2026-03-XX] Analytics: PostHog + Sentry. Integrate just before sharing with real testers — not before.
- [2026-03-XX] Push notifications: Expo Push API + Supabase Edge Functions. No third-party service needed.

## Technical moat (things that cannot exist in a browser tab)

1. SQLite persistence without OS-clearing risk
2. Native homescreen presence (icon, launch from home screen)
3. Multi-app container under one auth session
4. Real-time collaboration without any backend work from the mini-app
5. Native device APIs (haptics, notifications, share, photos, camera)
6. Reliable offline-first behavior

## YC strategy

Wait for 10 paying customers + $2–5K MRR before applying.
Target: August 2026 for Winter batch.
Story: B2B wedge — field teams using AI-built internal tools.
