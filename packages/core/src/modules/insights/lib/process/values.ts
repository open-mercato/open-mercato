import { isUuid } from '@open-mercato/shared/lib/causation/types'
import {
  PROCESS_ACTIVITY_VALUE_PATTERN,
  PROCESS_MAX_DISTINCT_VALUES_PER_FIELD,
  PROCESS_NONE_VALUE,
  PROCESS_OTHER_VALUE,
  PROCESS_RESERVED_VALUES,
  type ProcessFieldValueKind,
} from '@open-mercato/shared/modules/insights/process'

const RESERVED_VALUES: ReadonlySet<string> = new Set<string>(PROCESS_RESERVED_VALUES)

function toCandidateText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return null
}

/**
 * Maps a raw field value to a plaintext-safe activity value: a UUID (lower-cased), or a
 * value matching `PROCESS_ACTIVITY_VALUE_PATTERN`; a missing or empty value becomes `none`
 * and anything else `other`. `uuid` and `user` fields accept UUIDs only.
 */
export function sanitizeActivityValue(value: unknown, valueKind: ProcessFieldValueKind): string {
  if (value === null || value === undefined) return PROCESS_NONE_VALUE
  const text = toCandidateText(value)
  if (text === null) return PROCESS_OTHER_VALUE
  if (text.length === 0) return PROCESS_NONE_VALUE
  if (isUuid(text)) return text.toLowerCase()
  if (valueKind === 'uuid' || valueKind === 'user') return PROCESS_OTHER_VALUE
  return PROCESS_ACTIVITY_VALUE_PATTERN.test(text) ? text : PROCESS_OTHER_VALUE
}

export function isReservedActivityValue(value: string): boolean {
  return RESERVED_VALUES.has(value)
}

/**
 * Comparable form of a raw value, so a change between two values that both sanitize to
 * `other` still counts as a change.
 */
export function comparableRawValue(value: unknown): string {
  if (value === null || value === undefined) return '\u0000null'
  if (typeof value === 'string') return `s:${value}`
  if (typeof value === 'number' || typeof value === 'boolean') return `p:${String(value)}`
  try {
    return `j:${JSON.stringify(value)}`
  } catch {
    return '\u0000unserializable'
  }
}

/**
 * Per field scope: `known` values (stored ones that were looked up, plus values admitted in
 * this run) and `distinct`, the number of distinct non-reserved values stored or admitted
 * (null until counted; only needed once a value not known to be stored shows up).
 */
export type ValueCapEntry = { known: Set<string>; distinct: number | null }

export type ValueCapState = Map<string, ValueCapEntry>

export function valueCapScope(processKey: string, field: string): string {
  return `${processKey}\u001f${field}`
}

/**
 * Applies the per-organization cardinality cap: a field keeps at most
 * `PROCESS_MAX_DISTINCT_VALUES_PER_FIELD` distinct values (reserved values excluded); any
 * further new value becomes `other`. Before a value not yet `known` is capped, `state` must
 * hold the field's stored values among the incoming ones and its stored distinct count; it is
 * updated in place.
 */
export function capActivityValue(
  state: ValueCapState,
  scope: string,
  value: string,
  maxDistinct: number = PROCESS_MAX_DISTINCT_VALUES_PER_FIELD,
): string {
  if (isReservedActivityValue(value)) return value
  const entry = state.get(scope) ?? { known: new Set<string>(), distinct: 0 }
  state.set(scope, entry)
  if (entry.known.has(value)) return value
  const distinct = entry.distinct ?? entry.known.size
  if (distinct >= maxDistinct) return PROCESS_OTHER_VALUE
  entry.known.add(value)
  entry.distinct = distinct + 1
  return value
}
