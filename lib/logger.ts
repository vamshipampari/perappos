/**
 * Conditional logger that only outputs in development mode.
 *
 * All existing console.log/warn/error calls should migrate here so
 * production builds are silent. Each call site already uses prefixes
 * like [webview], [sync], [live-push] — keep those as the first arg.
 *
 * Usage:
 *   import { log } from '@/lib/logger';
 *   log.info('[webview]', 'message loaded', someData);
 *   log.warn('[sync]', 'retry failed');
 *   log.error('[merge]', 'unexpected shape', err);
 */

/* eslint-disable no-console */

const noop = (..._args: unknown[]): void => {};

export const log = {
  info: __DEV__ ? console.log.bind(console) : noop,
  warn: __DEV__ ? console.warn.bind(console) : noop,
  error: __DEV__ ? console.error.bind(console) : noop,
};
