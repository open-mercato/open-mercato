import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { InventoryLot } from '../../data/entities'
import { inventoryLotCreateSchema, inventoryLotUpdateSchema } from '../../data/validators'
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
  search: z.string().optional(),
  catalogVariantId: z.string().uuid().optional(),
  status: z.enum(['available', 'hold', 'quarantine', 'expired']).optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: InventoryLot,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.wms.inventory_lot },
  list: {
    schema: listSchema,
    entityId: E.wms.inventory_lot,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'catalog_variant_id',
      'sku',
      'lot_number',
      'batch_number',
      'manufactured_at',
      'best_before_at',
      'expires_at',
      'status',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      lotNumber: 'lot_number',
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.catalogVariantId) filters.catalog_variant_id = { $eq: query.catalogVariantId }
      if (query.status) filters.status = { $eq: query.status }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        filters.id = {
          $in: query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
        }
      }
      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [
          { sku: { $ilike: like } },
          { lot_number: { $ilike: like } },
          { batch_number: { $ilike: like } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'wms.lots.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(inventoryLotCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.lotId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'wms.lots.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(inventoryLotUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'wms.lots.delete',
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

const lotListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  catalog_variant_id: z.string().uuid().nullable().optional(),
  sku: z.string().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  batch_number: z.string().nullable().optional(),
  manufactured_at: z.string().nullable().optional(),
  best_before_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'Inventory lot',
  pluralName: 'Inventory lots',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(lotListItemSchema),
  create: {
    schema: inventoryLotCreateSchema,
    description: 'Creates an inventory lot or batch record.',
  },
  update: {
    schema: inventoryLotUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an inventory lot by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an inventory lot by id.',
  },
})
