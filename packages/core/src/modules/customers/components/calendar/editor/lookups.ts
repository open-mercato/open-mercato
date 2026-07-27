import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchAssignableStaffMembers } from '../../detail/assignableStaff'

export type RelatedEntityKind = 'person' | 'company'

export type RelatedEntityOption = {
  id: string
  kind: RelatedEntityKind
  label: string
  subtitle: string | null
}

export type DealOption = {
  id: string
  label: string
}

export type PersonOption = {
  userId: string
  name: string
  email: string | null
  isCustomer: boolean
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractRelatedEntityOption(item: Record<string, unknown>, kind: RelatedEntityKind): RelatedEntityOption | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const displayName = readNonEmptyString(item.displayName) ?? readNonEmptyString(item.display_name)
  const detail = kind === 'person'
    ? readNonEmptyString(item.primaryEmail) ?? readNonEmptyString(item.primary_email)
    : readNonEmptyString(item.domain)
      ?? readNonEmptyString(item.websiteUrl)
      ?? readNonEmptyString(item.website_url)
  const label = displayName ?? detail ?? id
  return { id, kind, label, subtitle: detail && detail !== label ? detail : null }
}

// Same lookup source as the deal-association pattern in DealForm
// (useDealAssociationLookups): the people/companies CRUD list APIs with
// `search` + name sorting, merged into a single related-to picker.
export async function searchRelatedEntities(
  kind: RelatedEntityKind,
  query: string,
  signal: AbortSignal,
): Promise<RelatedEntityOption[]> {
  const params = new URLSearchParams({ page: '1', pageSize: '20', sortField: 'name', sortDir: 'asc' })
  if (query.length) params.set('search', query)
  const endpoint = kind === 'person'
    ? `/api/customers/people?${params.toString()}`
    : `/api/customers/companies?${params.toString()}`
  const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(endpoint, { signal })
  const items = Array.isArray(data?.items) ? data.items : []
  return items
    .map((item) => (item && typeof item === 'object' ? extractRelatedEntityOption(item, kind) : null))
    .filter((option): option is RelatedEntityOption => option !== null)
}

async function fetchRelatedEntityOfKind(
  kind: RelatedEntityKind,
  entityId: string,
  signal: AbortSignal,
): Promise<RelatedEntityOption | null> {
  const params = new URLSearchParams({ page: '1', pageSize: '1', ids: entityId })
  const endpoint = kind === 'person'
    ? `/api/customers/people?${params.toString()}`
    : `/api/customers/companies?${params.toString()}`
  try {
    const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(endpoint, { signal })
    const item = Array.isArray(data?.items) ? data.items[0] : null
    return item && typeof item === 'object' ? extractRelatedEntityOption(item, kind) : null
  } catch {
    return null
  }
}

export async function fetchRelatedEntityById(entityId: string, signal: AbortSignal): Promise<RelatedEntityOption | null> {
  const [person, company] = await Promise.all([
    fetchRelatedEntityOfKind('person', entityId, signal),
    fetchRelatedEntityOfKind('company', entityId, signal),
  ])
  return person ?? company
}

function extractDealOption(item: Record<string, unknown>): DealOption | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const label = readNonEmptyString(item.title) ?? id
  return { id, label }
}

export async function fetchDealsForEntity(
  entity: { id: string; kind: RelatedEntityKind },
  signal: AbortSignal,
): Promise<DealOption[]> {
  const params = new URLSearchParams({ page: '1', pageSize: '20' })
  params.set(entity.kind === 'person' ? 'personId' : 'companyId', entity.id)
  const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
    `/api/customers/deals?${params.toString()}`,
    { signal },
  )
  const items = Array.isArray(data?.items) ? data.items : []
  return items
    .map((item) => (item && typeof item === 'object' ? extractDealOption(item) : null))
    .filter((option): option is DealOption => option !== null)
}

export async function fetchDealById(dealId: string, signal: AbortSignal): Promise<DealOption | null> {
  try {
    const params = new URLSearchParams({ page: '1', pageSize: '1', ids: dealId })
    const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `/api/customers/deals?${params.toString()}`,
      { signal },
    )
    const item = Array.isArray(data?.items) ? data.items[0] : null
    return item && typeof item === 'object' ? extractDealOption(item) : null
  } catch {
    return null
  }
}

export async function searchPeopleOptions(
  query: string,
  options: { includeCustomers: boolean; includeStaff?: boolean; signal: AbortSignal },
): Promise<PersonOption[]> {
  // Staff lookup is optional twice over: skipped when the staff module is not
  // loaded (includeStaff === false) and non-fatal when the endpoint errors, so
  // the people picker always degrades to customer-only options (#3552).
  const [staff, customers] = await Promise.all([
    options.includeStaff === false
      ? Promise.resolve<Awaited<ReturnType<typeof fetchAssignableStaffMembers>>>([])
      : fetchAssignableStaffMembers(query, { pageSize: 10, signal: options.signal }).catch(() => []),
    options.includeCustomers
      ? searchRelatedEntities('person', query, options.signal)
      : Promise.resolve<RelatedEntityOption[]>([]),
  ])
  const staffOptions: PersonOption[] = staff.map((member) => ({
    userId: member.userId,
    name: member.displayName,
    email: member.email,
    isCustomer: false,
  }))
  const customerOptions: PersonOption[] = customers.map((person) => ({
    userId: person.id,
    name: person.label,
    email: person.subtitle,
    isCustomer: true,
  }))
  return [...staffOptions, ...customerOptions]
}

export type ResourceOption = {
  id: string
  label: string
}

// Consumed only when the resources module is loaded (server flag from the
// calendar page); reads the resources CRUD list API — never resource entities.
export type ResourceType = { id: string; name: string; count: number }

export type ResourceSearchResult = { items: ResourceOption[]; total: number }

const RESOURCE_PAGE_SIZE = 20

// Server-side resource search, optionally scoped to one resource type. Returns
// the (page-limited) options plus the full match count so the UI can show a
// "showing N of M" hint and nudge the user to narrow a large catalog (#3552).
export async function searchResourceOptions(
  params: { query: string; resourceTypeId?: string | null },
  signal: AbortSignal,
): Promise<ResourceSearchResult> {
  const search = new URLSearchParams({
    page: '1',
    pageSize: String(RESOURCE_PAGE_SIZE),
    sortField: 'name',
    sortDir: 'asc',
    isActive: 'true',
  })
  if (params.query.length) search.set('search', params.query)
  if (params.resourceTypeId) search.set('resourceTypeId', params.resourceTypeId)
  const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>>; total?: number }>(
    `/api/resources/resources?${search.toString()}`,
    { signal },
  )
  const rows = Array.isArray(data?.items) ? data.items : []
  const items = rows
    .map((item): ResourceOption | null => {
      if (!item || typeof item !== 'object') return null
      const id = typeof item.id === 'string' ? item.id : null
      if (!id) return null
      const label = readNonEmptyString(item.name) ?? id
      return { id, label }
    })
    .filter((option): option is ResourceOption => option !== null)
  const total = typeof data?.total === 'number' && Number.isFinite(data.total) ? data.total : items.length
  return { items, total }
}

// Resource types with their resource counts, for the dropdown's type filter.
export async function fetchResourceTypes(signal: AbortSignal): Promise<ResourceType[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: '100',
    sortField: 'name',
    sortDir: 'asc',
    withResourceCounts: 'true',
  })
  try {
    const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `/api/resources/resource-types?${params.toString()}`,
      { signal },
    )
    const rows = Array.isArray(data?.items) ? data.items : []
    return rows
      .map((item): ResourceType | null => {
        if (!item || typeof item !== 'object') return null
        const id = typeof item.id === 'string' ? item.id : null
        if (!id) return null
        const name = readNonEmptyString(item.name) ?? id
        const rawCount = (item as Record<string, unknown>).resourceCount
        const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : 0
        return { id, name, count }
      })
      .filter((type): type is ResourceType => type !== null)
  } catch {
    return []
  }
}

export type ContactPhone = { id: string; name: string; phone: string }

// Resolves primary phone numbers for the given person ids (companies/staff have
// none and simply drop out — the people query only matches people). Used by the
// Call editor's "insert phone from contact" button (#3552).
export async function fetchPeoplePhones(ids: string[], signal: AbortSignal): Promise<ContactPhone[]> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)))
  if (unique.length === 0) return []
  const params = new URLSearchParams({ page: '1', pageSize: '100', ids: unique.join(',') })
  try {
    const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `/api/customers/people?${params.toString()}`,
      { signal },
    )
    const items = Array.isArray(data?.items) ? data.items : []
    const result: ContactPhone[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const id = typeof item.id === 'string' ? item.id : null
      const phone = readNonEmptyString(item.primaryPhone) ?? readNonEmptyString(item.primary_phone)
      if (!id || !phone) continue
      const name = readNonEmptyString(item.displayName) ?? readNonEmptyString(item.display_name) ?? id
      result.push({ id, name, phone })
    }
    return result
  } catch {
    return []
  }
}

export async function findStaffMemberName(userId: string, signal: AbortSignal): Promise<string | null> {
  try {
    const members = await fetchAssignableStaffMembers('', { pageSize: 100, signal })
    const match = members.find((member) => member.userId === userId)
    return match ? match.displayName : null
  } catch {
    return null
  }
}
