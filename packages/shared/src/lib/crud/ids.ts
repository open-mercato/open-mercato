import type { Where } from '@open-mercato/shared/lib/query/types'
import { toQueryValueList } from './query-params'

export const MAX_IDS_PER_REQUEST = 200

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

function normalizeIdList(values: string[]): string[] {
  if (values.length === 0) return values
  const deduped = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || !isUuid(trimmed)) continue
    deduped.add(trimmed)
  }
  return Array.from(deduped)
}

function readExistingIds(filter: unknown): string[] | null {
  if (typeof filter === 'string') {
    return isUuid(filter) ? [filter] : null
  }
  if (Array.isArray(filter)) {
    return normalizeIdList(
      filter.filter((value): value is string => typeof value === 'string'),
    )
  }
  if (!filter || typeof filter !== 'object') return null

  const operators = filter as Record<string, unknown>
  if (isUuid(operators.$eq)) return [operators.$eq]

  if (Array.isArray(operators.$in)) {
    return normalizeIdList(
      operators.$in.filter((value): value is string => typeof value === 'string'),
    )
  }

  return null
}

export function parseIdsParam(raw: unknown, maxIds: number = MAX_IDS_PER_REQUEST): string[] {
  const values = toQueryValueList(raw)
  if (values.length === 0) return []
  const safeMax = Number.isFinite(maxIds) && maxIds > 0 ? Math.floor(maxIds) : MAX_IDS_PER_REQUEST
  const parsed = normalizeIdList(values)
  return parsed.slice(0, safeMax)
}

const UUID_SHAPE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Splits a comma-separated id list query param into its trimmed, non-empty entries.
 */
export function splitIdListParam(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

/**
 * Whether every entry of a comma-separated id list query param is UUID-shaped, so it can be
 * bound to a uuid column without a database error. Use it to reject a malformed or mixed list
 * with a 400 instead of dropping the bad entries and widening the result set (#7265).
 */
export function isUuidListParam(raw: unknown): boolean {
  if (raw === undefined) return true
  if (typeof raw !== 'string') return false
  return splitIdListParam(raw).every((value) => UUID_SHAPE_REGEX.test(value))
}

/**
 * Whether an `?ids=` param was supplied at all (a non-empty string, or repeated
 * `?ids=` occurrences), regardless of whether any value survived UUID
 * validation. Lets a caller tell "no ids filter requested" apart from "ids
 * filter requested but every value was malformed" — the latter must match
 * nothing, not fall back to the full list (#4143 Finding 3).
 */
export function isIdsParamProvided(raw: unknown): boolean {
  const occurrences = Array.isArray(raw) ? raw : [raw]
  return occurrences.some((value) => typeof value === 'string' && value.trim().length > 0)
}

export function mergeIdFilter<Fields extends Record<string, unknown>>(
  existingFilters: Where<Fields>,
  parsedIds: string[],
  options?: { idsParamProvided?: boolean },
): Where<Fields> {
  if (parsedIds.length === 0) {
    // The `?ids=` param was supplied but nothing survived UUID validation.
    // Match nothing, mirroring a valid-but-unknown id returning zero rows,
    // rather than silently dropping the filter and returning the full list
    // (record-count side channel — #4143 Finding 3).
    if (options?.idsParamProvided) {
      return { ...existingFilters, id: { $in: [] } }
    }
    return existingFilters
  }

  const existingFilter = (existingFilters as Record<string, unknown>).id
  const existingIds = readExistingIds(existingFilter)

  if (!existingIds) {
    // No existing narrowing — safe to install the user-supplied `$in`.
    if (existingFilter === undefined || existingFilter === null) {
      return { ...existingFilters, id: { $in: parsedIds } }
    }
    // Existing `id` filter is in a shape we do not recognise. Fail closed by
    // ANDing both constraints rather than dropping either: `parsedIds` may be
    // server-supplied narrowing (an interceptor's `before` hook setting
    // `query.ids`), so discarding it to "preserve" an unrecognised caller
    // filter would silently disable that narrowing (#7641). Adding a new
    // recognised shape to `readExistingIds` remains preferable when the
    // shapes can be intersected directly.
    return { $and: [existingFilters, { id: { $in: parsedIds } }] } as Where<Fields>
  }

  const allowed = new Set(parsedIds)
  const intersection = existingIds.filter((id) => allowed.has(id))
  return {
    ...existingFilters,
    id: { $in: intersection },
  }
}
