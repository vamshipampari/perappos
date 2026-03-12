/**
 * services/sync/merge-index.ts
 *
 * Re-exports for the merge system.
 * Named merge-index to avoid conflicting with any existing index.ts in sync/.
 *
 * Usage:
 *   import { handleSharedWrite, generateSyncShim } from '@/services/sync/merge-index';
 */

export { deepEqual, isPlainObject, quickHash } from './merge-utils';
export { classifyShape, shapesCompatible } from './shape-classifier';
export type { ShapeClassification } from './shape-classifier';
export { mergeArraysById, mergeObjectFields } from './three-way-merge';
export type { Conflict, ArrayMergeResult, ObjectMergeResult } from './three-way-merge';
export {
  handleSharedWrite,
  getTelemetryBuffer,
  flushTelemetry,
} from './bridge-merge-handler';
export type {
  SharedWriteMessage,
  SharedWriteResult,
  MergeStrategy,
  MergeTelemetryEvent,
  PowerSyncDB,
} from './bridge-merge-handler';
