import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { InventoryReservation } from '../../../data/entities'
import { inventoryReservationListQuerySchema } from '../../../data/validators'
import { createPagedListResponseSchema } from '../../openapi'
import {
  attachVariantLabelsToListItems,
  attachWarehouseLabelsToListItems,
} from '../../listEnrichers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
}

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: InventoryReservation,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: inventoryReservationListQuerySchema,
    entityId: E.wms.inventory_reservation,
    disableListCache: true,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'warehouse_id',
      'catalog_variant_id',
      'lot_id',
      'serial_number',
      'quantity',
      'source_type',
      'source_id',
      'expires_at',
      'status',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.warehouseId) filters.warehouse_id = { $eq: query.warehouseId }
      if (query.catalogVariantId) filters.catalog_variant_id = { $eq: query.catalogVariantId }
      if (query.sourceType) filters.source_type = { $eq: query.sourceType }
      if (query.sourceId) filters.source_id = { $eq: query.sourceId }
      if (query.status) filters.status = { $eq: query.status }
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
        attachVariantLabelsToListItems(payload, ctx),
      ])
    },
  },
})

export const GET = crud.GET

const reservationListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  warehouse_name: z.string().nullable().optional(),
  warehouse_code: z.string().nullable().optional(),
  catalog_variant_id: z.string().uuid().nullable().optional(),
  catalog_product_id: z.string().uuid().nullable().optional(),
  variant_name: z.string().nullable().optional(),
  variant_sku: z.string().nullable().optional(),
  lot_id: z.string().uuid().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  quantity: z.union([z.string(), z.number()]).nullable().optional(),
  source_type: z.string().nullable().optional(),
  source_id: z.string().uuid().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Inventory reservations',
  methods: {
    GET: {
      summary: 'List inventory reservations',
      description: 'Returns paginated inventory reservations for the authenticated organization.',
      query: inventoryReservationListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Inventory reservations collection',
          schema: createPagedListResponseSchema(reservationListItemSchema),
        },
      ],
    },
  },
}
