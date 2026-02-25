/**
 * Response Size Limiter
 *
 * Serializes values with circular reference handling and truncates
 * to a maximum character count suitable for LLM consumption.
 */

const DEFAULT_MAX_CHARS = 40_000 // ~10K tokens

/**
 * Serialize and truncate a value for LLM consumption.
 *
 * Handles circular references, non-serializable values, and oversized output.
 */
export function truncateResult(value: unknown, maxChars = DEFAULT_MAX_CHARS): string {
  if (value === undefined) return 'undefined'

  let serialized: string
  try {
    serialized = JSON.stringify(value, circularReplacer(), 2)
  } catch {
    serialized = String(value)
  }

  if (serialized.length <= maxChars) return serialized

  return (
    serialized.slice(0, maxChars) +
    '\n\n... (truncated — refine your code to return less data)'
  )
}

/**
 * JSON.stringify replacer that replaces circular references with "[Circular]".
 */
function circularReplacer() {
  const seen = new WeakSet()
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  }
}
