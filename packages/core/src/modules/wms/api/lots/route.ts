import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { InventoryLot } from '../../data/entities'
import { inventoryLotCreateSchema, inventoryLotUpdateSchema } from '../../data/validators'
import { buildExpiryWindowDateFilter, type ExpiryWindow } from '../../lib/expiry'
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
  expiryWindow: z.enum(['expiringSoon', 'pastDue']).optional(),
  warehouseId: z.string().uuid().optional(),
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
      'metadata',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      lotNumber: 'lot_number',
      sku: 'sku',
      status: 'status',
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.catalogVariantId) filters.catalog_variant_id = { $eq: query.catalogVariantId }
      if (query.status) filters.status = { $eq: query.status }
      if (query.expiryWindow) {
        Object.assign(filters, buildExpiryWindowDateFilter(query.expiryWindow as ExpiryWindow))
      }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        filters.id = {
          $in: query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
        }
      }
      const requiresAvailableStock =
        Boolean(query.warehouseId) || query.expiryWindow === 'pastDue'
      if (requiresAvailableStock) {
        const organizationId = ctx.selectedOrganizationId
        const tenantId = ctx.auth?.tenantId
        if (organizationId && tenantId) {
          const em = ctx.container.resolve('em') as EntityManager
          const balanceParams: unknown[] = [organizationId, tenantId]
          let balanceSql = `
            select distinct lot_id
            from wms_inventory_balances
            where organization_id = ?
              and tenant_id = ?
              and deleted_at is null
              and lot_id is not null
              and (
                coalesce(quantity_on_hand, 0)
                - coalesce(quantity_reserved, 0)
                - coalesce(quantity_allocated, 0)
              ) > 0`
          if (query.warehouseId) {
            balanceSql += ' and warehouse_id = ?'
            balanceParams.push(query.warehouseId)
          }
          const rows = await em.getConnection().execute<Array<{ lot_id: string }>>(
            balanceSql,
            balanceParams,
          )
          const lotIds = rows.map((row) => row.lot_id).filter((value) => value.length > 0)
          filters.id = {
            $in: lotIds.length > 0 ? lotIds : ['00000000-0000-4000-8000-000000000000'],
          }
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
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
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
