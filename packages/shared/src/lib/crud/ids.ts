import type { Where } from '@open-mercato/shared/lib/query/types'

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
  if (typeof raw !== 'string' || raw.trim().length === 0) return []
  const safeMax = Number.isFinite(maxIds) && maxIds > 0 ? Math.floor(maxIds) : MAX_IDS_PER_REQUEST
  const parsed = normalizeIdList(raw.split(','))
  return parsed.slice(0, safeMax)
}

/**
 * Whether an `?ids=` param was supplied at all (a non-empty string), regardless
 * of whether any value survived UUID validation. Lets a caller tell "no ids
 * filter requested" apart from "ids filter requested but every value was
 * malformed" — the latter must match nothing, not fall back to the full list
 * (#4143 Finding 3).
 */
export function isIdsParamProvided(raw: unknown): boolean {
  return typeof raw === 'string' && raw.trim().length > 0
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
    // Existing `id` filter is in a shape we do not recognise. Fail closed:
    // preserve the existing filter instead of widening to `parsedIds`. Adding
    // a new recognised shape to `readExistingIds` is preferable to silently
    // dropping a narrowing that another caller put in place.
    return existingFilters
  }

  const allowed = new Set(parsedIds)
  const intersection = existingIds.filter((id) => allowed.has(id))
  return {
    ...existingFilters,
    id: { $in: intersection },
  }
}
