import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { InventoryBalance } from '../../../data/entities'
import { E } from '#generated/entities.ids.generated'
import {
  createWmsCrudOpenApi,
  createPagedListResponseSchema,
} from '../../../lib/openapi'

const WMS_BALANCE_ENTITY_ID = (E as { wms?: { inventory_balance: string } }).wms?.inventory_balance ?? 'wms:inventory_balance'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
}

export const metadata = routeMetadata

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    warehouseId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    catalogVariantId: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: InventoryBalance,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: WMS_BALANCE_ENTITY_ID,
    fields: [
      'id',
      'tenantId',
      'organizationId',
      'warehouseId',
      'locationId',
      'catalogVariantId',
      'lotId',
      'serialNumber',
      'quantityOnHand',
      'quantityReserved',
      'quantityAllocated',
      'createdAt',
      'updatedAt',
    ],
    sortFieldMap: {
      quantityOnHand: 'quantityOnHand',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    buildFilters: (query) => {
      const filters: Record<string, unknown> = {}
      if (query.warehouseId) filters.warehouseId = query.warehouseId
      if (query.locationId) filters.locationId = query.locationId
      if (query.catalogVariantId) filters.catalogVariantId = query.catalogVariantId
      if (query.lotId) filters.lotId = query.lotId
      if (typeof query.search === 'string' && query.search.trim()) {
        const like = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { catalogVariantId: { $ilike: like } },
          { serialNumber: { $ilike: like } },
        ]
      }
      return filters
    },
  },
})

export const GET = crud.GET

const balanceListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  catalogVariantId: z.string().uuid().nullable().optional(),
  lotId: z.string().uuid().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  quantityOnHand: z.number().nullable().optional(),
  quantityReserved: z.number().nullable().optional(),
  quantityAllocated: z.number().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'InventoryBalance',
  pluralName: 'Inventory Balances',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(balanceListItemSchema),
})
