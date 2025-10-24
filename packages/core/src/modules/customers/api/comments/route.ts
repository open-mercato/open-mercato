/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerComment, CustomerDeal } from '../../data/entities'
import { commentCreateSchema, commentUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    entityId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.activities.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerComment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.customers.customer_comment,
  },
  list: {
    schema: listSchema,
    entityId: E.customers.customer_comment,
    fields: [
      'id',
      'entity_id',
      'deal_id',
      'body',
      'author_user_id',
      'appearance_icon',
      'appearance_color',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.entityId) filters.entity_id = { $eq: query.entityId }
      if (query.dealId) filters.deal_id = { $eq: query.dealId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'customers.comments.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return commentCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({
        id: result?.commentId ?? result?.id ?? null,
        authorUserId: result?.authorUserId ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'customers.comments.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return commentUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.comments.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.comment_required', 'Comment id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const dealIds = Array.from(
        new Set(
          items
            .map((item) => {
              if (!item || typeof item !== 'object') return null
              const record = item as Record<string, unknown>
              const raw =
                typeof record.deal_id === 'string'
                  ? record.deal_id
                  : typeof record.dealId === 'string'
                    ? record.dealId
                    : null
              return raw && raw.trim().length ? raw : null
            })
            .filter((value): value is string => !!value),
        ),
      )
      if (!dealIds.length) return
      try {
        const em = ctx.container.resolve<EntityManager>('em')
        const deals = await em.find(CustomerDeal, { id: { $in: dealIds } })
        const map = new Map<string, string>()
        deals.forEach((deal) => {
          if (deal.id) map.set(deal.id, deal.title ?? '')
        })
        items.forEach((item) => {
          if (!item || typeof item !== 'object') return
          const record = item as Record<string, unknown>
          const raw =
            typeof record.deal_id === 'string'
              ? record.deal_id
              : typeof record.dealId === 'string'
                ? record.dealId
                : null
          if (!raw) return
          const title = map.get(raw) ?? null
          ;(record as Record<string, unknown>).dealTitle = title
          if (!('deal_title' in record)) {
            ;(record as Record<string, unknown>).deal_title = title
          }
        })
      } catch (err) {
        console.warn('[customers.comments] failed to enrich deal titles', err)
      }
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
