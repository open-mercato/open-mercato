import { isIdsParamProvided, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'

// Batch id lookup shares the list's page cap, so `?ids=` can never pull more rows than `?pageSize=`.
export const MAX_USER_LOOKUP_IDS = 100

export type UserIdFilter =
  /** Neither `?id=` nor `?ids=` was supplied — the list is filtered by the other params only. */
  | { kind: 'unfiltered' }
  /** Restrict the list to these ids. */
  | { kind: 'ids'; ids: string[] }
  /**
   * `?ids=` was supplied but nothing usable survived — either no value was a UUID, or the
   * intersection with `?id=` is empty. Match nothing rather than dropping the filter and returning
   * the full first page, which would turn a malformed request into a record-count side channel
   * (the same rule `mergeIdFilter` enforces for CRUD list routes, #4143 Finding 3).
   */
  | { kind: 'none' }

export function resolveUserIdFilter(
  rawIds: unknown,
  id?: string | null,
  maxIds: number = MAX_USER_LOOKUP_IDS,
): UserIdFilter {
  const single = typeof id === 'string' && id.trim() ? id.trim() : null
  if (!isIdsParamProvided(rawIds)) {
    return single ? { kind: 'ids', ids: [single] } : { kind: 'unfiltered' }
  }
  const parsed = parseIdsParam(rawIds, maxIds)
  const ids = single ? parsed.filter((value) => value === single) : parsed
  return ids.length ? { kind: 'ids', ids } : { kind: 'none' }
}
