import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { InventoryBalance } from '../../../data/entities'
import { inventoryBalanceListQuerySchema } from '../../../data/validators'
import {
  formatLowStockVariantIdsForFilter,
  resolveLowStockVariantIds,
} from '../../../lib/lowStockBalanceFilter'
import { createPagedListResponseSchema } from '../../openapi'
import {
  attachLocationLabelsToListItems,
  attachVariantLabelsToListItems,
  attachWarehouseLabelsToListItems,
} from '../../listEnrichers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
}

export function transformInventoryBalanceListItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const onHand = Number(item.quantity_on_hand ?? 0)
  const reserved = Number(item.quantity_reserved ?? 0)
  const allocated = Number(item.quantity_allocated ?? 0)
  const rawAvailable = item.quantity_available
  return {
    ...item,
    quantity_available: rawAvailable != null ? Number(rawAvailable) : onHand - reserved - allocated,
  }
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
  indexer: { entityType: E.wms.inventory_balance },
  list: {
    schema: inventoryBalanceListQuerySchema,
    entityId: E.wms.inventory_balance,
    disableListCache: true,
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
      'quantity_available',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      catalogVariantId: 'catalog_variant_id',
      warehouseId: 'warehouse_id',
      locationId: 'location_id',
      quantityOnHand: 'quantity_on_hand',
      quantityReserved: 'quantity_reserved',
      quantityAllocated: 'quantity_allocated',
      quantityAvailable: 'quantity_available',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    transformItem: transformInventoryBalanceListItem,
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.warehouseId) filters.warehouse_id = { $eq: query.warehouseId }
      if (query.locationId) filters.location_id = { $eq: query.locationId }
      if (query.lotId) filters.lot_id = { $eq: query.lotId }
      if (query.serialNumber) filters.serial_number = { $eq: query.serialNumber }

      let lowStockVariantIds: string[] | null = null
      if (query.lowStock === 'belowReorder' || query.lowStock === 'belowSafety') {
        const organizationId = ctx.selectedOrganizationId
        const tenantId = ctx.auth?.tenantId
        if (organizationId && tenantId) {
          const em = ctx.container.resolve('em') as EntityManager
          lowStockVariantIds = await resolveLowStockVariantIds(
            em,
            {
              organizationId,
              tenantId,
              warehouseId: query.warehouseId ?? null,
            },
            query.lowStock,
          )
        }
      }

      if (query.catalogVariantId) {
        if (lowStockVariantIds && !lowStockVariantIds.includes(query.catalogVariantId)) {
          filters.catalog_variant_id = { $in: ['00000000-0000-4000-8000-000000000000'] }
        } else {
          filters.catalog_variant_id = { $eq: query.catalogVariantId }
        }
      } else if (lowStockVariantIds) {
        filters.catalog_variant_id = {
          $in: formatLowStockVariantIdsForFilter(lowStockVariantIds),
        }
      }

      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [{ serial_number: { $ilike: like } }]
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      await Promise.all([
        attachWarehouseLabelsToListItems(payload, ctx),
        attachLocationLabelsToListItems(payload, ctx),
        attachVariantLabelsToListItems(payload, ctx),
      ])
    },
  },
})

export const GET = crud.GET

const inventoryBalanceListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  warehouse_name: z.string().nullable().optional(),
  warehouse_code: z.string().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  location_code: z.string().nullable().optional(),
  location_type: z.string().nullable().optional(),
  catalog_variant_id: z.string().uuid().nullable().optional(),
  catalog_product_id: z.string().uuid().nullable().optional(),
  variant_name: z.string().nullable().optional(),
  variant_sku: z.string().nullable().optional(),
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
