import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ProductPlanningParams } from '../../data/entities.js'
import {
  planningParamsCreateSchema,
  planningParamsUpdateSchema,
  planningParamsListQuerySchema,
} from '../../data/validators.js'
import { E } from '../../../../../generated/entities.ids.generated.js'
import {
  createProductionCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi.js'

const rawBodySchema = z.object({}).passthrough()

// The spec's API Contracts table does not pin an ACL resource for planning
// params (only "Technology" and "MRP" feature groups are defined). Since
// planning params drive MRP procurement/lead-time/lot-sizing decisions
// (§ Access Control: `production.mrp.view/manage` -> "admin, Planista"), this
// route is gated by the MRP feature group rather than technology.manage.
// Recorded here for the follow-up spec delta (task 1.5).
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['production.mrp.view'] },
  POST: { requireAuth: true, requireFeatures: ['production.mrp.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['production.mrp.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['production.mrp.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ProductPlanningParams,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.production.product_planning_params },
  list: {
    entityId: E.production.product_planning_params,
    schema: planningParamsListQuerySchema,
    fields: [
      'id',
      'product_id',
      'variant_id',
      'procurement',
      'lead_time_days',
      'min_lot',
      'lot_multiple',
      'safety_stock',
      'backflush',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      procurement: 'procurement',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    transformItem: (item: Record<string, unknown>) => {
      if (!item) return item
      return {
        id: item.id,
        productId: item.product_id,
        variantId: item.variant_id,
        procurement: item.procurement,
        leadTimeDays: item.lead_time_days,
        minLot: item.min_lot,
        lotMultiple: item.lot_multiple,
        safetyStock: item.safety_stock,
        backflush: item.backflush,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    },
  },
  actions: {
    create: {
      commandId: 'production.planning_params.create',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => planningParamsCreateSchema.parse(raw),
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'production.planning_params.update',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => planningParamsUpdateSchema.parse(raw),
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'production.planning_params.delete',
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

const planningParamsListItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  procurement: z.enum(['make', 'buy']),
  leadTimeDays: z.number(),
  minLot: z.string(),
  lotMultiple: z.string(),
  safetyStock: z.string(),
  backflush: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi = createProductionCrudOpenApi({
  resourceName: 'ProductPlanningParams',
  pluralName: 'ProductPlanningParams',
  querySchema: planningParamsListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(planningParamsListItemSchema),
  create: {
    schema: planningParamsCreateSchema,
    description: 'Creates planning parameters (make/buy, lead time, lot sizing, safety stock) for a product/variant.',
  },
  update: {
    schema: planningParamsUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates planning parameters by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes planning parameters by ID.',
  },
})
