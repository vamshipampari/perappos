import { useEffect, useState } from 'react';

import { supabase } from '@/services/supabase';

export type DemoApp = {
  name: string;
  desc: string;
  url: string;
  icon?: string;
  color?: string;
};

export type WelcomeSlide = {
  type: 'welcome';
  headline: string;
  subtext: string;
};

export type ImageSlide = {
  type: 'image';
  heading?: string;
  subheading?: string;
  image_url: string;
};

export type DemoAppsSlide = {
  type: 'demo_apps';
  heading: string;
  apps: DemoApp[];
};

export type FeatureSlide = {
  type: 'feature';
  icon: string;
  headline: string;
  body: string;
  bullets?: string[];
};

export type PaywallSlide = {
  type: 'paywall';
  headline: string;
  body: string;
  cta: string;
  skip: string;
};

export type OnboardingSlide =
  | WelcomeSlide
  | ImageSlide
  | DemoAppsSlide
  | FeatureSlide
  | PaywallSlide;

const KNOWN_TYPES = new Set(['welcome', 'image', 'demo_apps', 'feature', 'paywall']);

const DEFAULT_SLIDES: OnboardingSlide[] = [
  {
    type: 'welcome',
    headline: 'Turn any AI-built web app into a native mobile app',
    subtext:
      'Cottix wraps your vibe-coded apps with offline storage, real-time sync, and native device features — no backend needed.',
  },
  {
    type: 'image',
    heading: 'Install any web app',
    subheading: 'Paste a URL or drop HTML — it lives on your home screen',
    image_url: '',
  },
  {
    type: 'image',
    heading: 'Works offline, always',
    subheading: 'SQLite keeps your data safe without internet',
    image_url: '',
  },
  {
    type: 'image',
    heading: 'Real-time collaboration',
    subheading: 'Share an app with your team — everyone syncs instantly',
    image_url: '',
  },
  {
    type: 'image',
    heading: 'Native device features',
    subheading: 'Haptics, notifications, photos and more',
    image_url: '',
  },
  {
    type: 'image',
    heading: 'Create apps with AI',
    subheading: 'Describe what you need — Cottix builds it in seconds',
    image_url: '',
  },
  {
    type: 'demo_apps',
    heading: "Here's what people are building",
    apps: [
      { name: 'Subtrack', desc: 'Subscription tracker', url: 'https://apps.cottix.co/demo/subtrack', icon: '📊', color: '#DBEAFE' },
      { name: 'Workout Log', desc: 'Track sets, reps & progress', url: 'https://apps.cottix.co/demo/workout', icon: '💪', color: '#D1FAE5' },
      { name: 'Expense Snap', desc: 'Quick daily expense logger', url: 'https://apps.cottix.co/demo/expense', icon: '💸', color: '#FEF3C7' },
      { name: 'Daily Habits', desc: 'Habit streaks & check-ins', url: 'https://apps.cottix.co/demo/habits', icon: '✅', color: '#E0E7FF' },
    ],
  },
  {
    type: 'paywall',
    headline: 'Unlock the full Cottix experience',
    body: 'Go Pro for unlimited apps, cloud sync across devices, and real-time collaboration with your team.',
    cta: 'Start Free Trial',
    skip: 'Maybe later',
  },
];

export function useAppConfig() {
  const [slides, setSlides] = useState<OnboardingSlide[]>(DEFAULT_SLIDES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'onboarding_slides')
          .single();
        if (data?.value) {
          try {
            const parsed: unknown[] = JSON.parse(data.value);
            const valid = parsed.filter(
              (s): s is OnboardingSlide =>
                typeof s === 'object' &&
                s !== null &&
                KNOWN_TYPES.has((s as { type: string }).type),
            );
            if (valid.length > 0) setSlides(valid);
          } catch {
            // use defaults
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { slides, loading };
}
