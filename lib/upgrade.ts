import { Platform } from 'react-native';

/**
 * Whether the in-app "Upgrade to Pro" purchase flow is available on this
 * platform.
 *
 * RevenueCat is currently provisioned for iOS only (see services/revenueCat.ts —
 * iOS key/entitlement/offering). Android RevenueCat + Play Console setup is
 * pending, so starting a *new* purchase on Android fails. Until that provisioning
 * lands, every entry point into the paywall is gated on this flag so the upgrade
 * CTA is hidden on Android rather than routing users to a dead-end.
 *
 * When Android provisioning is complete, flip this to `true` for Android (or
 * remove the gate) — a single-line change re-enables every upgrade entry point.
 */
export const isUpgradeAvailable = Platform.OS === 'ios';
