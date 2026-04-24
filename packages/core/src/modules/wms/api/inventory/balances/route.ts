import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { InventoryBalance } from '../../../data/entities'
import { inventoryBalanceListQuerySchema } from '../../../data/validators'
import { createPagedListResponseSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
}

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: InventoryBalance,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: inventoryBalanceListQuerySchema,
    entityId: E.wms.inventory_balance,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'warehouse_id',
      'location_id',
      'catalog_variant_id',
      'lot_id',
      'serial_number',
      'quantity_on_hand',
      'quantity_reserved',
      'quantity_allocated',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    transformItem: (item) => {
      const onHand = Number(item.quantity_on_hand ?? 0)
      const reserved = Number(item.quantity_reserved ?? 0)
      const allocated = Number(item.quantity_allocated ?? 0)
      return {
        ...item,
        quantity_available: onHand - reserved - allocated,
      }
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.warehouseId) filters.warehouse_id = { $eq: query.warehouseId }
      if (query.locationId) filters.location_id = { $eq: query.locationId }
      if (query.catalogVariantId) filters.catalog_variant_id = { $eq: query.catalogVariantId }
      if (query.lotId) filters.lot_id = { $eq: query.lotId }
      if (query.serialNumber) filters.serial_number = { $eq: query.serialNumber }
      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [{ serial_number: { $ilike: like } }]
      }
      return filters
    },
  },
})

export const GET = crud.GET

const inventoryBalanceListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  catalog_variant_id: z.string().uuid().nullable().optional(),
  lot_id: z.string().uuid().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  quantity_on_hand: z.union([z.string(), z.number()]).nullable().optional(),
  quantity_reserved: z.union([z.string(), z.number()]).nullable().optional(),
  quantity_allocated: z.union([z.string(), z.number()]).nullable().optional(),
  quantity_available: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Inventory balances',
  methods: {
    GET: {
      summary: 'List inventory balances',
      description: 'Returns paginated inventory balance buckets for the authenticated organization.',
      query: inventoryBalanceListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Inventory balances collection',
          schema: createPagedListResponseSchema(inventoryBalanceListItemSchema),
        },
      ],
    },
  },
}
