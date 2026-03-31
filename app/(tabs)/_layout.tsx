import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Haptics, safeImpactAsync } from '@/lib/haptics';
import { useTheme } from '@/lib/theme';
import { supabase } from '../../services/supabase';

function TabIcon({ symbol, color }: { symbol: string; focused: boolean; color: string }) {
  return (
    <Text style={{ fontSize: 22, color }}>{symbol}</Text>
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
          tabBarIcon: ({ focused, color }) => <TabIcon symbol="⊞" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="guide"
        options={{
          title: 'Guide',
          tabBarIcon: ({ focused, color }) => <TabIcon symbol="◎" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color }) => <TabIcon symbol="⚙" focused={focused} color={color} />,
        }}
      />
    </Tabs>
  );
}
