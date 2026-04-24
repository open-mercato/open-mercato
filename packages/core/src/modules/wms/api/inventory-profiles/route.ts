import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { E } from '#generated/entities.ids.generated'
import { ProductInventoryProfile } from '../../data/entities'
import {
  productInventoryProfileCreateSchema,
  productInventoryProfileUpdateSchema,
} from '../../data/validators'
import { createPagedListResponseSchema, createWmsCrudOpenApi, defaultOkResponseSchema } from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  POST: { requireAuth: true, requireFeatures: ['wms.manage_inventory'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_inventory'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_inventory'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  catalogProductId: z.string().uuid().optional(),
  catalogVariantId: z.string().uuid().optional(),
  defaultStrategy: z.enum(['fifo', 'lifo', 'fefo']).optional(),
  trackLot: z.string().optional(),
  trackSerial: z.string().optional(),
  trackExpiration: z.string().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ProductInventoryProfile,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.wms.product_inventory_profile },
  list: {
    schema: listSchema,
    entityId: E.wms.product_inventory_profile,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'catalog_product_id',
      'catalog_variant_id',
      'default_uom',
      'track_lot',
      'track_serial',
      'track_expiration',
      'default_strategy',
      'reorder_point',
      'safety_stock',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      defaultStrategy: 'default_strategy',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.catalogProductId) filters.catalog_product_id = { $eq: query.catalogProductId }
      if (query.catalogVariantId) filters.catalog_variant_id = { $eq: query.catalogVariantId }
      if (query.defaultStrategy) filters.default_strategy = { $eq: query.defaultStrategy }
      const trackLot = parseBooleanToken(query.trackLot)
      const trackSerial = parseBooleanToken(query.trackSerial)
      const trackExpiration = parseBooleanToken(query.trackExpiration)
      if (trackLot !== null) filters.track_lot = { $eq: trackLot }
      if (trackSerial !== null) filters.track_serial = { $eq: trackSerial }
      if (trackExpiration !== null) filters.track_expiration = { $eq: trackExpiration }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        filters.id = {
          $in: query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
        }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'wms.inventoryProfiles.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productInventoryProfileCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.profileId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'wms.inventoryProfiles.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productInventoryProfileUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'wms.inventoryProfiles.delete',
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

const profileListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  catalog_product_id: z.string().uuid().nullable().optional(),
  catalog_variant_id: z.string().uuid().nullable().optional(),
  default_uom: z.string().nullable().optional(),
  track_lot: z.boolean().nullable().optional(),
  track_serial: z.boolean().nullable().optional(),
  track_expiration: z.boolean().nullable().optional(),
  default_strategy: z.string().nullable().optional(),
  reorder_point: z.union([z.string(), z.number()]).nullable().optional(),
  safety_stock: z.union([z.string(), z.number()]).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'Inventory profile',
  pluralName: 'Inventory profiles',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(profileListItemSchema),
  create: {
    schema: productInventoryProfileCreateSchema,
    description: 'Creates a product inventory profile.',
  },
  update: {
    schema: productInventoryProfileUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an inventory profile by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an inventory profile by id.',
  },
})
