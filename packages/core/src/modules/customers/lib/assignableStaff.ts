import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
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

type AuthUserListItem = {
  id?: unknown
  name?: unknown
  display_name?: unknown
  email?: unknown
}

export type AssignableStaffMembersPage = {
  items: AssignableStaffMember[]
  /**
   * How many rows the server served for this page, before the dedupe below.
   * "Load more" guards must measure this rather than `items.length`: a deduped
   * length shorter than the served page reads as a short page and terminates
   * the sequence early, stranding the rest of the roster.
   */
  servedCount: number
  total: number
  page: number
  pageSize: number
}

// The assignable-staff roster is owned by the optional, ejectable `staff` module.
// When that module is disabled, its `/api/staff/team-members/assignable` endpoint is
// absent and the request resolves to 404. Customers UI (deals / people / companies
// owner filters, role-assignment dialogs) is core and always enabled, so it must not
// break in that case — fall back to tenant auth users, because `ownerUserId` is an
// auth user id, not a staff team-member id (issue #6183). Treat other failures as
// before: propagate them to the caller.
function isAssignableEndpointMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 404
  )
}

function mapStaffItems(rawItems: Array<Record<string, unknown>>): AssignableStaffMember[] {
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

  return Array.from(deduped.values())
}

function mapAuthUsersToAssignable(rawItems: AuthUserListItem[]): AssignableStaffMember[] {
  const deduped = new Map<string, AssignableStaffMember>()

  for (const item of rawItems) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) continue
    const userId = item.id.trim()
    if (deduped.has(userId)) continue

    const name = typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : null
    const displayNameField =
      typeof item.display_name === 'string' && item.display_name.trim().length > 0
        ? item.display_name.trim()
        : null
    const email = typeof item.email === 'string' && item.email.trim().length > 0 ? item.email.trim() : null
    const displayName = name ?? displayNameField ?? email ?? userId

    deduped.set(userId, {
      teamMemberId: userId,
      userId,
      displayName,
      email,
      teamName: null,
    })
  }

  return Array.from(deduped.values())
}

/**
 * When the optional `staff` module is absent, resolve assignable owners from
 * `GET /api/auth/users` so CRM apps without staff still show owner names and
 * pickers (ownerUserId is always an auth user id).
 *
 * A missing `auth.users.list` grant must not bounce the page to /login — degrade
 * to an empty roster the same way a missing staff module used to.
 */
async function fetchAssignableUsersFallback(
  query: string,
  options: { page: number; pageSize: number; signal?: AbortSignal },
): Promise<AssignableStaffMembersPage> {
  const { page, pageSize, signal } = options
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  // Owner assignment stamps the active organization onto the record; keep the
  // picker inside that org (same contract as message recipient suggestions).
  params.set('scopeToActiveOrganization', '1')
  const normalizedQuery = query.trim()
  if (normalizedQuery.length > 0) {
    params.set('search', normalizedQuery)
  }

  const call = await apiCall<AssignableStaffResponse>(
    `/api/auth/users?${params.toString()}`,
    {
      headers: { 'x-om-forbidden-redirect': '0' },
      signal,
    },
    { fallback: null },
  ).catch(() => null)

  if (!call || !call.ok) {
    return { items: [], servedCount: 0, total: 0, page, pageSize }
  }

  const rawItems = Array.isArray(call.result?.items) ? call.result.items : []
  const items = mapAuthUsersToAssignable(rawItems as AuthUserListItem[])

  return {
    items,
    servedCount: rawItems.length,
    total:
      typeof call.result?.total === 'number' && Number.isFinite(call.result.total)
        ? call.result.total
        : items.length,
    page:
      typeof call.result?.page === 'number' && Number.isFinite(call.result.page)
        ? call.result.page
        : page,
    pageSize:
      typeof call.result?.pageSize === 'number' && Number.isFinite(call.result.pageSize)
        ? call.result.pageSize
        : pageSize,
  }
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
      return fetchAssignableUsersFallback(query, {
        page,
        pageSize,
        signal: options?.signal,
      })
    }
    throw error
  }

  const rawItems = Array.isArray(data?.items) ? data.items : []
  const items = mapStaffItems(rawItems)

  return {
    items,
    servedCount: rawItems.length,
    total:
      typeof data?.total === 'number' && Number.isFinite(data.total)
        ? data.total
        : items.length,
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
