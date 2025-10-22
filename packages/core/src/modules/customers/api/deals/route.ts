/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDeal, CustomerDealPersonLink, CustomerDealCompanyLink } from '../../data/entities'
import { dealCreateSchema, dealUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
import type { EntityManager } from '@mikro-orm/postgresql'

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
        return dealCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.dealId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.deals.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return dealUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
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
      const personEntityId = query.personEntityId ?? null
      const companyEntityId = query.companyEntityId ?? null
      ;(ctx as any).__dealsFilters = {
        personEntityId,
        companyEntityId,
      }
    },
    afterList: async (payload, ctx) => {
      const filters = ((ctx as any).__dealsFilters || {}) as {
        personEntityId?: string | null
        companyEntityId?: string | null
      }
      const personEntityId =
        typeof filters.personEntityId === 'string' && filters.personEntityId.trim().length
          ? filters.personEntityId
          : null
      const companyEntityId =
        typeof filters.companyEntityId === 'string' && filters.companyEntityId.trim().length
          ? filters.companyEntityId
          : null
      if (!personEntityId && !companyEntityId) return
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
        const personMatches = new Set<string>()
        const companyMatches = new Set<string>()
        if (personEntityId) {
          const personLinks = await em.find(CustomerDealPersonLink, {
            deal: { $in: ids },
            person: personEntityId,
          })
          personLinks.forEach((link) => {
            const deal = link.deal
            if (typeof deal === 'string') personMatches.add(deal)
            else if (deal && typeof deal === 'object' && 'id' in deal && typeof (deal as any).id === 'string') {
              personMatches.add((deal as any).id)
            }
          })
        }
        if (companyEntityId) {
          const companyLinks = await em.find(CustomerDealCompanyLink, {
            deal: { $in: ids },
            company: companyEntityId,
          })
          companyLinks.forEach((link) => {
            const deal = link.deal
            if (typeof deal === 'string') companyMatches.add(deal)
            else if (deal && typeof deal === 'object' && 'id' in deal && typeof (deal as any).id === 'string') {
              companyMatches.add((deal as any).id)
            }
          })
        }
        const filtered = items.filter((item) => {
          if (!item || typeof item !== 'object') return false
          const candidate = (item as Record<string, unknown>).id
          if (typeof candidate !== 'string' || !candidate.trim().length) return false
          const matchesPerson = personEntityId ? personMatches.has(candidate) : true
          const matchesCompany = companyEntityId ? companyMatches.has(candidate) : true
          return matchesPerson && matchesCompany
        })
        payload.items = filtered
        payload.total = filtered.length
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
