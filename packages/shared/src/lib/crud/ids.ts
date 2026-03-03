import type { Where } from '@open-mercato/shared/lib/query/types'

export const MAX_IDS_PER_REQUEST = 200

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  if (!filter || typeof filter !== 'object') return null

  const operators = filter as Record<string, unknown>
  if (isUuid(operators.$eq)) return [operators.$eq]

  if (Array.isArray(operators.$in)) {
    const parsed = normalizeIdList(
      operators.$in.filter((value): value is string => typeof value === 'string'),
    )
    return parsed
  }

  return null
}

export function parseIdsParam(raw: unknown, maxIds: number = MAX_IDS_PER_REQUEST): string[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return []
  const safeMax = Number.isFinite(maxIds) && maxIds > 0 ? Math.floor(maxIds) : MAX_IDS_PER_REQUEST
  const parsed = normalizeIdList(raw.split(','))
  return parsed.slice(0, safeMax)
}

export function mergeIdFilter<Fields extends Record<string, unknown>>(
  existingFilters: Where<Fields>,
  parsedIds: string[],
): Where<Fields> {
  if (parsedIds.length === 0) return existingFilters

  const allowed = new Set(parsedIds)
  const existingFilter = (existingFilters as Record<string, unknown>).id
  const existingIds = readExistingIds(existingFilter)

  if (!existingIds) {
    return { ...existingFilters, id: { $in: parsedIds } }
  }

  const intersection = existingIds.filter((id) => allowed.has(id))
  return {
    ...existingFilters,
    id: { $in: intersection },
  }
}
