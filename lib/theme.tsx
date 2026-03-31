import React, { createContext, useCallback, useContext, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

export interface Colors {
  // Backgrounds
  background: string;         // screen / grouped list bg
  groupedBackground: string;  // same — explicit alias
  surface: string;            // cards, modals, sheets
  inputBackground: string;    // text input fill

  // Text
  label: string;              // primary text
  labelSecondary: string;     // captions, placeholders
  labelTertiary: string;      // very muted text

  // Accent / semantic
  primary: string;            // blue buttons, links
  separator: string;          // inset separators
  separatorOpaque: string;    // full-bleed borders
  destructive: string;        // red
  success: string;            // green

  // Navigation
  tabBar: string;
  tabBarBorder: string;

  // Overlays
  overlay: string;            // modal backdrop
}

export type ThemeMode = 'light' | 'dark' | 'system';

const light: Colors = {
  background: '#F2F2F7',
  groupedBackground: '#F2F2F7',
  surface: '#FFFFFF',
  inputBackground: '#FAFAFA',

  label: '#1C1C1E',
  labelSecondary: '#8E8E93',
  labelTertiary: '#C7C7CC',

  primary: '#007AFF',
  separator: '#E5E5EA',
  separatorOpaque: '#E5E7EB',
  destructive: '#FF3B30',
  success: '#34C759',

  tabBar: '#FFFFFF',
  tabBarBorder: '#E5E7EB',

  overlay: 'rgba(0,0,0,0.35)',
};

const dark: Colors = {
  background: '#000000',
  groupedBackground: '#000000',
  surface: '#1C1C1E',
  inputBackground: '#2C2C2E',

  label: '#FFFFFF',
  labelSecondary: '#8E8E93',
  labelTertiary: '#48484A',

  primary: '#0A84FF',
  separator: '#38383A',
  separatorOpaque: '#38383A',
  destructive: '#FF453A',
  success: '#30D158',

  tabBar: '#1C1C1E',
  tabBarBorder: '#38383A',

  overlay: 'rgba(0,0,0,0.6)',
};

export const themes = { light, dark };

// ── Theme context ─────────────────────────────────────────────────────────────
// Using React context instead of useColorScheme() directly ensures programmatic
// theme changes (Appearance.setColorScheme) propagate to all mounted tab screens,
// which don't reliably re-render from useColorScheme in RN New Architecture.

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  colors: Colors;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  setMode: () => {},
  colors: light,
});

/** Wrap the app tree with this so useTheme() + useSetTheme() work everywhere. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    // Also drive the system-level scheme so any components using useColorScheme()
    // directly (e.g. third-party libs) follow the user's preference.
    if (newMode !== 'system') {
      Appearance.setColorScheme(newMode);
    }
    // For 'system': Appearance.setColorScheme(null) is invalid in RN 0.83.
    // The ThemeContext already resolves 'system' via useColorScheme(), so
    // we just skip the Appearance call and let the device preference take effect.
  }, []);

  const resolved = mode === 'system' ? (systemScheme ?? 'light') : mode;
  const colors = resolved === 'dark' ? dark : light;

  return (
    <ThemeContext.Provider value={{ mode, setMode, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Returns the color palette for the active theme. */
export function useTheme(): Colors {
  return useContext(ThemeContext).colors;
}

/** Returns a setter that changes the app-wide theme and persists via Appearance. */
export function useSetTheme(): (mode: ThemeMode) => void {
  return useContext(ThemeContext).setMode;
}

/** Returns the current ThemeMode ('light' | 'dark' | 'system'). */
export function useThemeMode(): ThemeMode {
  return useContext(ThemeContext).mode;
}
