import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ProductionOrder } from '../../data/entities.js'
import {
  orderCreateSchema,
  orderUpdateSchema,
  orderListQuerySchema,
} from '../../data/validators.js'
import { E } from '../../../../../generated/entities.ids.generated.js'
import {
  createProductionCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi.js'

const rawBodySchema = z.object({}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['production.orders.view'] },
  POST: { requireAuth: true, requireFeatures: ['production.orders.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['production.orders.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['production.orders.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ProductionOrder,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.production.production_order },
  list: {
    entityId: E.production.production_order,
    schema: orderListQuerySchema,
    fields: [
      'id',
      'number',
      'product_id',
      'variant_id',
      'qty_planned',
      'uom',
      'due_date',
      'priority',
      'status',
      'source_type',
      'source_id',
      'released_at',
      'qty_completed',
      'qty_scrapped',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      number: 'number',
      dueDate: 'due_date',
      priority: 'priority',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    transformItem: (item: Record<string, unknown>) => {
      if (!item) return item
      return {
        id: item.id,
        number: item.number,
        productId: item.product_id,
        variantId: item.variant_id,
        qtyPlanned: item.qty_planned,
        uom: item.uom,
        dueDate: item.due_date,
        priority: item.priority,
        status: item.status,
        sourceType: item.source_type,
        sourceId: item.source_id,
        releasedAt: item.released_at,
        qtyCompleted: item.qty_completed,
        qtyScrapped: item.qty_scrapped,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    },
  },
  actions: {
    create: {
      commandId: 'production.orders.create',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => orderCreateSchema.parse(raw),
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'production.orders.update',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => orderUpdateSchema.parse(raw),
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'production.orders.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('production.errors.id_required', 'Record id is required') })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud

const orderListItemSchema = z.object({
  id: z.string().uuid(),
  number: z.number(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  qtyPlanned: z.string(),
  uom: z.string(),
  dueDate: z.string().nullable(),
  priority: z.number(),
  status: z.enum(['draft', 'planned', 'released', 'in_progress', 'completed', 'closed', 'cancelled']),
  sourceType: z.enum(['sales_order', 'mrp', 'manual']),
  sourceId: z.string().uuid().nullable(),
  releasedAt: z.string().nullable(),
  qtyCompleted: z.string(),
  qtyScrapped: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi = createProductionCrudOpenApi({
  resourceName: 'ProductionOrder',
  pluralName: 'ProductionOrders',
  querySchema: orderListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(orderListItemSchema),
  create: {
    schema: orderCreateSchema,
    description: 'Creates a new draft production order.',
  },
  update: {
    schema: orderUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a draft/planned production order\'s header fields.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a draft production order by ID.',
  },
})
