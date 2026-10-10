import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { FreightOrder, ORDER_STATUSES, TRUCK_TYPES } from '../../data/entities'
import { createOrderSchema, updateOrderSchema } from '../../data/validators'
import { withOrConditions } from '../../lib/crudFilters'
import { createPagedListResponseSchema, createFreightCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FREIGHT_ORDER_ENTITY_ID } from '../../commands/entities'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    customerId: z.string().uuid().optional(),
    truckTypeRequired: z.enum(TRUCK_TYPES).optional(),
    requestedFrom: z.string().optional(),
    requestedTo: z.string().optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
  POST: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
}
export const metadata = { path: '/freight_operations/orders', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FreightOrder, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FREIGHT_ORDER_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FREIGHT_ORDER_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'order_number', 'status', 'customer_id', 'customer_snapshot',
      'cargo_description', 'pickup_location', 'dropoff_location', 'requested_pickup_at', 'requested_delivery_at',
      'truck_type_required', 'vehicle_id', 'driver_id', 'vehicle_snapshot', 'driver_snapshot',
      'agreed_amount_net', 'adjustment_amount_net', 'currency_code', 'vat_rate',
      'delivered_at', 'completed_at', 'sales_order_id', 'sales_invoice_id', 'invoiced_at',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      orderNumber: 'order_number',
      requestedPickupAt: 'requested_pickup_at',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) =>
      withOrConditions(
        {
          ...(query.id ? { id: { $eq: query.id } } : {}),
          ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
          ...(query.status ? { status: { $eq: query.status } } : {}),
          ...(query.customerId ? { customer_id: { $eq: query.customerId } } : {}),
          ...(query.truckTypeRequired ? { truck_type_required: { $eq: query.truckTypeRequired } } : {}),
          ...(query.requestedFrom ? { requested_pickup_at: { $gte: query.requestedFrom } } : {}),
          ...(query.requestedTo ? { requested_pickup_at: { $lte: query.requestedTo } } : {}),
        },
        query.search
          ? [
              {
                $or: [
                  { order_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { cargo_description: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { pickup_location: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { dropoff_location: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                ],
              },
            ]
          : [],
      ),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'freight_operations.orders.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createOrderSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'freight_operations.orders.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateOrderSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'freight_operations.orders.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const orderListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  order_number: z.string(),
  status: z.enum(ORDER_STATUSES),
  customer_id: z.string().uuid(),
  customer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  cargo_description: z.string(),
  pickup_location: z.string(),
  dropoff_location: z.string(),
  requested_pickup_at: z.string().nullable().optional(),
  requested_delivery_at: z.string().nullable().optional(),
  truck_type_required: z.enum(TRUCK_TYPES).nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  vehicle_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  driver_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  agreed_amount_net: z.string(),
  adjustment_amount_net: z.string().nullable().optional(),
  currency_code: z.string(),
  vat_rate: z.string(),
  sales_order_id: z.string().uuid().nullable().optional(),
  sales_invoice_id: z.string().uuid().nullable().optional(),
  invoiced_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFreightCrudOpenApi({
  resourceName: 'FreightOrder',
  pluralName: 'Freight Orders',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(orderListItemSchema),
  create: { schema: createOrderSchema, description: 'Creates a spot truck order (draft) and allocates its number.' },
  update: { schema: updateOrderSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a draft or confirmed order.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a draft order.' },
})
