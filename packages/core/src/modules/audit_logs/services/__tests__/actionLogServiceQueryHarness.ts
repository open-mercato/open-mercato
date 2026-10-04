import { RawQueryFragment } from '@mikro-orm/core'
import { ActionLogService } from '../actionLogService'

export type ActionLogQueryRow = {
  [key: string]: unknown
  contextJson?: Record<string, unknown> | null
  createdAt: Date
  id: string
  updatedAt: Date
}

function matchesRawCondition(row: ActionLogQueryRow, key: symbol, expected: unknown): boolean {
  const fragment = RawQueryFragment.getKnownFragment(key)
  if (!fragment) return false
  const context = row.contextJson
  const isContextObject = Boolean(context && !Array.isArray(context) && typeof context === 'object')
  const hasActorSubject = Boolean(
    isContextObject
    && Object.prototype.hasOwnProperty.call(context, 'actorSubject'),
  )

  if (fragment.sql.includes('->>')) {
    return (hasActorSubject ? context?.actorSubject : null) === expected
  }
  if (fragment.sql.includes('jsonb_typeof')) {
    return (context === null || (isContextObject && !hasActorSubject)) === expected
  }

  return false
}

function matchesFilter(row: ActionLogQueryRow, filter: Record<PropertyKey, unknown>): boolean {
  for (const key of Reflect.ownKeys(filter)) {
    const expected = filter[key]
    if (typeof key === 'symbol') {
      if (!matchesRawCondition(row, key, expected)) return false
      continue
    }
    if (key === '$or') {
      if (!Array.isArray(expected) || !expected.some((branch) => (
        branch !== null
        && typeof branch === 'object'
        && matchesFilter(row, branch as Record<PropertyKey, unknown>)
      ))) return false
      continue
    }

    const actual = row[key]
    if (expected !== null && typeof expected === 'object' && '$ne' in expected) {
      if (actual === (expected as { $ne: unknown }).$ne) return false
      continue
    }
    if (actual !== expected) return false
  }

  return true
}

export function buildActionLogQueryHarness(
  rows: ActionLogQueryRow[],
  options: { encryptionEnabled?: boolean } = {},
) {
  const resolveMatches = (
    where: Record<PropertyKey, unknown>,
    queryOptions?: { limit?: number; offset?: number; orderBy?: Record<string, string> },
  ) => {
    const matches = rows.filter((row) => matchesFilter(row, where))
    const orderEntries = Object.entries(queryOptions?.orderBy ?? {})
    if (orderEntries.length > 0) {
      matches.sort((left, right) => {
        for (const [orderField, orderDirection] of orderEntries) {
          const leftValue = left[orderField]
          const rightValue = right[orderField]
          const result = leftValue instanceof Date && rightValue instanceof Date
            ? leftValue.getTime() - rightValue.getTime()
            : String(leftValue).localeCompare(String(rightValue))
          if (result !== 0) return orderDirection === 'desc' ? -result : result
        }
        return 0
      })
    }
    const offset = queryOptions?.offset ?? 0
    const limit = queryOptions?.limit ?? matches.length
    return matches.slice(offset, offset + limit)
  }
  const findOne = jest.fn(async (
    _entity: unknown,
    where: Record<PropertyKey, unknown>,
    queryOptions?: { limit?: number; offset?: number; orderBy?: Record<string, string> },
  ) => resolveMatches(where, queryOptions)[0] ?? null)
  const find = jest.fn(async (
    _entity: unknown,
    where: Record<PropertyKey, unknown>,
    queryOptions?: { limit?: number; offset?: number; orderBy?: Record<string, string> },
  ) => resolveMatches(where, queryOptions))
  const tenantEncryptionService = options.encryptionEnabled
    ? {
        isEnabled: () => true,
        getDek: async () => null,
        decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
      }
    : undefined
  const service = new ActionLogService({ find, findOne } as never, tenantEncryptionService as never)

  return { find, findOne, service }
}
