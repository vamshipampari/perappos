/**
 * services/sync/three-way-merge.ts
 *
 * Core merge logic. Given base + incoming + current, produces a merged result.
 */

import { deepEqual, isPlainObject } from './merge-utils';

// ─── Types ───────────────────────────────────────────────────────────

export interface Conflict {
  id: string;
  type:
    | 'concurrent_add'
    | 'delete_vs_update'
    | 'field_conflict'
    | 'concurrent_update';
  fields?: string[];
}

export interface ArrayMergeResult {
  merged: Record<string, any>[];
  conflicts: Conflict[];
}

export interface ObjectMergeResult {
  value: Record<string, any>;
  conflicts: string[];
}

// ─── Array Merge (order-preserving) ──────────────────────────────────

/**
 * 3-way merge for arrays of objects with a stable ID field.
 *
 * 1. Diff base → incoming to figure out what THIS user did
 * 2. Apply those changes onto `current` (the DB state)
 * 3. Preserve incoming's array order, append server-only items at end
 */
export function mergeArraysById(
  base: Record<string, any>[] | undefined,
  incoming: Record<string, any>[],
  current: Record<string, any>[],
  idField: string
): ArrayMergeResult {
  const baseMap = new Map(
    (base ?? []).map((x) => [String(x[idField]), x])
  );
  const incomingMap = new Map(
    incoming.map((x) => [String(x[idField]), x])
  );
  const currentMap = new Map(
    current.map((x) => [String(x[idField]), x])
  );

  const conflicts: Conflict[] = [];

  // ── Derive user intent: base → incoming ──

  const added = new Set<string>();
  const deleted = new Set<string>();
  const updated = new Set<string>();

  for (const [id, item] of incomingMap) {
    if (!baseMap.has(id)) {
      added.add(id);
    } else if (!deepEqual(item, baseMap.get(id))) {
      updated.add(id);
    }
  }
  for (const id of baseMap.keys()) {
    if (!incomingMap.has(id)) {
      deleted.add(id);
    }
  }

  // ── Apply intent onto current DB state ──

  const mergedMap = new Map(currentMap);

  // Deletions
  for (const id of deleted) {
    const currentItem = currentMap.get(id);
    const baseItem = baseMap.get(id)!;

    if (!currentItem || deepEqual(currentItem, baseItem)) {
      mergedMap.delete(id);
    } else {
      // Delete vs update conflict — keep the update (safer for family apps)
      conflicts.push({ id, type: 'delete_vs_update' });
    }
  }

  // Updates
  for (const id of updated) {
    const currentItem = currentMap.get(id);
    const baseItem = baseMap.get(id)!;
    const incomingItem = incomingMap.get(id)!;

    if (!currentItem || deepEqual(currentItem, baseItem)) {
      mergedMap.set(id, incomingItem);
    } else {
      // Both changed same item — field-level merge
      const fieldMerge = mergeObjectFields(baseItem, incomingItem, currentItem);
      mergedMap.set(id, fieldMerge.value);
      if (fieldMerge.conflicts.length > 0) {
        conflicts.push({
          id,
          type: 'field_conflict',
          fields: fieldMerge.conflicts,
        });
      }
    }
  }

  // Additions
  for (const id of added) {
    const incomingItem = incomingMap.get(id)!;
    const currentItem = currentMap.get(id);

    if (!currentItem) {
      mergedMap.set(id, incomingItem);
    } else if (deepEqual(currentItem, incomingItem)) {
      // Both added same thing — no conflict
    } else {
      conflicts.push({ id, type: 'concurrent_add' });
      mergedMap.set(id, incomingItem);
    }
  }

  // ── Order preservation ──
  // Incoming order first, then server-only items appended at end

  const result: Record<string, any>[] = [];
  const placed = new Set<string>();

  for (const item of incoming) {
    const id = String(item[idField]);
    if (mergedMap.has(id)) {
      result.push(mergedMap.get(id)!);
      placed.add(id);
    }
  }

  for (const item of current) {
    const id = String(item[idField]);
    if (mergedMap.has(id) && !placed.has(id)) {
      result.push(mergedMap.get(id)!);
      placed.add(id);
    }
  }

  return { merged: result, conflicts };
}

// ─── Object Merge (field-level) ──────────────────────────────────────

/**
 * 3-way field-level merge for plain objects (settings, config, individual items).
 *
 * Rules per field:
 *   - Only this user changed → take incoming
 *   - Only other user changed → keep current
 *   - Both same change → fine
 *   - Both different → incoming wins, conflict logged
 *   - Nested plain objects → recurse
 */
export function mergeObjectFields(
  base: Record<string, any> | undefined,
  incoming: Record<string, any>,
  current: Record<string, any>
): ObjectMergeResult {
  const result: Record<string, any> = { ...current };
  const conflicts: string[] = [];
  const b = base ?? {};

  const allKeys = new Set([
    ...Object.keys(incoming),
    ...Object.keys(b),
    ...Object.keys(current),
  ]);

  for (const key of allKeys) {
    const bv = b[key];
    const iv = incoming[key];
    const cv = current[key];

    if (deepEqual(iv, bv)) continue;          // user didn't touch this field
    if (deepEqual(cv, bv)) {
      result[key] = iv;                        // only this user changed it
      continue;
    }
    if (deepEqual(iv, cv)) continue;           // both made same change

    // Both changed differently
    if (isPlainObject(bv) && isPlainObject(iv) && isPlainObject(cv)) {
      const nested = mergeObjectFields(bv, iv, cv);
      result[key] = nested.value;
      conflicts.push(...nested.conflicts.map((f) => `${key}.${f}`));
    } else {
      result[key] = iv;                        // incoming wins
      conflicts.push(key);
    }
  }

  return { value: result, conflicts };
}
