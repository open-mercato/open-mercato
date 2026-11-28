import { resolveAssignmentState } from './projectTeamAssignment'

export const DEFAULT_ASSIGNEE_PAGE_SIZE = 100
export const DEFAULT_ASSIGNEE_MAX_PAGES = 20

export type ProjectMemberRow = {
  id?: unknown
  staffMemberId?: unknown
  staff_member_id?: unknown
  status?: unknown
  assigned_start_date?: unknown
  assignedStartDate?: unknown
  assigned_end_date?: unknown
  assignedEndDate?: unknown
}

export type ProjectMembershipPage = {
  items: ProjectMemberRow[]
  totalPages: number | null
}

export type ProjectMembershipCollection = {
  rows: ProjectMemberRow[]
  truncated: boolean
}

export type DefaultAssigneeCandidate = {
  staffMemberId: string
  active: boolean
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function readMembershipStaffMemberId(row: ProjectMemberRow): string | null {
  return readString(row.staffMemberId) ?? readString(row.staff_member_id)
}

/**
 * Whether a membership can still receive a portal ticket as the default assignee —
 * the browser twin of `resolveUsableDefaultAssignee`: an `active` membership inside
 * its assignment window plus the tenant's grace days.
 */
export function isUsableDefaultAssigneeMembership(row: ProjectMemberRow, graceDays: number, now: Date = new Date()): boolean {
  if (readString(row.status) !== 'active') return false
  const startDate = readString(row.assignedStartDate) ?? readString(row.assigned_start_date)
  const endDate = readString(row.assignedEndDate) ?? readString(row.assigned_end_date)
  return resolveAssignmentState({ startDate, endDate }, graceDays, now) === 'active'
}

export type ProjectMembershipPageResponse = {
  ok: boolean
  result?: { items?: unknown; totalPages?: unknown } | null
}

/**
 * Reads one employees page, refusing anything but a successful response with a
 * row list: an error page carries no rows and no total, and reading it as an empty
 * last page would mark every member beyond it as gone.
 */
export function readProjectMembershipPage(response: ProjectMembershipPageResponse): ProjectMembershipPage {
  if (!response.ok) throw new Error('[internal] project membership page request failed')
  const items = response.result?.items
  if (!Array.isArray(items)) throw new Error('[internal] project membership page has no rows')
  const totalPages = typeof response.result?.totalPages === 'number' ? response.result.totalPages : null
  const rows = items.filter((item): item is ProjectMemberRow => typeof item === 'object' && item !== null)
  return { items: rows, totalPages }
}

export async function collectProjectMemberships(
  fetchPage: (page: number) => Promise<ProjectMembershipPage>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<ProjectMembershipCollection> {
  const pageSize = options.pageSize ?? DEFAULT_ASSIGNEE_PAGE_SIZE
  const maxPages = options.maxPages ?? DEFAULT_ASSIGNEE_MAX_PAGES
  const rows: ProjectMemberRow[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page)
    rows.push(...result.items)
    const lastPage = result.totalPages !== null ? page >= result.totalPages : result.items.length < pageSize
    if (lastPage || result.items.length === 0) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

export function classifyDefaultAssigneeCandidates(
  rows: ProjectMemberRow[],
  graceDays: number,
  now: Date = new Date(),
): DefaultAssigneeCandidate[] {
  const byMember = new Map<string, boolean>()
  for (const row of rows) {
    const staffMemberId = readMembershipStaffMemberId(row)
    if (!staffMemberId) continue
    const active = isUsableDefaultAssigneeMembership(row, graceDays, now)
    byMember.set(staffMemberId, (byMember.get(staffMemberId) ?? false) || active)
  }
  return Array.from(byMember, ([staffMemberId, active]) => ({ staffMemberId, active }))
}

export function chunkIds(ids: string[], size: number = DEFAULT_ASSIGNEE_PAGE_SIZE): string[][] {
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += size) batches.push(ids.slice(index, index + size))
  return batches
}

export function resolveSelectedDefaultAssignee(
  candidates: DefaultAssigneeCandidate[],
  value: string | null,
  truncated: boolean,
): { candidate: DefaultAssigneeCandidate | null; unusable: boolean } {
  if (!value) return { candidate: null, unusable: false }
  const candidate = candidates.find((entry) => entry.staffMemberId === value) ?? null
  if (candidate) return { candidate, unusable: !candidate.active }
  return { candidate: null, unusable: !truncated }
}
