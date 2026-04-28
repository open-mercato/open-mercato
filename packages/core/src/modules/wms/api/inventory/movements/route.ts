import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { InventoryMovement } from '../../../data/entities'
import { inventoryMovementListQuerySchema } from '../../../data/validators'
import { createPagedListResponseSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
}

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: InventoryMovement,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: inventoryMovementListQuerySchema,
    entityId: E.wms.inventory_movement,
    disableListCache: true,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'warehouse_id',
      'location_from_id',
      'location_to_id',
      'catalog_variant_id',
      'lot_id',
      'serial_number',
      'quantity',
      'type',
      'reference_type',
      'reference_id',
      'performed_by',
      'performed_at',
      'received_at',
      'reason',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      performedAt: 'performed_at',
      receivedAt: 'received_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.warehouseId) filters.warehouse_id = { $eq: query.warehouseId }
      if (query.catalogVariantId) filters.catalog_variant_id = { $eq: query.catalogVariantId }
      if (query.referenceType) filters.reference_type = { $eq: query.referenceType }
      if (query.referenceId) filters.reference_id = { $eq: query.referenceId }
      if (query.type) filters.type = { $eq: query.type }
      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [
          { serial_number: { $ilike: like } },
          { reason: { $ilike: like } },
        ]
      }
      return filters
    },
  },
})

export const GET = crud.GET

const movementListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  location_from_id: z.string().uuid().nullable().optional(),
  location_to_id: z.string().uuid().nullable().optional(),
  catalog_variant_id: z.string().uuid().nullable().optional(),
  lot_id: z.string().uuid().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  quantity: z.union([z.string(), z.number()]).nullable().optional(),
  type: z.string().nullable().optional(),
  reference_type: z.string().nullable().optional(),
  reference_id: z.string().uuid().nullable().optional(),
  performed_by: z.string().uuid().nullable().optional(),
  performed_at: z.string().nullable().optional(),
  received_at: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Inventory movements',
  methods: {
    GET: {
      summary: 'List inventory movements',
      description: 'Returns paginated inventory ledger entries for the authenticated organization.',
      query: inventoryMovementListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Inventory movements collection',
          schema: createPagedListResponseSchema(movementListItemSchema),
        },
      ],
    },
  },
}
