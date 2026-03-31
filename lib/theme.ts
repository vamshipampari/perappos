import { useColorScheme } from 'react-native';

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

/** Returns the color palette for the current color scheme. */
export function useTheme(): Colors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}
