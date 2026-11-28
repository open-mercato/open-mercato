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

export type ByteCappedText = { value: string; truncated: boolean; bytes: number }

export type ByteCappedJson = { value: unknown; truncated: boolean; bytes: number }

export function measureUtf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

export function truncateTextToBytes(text: string, maxBytes: number): ByteCappedText {
  const bytes = measureUtf8Bytes(text)
  if (bytes <= maxBytes) return { value: text, truncated: false, bytes }
  const sliced = Buffer.from(text, 'utf8').subarray(0, Math.max(0, maxBytes)).toString('utf8')
  return { value: sliced.replace(/\uFFFD+$/, ''), truncated: true, bytes }
}

export function serializeForStorage(value: unknown): string | null {
  if (value === undefined) return null
  try {
    const serialized = JSON.stringify(value, circularReplacer())
    return serialized === undefined ? null : serialized
  } catch {
    return String(value)
  }
}

export function capJsonPayload(value: unknown, maxBytes: number): ByteCappedJson {
  const serialized = serializeForStorage(value)
  if (serialized === null) return { value: null, truncated: false, bytes: 0 }
  const capped = truncateTextToBytes(serialized, maxBytes)
  if (!capped.truncated) {
    try {
      return { value: JSON.parse(serialized), truncated: false, bytes: capped.bytes }
    } catch {
      return { value: serialized, truncated: false, bytes: capped.bytes }
    }
  }
  return { value: capped.value, truncated: true, bytes: capped.bytes }
}
