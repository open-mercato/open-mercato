/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDeal, CustomerDealPersonLink, CustomerDealCompanyLink } from '../../data/entities'
import { dealCreateSchema, dealUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/generated/entity-ids'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../utils'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  createCustomersCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    status: z.string().optional(),
    pipelineStage: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    personEntityId: z.string().uuid().optional(),
    companyEntityId: z.string().uuid().optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

export const metadata = routeMetadata

type DealListQuery = z.infer<typeof listSchema>

function parseUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  const result = z.string().uuid().safeParse(trimmed)
  return result.success ? trimmed : null
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
  list: {
    schema: listSchema,
    entityId: E.customers.customer_deal,
    fields: [
      'id',
      'title',
      'description',
      'status',
      'pipeline_stage',
      'value_amount',
      'value_currency',
      'probability',
      'expected_close_at',
      'owner_user_id',
      'source',
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
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.search) {
        filters.title = { $ilike: `%${escapeLikePattern(query.search)}%` }
      }
      if (query.status) {
        filters.status = { $eq: query.status }
      }
      if (query.pipelineStage) {
        filters.pipeline_stage = { $eq: query.pipelineStage }
      }
      return filters
    },
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
    beforeList: (query, ctx) => {
      const url = ctx.request ? new URL(ctx.request.url) : null
      const legacyPersonId = query.personEntityId ?? null
      const legacyCompanyId = query.companyEntityId ?? null
      const allPersonCandidates: unknown[] = []
      const allCompanyCandidates: unknown[] = []
      if (legacyPersonId) allPersonCandidates.push(legacyPersonId)
      if (legacyCompanyId) allCompanyCandidates.push(legacyCompanyId)
      if (url) {
        const personParams = url.searchParams.getAll('personId')
        const companyParams = url.searchParams.getAll('companyId')
        if (personParams.length) allPersonCandidates.push(...personParams)
        if (companyParams.length) allCompanyCandidates.push(...companyParams)
        const legacyRepeatPerson = url.searchParams.getAll('personEntityId')
        const legacyRepeatCompany = url.searchParams.getAll('companyEntityId')
        if (legacyRepeatPerson.length) allPersonCandidates.push(...legacyRepeatPerson)
        if (legacyRepeatCompany.length) allCompanyCandidates.push(...legacyRepeatCompany)
      }
      const personIds = normalizeUuidList(allPersonCandidates)
      const companyIds = normalizeUuidList(allCompanyCandidates)
      ;(ctx as any).__dealsFilters = {
        personIds,
        companyIds,
      }
    },
    afterList: async (payload, ctx) => {
      const filters = ((ctx as any).__dealsFilters || {}) as {
        personIds?: string[]
        companyIds?: string[]
      }
      const selectedPersonIds = Array.isArray(filters.personIds) ? filters.personIds : []
      const selectedCompanyIds = Array.isArray(filters.companyIds) ? filters.companyIds : []

      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const scopeSource = (items[0] ?? {}) as Record<string, unknown>
      const fallbackTenantId =
        (typeof scopeSource.tenantId === 'string' && scopeSource.tenantId.trim().length
          ? scopeSource.tenantId
          : typeof (scopeSource as any).tenant_id === 'string' && (scopeSource as any).tenant_id.trim().length
            ? (scopeSource as any).tenant_id
            : null) ?? (ctx as any)?.auth?.tenantId ?? null
      const fallbackOrganizationId =
        (typeof scopeSource.organizationId === 'string' && scopeSource.organizationId.trim().length
          ? scopeSource.organizationId
          : typeof (scopeSource as any).organization_id === 'string' &&
              (scopeSource as any).organization_id.trim().length
            ? (scopeSource as any).organization_id
            : null) ?? (ctx as any)?.auth?.orgId ?? null
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
        const personMemberships = new Map<string, Set<string>>()
        allPersonLinks.forEach((link) => {
          const deal = link.deal
          const dealId =
            typeof deal === 'string'
              ? deal
              : deal && typeof deal === 'object' && 'id' in deal && typeof (deal as any).id === 'string'
                ? (deal as any).id
                : null
          if (!dealId) return
          const personRef = link.person
          const personId =
            typeof personRef === 'string'
              ? personRef
              : personRef && typeof personRef === 'object' && 'id' in personRef && typeof (personRef as any).id === 'string'
                ? (personRef as any).id
                : null
          if (!personId) return
          const label =
            personRef && typeof personRef === 'object' && 'displayName' in personRef && typeof (personRef as any).displayName === 'string'
              ? (personRef as any).displayName
              : ''
          const bucket = personAssignments.get(dealId) ?? []
          if (!bucket.some((entry) => entry.id === personId)) {
            bucket.push({ id: personId, label })
            personAssignments.set(dealId, bucket)
          }
          const membership = personMemberships.get(dealId) ?? new Set<string>()
          membership.add(personId)
          personMemberships.set(dealId, membership)
        })

        const companyAssignments = new Map<string, { id: string; label: string }[]>()
        const companyMemberships = new Map<string, Set<string>>()
        allCompanyLinks.forEach((link) => {
          const deal = link.deal
          const dealId =
            typeof deal === 'string'
              ? deal
              : deal && typeof deal === 'object' && 'id' in deal && typeof (deal as any).id === 'string'
                ? (deal as any).id
                : null
          if (!dealId) return
          const companyRef = link.company
          const companyId =
            typeof companyRef === 'string'
              ? companyRef
              : companyRef && typeof companyRef === 'object' && 'id' in companyRef && typeof (companyRef as any).id === 'string'
                ? (companyRef as any).id
                : null
          if (!companyId) return
          const label =
            companyRef && typeof companyRef === 'object' && 'displayName' in companyRef && typeof (companyRef as any).displayName === 'string'
              ? (companyRef as any).displayName
              : ''
          const bucket = companyAssignments.get(dealId) ?? []
          if (!bucket.some((entry) => entry.id === companyId)) {
            bucket.push({ id: companyId, label })
            companyAssignments.set(dealId, bucket)
          }
          const membership = companyMemberships.get(dealId) ?? new Set<string>()
          membership.add(companyId)
          companyMemberships.set(dealId, membership)
        })

        const hasPersonFilter = selectedPersonIds.length > 0
        const hasCompanyFilter = selectedCompanyIds.length > 0
        const matchesAll = (selected: string[], memberships: Map<string, Set<string>>, dealId: string) => {
          if (!selected.length) return true
          const membership = memberships.get(dealId)
          if (!membership || membership.size === 0) return false
          return selected.every((id) => membership.has(id))
        }

        const enhancedItems = items
          .map((item: unknown) => {
            if (!item || typeof item !== 'object') return null
            const data = item as Record<string, unknown>
            const candidate = typeof data.id === 'string' ? data.id : null
            if (!candidate || !candidate.trim().length) return null
            const people = personAssignments.get(candidate) ?? []
            const companies = companyAssignments.get(candidate) ?? []
            const matchesPerson = matchesAll(selectedPersonIds, personMemberships, candidate)
            const matchesCompany = matchesAll(selectedCompanyIds, companyMemberships, candidate)
            if (!matchesPerson || !matchesCompany) return null
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
        if (hasPersonFilter || hasCompanyFilter) {
          payload.total = enhancedItems.length
          payload.totalPages = 1
          payload.page = 1
        }
      } catch (err) {
        console.warn('[customers.deals] failed to filter by person/company link', err)
        // fall back to unfiltered list to avoid breaking the endpoint
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
  querySchema: listSchema,
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
