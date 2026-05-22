import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Storage as KVStore } from 'expo-sqlite/kv-store';
import { useSQLiteContext } from 'expo-sqlite';

import {
  DemoAppsSlide,
  FeatureSlide,
  ImageSlide,
  OnboardingSlide,
  PaywallSlide,
  WelcomeSlide,
  useAppConfig,
} from '@/hooks/useAppConfig';
import { installUrlApp } from '@/services/appInstaller';

type ImportStatus = 'idle' | 'loading' | 'done';

export default function OnboardingScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { slides, loading } = useAppConfig();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [importStatus, setImportStatus] = useState<Record<string, ImportStatus>>({});

  const goTo = (i: number) => setCurrentIndex(i);
  const goNext = () => goTo(currentIndex + 1);
  const goBack = () => goTo(currentIndex - 1);

  const markDone = () => KVStore.setItem('onboarding_complete', 'true');

  const handleImport = async (url: string, name: string, icon: string, color: string) => {
    if (importStatus[url] === 'loading' || importStatus[url] === 'done') return;
    setImportStatus((s) => ({ ...s, [url]: 'loading' }));
    try {
      await installUrlApp(db, { url, name, iconEmoji: icon, iconBgColor: color });
      setImportStatus((s) => ({ ...s, [url]: 'done' }));
    } catch {
      setImportStatus((s) => ({ ...s, [url]: 'idle' }));
    }
  };

  const handlePaywallUpgrade = async () => {
    await markDone();
    router.push('/paywall');
  };

  const handlePaywallSkip = async () => {
    await markDone();
    router.replace('/(tabs)');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.slideContainer}>
        {slides.map((slide, i) => {
          const visible = i === currentIndex;
          return (
            <View
              key={i}
              style={[StyleSheet.absoluteFillObject, { opacity: visible ? 1 : 0 }]}
              pointerEvents={visible ? 'auto' : 'none'}
            >
              {renderSlide(slide, {
                goNext,
                goBack,
                importStatus,
                onImport: handleImport,
                onUpgrade: handlePaywallUpgrade,
                onSkip: handlePaywallSkip,
                isFirst: i === 0,
              })}
            </View>
          );
        })}
      </View>

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === currentIndex ? styles.dotActive : styles.dotInactive,
            ]}
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

type SlideProps = {
  goNext: () => void;
  goBack: () => void;
  importStatus: Record<string, ImportStatus>;
  onImport: (url: string, name: string, icon: string, color: string) => void;
  onUpgrade: () => void;
  onSkip: () => void;
  isFirst: boolean;
};

function renderSlide(slide: OnboardingSlide, props: SlideProps) {
  switch (slide.type) {
    case 'welcome':
      return <WelcomeSlideView slide={slide} onNext={props.goNext} />;
    case 'image':
      return <ImageSlideView slide={slide} onNext={props.goNext} onBack={props.goBack} onSkip={props.onSkip} />;
    case 'demo_apps':
      return (
        <DemoAppsSlideView
          slide={slide}
          onNext={props.goNext}
          onBack={props.goBack}
          importStatus={props.importStatus}
          onImport={props.onImport}
        />
      );
    case 'feature':
      return <FeatureSlideView slide={slide} onNext={props.goNext} onBack={props.goBack} />;
    case 'paywall':
      return (
        <PaywallSlideView
          slide={slide}
          onBack={props.goBack}
          onUpgrade={props.onUpgrade}
          onSkip={props.onSkip}
        />
      );
  }
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.backButton} hitSlop={12}>
      <Text style={styles.backChevron}>‹</Text>
    </TouchableOpacity>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.primaryButton} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function WelcomeSlideView({ slide, onNext }: { slide: WelcomeSlide; onNext: () => void }) {
  return (
    <View style={styles.slide}>
      <Text style={styles.heroEmoji}>🚀</Text>
      <Text style={styles.welcomeHeadline}>{slide.headline}</Text>
      <Text style={styles.welcomeSubtext}>{slide.subtext}</Text>
      <View style={styles.buttonArea}>
        <PrimaryButton label="Get Started →" onPress={onNext} />
      </View>
    </View>
  );
}

function ImageSlideView({
  slide,
  onNext,
  onBack,
  onSkip,
}: {
  slide: ImageSlide;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <View style={styles.slide}>
      <BackButton onPress={onBack} />
      <View style={styles.imageWrapper}>
        {slide.image_url && !imgError ? (
          <Image
            source={{ uri: slide.image_url }}
            style={styles.slideImage}
            resizeMode="contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={styles.imagePlaceholder} />
        )}
      </View>
      {slide.heading ? <Text style={styles.imageHeading}>{slide.heading}</Text> : null}
      {slide.subheading ? <Text style={styles.imageSubheading}>{slide.subheading}</Text> : null}
      <View style={styles.buttonArea}>
        <PrimaryButton label="Continue →" onPress={onNext} />
        <TouchableOpacity onPress={onSkip} style={styles.skipLink} activeOpacity={0.7}>
          <Text style={styles.skipLinkText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DemoAppsSlideView({
  slide,
  onNext,
  onBack,
  importStatus,
  onImport,
}: {
  slide: DemoAppsSlide;
  onNext: () => void;
  onBack: () => void;
  importStatus: Record<string, ImportStatus>;
  onImport: (url: string, name: string, icon: string, color: string) => void;
}) {
  return (
    <View style={styles.slide}>
      <BackButton onPress={onBack} />
      <Text style={[styles.sectionHeading, styles.demoHeading]}>{slide.heading}</Text>
      <ScrollView
        style={styles.cardScroll}
        contentContainerStyle={styles.cardScrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {slide.apps.map((app) => {
          const status = importStatus[app.url] ?? 'idle';
          const icon = app.icon ?? '📱';
          const color = app.color ?? '#E5E7EB';
          return (
            <View key={app.url} style={styles.card}>
              <View style={[styles.cardIcon, { backgroundColor: color }]}>
                <Text style={styles.cardEmoji}>{icon}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{app.name}</Text>
                <Text style={styles.cardDesc}>{app.desc}</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.importButton,
                  status === 'done' && styles.importButtonDone,
                ]}
                onPress={() => onImport(app.url, app.name, icon, color)}
                disabled={status !== 'idle'}
                activeOpacity={0.7}
              >
                {status === 'loading' ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : status === 'done' ? (
                  <Text style={styles.importButtonDoneText}>✓</Text>
                ) : (
                  <Text style={styles.importButtonText}>Import</Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.buttonArea}>
        <PrimaryButton label="Continue →" onPress={onNext} />
      </View>
    </View>
  );
}

function FeatureSlideView({
  slide,
  onNext,
  onBack,
}: {
  slide: FeatureSlide;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.slide}>
      <BackButton onPress={onBack} />
      <Text style={styles.heroEmoji}>{slide.icon}</Text>
      <Text style={styles.featureHeadline}>{slide.headline}</Text>
      <Text style={styles.featureBody}>{slide.body}</Text>
      {slide.bullets && slide.bullets.length > 0 && (
        <View style={styles.bullets}>
          {slide.bullets.map((bullet, i) => (
            <Text key={i} style={styles.bulletItem}>
              · {bullet}
            </Text>
          ))}
        </View>
      )}
      <View style={styles.buttonArea}>
        <PrimaryButton label="Continue →" onPress={onNext} />
      </View>
    </View>
  );
}

function PaywallSlideView({
  slide,
  onBack,
  onUpgrade,
  onSkip,
}: {
  slide: PaywallSlide;
  onBack: () => void;
  onUpgrade: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={styles.slide}>
      <BackButton onPress={onBack} />
      <Text style={styles.heroEmoji}>✨</Text>
      <Text style={styles.featureHeadline}>{slide.headline}</Text>
      <Text style={styles.featureBody}>{slide.body}</Text>
      <View style={styles.buttonArea}>
        <TouchableOpacity
          style={styles.upgradeButton}
          onPress={onUpgrade}
          activeOpacity={0.8}
        >
          <Text style={styles.upgradeButtonText}>{slide.cta}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSkip} style={styles.skipLink} activeOpacity={0.7}>
          <Text style={styles.skipLinkText}>{slide.skip}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideContainer: {
    flex: 1,
    position: 'relative',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    gap: 6,
  },
  dot: {
    borderRadius: 4,
  },
  dotActive: {
    width: 8,
    height: 8,
    backgroundColor: '#007AFF',
  },
  dotInactive: {
    width: 6,
    height: 6,
    backgroundColor: '#D1D5DB',
  },
  slide: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 8,
  },
  backChevron: {
    fontSize: 28,
    color: '#8E8E93',
    lineHeight: 32,
  },
  heroEmoji: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 24,
  },
  welcomeHeadline: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 32,
  },
  welcomeSubtext: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  sectionHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 20,
    marginTop: 24,
  },
  demoHeading: {
    marginTop: 48,
  },
  imageWrapper: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#F2F2F7',
  },
  slideImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    backgroundColor: '#E5E7EB',
  },
  imageHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 8,
  },
  imageSubheading: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  cardScroll: {
    flex: 1,
  },
  cardScrollContent: {
    gap: 12,
    paddingBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F2F2F7',
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardEmoji: {
    fontSize: 22,
  },
  cardInfo: {
    flex: 1,
    marginRight: 8,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: 13,
    color: '#8E8E93',
  },
  importButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  importButtonDone: {
    borderColor: '#34C759',
    backgroundColor: '#F0FDF4',
  },
  importButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
  importButtonDoneText: {
    fontSize: 16,
    color: '#34C759',
    fontWeight: '700',
  },
  featureHeadline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 28,
  },
  featureBody: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  bullets: {
    marginTop: 16,
    alignSelf: 'flex-start',
    width: '100%',
    paddingHorizontal: 8,
    gap: 8,
  },
  bulletItem: {
    fontSize: 15,
    color: '#8E8E93',
    lineHeight: 22,
  },
  buttonArea: {
    marginTop: 'auto',
    paddingTop: 16,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  upgradeButton: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  upgradeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  skipLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipLinkText: {
    fontSize: 14,
    color: '#8E8E93',
  },
});
