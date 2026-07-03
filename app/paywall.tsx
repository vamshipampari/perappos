import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';
import { PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { useTheme } from '@/lib/theme';
import { isUpgradeAvailable } from '@/lib/upgrade';
import { useUserProfile } from '@/hooks/useUserProfile';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
} from '../services/revenueCat';

const FEATURES = [
  'Unlimited mini-apps (free tier: 5)',
  'Share apps with your team',
  'Real-time collaboration & sync',
  'AI app generation',
  'Secure API key storage',
];

type BillingPeriod = 'monthly' | 'yearly';

export default function PaywallScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { refresh: refreshProfile } = useUserProfile();

  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('yearly');
  const [monthlyPkg, setMonthlyPkg] = useState<PurchasesPackage | null>(null);
  const [yearlyPkg, setYearlyPkg] = useState<PurchasesPackage | null>(null);
  const [loading, setLoading] = useState(false);
  const [offeringsLoading, setOfferingsLoading] = useState(true);
  const [offeringsError, setOfferingsError] = useState(false);

  // Android has no RevenueCat provisioning yet, so the purchase flow can't work.
  // Guard against reaching this screen via a stale deep link or leftover entry
  // point by redirecting away before any RevenueCat calls run.
  useEffect(() => {
    if (!isUpgradeAvailable) {
      if (router.canDismiss()) router.dismiss();
      else router.replace('/(tabs)');
    }
  }, [router]);

  const loadOfferings = async () => {
    setOfferingsLoading(true);
    setOfferingsError(false);
    try {
      const offerings = await getOfferings();
      const current = offerings.current;
      if (!current) {
        setOfferingsError(true);
        return;
      }
      for (const pkg of current.availablePackages) {
        const id = pkg.packageType;
        if (id === 'MONTHLY') setMonthlyPkg(pkg);
        if (id === 'ANNUAL') setYearlyPkg(pkg);
      }
    } catch {
      setOfferingsError(true);
    } finally {
      setOfferingsLoading(false);
    }
  };

  useEffect(() => {
    if (!isUpgradeAvailable) return;
    void loadOfferings();
  }, []);

  const selectedPkg = billingPeriod === 'monthly' ? monthlyPkg : yearlyPkg;

  const monthlyPrice = monthlyPkg?.product.priceString ?? '$9/mo';
  const yearlyPrice = yearlyPkg?.product.priceString ?? '$79/yr';
  const ctaLabel =
    billingPeriod === 'monthly'
      ? `Start Pro – ${monthlyPrice}`
      : `Start Pro – ${yearlyPrice}`;

  const handlePurchase = useCallback(async () => {
    if (!selectedPkg) return;
    setLoading(true);
    try {
      await purchasePackage(selectedPkg);
      await refreshProfile();
      router.dismiss();
    } catch (err: unknown) {
      const code = (err as { code?: string | number }).code;
      const codeStr = String(code);
      if (codeStr === String(PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR)) {
        // User tapped Cancel — no alert needed.
        return;
      }
      if (codeStr === String(PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR)) {
        // Already subscribed — restore so the app reflects the active subscription.
        try {
          await restorePurchases();
          await refreshProfile();
          router.dismiss();
        } catch {
          await refreshProfile();
          router.dismiss();
        }
        return;
      }
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      Alert.alert('Purchase failed', message);
    } finally {
      setLoading(false);
    }
  }, [selectedPkg, refreshProfile, router]);

  const handleRestore = useCallback(async () => {
    setLoading(true);
    try {
      await restorePurchases();
      await refreshProfile();
      router.dismiss();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not restore purchases.';
      Alert.alert('Restore failed', message);
    } finally {
      setLoading(false);
    }
  }, [refreshProfile, router]);

  // Redirect is in-flight on Android — render nothing rather than the paywall UI.
  if (!isUpgradeAvailable) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top', 'bottom']}>
      {/* Close button */}
      <TouchableOpacity
        onPress={() => router.dismiss()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={{ position: 'absolute', top: 56, right: 20, zIndex: 10, padding: 4 }}
      >
        <Text style={{ fontSize: 22, color: '#8E8E93' }}>✕</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 72, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Icon + heading */}
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <Text style={{ fontSize: 64, marginBottom: 16 }}>🚀</Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#1C1C1E', marginBottom: 8, textAlign: 'center' }}>
            Cottix Pro
          </Text>
          <Text style={{ fontSize: 16, color: '#8E8E93', textAlign: 'center', lineHeight: 22 }}>
            Unlock unlimited apps and{'\n'}real-time collaboration
          </Text>
        </View>

        {/* Feature list */}
        <View style={{ marginBottom: 28, gap: 12 }}>
          {FEATURES.map((feature) => (
            <View key={feature} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Text style={{ fontSize: 16, color: '#007AFF', marginTop: 1 }}>✓</Text>
              <Text style={{ fontSize: 15, color: '#1C1C1E', flex: 1, lineHeight: 22 }}>{feature}</Text>
            </View>
          ))}
        </View>

        {/* Billing toggle */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: '#F2F2F7',
            borderRadius: 10,
            padding: 3,
            marginBottom: 20,
          }}
        >
          {(['monthly', 'yearly'] as BillingPeriod[]).map((period) => (
            <TouchableOpacity
              key={period}
              onPress={() => setBillingPeriod(period)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: billingPeriod === period ? '#FFFFFF' : 'transparent',
                alignItems: 'center',
                shadowColor: billingPeriod === period ? '#000' : 'transparent',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: billingPeriod === period ? 0.08 : 0,
                shadowRadius: 2,
                elevation: billingPeriod === period ? 2 : 0,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: billingPeriod === period ? '600' : '400',
                  color: billingPeriod === period ? '#1C1C1E' : '#8E8E93',
                }}
              >
                {period === 'monthly' ? 'Monthly' : 'Yearly'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Price display */}
        <View style={{ alignItems: 'center', marginBottom: 20, gap: 4 }}>
          {offeringsLoading ? (
            <ActivityIndicator color="#007AFF" />
          ) : offeringsError ? (
            <TouchableOpacity onPress={() => void loadOfferings()} style={{ alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14, color: '#8E8E93' }}>Could not load pricing.</Text>
              <Text style={{ fontSize: 14, color: '#007AFF', fontWeight: '600' }}>Tap to retry</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={{ fontSize: 32, fontWeight: '700', color: '#1C1C1E' }}>
                {billingPeriod === 'monthly' ? monthlyPrice : yearlyPrice}
              </Text>
              {billingPeriod === 'yearly' && (
                <View
                  style={{
                    backgroundColor: '#ECFDF5',
                    borderRadius: 6,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#059669' }}>
                    Save ~27% vs monthly
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* CTA */}
        <TouchableOpacity
          onPress={handlePurchase}
          disabled={loading || !selectedPkg}
          style={{
            backgroundColor: loading || !selectedPkg ? '#A8C7FA' : '#007AFF',
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={{ fontSize: 17, fontWeight: '600', color: '#FFFFFF' }}>{ctaLabel}</Text>
          )}
        </TouchableOpacity>

        {/* Restore */}
        <TouchableOpacity
          onPress={handleRestore}
          disabled={loading}
          style={{ alignItems: 'center', marginBottom: 16 }}
        >
          <Text style={{ fontSize: 15, color: '#007AFF' }}>Restore Purchases</Text>
        </TouchableOpacity>

        {/* Fine print */}
        <Text style={{ fontSize: 12, color: '#8E8E93', textAlign: 'center', lineHeight: 18 }}>
          Billed via Apple. Cancel anytime in iOS Settings.{'\n'}Subscription automatically renews unless cancelled.
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 }}>
          <TouchableOpacity onPress={() => void Linking.openURL('https://cottix.co/terms')}>
            <Text style={{ fontSize: 12, color: '#007AFF' }}>Terms of Use</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 12, color: '#8E8E93' }}>·</Text>
          <TouchableOpacity onPress={() => void Linking.openURL('https://cottix.co/privacy')}>
            <Text style={{ fontSize: 12, color: '#007AFF' }}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
