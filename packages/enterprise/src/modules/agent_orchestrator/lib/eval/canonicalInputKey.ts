import { createHash } from 'node:crypto'

/**
 * Recursively canonicalizes a JSON-ish value so that two structurally-equal
 * inputs serialize identically regardless of object key order. Arrays keep their
 * order (order is semantically meaningful); object keys are sorted; primitives
 * pass through. Non-finite numbers / undefined collapse to null (matching
 * JSON.stringify semantics) so the result is always a stable string.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const canonicalChild = canonicalize(record[key])
    if (canonicalChild !== undefined) sorted[key] = canonicalChild
  }
  return sorted
}

/**
 * Deterministic content hash of an agent run input, stable across object key
 * order. Used to match a live/playground run's input to an approved golden eval
 * case (`agent_eval_cases.input_key`). Computed over the DECRYPTED plaintext
 * input at write time; the resulting hex digest is stored plaintext and is
 * SQL-queryable. 64-char SHA-256 hex → fits `varchar(64)`.
 */
export function canonicalInputKey(input: unknown): string {
  const canonical = JSON.stringify(canonicalize(input) ?? null)
  return createHash('sha256').update(canonical).digest('hex')
}
