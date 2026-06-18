import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerAddress,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
} from '../../../data/entities'
import { buildDealListFilters, dealListQuerySchema } from '../route'
import { applyEntityIdRestriction, findMatchingEntityIdsBySearchTokensAcrossSources } from '../../utils'
import { createPagedListResponseSchema } from '../../openapi'
import {
  resolveDealLocations,
  type DealMapAddress,
  type DealMapLink,
  type DealMapLocation,
} from '../../../lib/dealsMapLocation'
import { E } from '#generated/entities.ids.generated'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view', 'customers.activities.view'] },
}

const mapSortFields = ['createdAt', 'updatedAt', 'title', 'value', 'probability', 'expectedCloseAt'] as const

const sortFieldMap: Record<(typeof mapSortFields)[number], string> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  title: 'title',
  value: 'value_amount',
  probability: 'probability',
  expectedCloseAt: 'expected_close_at',
}

const querySchema = dealListQuerySchema.extend({
  pageSize: z.coerce.number().min(1).max(100).default(100),
  sortField: z.enum(mapSortFields).optional(),
})

const dealMapAssociationSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
})

const dealMapLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  source: z.enum(['company', 'person']),
  entityId: z.string().uuid(),
  addressId: z.string().uuid(),
})

const dealMapItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  pipelineId: z.string().uuid().nullable(),
  pipelineStageId: z.string().uuid().nullable(),
  pipelineStage: z.string().nullable(),
  valueAmount: z.number().nullable(),
  valueCurrency: z.string().nullable(),
  probability: z.number().nullable(),
  expectedCloseAt: z.string().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  updatedAt: z.string().nullable(),
  companies: z.array(dealMapAssociationSchema),
  people: z.array(dealMapAssociationSchema),
  location: dealMapLocationSchema.nullable(),
})

const mapErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deals map listing with resolved locations',
  methods: {
    GET: {
      summary: 'Paginated deals that have a resolvable map location',
      description:
        'Returns a page of deals that have a coordinate-bearing linked company/person address, each enriched with one resolved location (company primary first, then earliest created; person addresses as fallback). Deals with no coordinate-bearing address are excluded entirely, so every item carries a non-null location in normal operation; the schema keeps location nullable only for the rare case where the address is deleted between the located-deal resolution and the page fetch.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Paged located deals', schema: createPagedListResponseSchema(dealMapItemSchema) },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: mapErrorSchema },
        { status: 401, description: 'Unauthorized', schema: mapErrorSchema },
        { status: 403, description: 'Missing required features', schema: mapErrorSchema },
      ],
    },
  },
}

type DealMapAssociation = z.infer<typeof dealMapAssociationSchema>

type LinkRow = {
  dealId: string
  entityId: string
  label: string
  createdAt: Date | string | null
}

function readEntityRef(ref: unknown): { id: string | null; record: Record<string, unknown> | null } {
  if (typeof ref === 'string') return { id: ref, record: null }
  if (ref && typeof ref === 'object') {
    const record = ref as Record<string, unknown>
    return { id: typeof record.id === 'string' ? record.id : null, record }
  }
  return { id: null, record: null }
}

function readLinkRow(link: { deal: unknown; createdAt?: Date | string | null }, linkedRef: unknown): LinkRow | null {
  const { id: dealId } = readEntityRef(link.deal)
  if (!dealId) return null
  const { id: entityId, record } = readEntityRef(linkedRef)
  if (!entityId) return null
  const label = record && typeof record.displayName === 'string' ? record.displayName : ''
  return { dealId, entityId, label, createdAt: link.createdAt ?? null }
}

function groupAssociations(rows: LinkRow[]): Map<string, DealMapAssociation[]> {
  const byDeal = new Map<string, DealMapAssociation[]>()
  for (const row of rows) {
    const bucket = byDeal.get(row.dealId) ?? []
    if (!bucket.some((entry) => entry.id === row.entityId)) {
      bucket.push({ id: row.entityId, label: row.label })
      byDeal.set(row.dealId, bucket)
    }
  }
  return byDeal
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toFiniteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toIsoStringOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  return toStringOrNull(value)
}

function readArrayParam(searchParams: URLSearchParams, key: string): string[] | null {
  const all = searchParams.getAll(key)
  if (!all.length) return null
  const trimmed = all.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
  return trimmed.length ? trimmed : null
}

function collectRefIds(rows: unknown[], key: string): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const { id } = readEntityRef((row as Record<string, unknown>)[key])
    if (id) ids.add(id)
  }
  return Array.from(ids)
}

// The deal-list filter builder may already restrict `id` (search, association, stuck, or advanced
// filters). `applyEntityIdRestriction` overwrites an existing `$in`, so intersect the located-deal
// set with whatever allow-list is already present before re-applying it.
function readFilterIdAllowlist(filters: Record<string, unknown>): string[] | null {
  const idFilter = filters.id
  if (!idFilter || typeof idFilter !== 'object' || Array.isArray(idFilter)) return null
  const record = idFilter as { $eq?: unknown; $in?: unknown }
  if (typeof record.$eq === 'string') return [record.$eq]
  if (Array.isArray(record.$in)) return record.$in.filter((value): value is string => typeof value === 'string')
  return null
}

function emptyMapResponse(page: number, pageSize: number) {
  return NextResponse.json({ items: [], total: 0, page, pageSize, totalPages: 0 })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const params = url.searchParams
  const parsed = querySchema.safeParse({
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
    search: params.get('search') ?? undefined,
    status: readArrayParam(params, 'status') ?? undefined,
    pipelineId: readArrayParam(params, 'pipelineId') ?? undefined,
    pipelineStageId: params.get('pipelineStageId') ?? undefined,
    ownerUserId: readArrayParam(params, 'ownerUserId') ?? undefined,
    personId: readArrayParam(params, 'personId') ?? undefined,
    companyId: readArrayParam(params, 'companyId') ?? undefined,
    valueCurrency: readArrayParam(params, 'valueCurrency') ?? undefined,
    expectedCloseAtFrom: params.get('expectedCloseAtFrom') ?? undefined,
    expectedCloseAtTo: params.get('expectedCloseAtTo') ?? undefined,
    isStuck: params.get('isStuck') ?? undefined,
    isOverdue: params.get('isOverdue') ?? undefined,
    sortField: params.get('sortField') ?? undefined,
    sortDir: params.get('sortDir') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }
  const query = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const queryEngine = container.resolve<QueryEngine>('queryEngine')

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const effectiveTenantId = scope.tenantId ?? auth.tenantId
  const orgFilterIds = Array.isArray(scope.filterIds) && scope.filterIds.length > 0
    ? scope.filterIds.filter((id) => typeof id === 'string' && id.length > 0)
    : auth.orgId
      ? [auth.orgId]
      : []
  if (!effectiveTenantId || orgFilterIds.length === 0) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // `findWithDecryption` decrypts each row with the row's OWN tenant/organization (the encryption
  // subscriber's resolveScope(target) wins); this scope is only a fallback for rows that carry no
  // scope columns. CustomerAddress always carries organization_id, so under a multi-org ("All
  // organizations") scope every org's rows still decrypt correctly even though we pass orgFilterIds[0].
  const decryptionScope = { tenantId: effectiveTenantId, organizationId: orgFilterIds[0] }

  // Located-only, resolved in two stages so the per-request cost stays page-bounded:
  // 1) LIGHT id-only queries (FK columns only, no decryption) determine which deals have a
  //    coordinate-bearing linked company/person, so pagination + `total` operate on located deals.
  // 2) The HEAVY decrypted/populated fetch (labels + address coordinates) runs only for the deals
  //    that actually land on the requested page — never the whole located universe.
  const coordinateEntityRows = await findWithDecryption(
    em,
    CustomerAddress,
    {
      latitude: { $ne: null },
      longitude: { $ne: null },
      tenantId: effectiveTenantId,
      organizationId: { $in: orgFilterIds },
    },
    { fields: ['entity'] },
    decryptionScope,
  )
  const locatedEntityIds = collectRefIds(coordinateEntityRows, 'entity')
  if (locatedEntityIds.length === 0) {
    return emptyMapResponse(query.page, query.pageSize)
  }

  const [locatedCompanyLinkRows, locatedPersonLinkRows] = await Promise.all([
    findWithDecryption(
      em,
      CustomerDealCompanyLink,
      { company: { $in: locatedEntityIds } },
      { fields: ['deal'] },
      decryptionScope,
    ),
    findWithDecryption(
      em,
      CustomerDealPersonLink,
      { person: { $in: locatedEntityIds } },
      { fields: ['deal'] },
      decryptionScope,
    ),
  ])
  const locatedDealIds = Array.from(
    new Set([
      ...collectRefIds(locatedCompanyLinkRows, 'deal'),
      ...collectRefIds(locatedPersonLinkRows, 'deal'),
    ]),
  )
  if (locatedDealIds.length === 0) {
    return emptyMapResponse(query.page, query.pageSize)
  }

  const ctx: CrudCtx = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: orgFilterIds[0],
    organizationIds: orgFilterIds,
    request: req,
  }

  const filters = await buildDealListFilters(query, ctx)
  const existingAllowlist = readFilterIdAllowlist(filters)

  // The map card headline is the linked company/person name, which the deal-field token search
  // (title/description/status/…) used by `buildDealListFilters` does NOT cover — so searching a
  // company/person name a user can plainly see on a card would otherwise return nothing. When a
  // search term is present, also resolve located deals whose linked company/person ENTITY name
  // matches, and union them with the deal-field matches. The sentinel "no match" id from the
  // deal-field search drops out naturally at the located intersection below, so no special-casing.
  let searchAllowlist = existingAllowlist
  if (query.search && locatedEntityIds.length > 0) {
    const nameMatchedEntityIds = await findMatchingEntityIdsBySearchTokensAcrossSources({
      ctx,
      query: query.search,
      sources: [
        {
          entityType: E.customers.customer_entity,
          fields: ['display_name', 'primary_email', 'primary_phone', 'description'],
        },
      ],
    })
    const locatedEntitySet = new Set(locatedEntityIds)
    const locatedMatchedEntityIds = (nameMatchedEntityIds ?? []).filter((id) => locatedEntitySet.has(id))
    if (locatedMatchedEntityIds.length > 0) {
      const [companyNameLinkRows, personNameLinkRows] = await Promise.all([
        findWithDecryption(
          em,
          CustomerDealCompanyLink,
          { company: { $in: locatedMatchedEntityIds } },
          { fields: ['deal'] },
          decryptionScope,
        ),
        findWithDecryption(
          em,
          CustomerDealPersonLink,
          { person: { $in: locatedMatchedEntityIds } },
          { fields: ['deal'] },
          decryptionScope,
        ),
      ])
      let nameMatchedDealIds = [
        ...collectRefIds(companyNameLinkRows, 'deal'),
        ...collectRefIds(personNameLinkRows, 'deal'),
      ]
      if (nameMatchedDealIds.length > 0) {
        // The deal-field search in `buildDealListFilters` is intersected with the People/Companies
        // association (and stuck/`?id`) filters — they all land together in `filters.id`. The name
        // matches above carry NO such constraint, so unioning them raw would let a co-active
        // People/Companies filter be bypassed (over-broad results). Recover exactly the non-search id
        // allowlist by rebuilding the deal filters WITHOUT the search term, and intersect the name
        // matches with it so the active filter is honored: located ∩ nonSearch ∩ (dealField ∪ name).
        // (The map's query carries no advanced `filter[...]` params, so the consume-mutation in
        // buildDealListFilters does not affect this second build.)
        const nonSearchAllowlist = readFilterIdAllowlist(
          await buildDealListFilters({ ...query, search: undefined }, ctx),
        )
        if (nonSearchAllowlist) {
          const nonSearchLookup = new Set(nonSearchAllowlist)
          nameMatchedDealIds = nameMatchedDealIds.filter((id) => nonSearchLookup.has(id))
        }
      }
      if (nameMatchedDealIds.length > 0) {
        searchAllowlist = Array.from(new Set([...(existingAllowlist ?? []), ...nameMatchedDealIds]))
      }
    }
  }

  const allowlistLookup = searchAllowlist ? new Set(searchAllowlist) : null
  const restrictedDealIds = allowlistLookup
    ? locatedDealIds.filter((id) => allowlistLookup.has(id))
    : locatedDealIds
  // `restrictedDealIds` is the final located ∩ (deal-field ∪ company/person-name) set — it already
  // captures every id constraint `buildDealListFilters` expressed (read back via
  // `readFilterIdAllowlist`). Clear the stale `filters.id` first so `applyEntityIdRestriction` does
  // not re-intersect against the deal-field "no match" sentinel and drop the name-matched deals.
  delete (filters as Record<string, unknown>).id
  applyEntityIdRestriction(filters, restrictedDealIds)

  const sortColumn = query.sortField ? sortFieldMap[query.sortField] : 'id'
  const sortDir = query.sortDir === 'desc' ? SortDir.Desc : SortDir.Asc
  // Always append `id` as a stable tiebreaker — non-unique sort columns (title, value,
  // probability, stage, or colliding timestamps) otherwise reorder between OFFSET pages and the
  // client's multi-page accumulation would skip or duplicate deals at page boundaries.
  const sort = sortColumn === 'id'
    ? [{ field: 'id', dir: sortDir }]
    : [{ field: sortColumn, dir: sortDir }, { field: 'id', dir: SortDir.Asc }]

  const res = await queryEngine.query(E.customers.customer_deal, {
    fields: [
      'id',
      'title',
      'status',
      'pipeline_id',
      'pipeline_stage_id',
      'pipeline_stage',
      'value_amount',
      'value_currency',
      'probability',
      'expected_close_at',
      'owner_user_id',
      'updated_at',
    ],
    sort,
    page: { page: query.page, pageSize: query.pageSize },
    filters,
    tenantId: effectiveTenantId,
    organizationId: orgFilterIds[0],
    organizationIds: orgFilterIds,
  })

  const rows = (Array.isArray(res.items) ? res.items : []).filter(
    (row): row is Record<string, unknown> => !!row && typeof row === 'object',
  )
  const dealIds = rows
    .map((row) => (typeof row.id === 'string' && row.id.trim().length ? row.id : null))
    .filter((value): value is string => value !== null)

  // Heavy fetch, page-bounded: pull decrypted links (for labels) and coordinate-bearing addresses
  // only for the deals on this page.
  const [companyLinks, personLinks] = dealIds.length
    ? await Promise.all([
        findWithDecryption(
          em,
          CustomerDealCompanyLink,
          { deal: { $in: dealIds } },
          { populate: ['company'] },
          decryptionScope,
        ),
        findWithDecryption(
          em,
          CustomerDealPersonLink,
          { deal: { $in: dealIds } },
          { populate: ['person'] },
          decryptionScope,
        ),
      ])
    : [[], []]

  const companyRows = companyLinks
    .map((link) => readLinkRow(link, link.company))
    .filter((row): row is LinkRow => row !== null)
  const personRows = personLinks
    .map((link) => readLinkRow(link, link.person))
    .filter((row): row is LinkRow => row !== null)
  const companiesByDeal = groupAssociations(companyRows)
  const peopleByDeal = groupAssociations(personRows)

  const linkedEntityIds = Array.from(
    new Set([...companyRows, ...personRows].map((row) => row.entityId)),
  )
  const addresses = linkedEntityIds.length
    ? await findWithDecryption(
        em,
        CustomerAddress,
        {
          entity: { $in: linkedEntityIds },
          latitude: { $ne: null },
          longitude: { $ne: null },
          tenantId: effectiveTenantId,
          organizationId: { $in: orgFilterIds },
        },
        {},
        decryptionScope,
      )
    : []

  const addressRows: DealMapAddress[] = []
  for (const address of addresses) {
    const { id: entityId } = readEntityRef(address.entity)
    if (!entityId) continue
    addressRows.push({
      id: address.id,
      entityId,
      isPrimary: address.isPrimary === true,
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
      city: address.city ?? null,
      region: address.region ?? null,
      country: address.country ?? null,
      createdAt: address.createdAt ?? null,
    })
  }

  const toLink = (row: LinkRow): DealMapLink => ({
    dealId: row.dealId,
    entityId: row.entityId,
    createdAt: row.createdAt,
  })
  const locationByDeal: Map<string, DealMapLocation | null> = resolveDealLocations(
    dealIds,
    companyRows.map(toLink),
    personRows.map(toLink),
    addressRows,
  )

  const items = rows
    .map((row) => {
      const id = typeof row.id === 'string' && row.id.trim().length ? row.id : null
      if (!id) return null
      return {
        id,
        title: toStringOrNull(row.title),
        status: toStringOrNull(row.status),
        pipelineId: toStringOrNull(row.pipeline_id),
        pipelineStageId: toStringOrNull(row.pipeline_stage_id),
        pipelineStage: toStringOrNull(row.pipeline_stage),
        valueAmount: toFiniteNumberOrNull(row.value_amount),
        valueCurrency: toStringOrNull(row.value_currency),
        probability: toFiniteNumberOrNull(row.probability),
        expectedCloseAt: toIsoStringOrNull(row.expected_close_at),
        ownerUserId: toStringOrNull(row.owner_user_id),
        updatedAt: toIsoStringOrNull(row.updated_at),
        companies: companiesByDeal.get(id) ?? [],
        people: peopleByDeal.get(id) ?? [],
        location: locationByDeal.get(id) ?? null,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return NextResponse.json({
    items,
    total: res.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(res.total / (query.pageSize || 1)),
  })
}
