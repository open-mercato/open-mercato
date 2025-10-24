/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDeal, CustomerDealPersonLink, CustomerDealCompanyLink } from '../../data/entities'
import { dealCreateSchema, dealUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../utils'
import type { EntityManager } from '@mikro-orm/postgresql'
import { extractAllCustomFieldEntries, loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'

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
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      title: 'title',
      value: 'value_amount',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.search) {
        filters.title = { $ilike: `%${query.search}%` }
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
      const ids = items
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const candidate = (item as Record<string, unknown>).id
          return typeof candidate === 'string' && candidate.trim().length ? candidate : null
        })
        .filter((value): value is string => !!value)
      if (!ids.length) {
        payload.items = []
        payload.total = 0
        return
      }
      try {
        const em = ctx.container.resolve<EntityManager>('em')
        const [allPersonLinks, allCompanyLinks] = await Promise.all([
          em.find(CustomerDealPersonLink, { deal: { $in: ids } }, { populate: ['person'] }),
          em.find(CustomerDealCompanyLink, { deal: { $in: ids } }, { populate: ['company'] }),
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

        const tenantByRecord: Record<string, string | null | undefined> = {}
        const orgByRecord: Record<string, string | null | undefined> = {}
        const enhancedItems = items
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const data = item as Record<string, unknown>
            const candidate = typeof data.id === 'string' ? data.id : null
            if (!candidate || !candidate.trim().length) return null
            const people = personAssignments.get(candidate) ?? []
            const companies = companyAssignments.get(candidate) ?? []
            const matchesPerson = matchesAll(selectedPersonIds, personMemberships, candidate)
            const matchesCompany = matchesAll(selectedCompanyIds, companyMemberships, candidate)
            if (!matchesPerson || !matchesCompany) return null
            const tenantId =
              typeof data.tenantId === 'string'
                ? data.tenantId
                : typeof data.tenant_id === 'string'
                  ? data.tenant_id
                  : null
            const organizationId =
              typeof data.organizationId === 'string'
                ? data.organizationId
                : typeof data.organization_id === 'string'
                  ? data.organization_id
                  : null
            tenantByRecord[candidate] = tenantId
            orgByRecord[candidate] = organizationId

            const rawCustom = extractAllCustomFieldEntries(data as any)
            const normalizedValues = Object.fromEntries(
              Object.entries(rawCustom).map(([prefixedKey, value]) => [
                prefixedKey.replace(/^cf_/, ''),
                value,
              ]),
            )
            const customEntries = Object.entries(normalizedValues).map(([key, value]) => ({
              key,
              label: key,
              value,
              kind: null,
              multi: Array.isArray(value),
            }))
            const customValues = Object.keys(normalizedValues).length ? normalizedValues : null
            return {
              ...data,
              personIds: people.map((entry) => entry.id),
              people,
              companyIds: companies.map((entry) => entry.id),
              companies,
              customValues,
              customFields: customValues ? customEntries : [],
            }
          })
          .filter((item): item is Record<string, unknown> => !!item)

        if (enhancedItems.length) {
          try {
            const em = ctx.container.resolve<EntityManager>('em')
            const allIds = enhancedItems
              .map((item) => {
                const rawId = (item as Record<string, unknown>).id
                return typeof rawId === 'string' && rawId.trim().length ? rawId : null
              })
              .filter((value): value is string => !!value)
            if (allIds.length) {
              const loaded = await loadCustomFieldValues({
                em,
                entityId: E.customers.customer_deal,
                recordIds: Array.from(new Set(allIds)),
                tenantIdByRecord: tenantByRecord,
                organizationIdByRecord: orgByRecord,
                tenantFallbacks: [ctx.auth?.tenantId ?? null],
              })
              if (loaded && Object.keys(loaded).length) {
                enhancedItems.forEach((item) => {
                  const itemId =
                    typeof (item as Record<string, unknown>).id === 'string'
                      ? ((item as Record<string, unknown>).id as string)
                      : null
                  if (!itemId) return
                  const values = loaded[itemId]
                  if (!values) return
                  const normalized = Object.fromEntries(
                    Object.entries(values).map(([prefixedKey, value]) => [
                      prefixedKey.replace(/^cf_/, ''),
                      value,
                    ]),
                  )
                  const baseExisting = (item as { customValues?: Record<string, unknown> | null }).customValues
                  const existing =
                    baseExisting && typeof baseExisting === 'object' && baseExisting !== null
                      ? baseExisting
                      : {}
                  const merged = { ...existing, ...normalized }
                  const entries = Object.entries(merged).map(([key, value]) => ({
                    key,
                    label: key,
                    value,
                    kind: null,
                    multi: Array.isArray(value),
                  }))
                  ;(item as any).customValues = merged
                  ;(item as any).customFields = entries
                })
              }
            }
          } catch (err) {
            console.warn('[customers.deals] failed to backfill custom fields', err)
          }
        }

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
