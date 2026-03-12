/**
 * services/sync/__tests__/merge.test.ts
 *
 * Test fixtures for the 3-way merge system.
 * Run with: npx jest services/sync/__tests__/merge.test.ts
 */

import { deepEqual } from '../merge-utils';
import { classifyShape } from '../shape-classifier';
import { mergeArraysById, mergeObjectFields } from '../three-way-merge';

// ─── deepEqual ──────────────────────────────────────────────────────

describe('deepEqual', () => {
  test('primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  test('arrays', () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  test('objects', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test('nested structures', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
  });
});

// ─── Shape Classifier ───────────────────────────────────────────────

describe('classifyShape', () => {
  test('array with id field → array_with_ids', () => {
    const val = JSON.stringify([
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread' },
    ]);
    const result = classifyShape(val);
    expect(result.type).toBe('array_with_ids');
    if (result.type === 'array_with_ids') expect(result.idField).toBe('id');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  test('array with _id field → array_with_ids', () => {
    const val = JSON.stringify([
      { _id: 'abc', amount: 300 },
      { _id: 'def', amount: 150 },
    ]);
    const result = classifyShape(val);
    expect(result.type).toBe('array_with_ids');
    if (result.type === 'array_with_ids') expect(result.idField).toBe('_id');
  });

  test('duplicate IDs → low confidence', () => {
    const val = JSON.stringify([
      { id: '1', name: 'A' },
      { id: '1', name: 'B' },
    ]);
    const result = classifyShape(val);
    expect(result.type).toBe('other');
    expect(result.confidence).toBeLessThan(0.8);
  });

  test('plain object → plain_object', () => {
    expect(classifyShape(JSON.stringify({ theme: 'dark' })).type).toBe('plain_object');
  });

  test('empty array → other', () => {
    expect(classifyShape('[]').type).toBe('other');
  });

  test('array of primitives → other', () => {
    expect(classifyShape('[1,2,3]').type).toBe('other');
  });

  test('non-JSON → other', () => {
    expect(classifyShape('not json').type).toBe('other');
  });

  test('null → other', () => {
    expect(classifyShape('null').type).toBe('other');
  });
});

// ─── Array Merge ────────────────────────────────────────────────────

describe('mergeArraysById', () => {
  test('THE CORE SCENARIO: concurrent additions → both preserved', () => {
    const base = [
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread' },
    ];
    const incoming = [
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread' },
      { id: '3', name: 'Eggs' },        // Dad added Eggs
    ];
    const current = [
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread' },
      { id: '4', name: 'Butter' },      // Mom added Butter
    ];

    const result = mergeArraysById(base, incoming, current, 'id');
    const names = result.merged.map((x) => x.name);

    expect(names).toContain('Milk');
    expect(names).toContain('Bread');
    expect(names).toContain('Eggs');
    expect(names).toContain('Butter');
    expect(result.merged).toHaveLength(4);
    expect(result.conflicts).toHaveLength(0);
  });

  test('clean deletion → item removed', () => {
    const base = [
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread' },
      { id: '3', name: 'Eggs' },
    ];
    const incoming = [
      { id: '1', name: 'Milk' },
      { id: '3', name: 'Eggs' },
    ];
    const current = [...base];

    const result = mergeArraysById(base, incoming, current, 'id');
    expect(result.merged.map((x) => x.name)).not.toContain('Bread');
    expect(result.merged).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  test('delete vs update → update preserved (safer for families)', () => {
    const base = [
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread', qty: 1 },
    ];
    const incoming = [{ id: '1', name: 'Milk' }]; // deleted Bread
    const current = [
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread', qty: 3 },         // someone updated qty
    ];

    const result = mergeArraysById(base, incoming, current, 'id');
    expect(result.merged.map((x) => x.name)).toContain('Bread');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].type).toBe('delete_vs_update');
  });

  test('concurrent update, different fields → both changes merged', () => {
    const base = [{ id: '1', name: 'Milk', qty: 1, checked: false }];
    const incoming = [{ id: '1', name: 'Milk', qty: 2, checked: false }]; // changed qty
    const current = [{ id: '1', name: 'Milk', qty: 1, checked: true }];  // checked off

    const result = mergeArraysById(base, incoming, current, 'id');
    expect(result.merged[0].qty).toBe(2);
    expect(result.merged[0].checked).toBe(true);
  });

  test('concurrent update, same field → incoming wins + conflict', () => {
    const base = [{ id: '1', name: 'Milk', qty: 1 }];
    const incoming = [{ id: '1', name: 'Milk', qty: 5 }];
    const current = [{ id: '1', name: 'Milk', qty: 3 }];

    const result = mergeArraysById(base, incoming, current, 'id');
    expect(result.merged[0].qty).toBe(5);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  test('no base (first sync) → additive', () => {
    const incoming = [{ id: '1', name: 'Milk' }, { id: '2', name: 'Bread' }];
    const current = [{ id: '3', name: 'Eggs' }];

    const result = mergeArraysById(undefined, incoming, current, 'id');
    expect(result.merged).toHaveLength(3);
  });

  test('order preservation → incoming order, server-only items appended', () => {
    const base = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
    const incoming = [
      { id: '2', name: 'B' },    // reordered
      { id: '1', name: 'A' },
      { id: '3', name: 'C' },    // added
    ];
    const current = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
      { id: '4', name: 'D' },    // added by other user
    ];

    const result = mergeArraysById(base, incoming, current, 'id');
    expect(result.merged.map((x) => x.name)).toEqual(['B', 'A', 'C', 'D']);
  });

  test('user clears list → deletes base items, keeps server-added items', () => {
    const base = [
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread' },
    ];
    const incoming: any[] = []; // user cleared everything
    const current = [
      { id: '1', name: 'Milk' },
      { id: '2', name: 'Bread' },
      { id: '3', name: 'Eggs' }, // added by other user
    ];

    const result = mergeArraysById(base, incoming, current, 'id');
    const names = result.merged.map((x) => x.name);
    expect(names).toContain('Eggs');
    expect(names).not.toContain('Milk');
    expect(names).not.toContain('Bread');
  });
});

// ─── Object Merge ───────────────────────────────────────────────────

describe('mergeObjectFields', () => {
  test('non-overlapping changes → both preserved', () => {
    const base = { theme: 'light', lang: 'en', budget: 5000 };
    const incoming = { theme: 'dark', lang: 'en', budget: 5000 };
    const current = { theme: 'light', lang: 'hi', budget: 5000 };

    const result = mergeObjectFields(base, incoming, current);
    expect(result.value.theme).toBe('dark');
    expect(result.value.lang).toBe('hi');
    expect(result.value.budget).toBe(5000);
    expect(result.conflicts).toHaveLength(0);
  });

  test('same field changed differently → incoming wins + conflict', () => {
    const result = mergeObjectFields(
      { theme: 'light' },
      { theme: 'dark' },
      { theme: 'blue' }
    );
    expect(result.value.theme).toBe('dark');
    expect(result.conflicts).toContain('theme');
  });

  test('both same change → no conflict', () => {
    const result = mergeObjectFields(
      { theme: 'light' },
      { theme: 'dark' },
      { theme: 'dark' }
    );
    expect(result.value.theme).toBe('dark');
    expect(result.conflicts).toHaveLength(0);
  });

  test('user didnt change → keep current', () => {
    const result = mergeObjectFields(
      { a: 1, b: 2 },
      { a: 1, b: 2 },
      { a: 1, b: 99 }
    );
    expect(result.value.b).toBe(99);
    expect(result.conflicts).toHaveLength(0);
  });

  test('nested objects → recursive merge', () => {
    const result = mergeObjectFields(
      { prefs: { color: 'red', size: 10 } },
      { prefs: { color: 'blue', size: 10 } },
      { prefs: { color: 'red', size: 20 } }
    );
    expect(result.value.prefs.color).toBe('blue');
    expect(result.value.prefs.size).toBe(20);
    expect(result.conflicts).toHaveLength(0);
  });
});
