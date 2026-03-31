import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Haptics, safeImpactAsync } from '@/lib/haptics';
import { useTheme } from '@/lib/theme';
import { supabase } from '../../services/supabase';

function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{symbol}</Text>
  );
}

export default function TabLayout() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
      setSessionChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setHasSession(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!sessionChecked) return null;
  if (!hasSession) return <Redirect href="/login" />;

  return (
    <Tabs
      screenListeners={{
        tabPress: () => {
          void safeImpactAsync(Haptics.ImpactFeedbackStyle.Light);
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.tabBar,
          borderTopWidth: 0.5,
          borderTopColor: theme.tabBarBorder,
          elevation: 0,
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.labelSecondary,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          marginBottom: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon symbol="⊞" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ focused }) => <TabIcon symbol="✦" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon symbol="⚙" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
