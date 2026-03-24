/**
 * services/sync/shape-classifier.ts
 *
 * Inspects a JSON string and classifies its shape for merge strategy selection.
 */

const ID_CANDIDATES = ['id', '_id', 'uuid', 'key', 'itemId', 'guid'] as const;

export type ShapeClassification =
  | { type: 'array_with_ids'; idField: string; confidence: number }
  | { type: 'plain_object'; confidence: number }
  | { type: 'other'; confidence: number };

/**
 * Classifies a JSON value string to determine which merge strategy to use.
 *
 * Returns:
 *   - array_with_ids: array of objects where 90%+ have a unique id field
 *   - plain_object: a single JSON object (settings, config)
 *   - other: primitives, strings, arrays of primitives, unrecognizable structures
 *
 * If confidence < 0.8, the bridge should fall back to LWW.
 */
export function classifyShape(value: string): ShapeClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { type: 'other', confidence: 1.0 };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { type: 'other', confidence: 1.0 };
  }

  if (!Array.isArray(parsed)) {
    return { type: 'plain_object', confidence: 0.9 };
  }

  if (parsed.length === 0) {
    return { type: 'other', confidence: 1.0 };
  }

  const parsedArr = parsed as unknown[];
  const objectItems = parsedArr.filter(
    (x): x is Record<string, unknown> =>
      x !== null && typeof x === 'object' && !Array.isArray(x)
  );
  const objectRatio = objectItems.length / parsedArr.length;
  if (objectRatio < 0.8) {
    return { type: 'other', confidence: 0.8 };
  }

  for (const candidate of ID_CANDIDATES) {
    const withField = objectItems.filter(
      (x) => x[candidate] != null && x[candidate] !== ''
    );
    const fieldRatio = withField.length / objectItems.length;

    if (fieldRatio >= 0.9) {
      const ids = withField.map((x) => String(x[candidate]));
      const uniqueIds = new Set(ids);

      if (uniqueIds.size === ids.length) {
        return { type: 'array_with_ids', idField: candidate, confidence: 0.95 };
      } else {
        return { type: 'other', confidence: 0.5 };
      }
    }
  }

  return { type: 'other', confidence: 0.6 };
}

/**
 * Quick check: do two values have the same shape type?
 * If not, skip merge entirely (possible schema migration from an app update).
 */
export function shapesCompatible(valueA: string, valueB: string): boolean {
  const shapeA = classifyShape(valueA);
  const shapeB = classifyShape(valueB);
  return shapeA.type === shapeB.type;
}
