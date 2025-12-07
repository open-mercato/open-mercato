import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOrderAdjustment } from '../../data/entities'
import { orderAdjustmentCreateSchema } from '../../data/validators'
import { createPagedListResponseSchema, createSalesCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { withScopedPayload } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/sales_order_adjustment'
import { buildCustomFieldFiltersFromQuery, extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    orderId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.orders.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
}

const upsertSchema = orderAdjustmentCreateSchema.extend({ id: z.string().uuid().optional() })

const deleteSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesOrderAdjustment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.sales.sales_order_adjustment,
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_order_adjustment,
    decorateCustomFields: { entityIds: [E.sales.sales_order_adjustment] },
    fields: [
      F.id,
      'order_id',
      'order_line_id',
      F.scope,
      F.kind,
      F.code,
      F.label,
      F.calculator_key,
      F.promotion_id,
      F.rate,
      F.amount_net,
      F.amount_gross,
      F.currency_code,
      F.metadata,
      F.position,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      position: F.position,
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      try {
        const em = ctx.container.resolve('em')
        const cfFilters = await buildCustomFieldFiltersFromQuery({
          entityId: E.sales.sales_order_adjustment,
          query,
          em,
          tenantId: ctx.auth?.tenantId ?? null,
        })
        Object.assign(filters, cfFilters)
      } catch {
        // ignore custom field filters when EM is unavailable in this context
      }
      return filters
    },
    transformItem: (item: any) => {
      if (!item) return item
      const normalized = { ...item }
      const cfEntries = extractAllCustomFieldEntries(item)
      for (const key of Object.keys(normalized)) {
        if (key.startsWith('cf:')) delete normalized[key]
      }
      return { ...normalized, ...cfEntries }
    },
  },
  actions: {
    create: {
      commandId: 'sales.orders.adjustments.upsert',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload = upsertSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
        return { body: payload }
      },
      response: ({ result }) => ({ id: result?.adjustmentId ?? null, orderId: result?.orderId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.orders.adjustments.upsert',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload = upsertSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
        return { body: payload }
      },
      response: ({ result }) => ({ id: result?.adjustmentId ?? null, orderId: result?.orderId ?? null }),
    },
    delete: {
      commandId: 'sales.orders.adjustments.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload = deleteSchema.parse(
          withScopedPayload(
            {
              ...((raw as any)?.body ?? {}),
              ...((raw as any)?.query ?? {}),
            },
            ctx,
            translate
          )
        )
        if (!payload.id || !payload.orderId) {
          throw new CrudHttpError(400, { error: translate('sales.documents.detail.error', 'Document not found or inaccessible.') })
        }
        return { body: payload }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { GET, POST, PUT, DELETE } = crud

export { GET, POST, PUT, DELETE }

const adjustmentSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  order_line_id: z.string().uuid().nullable().optional(),
  scope: z.string(),
  kind: z.string(),
  code: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  calculator_key: z.string().nullable().optional(),
  promotion_id: z.string().uuid().nullable().optional(),
  rate: z.number(),
  amount_net: z.number(),
  amount_gross: z.number(),
  currency_code: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Order adjustment',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(adjustmentSchema),
  create: {
    schema: upsertSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable(), orderId: z.string().uuid().nullable() }),
    description: 'Creates an order adjustment and recalculates totals.',
  },
  update: {
    schema: upsertSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable(), orderId: z.string().uuid().nullable() }),
    description: 'Updates an order adjustment and recalculates totals.',
  },
  del: {
    schema: deleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an order adjustment and recalculates totals.',
  },
})
