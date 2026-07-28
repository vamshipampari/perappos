import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';
import { log } from '@/lib/logger';

const RC_API_KEY =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? ''
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';

// Set to true once configure() succeeds. Guards all subsequent calls so a
// missing native module (Expo Go, un-prebuilt dev client) never crashes the app.
let _rcAvailable = false;

export function initRevenueCat(userId: string): void {
  try {
    Purchases.configure({ apiKey: RC_API_KEY, appUserID: userId });
    if (__DEV__) {
      Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    }
    _rcAvailable = true;
  } catch (err) {
    // Native module not linked yet — needs `pod install` + a dev/production build.
    // The app continues to work; Supabase plan is used as the sole source of truth.
    log.warn('[RevenueCat] Native module unavailable — skipping RC init:', err);
  }
}

export async function getCustomerInfo(): Promise<CustomerInfo> {
  if (!_rcAvailable) throw new Error('RevenueCat not available');
  return Purchases.getCustomerInfo();
}

export async function getOfferings(): Promise<PurchasesOfferings> {
  if (!_rcAvailable) throw new Error('RevenueCat not available');
  return Purchases.getOfferings();
}

export async function purchasePackage(pkg: PurchasesPackage) {
  if (!_rcAvailable) throw new Error('RevenueCat not available');
  return Purchases.purchasePackage(pkg);
}

export async function restorePurchases(): Promise<CustomerInfo> {
  if (!_rcAvailable) throw new Error('RevenueCat not available');
  return Purchases.restorePurchases();
}

export function hasProAccess(customerInfo: CustomerInfo): boolean {
  return typeof customerInfo.entitlements.active['Cottix Pro'] !== 'undefined';
}

export function isRevenueCatAvailable(): boolean {
  return _rcAvailable;
}
