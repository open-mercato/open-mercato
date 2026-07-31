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

// The assignable-staff roster is owned by the optional, ejectable `staff` module.
// When that module is disabled, its `/api/staff/team-members/assignable` endpoint is
// absent and the request resolves to 404. Customers UI (deals / people / companies
// owner filters, role-assignment dialogs) is core and always enabled, so it must not
// break in that case — a missing staff module simply means there is no roster to
// offer. Treat the 404 as an empty page and let any other failure propagate.
function isAssignableEndpointMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 404
  )
}

export async function fetchAssignableStaffMembersPage(
  query: string,
  options?: { page?: number; pageSize?: number; signal?: AbortSignal },
): Promise<AssignableStaffMembersPage> {
  const page = options?.page ?? 1
  const pageSize = options?.pageSize ?? 24
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  const normalizedQuery = query.trim()
  if (normalizedQuery.length > 0) {
    params.set('search', normalizedQuery)
  }

  let data: AssignableStaffResponse
  try {
    data = await readApiResultOrThrow<AssignableStaffResponse>(
      `/api/staff/team-members/assignable?${params.toString()}`,
      options?.signal ? { signal: options.signal } : undefined,
    )
  } catch (error) {
    if (isAssignableEndpointMissing(error)) {
      return { items: [], total: 0, page, pageSize }
    }
    throw error
  }

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
        : page,
    pageSize:
      typeof data?.pageSize === 'number' && Number.isFinite(data.pageSize)
        ? data.pageSize
        : pageSize,
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
