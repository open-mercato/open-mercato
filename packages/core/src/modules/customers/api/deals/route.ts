import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDeal, CustomerDealPersonLink, CustomerDealCompanyLink } from '../../data/entities'
import { dealCreateSchema, dealUpdateSchema } from '../../data/validators'
import { E } from '#generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import {
  applyEntityIdRestriction,
  findMatchingEntityIdsWithQueryEngine,
  findMatchingEntityIdsBySearchTokensAcrossSources,
  parseScopedCommandInput,
} from '../utils'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  createCustomersCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { consumeAdvancedFilterState, mergeAdvancedFilterTree } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
import { fetchStuckDealIds } from '../../lib/stuckDeals'

const rawBodySchema = z.object({}).passthrough()

const stringOrStringArray = z.union([z.string(), z.array(z.string())])
const booleanQueryParam = z.preprocess((value) => {
  const parsed = parseBooleanFromUnknown(value)
  return parsed === null ? value : parsed
}, z.boolean()).optional()

export const dealListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    status: stringOrStringArray.optional(),
    pipelineStage: z.string().optional(),
    pipelineId: stringOrStringArray.optional(),
    pipelineStageId: z.union([z.string().uuid(), z.literal('__unassigned')]).optional(),
    ownerUserId: stringOrStringArray.optional(),
    expectedCloseAtFrom: z.string().optional(),
    expectedCloseAtTo: z.string().optional(),
    isStuck: booleanQueryParam,
    isOverdue: booleanQueryParam,
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    personEntityId: z.string().uuid().optional(),
    companyEntityId: z.string().uuid().optional(),
    personId: stringOrStringArray.optional(),
    companyId: stringOrStringArray.optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

export const metadata = routeMetadata

export type DealListQuery = z.infer<typeof dealListQuerySchema>

function parseUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  const result = z.string().uuid().safeParse(trimmed)
  return result.success ? trimmed : null
}

function normalizeStringList(value: unknown): string[] {
  const set = new Set<string>()
  const visit = (entry: unknown) => {
    if (entry == null) return
    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }
    if (typeof entry !== 'string') return
    entry
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .forEach((token) => set.add(token))
  }
  visit(value)
  return Array.from(set)
}

function parseDateInput(value: unknown): Date | null {
  if (!(typeof value === 'string') || value.trim().length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Pre-pagination ID narrowing for person/company filters.
 *
 * Mirrors the SQL the aggregate route uses (`EXISTS ... IN (...)`) so the list endpoint
 * and the lane-header aggregate return a consistent set of deals for the same filters.
 * Semantics: OR within a category (any selected person/company matches), AND across
 * categories (deal must match at least one person AND at least one company when both
 * filter lists are provided).
 *
 * Returns the matched deal IDs (UUIDs). An empty array means "no deals match" — callers
 * must intersect with `restrictedIds` (which will collapse the list to zero).
 */
async function fetchDealIdsMatchingAssociations(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  personIds: string[],
  companyIds: string[],
): Promise<string[]> {
  if (!personIds.length && !companyIds.length) return []
  const where: string[] = [
    'organization_id = ?',
    'tenant_id = ?',
    'deleted_at IS NULL',
  ]
  const values: Array<string | number> = [organizationId, tenantId]
  if (personIds.length) {
    const placeholders = personIds.map(() => '?').join(',')
    where.push(
      `EXISTS (SELECT 1 FROM customer_deal_people dp WHERE dp.deal_id = customer_deals.id AND dp.person_entity_id IN (${placeholders}))`,
    )
    values.push(...personIds)
  }
  if (companyIds.length) {
    const placeholders = companyIds.map(() => '?').join(',')
    where.push(
      `EXISTS (SELECT 1 FROM customer_deal_companies dc WHERE dc.deal_id = customer_deals.id AND dc.company_entity_id IN (${placeholders}))`,
    )
    values.push(...companyIds)
  }
  const rows = await em.getConnection().execute<Array<{ id: string }>>(
    `SELECT id FROM customer_deals WHERE ${where.join(' AND ')}`,
    values,
  )
  return rows.map((row) => row.id)
}

function normalizeUuidList(values: Array<unknown>): string[] {
  const set = new Set<string>()
  values.forEach((candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => {
        const parsed = parseUuid(entry)
        if (parsed) set.add(parsed)
      })
      return
    }
    if (typeof candidate === 'string' && candidate.includes(',')) {
      candidate
        .split(',')
        .map((entry) => entry.trim())
        .forEach((entry) => {
          const parsed = parseUuid(entry)
          if (parsed) set.add(parsed)
        })
      return
    }
    const parsed = parseUuid(candidate)
    if (parsed) set.add(parsed)
  })
  return Array.from(set)
}

export async function buildDealListFilters(query: DealListQuery, ctx?: import('@open-mercato/shared/lib/crud/factory').CrudCtx) {
  const advancedFilterTree = consumeAdvancedFilterState(query)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filters: Record<string, any> = {}
  let restrictedIds: string[] | null = null

  const intersectIds = (ids: string[]) => {
    if (restrictedIds === null) {
      restrictedIds = ids
      return
    }
    const lookup = new Set(ids)
    restrictedIds = restrictedIds.filter((id) => lookup.has(id))
  }

  if (query.search) {
    const matchingIds = ctx
      ? await findMatchingEntityIdsBySearchTokensAcrossSources({
          ctx,
          query: query.search,
          sources: [
            {
              entityType: E.customers.customer_deal,
              fields: [
                'title',
                'description',
                'status',
                'pipeline_stage',
                'source',
                'value_amount',
                'value_currency',
                'cf:competitive_risk',
                'cf:implementation_complexity',
              ],
            },
          ],
        })
      : null
    if (matchingIds !== null && matchingIds.length > 0) {
      intersectIds(matchingIds)
    } else {
      const searchPattern = `%${escapeLikePattern(query.search)}%`
      filters.$or = [
        { title: { $ilike: searchPattern } },
        { description: { $ilike: searchPattern } },
      ]
    }
  }

  const statusList = query.status ? normalizeStringList(query.status) : []
  if (statusList.length > 0) {
    filters.status = statusList.length === 1 ? { $eq: statusList[0] } : { $in: statusList }
  }

  if (query.pipelineStage) {
    filters.pipeline_stage = { $eq: query.pipelineStage }
  }

  const pipelineIds = query.pipelineId ? normalizeUuidList([query.pipelineId]) : []
  if (pipelineIds.length > 0) {
    filters.pipeline_id = pipelineIds.length === 1 ? { $eq: pipelineIds[0] } : { $in: pipelineIds }
  }

  if (query.pipelineStageId === '__unassigned') {
    filters.pipeline_stage_id = { $eq: null }
  } else if (query.pipelineStageId) {
    filters.pipeline_stage_id = { $eq: query.pipelineStageId }
  }

  const ownerUserIds = query.ownerUserId ? normalizeUuidList([query.ownerUserId]) : []
  if (ownerUserIds.length > 0) {
    filters.owner_user_id =
      ownerUserIds.length === 1 ? { $eq: ownerUserIds[0] } : { $in: ownerUserIds }
  }

  const expectedCloseFrom = parseDateInput(query.expectedCloseAtFrom)
  const expectedCloseTo = parseDateInput(query.expectedCloseAtTo)
  if (expectedCloseFrom || expectedCloseTo) {
    const range: Record<string, Date> = {}
    if (expectedCloseFrom) range.$gte = expectedCloseFrom
    if (expectedCloseTo) range.$lte = expectedCloseTo
    filters.expected_close_at = range
  }

  if (query.isOverdue) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (statusList.length === 0) {
      filters.status = { $eq: 'open' }
    }
    const existingRange =
      filters.expected_close_at && typeof filters.expected_close_at === 'object'
        ? (filters.expected_close_at as Record<string, Date>)
        : {}
    existingRange.$lt = today
    filters.expected_close_at = existingRange
  }

  if (query.isStuck && ctx) {
    const tenantId = ctx.auth?.tenantId
    // CrudCtx.auth carries `orgId` (not `organizationId`). The previous code referenced
    // `organizationId` which is always `undefined`, so the typeof check below silently
    // skipped the entire isStuck branch — `?isStuck=true` was a no-op on this endpoint.
    const organizationId = ctx.auth?.orgId
    if (typeof tenantId === 'string' && typeof organizationId === 'string') {
      const em = ctx.container.resolve<EntityManager>('em')
      const stuckIds = await fetchStuckDealIds(em, organizationId, tenantId)
      intersectIds(stuckIds)
    }
  }

  // Pre-pagination association filter. Must run on the FULL dataset (before pagination),
  // otherwise matching deals on later pages disappear and `total` would be wrong. Read the
  // raw URL too so legacy `?personEntityId=` / `?companyEntityId=` keep working alongside the
  // canonical `?personId=` / `?companyId=`.
  const url = ctx?.request ? new URL(ctx.request.url) : null
  const personCandidates: unknown[] = [query.personId, query.personEntityId]
  const companyCandidates: unknown[] = [query.companyId, query.companyEntityId]
  if (url) {
    personCandidates.push(url.searchParams.getAll('personId'))
    personCandidates.push(url.searchParams.getAll('personEntityId'))
    companyCandidates.push(url.searchParams.getAll('companyId'))
    companyCandidates.push(url.searchParams.getAll('companyEntityId'))
  }
  const selectedPersonIds = normalizeUuidList(personCandidates)
  const selectedCompanyIds = normalizeUuidList(companyCandidates)
  if ((selectedPersonIds.length > 0 || selectedCompanyIds.length > 0) && ctx) {
    const tenantId = ctx.auth?.tenantId
    // `ctx.auth` exposes `orgId` (see AuthContext in @open-mercato/shared/lib/auth/server).
    // Read it under the correct key — the previous code's `organizationId` would always be
    // `undefined`, silently disabling association filtering on the deals list endpoint.
    const organizationId = ctx.auth?.orgId
    if (typeof tenantId === 'string' && typeof organizationId === 'string') {
      const em = ctx.container.resolve<EntityManager>('em')
      const matchedIds = await fetchDealIdsMatchingAssociations(
        em,
        organizationId,
        tenantId,
        selectedPersonIds,
        selectedCompanyIds,
      )
      // intersectIds with empty array → no rows; collapses the page to zero, total stays correct.
      intersectIds(matchedIds)
    }
  }

  if (ctx && advancedFilterTree) {
    const advancedFilters = mergeAdvancedFilterTree({ ...filters }, advancedFilterTree)
    const matchedIds = await findMatchingEntityIdsWithQueryEngine({
      ctx,
      entityId: E.customers.customer_deal,
      filters: advancedFilters,
    })
    if (matchedIds !== null) {
      intersectIds(matchedIds)
    }
  }

  if (restrictedIds !== null) {
    applyEntityIdRestriction(filters, restrictedIds)
  }

  return filters
}

const crud = makeCrudRoute<unknown, unknown, DealListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: CustomerDeal,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.customers.customer_deal,
  },
  enrichers: { entityId: 'customers.deal' },
  list: {
    schema: dealListQuerySchema,
    entityId: E.customers.customer_deal,
    fields: [
      'id',
      'title',
      'description',
      'status',
      'pipeline_stage',
      'pipeline_id',
      'pipeline_stage_id',
      'value_amount',
      'value_currency',
      'probability',
      'expected_close_at',
      'owner_user_id',
      'source',
      'closure_outcome',
      'loss_reason_id',
      'loss_notes',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    decorateCustomFields: {
      entityIds: E.customers.customer_deal,
    },
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      title: 'title',
      value: 'value_amount',
      probability: 'probability',
      expectedCloseAt: 'expected_close_at',
    },
    buildFilters: buildDealListFilters,
  },
  actions: {
    create: {
      commandId: 'customers.deals.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(dealCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.dealId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.deals.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(dealUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.deals.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.deal_required', 'Deal id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    // afterList only DECORATES results with `people`/`companies` arrays — it must not filter,
    // because filtering after pagination would drop deals on later pages and rewrite `total`
    // to a misleading value. Association filtering happens pre-pagination in `buildFilters`
    // via `fetchDealIdsMatchingAssociations`.
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const scopeSource = (items[0] ?? {}) as Record<string, unknown>
      const tenantIdRaw = scopeSource.tenantId ?? scopeSource.tenant_id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fallbackTenantId = (typeof tenantIdRaw === 'string' && tenantIdRaw.trim().length ? tenantIdRaw : null) ?? (ctx as any)?.auth?.tenantId ?? null
      const orgIdRaw = scopeSource.organizationId ?? scopeSource.organization_id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fallbackOrganizationId = (typeof orgIdRaw === 'string' && orgIdRaw.trim().length ? orgIdRaw : null) ?? (ctx as any)?.auth?.orgId ?? null
      const ids = items
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null
          const candidate = (item as Record<string, unknown>).id
          return typeof candidate === 'string' && candidate.trim().length ? candidate : null
        })
        .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
      if (!ids.length) {
        payload.items = []
        payload.total = 0
        return
      }
      try {
        const em = (ctx.container.resolve('em') as EntityManager)
        const [allPersonLinks, allCompanyLinks] = await Promise.all([
          findWithDecryption(
            em,
            CustomerDealPersonLink,
            { deal: { $in: ids } },
            { populate: ['person'] },
            { tenantId: fallbackTenantId, organizationId: fallbackOrganizationId },
          ),
          findWithDecryption(
            em,
            CustomerDealCompanyLink,
            { deal: { $in: ids } },
            { populate: ['company'] },
            { tenantId: fallbackTenantId, organizationId: fallbackOrganizationId },
          ),
        ])

        const personAssignments = new Map<string, { id: string; label: string }[]>()
        allPersonLinks.forEach((link) => {
          const deal = link.deal
          const dealRecord = deal && typeof deal === 'object' ? deal as unknown as Record<string, unknown> : null
          const dealId = typeof deal === 'string' ? deal
            : dealRecord && typeof dealRecord.id === 'string' ? dealRecord.id
            : null
          if (!dealId) return
          const personRef = link.person
          const personRecord = personRef && typeof personRef === 'object' ? personRef as unknown as Record<string, unknown> : null
          const personId = typeof personRef === 'string' ? personRef
            : personRecord && typeof personRecord.id === 'string' ? personRecord.id
            : null
          if (!personId) return
          const label = personRecord && typeof personRecord.displayName === 'string'
            ? personRecord.displayName
            : ''
          const bucket = personAssignments.get(dealId) ?? []
          if (!bucket.some((entry) => entry.id === personId)) {
            bucket.push({ id: personId, label })
            personAssignments.set(dealId, bucket)
          }
        })

        const companyAssignments = new Map<string, { id: string; label: string }[]>()
        allCompanyLinks.forEach((link) => {
          const deal = link.deal
          const dealRecord = deal && typeof deal === 'object' ? deal as unknown as Record<string, unknown> : null
          const dealId = typeof deal === 'string' ? deal
            : dealRecord && typeof dealRecord.id === 'string' ? dealRecord.id
            : null
          if (!dealId) return
          const companyRef = link.company
          const companyRecord = companyRef && typeof companyRef === 'object' ? companyRef as unknown as Record<string, unknown> : null
          const companyId = typeof companyRef === 'string' ? companyRef
            : companyRecord && typeof companyRecord.id === 'string' ? companyRecord.id
            : null
          if (!companyId) return
          const label = companyRecord && typeof companyRecord.displayName === 'string'
            ? companyRecord.displayName
            : ''
          const bucket = companyAssignments.get(dealId) ?? []
          if (!bucket.some((entry) => entry.id === companyId)) {
            bucket.push({ id: companyId, label })
            companyAssignments.set(dealId, bucket)
          }
        })

        const enhancedItems = items
          .map((item: unknown) => {
            if (!item || typeof item !== 'object') return null
            const data = item as Record<string, unknown>
            const candidate = typeof data.id === 'string' ? data.id : null
            if (!candidate || !candidate.trim().length) return null
            const people = personAssignments.get(candidate) ?? []
            const companies = companyAssignments.get(candidate) ?? []
            const tenantIdRaw =
              typeof data.tenantId === 'string'
                ? data.tenantId
                : typeof data.tenant_id === 'string'
                  ? data.tenant_id
                  : null
            const organizationIdRaw =
              typeof data.organizationId === 'string'
                ? data.organizationId
                : typeof data.organization_id === 'string'
                  ? data.organization_id
                  : null
            const tenantId = tenantIdRaw && tenantIdRaw.trim().length ? tenantIdRaw.trim() : null
            const organizationId = organizationIdRaw && organizationIdRaw.trim().length ? organizationIdRaw.trim() : null
            return {
              ...data,
              personIds: people.map((entry) => entry.id),
              people,
              companyIds: companies.map((entry) => entry.id),
              companies,
              tenantId,
              organizationId,
            }
          })
          .filter(
            (item: Record<string, unknown> | null): item is Record<string, unknown> => item !== null,
          )

        payload.items = enhancedItems
      } catch (err) {
        // We swallow rather than fail the request because the kanban is still useful without
        // people/companies labels (cards just lose their company pill). Tag every item with
        // `_associations: { ok: false }` so a future surface can render a degraded-state hint
        // instead of silently showing cards without company badges.
        console.warn('[customers.deals] failed to decorate items with person/company links', err)
        payload.items = items.map((item: unknown) => {
          if (!item || typeof item !== 'object') return item
          return {
            ...(item as Record<string, unknown>),
            _associations: {
              ok: false,
              reason: err instanceof Error ? err.message : 'unknown',
            },
          }
        })
      }
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const dealAssociationSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
})

const dealListItemSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().nullable(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    pipeline_stage: z.string().nullable().optional(),
    pipeline_id: z.string().uuid().nullable().optional(),
    pipeline_stage_id: z.string().uuid().nullable().optional(),
    value_amount: z.number().nullable().optional(),
    value_currency: z.string().nullable().optional(),
    probability: z.number().nullable().optional(),
    expected_close_at: z.string().nullable().optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    source: z.string().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    personIds: z.array(z.string().uuid()).optional(),
    people: z.array(dealAssociationSchema).optional(),
    companyIds: z.array(z.string().uuid()).optional(),
    companies: z.array(dealAssociationSchema).optional(),
    organizationId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid().nullable().optional(),
  })
  .passthrough()

const dealCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Deal',
  querySchema: dealListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(dealListItemSchema),
  create: {
    schema: dealCreateSchema,
    responseSchema: dealCreateResponseSchema,
    description: 'Creates a sales deal, optionally associating people and companies.',
  },
  update: {
    schema: dealUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates pipeline position, metadata, or associations for an existing deal.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a deal by `id`. The identifier may be provided in the body or query parameters.',
  },
})
