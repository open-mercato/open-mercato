import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildCustomFieldFiltersFromQuery, extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import { SalesOrderLine } from '../../data/entities'
import { orderLineCreateSchema } from '../../data/validators'
import { createPagedListResponseSchema, createSalesCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { withScopedPayload } from '../utils'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/sales_order_line'

const rawBodySchema = z.object({}).passthrough()
const resolveRawBody = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object') return {}
  if ('body' in raw) {
    const payload = raw as { body?: unknown }
    if (payload.body && typeof payload.body === 'object') {
      return payload.body as Record<string, unknown>
    }
  }
  return raw as Record<string, unknown>
}

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
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

const upsertSchema = orderLineCreateSchema.extend({ id: z.string().uuid().optional() })
const deleteSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesOrderLine,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.sales.sales_order_line,
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_order_line,
    fields: [
      F.id,
      'order_id',
      F.line_number,
      F.kind,
      F.status_entry_id,
      F.status,
      F.product_id,
      F.product_variant_id,
      F.catalog_snapshot,
      F.name,
      F.description,
      F.comment,
      F.organization_id,
      F.tenant_id,
      F.quantity,
      F.quantity_unit,
      'normalized_quantity',
      'normalized_unit',
      'uom_snapshot',
      F.currency_code,
      F.unit_price_net,
      F.unit_price_gross,
      F.discount_amount,
      F.discount_percent,
      F.tax_rate,
      F.tax_amount,
      F.total_net_amount,
      F.total_gross_amount,
      F.configuration,
      F.promotion_code,
      F.promotion_snapshot,
      F.metadata,
      F.custom_field_set_id,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      lineNumber: F.line_number,
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      try {
        const em = ctx.container.resolve('em')
        const cfFilters = await buildCustomFieldFiltersFromQuery({
          entityId: E.sales.sales_order_line,
          query,
          em,
          tenantId: ctx.auth?.tenantId ?? null,
        })
        Object.assign(filters, cfFilters)
      } catch {
        // ignore
      }
      return filters
    },
    transformItem: (item: Record<string, unknown> | null | undefined) => {
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
      commandId: 'sales.orders.lines.upsert',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload = upsertSchema.parse(withScopedPayload(resolveRawBody(raw) ?? {}, ctx, translate))
        return { body: payload }
      },
      response: ({ result }) => ({ id: result?.lineId ?? null, orderId: result?.orderId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.orders.lines.upsert',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload = upsertSchema.parse(withScopedPayload(resolveRawBody(raw) ?? {}, ctx, translate))
        return { body: payload }
      },
      response: ({ result }) => ({ id: result?.lineId ?? null, orderId: result?.orderId ?? null }),
    },
    delete: {
      commandId: 'sales.orders.lines.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload = deleteSchema.parse(withScopedPayload(resolveRawBody(raw) ?? {}, ctx, translate))
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

const orderLineSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  line_number: z.number(),
  kind: z.string(),
  status_entry_id: z.string().uuid().nullable().optional(),
  status: z.string().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  product_variant_id: z.string().uuid().nullable().optional(),
  catalog_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  quantity: z.number(),
  quantity_unit: z.string().nullable().optional(),
  normalized_quantity: z.number(),
  normalized_unit: z.string().nullable().optional(),
  uom_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  currency_code: z.string(),
  unit_price_net: z.number(),
  unit_price_gross: z.number(),
  discount_amount: z.number(),
  discount_percent: z.number(),
  tax_rate: z.number(),
  tax_amount: z.number(),
  total_net_amount: z.number(),
  total_gross_amount: z.number(),
  configuration: z.record(z.string(), z.unknown()).nullable().optional(),
  promotion_code: z.string().nullable().optional(),
  promotion_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  custom_field_set_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Order line',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(orderLineSchema),
  create: {
    schema: upsertSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable(), orderId: z.string().uuid().nullable() }),
    description: 'Creates an order line and recalculates totals.',
  },
  update: {
    schema: upsertSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable(), orderId: z.string().uuid().nullable() }),
    description: 'Updates an order line and recalculates totals.',
  },
  del: {
    schema: deleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an order line and recalculates totals.',
  },
})
