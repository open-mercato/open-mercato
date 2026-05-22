import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { FilterOption } from '@open-mercato/shared/lib/query/advanced-filter'

export type AssignableStaffMember = {
  teamMemberId: string
  userId: string
  displayName: string
  email: string | null
  teamName: string | null
}

type AssignableStaffResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  pageSize?: number
}

export type AssignableStaffMembersPage = {
  items: AssignableStaffMember[]
  total: number
  page: number
  pageSize: number
}

export async function fetchAssignableStaffMembersPage(
  query: string,
  options?: { page?: number; pageSize?: number; signal?: AbortSignal },
): Promise<AssignableStaffMembersPage> {
  const params = new URLSearchParams()
  params.set('page', String(options?.page ?? 1))
  params.set('pageSize', String(options?.pageSize ?? 24))
  const normalizedQuery = query.trim()
  if (normalizedQuery.length > 0) {
    params.set('search', normalizedQuery)
  }

  const data = await readApiResultOrThrow<AssignableStaffResponse>(
    `/api/customers/assignable-staff?${params.toString()}`,
    options?.signal ? { signal: options.signal } : undefined,
  )

  const rawItems = Array.isArray(data?.items) ? data.items : []
  const deduped = new Map<string, AssignableStaffMember>()

  for (const item of rawItems) {
    const userId =
      typeof item?.userId === 'string'
        ? item.userId
        : typeof item?.user_id === 'string'
          ? item.user_id
          : null
    if (!userId || deduped.has(userId)) continue

    const user =
      item?.user && typeof item.user === 'object'
        ? (item.user as Record<string, unknown>)
        : null
    const team =
      item?.team && typeof item.team === 'object'
        ? (item.team as Record<string, unknown>)
        : null

    const displayName =
      typeof item?.displayName === 'string' && item.displayName.trim().length > 0
        ? item.displayName.trim()
        : typeof item?.display_name === 'string' && item.display_name.trim().length > 0
          ? item.display_name.trim()
          : null
    const email =
      user && typeof user.email === 'string' && user.email.trim().length > 0
        ? user.email.trim()
        : typeof item?.email === 'string' && item.email.trim().length > 0
          ? item.email.trim()
          : null
    const teamName =
      typeof item?.teamName === 'string' && item.teamName.trim().length > 0
        ? item.teamName.trim()
        : typeof item?.team_name === 'string' && item.team_name.trim().length > 0
          ? item.team_name.trim()
          : team && typeof team.name === 'string' && team.name.trim().length > 0
            ? team.name.trim()
            : null
    const teamMemberId =
      typeof item?.teamMemberId === 'string'
        ? item.teamMemberId
        : typeof item?.team_member_id === 'string'
          ? item.team_member_id
          : typeof item?.id === 'string'
            ? item.id
            : userId

    deduped.set(userId, {
      teamMemberId,
      userId,
      displayName: displayName ?? email ?? userId,
      email,
      teamName,
    })
  }

  return {
    items: Array.from(deduped.values()),
    total:
      typeof data?.total === 'number' && Number.isFinite(data.total)
        ? data.total
        : deduped.size,
    page:
      typeof data?.page === 'number' && Number.isFinite(data.page)
        ? data.page
        : options?.page ?? 1,
    pageSize:
      typeof data?.pageSize === 'number' && Number.isFinite(data.pageSize)
        ? data.pageSize
        : options?.pageSize ?? 24,
  }
}

export async function fetchAssignableStaffMembers(
  query: string,
  options?: { pageSize?: number; signal?: AbortSignal },
): Promise<AssignableStaffMember[]> {
  const result = await fetchAssignableStaffMembersPage(query, options)
  return result.items
}

export function mapAssignableStaffToFilterOptions(items: AssignableStaffMember[]): FilterOption[] {
  return items.map((item) => ({
    value: item.userId,
    label: item.email && item.email !== item.displayName
      ? `${item.displayName} (${item.email})`
      : item.displayName,
    tone: 'neutral',
  }))
}

export function ensureCurrentUserFilterOption(
  options: FilterOption[],
  currentUserId: string,
  fallbackLabel: string,
): FilterOption[] {
  const trimmed = currentUserId.trim()
  if (!trimmed || options.some((option) => option.value === trimmed)) return options
  return [{ value: trimmed, label: fallbackLabel, tone: 'neutral' }, ...options]
}
