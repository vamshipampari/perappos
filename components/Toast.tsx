/**
 * Lightweight toast system.
 *
 * Usage:
 *   1. Wrap your root with <ToastProvider>.
 *   2. Call useToast().showToast('message', 'success' | 'error') from any screen.
 *
 * Renders an animated pill that slides down from the top, then auto-dismisses
 * after 3 seconds.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ── Single toast banner ────────────────────────────────────────────────────────

function ToastBanner({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // Slide in from top
    translateY.value = withSpring(0, { damping: 18, stiffness: 260 });
    opacity.value = withTiming(1, { duration: 160 });

    // Auto-dismiss after 3 s
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
      translateY.value = withTiming(-80, { duration: 220 });
    }, 3000);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const bg = item.type === 'success' ? '#34C759' : '#FF3B30';

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        { top: insets.top + 10, backgroundColor: bg },
        animStyle,
      ]}
    >
      <Text style={styles.toastText}>{item.message}</Text>
    </Animated.View>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seqRef = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++seqRef.current;
    // Keep at most 2 toasts visible simultaneously
    setToasts((prev) => [...prev.slice(-1), { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      <View style={styles.container}>
        {children}
        {toasts.map((t) => (
          <ToastBanner key={t.id} item={t} onDone={() => removeToast(t.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 9999,
    alignItems: 'center',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
