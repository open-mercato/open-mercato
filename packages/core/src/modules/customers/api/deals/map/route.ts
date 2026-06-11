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
import { applyEntityIdRestriction } from '../../utils'
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
        'Returns a page of deals that have a coordinate-bearing linked company/person address, each enriched with one resolved location (company primary first, then earliest created; person addresses as fallback). Deals with no coordinate-bearing address are excluded entirely, so every item carries a non-null location.',
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

  const decryptionScope = { tenantId: effectiveTenantId, organizationId: orgFilterIds[0] }

  // Located-only: a deal can only appear on the map if a linked company/person owns a
  // coordinate-bearing address. Resolve that universe first so pagination, `total`, and the
  // 500-deal client cap all operate on deals that actually have a pin — deals without
  // coordinates are excluded entirely instead of being paged through and dropped client-side.
  const coordinateAddresses = await findWithDecryption(
    em,
    CustomerAddress,
    {
      latitude: { $ne: null },
      longitude: { $ne: null },
      tenantId: effectiveTenantId,
      organizationId: { $in: orgFilterIds },
    },
    {},
    decryptionScope,
  )

  const addressRows: DealMapAddress[] = []
  const locatedEntityIds = new Set<string>()
  for (const address of coordinateAddresses) {
    const { id: entityId } = readEntityRef(address.entity)
    if (!entityId) continue
    locatedEntityIds.add(entityId)
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
  if (locatedEntityIds.size === 0) {
    return emptyMapResponse(query.page, query.pageSize)
  }

  const locatedEntityIdList = Array.from(locatedEntityIds)
  const [companyLinks, personLinks] = await Promise.all([
    findWithDecryption(
      em,
      CustomerDealCompanyLink,
      { company: { $in: locatedEntityIdList } },
      { populate: ['company'] },
      decryptionScope,
    ),
    findWithDecryption(
      em,
      CustomerDealPersonLink,
      { person: { $in: locatedEntityIdList } },
      { populate: ['person'] },
      decryptionScope,
    ),
  ])

  const companyRows = companyLinks
    .map((link) => readLinkRow(link, link.company))
    .filter((row): row is LinkRow => row !== null)
  const personRows = personLinks
    .map((link) => readLinkRow(link, link.person))
    .filter((row): row is LinkRow => row !== null)

  const locatedDealIds = Array.from(new Set([...companyRows, ...personRows].map((row) => row.dealId)))
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
  const allowlistLookup = existingAllowlist ? new Set(existingAllowlist) : null
  const restrictedDealIds = allowlistLookup
    ? locatedDealIds.filter((id) => allowlistLookup.has(id))
    : locatedDealIds
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
  const pageDealIds = new Set(dealIds)

  const pageCompanyRows = companyRows.filter((row) => pageDealIds.has(row.dealId))
  const pagePersonRows = personRows.filter((row) => pageDealIds.has(row.dealId))
  const companiesByDeal = groupAssociations(pageCompanyRows)
  const peopleByDeal = groupAssociations(pagePersonRows)

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
