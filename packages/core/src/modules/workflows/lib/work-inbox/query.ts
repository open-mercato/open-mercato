/**
 * Work Inbox — query-string parsing (PURE).
 *
 * Kept out of the route handler so every filter, the limit clamp and the
 * priority vocabulary can be asserted without a request, a container or a
 * database. The route only supplies the caller scope.
 */

import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { parseCommaSeparatedList, trimToUndefined } from '@open-mercato/shared/lib/string'
import { normalizeWorkInboxPriority } from './provider'
import type { WorkInboxPriority, WorkInboxQuery } from './provider'

export const WORK_INBOX_DEFAULT_LIMIT = 50

/** Project rule: `pageSize` never exceeds 100 (root AGENTS.md → UI & HTTP). */
export const WORK_INBOX_MAX_LIMIT = 100

function listOrNull(raw: string | null): string[] | null {
  const values = parseCommaSeparatedList(raw)
  return values.length > 0 ? values : null
}

function prioritiesOrNull(raw: string | null): WorkInboxPriority[] | null {
  const values = parseCommaSeparatedList(raw)
    .map(normalizeWorkInboxPriority)
    .filter((value): value is WorkInboxPriority => value !== null)
  return values.length > 0 ? values : null
}

/**
 * `myWork` also answers to `myTasks`, the name the shipped task inbox has always
 * sent, so a bookmarked filter keeps meaning what it meant.
 */
/** Filter ids the inbox page offers, in the order they appear in the filter bar. */
export const WORK_INBOX_TEXT_FILTERS = [
  'kind',
  'module',
  'entityType',
  'role',
  'priority',
  'status',
] as const

export const WORK_INBOX_FLAG_FILTERS = ['overdue', 'myWork'] as const

export type WorkInboxFilterValues = Record<string, unknown>

/**
 * Client → server filter forwarding, kept outside the page for the same reason
 * `lib/task-list-query.ts` is: forwarding only a subset is silent, and the view
 * then claims a narrowing it never asked the server for.
 */
export function buildWorkInboxListQueryParams(
  filters: WorkInboxFilterValues,
  pagination: { limit: number; offset: number },
): URLSearchParams {
  const params = new URLSearchParams()
  params.set('limit', String(Math.min(pagination.limit, WORK_INBOX_MAX_LIMIT)))
  params.set('offset', String(pagination.offset))

  for (const key of WORK_INBOX_TEXT_FILTERS) {
    const value = filters[key]
    if (typeof value === 'string' && value.length > 0) params.set(key, value)
  }

  for (const key of WORK_INBOX_FLAG_FILTERS) {
    if (filters[key] === 'true') params.set(key, 'true')
  }

  return params
}

export function parseWorkInboxQuery(searchParams: URLSearchParams, now: Date): WorkInboxQuery {
  const limit = Math.min(
    parseNumberWithDefault(searchParams.get('limit'), WORK_INBOX_DEFAULT_LIMIT, {
      min: 1,
      integer: true,
    }),
    WORK_INBOX_MAX_LIMIT,
  )

  const myWork =
    parseBooleanWithDefault(searchParams.get('myWork'), false) ||
    parseBooleanWithDefault(searchParams.get('myTasks'), false)

  return {
    kinds: listOrNull(searchParams.get('kind')),
    moduleIds: listOrNull(searchParams.get('module')),
    entityTypes: listOrNull(searchParams.get('entityType')),
    roles: listOrNull(searchParams.get('role')),
    priorities: prioritiesOrNull(searchParams.get('priority')),
    statuses: listOrNull(searchParams.get('status')),
    overdueOnly: parseBooleanWithDefault(searchParams.get('overdue'), false),
    myWork,
    assignedTo: trimToUndefined(searchParams.get('assignedTo')) ?? null,
    workflowInstanceId: trimToUndefined(searchParams.get('workflowInstanceId')) ?? null,
    limit,
    offset: parseNumberWithDefault(searchParams.get('offset'), 0, { min: 0, integer: true }),
    now,
  }
}
