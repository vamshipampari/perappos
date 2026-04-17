import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

let isInitialized = false;

function getRelease() {
  const expoConfig = Constants.expoConfig;
  const appId =
    expoConfig?.ios?.bundleIdentifier ??
    expoConfig?.android?.package ??
    expoConfig?.slug ??
    'cottix';
  const version = expoConfig?.version ?? '0.0.0';
  const build = Constants.nativeBuildVersion ?? Constants.nativeAppVersion ?? 'dev';

  return `${appId}@${version}+${build}`;
}

export function initSentry() {
  if (isInitialized || !dsn) return;

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    tracesSampleRate: __DEV__ ? 1 : 0.2,
    release: getRelease(),
    beforeSend(event, hint) {
      const originalException = hint.originalException;
      const message =
        originalException instanceof Error
          ? originalException.message
          : typeof originalException === 'string'
            ? originalException
            : null;

      if (message?.includes('Network request failed')) {
        return null;
      }

      return event;
    },
  });

  isInitialized = true;
}

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;

  if (typeof error === 'string') {
    return new Error(error);
  }

  return new Error('Non-Error exception');
}

export function truncateForSentry(value: string, max = 500) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export { Sentry };
