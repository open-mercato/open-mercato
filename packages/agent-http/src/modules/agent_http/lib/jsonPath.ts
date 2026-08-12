/**
 * The smallest path expression that can address a real provider payload, and
 * nothing more.
 *
 * `result.answer`, `data.0.output.text`: dot-separated segments, a numeric
 * segment indexing an array. No wildcards, no filters, no bracket syntax — a
 * fuller JSONPath would be a second query language to learn, to validate and to
 * get wrong, on a value an operator types into a text field with no autocomplete.
 * When the shape is more complicated than this can address, the honest answer is
 * a provider-specific connector, which is what the seam exists for.
 *
 * Pure and dependency-free on purpose: this is what both the callback (answer
 * extraction) and the start response (provider run id) read through, so a bug
 * here would be a bug in both halves.
 */

/** Own-property read only: a path must never walk into a prototype. */
function readOwn(source: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key)
    ? (source as Record<string, unknown>)[key]
    : undefined
}

/**
 * Resolve `path` against `value`. Returns `undefined` for anything the path
 * cannot reach — a missing key, an index past the end, a scalar in the middle of
 * the path. The caller decides what a miss means; this never throws.
 */
export function readJsonPath(value: unknown, path: string): unknown {
  const segments = path.split('.').filter((segment) => segment.length > 0)
  if (!segments.length) return undefined

  let current: unknown = value
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined
      current = current[Number.parseInt(segment, 10)]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = readOwn(current, segment)
  }
  return current
}

/**
 * A NAME for what was found, never the value itself. Refusal messages are
 * persisted on the run and rendered in the cockpit, and a provider payload is
 * third-party content that can carry anything.
 */
export function describeJsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  const type = typeof value
  if (type === 'object') return 'an object'
  return `a ${type}`
}
