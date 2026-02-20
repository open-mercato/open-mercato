import { z } from 'zod'

export const warehouseCreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  is_active: z.boolean().optional().default(true),
  address: z.record(z.string(), z.unknown()).optional().nullable(),
  timezone: z.string().optional().nullable(),
})

export const warehouseUpdateSchema = warehouseCreateSchema.partial()

export const locationCreateSchema = z.object({
  warehouse_id: z.string().uuid(),
  code: z.string().min(1),
  type: z.enum(['zone', 'aisle', 'rack', 'bin', 'slot', 'dock', 'staging']),
  parent_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  capacity_units: z.number().optional().nullable(),
  capacity_weight: z.number().optional().nullable(),
  constraints: z.record(z.string(), z.unknown()).optional().nullable(),
})

export const locationUpdateSchema = locationCreateSchema.partial()

export const inventoryAdjustSchema = z.object({
  warehouse_id: z.string().uuid(),
  location_id: z.string().uuid(),
  catalog_variant_id: z.string().uuid(),
  lot_id: z.string().uuid().optional().nullable(),
  quantity_delta: z.number(),
  reason: z.string().min(1),
})

export const reservationCreateSchema = z.object({
  warehouse_id: z.string().uuid(),
  catalog_variant_id: z.string().uuid(),
  lot_id: z.string().uuid().optional().nullable(),
  quantity: z.number().positive(),
  source_type: z.enum(['order', 'transfer', 'manual']),
  source_id: z.string().uuid(),
  expires_at: z.coerce.date().optional().nullable(),
})

export const lotCreateSchema = z.object({
  sku: z.string().optional().nullable(),
  catalog_variant_id: z.string().uuid().optional().nullable(),
  lot_number: z.string().min(1),
  batch_number: z.string().optional().nullable(),
  manufactured_at: z.coerce.date().optional().nullable(),
  best_before_at: z.coerce.date().optional().nullable(),
  expires_at: z.coerce.date().optional().nullable(),
  status: z.enum(['available', 'hold', 'quarantine', 'expired']).optional().default('available'),
}).refine(
  (data) => {
    if (!data.expires_at || !data.best_before_at) return true
    return data.expires_at >= data.best_before_at
  },
  { message: 'expires_at must be >= best_before_at', path: ['expires_at'] }
).refine(
  (data) => {
    if (!data.best_before_at || !data.manufactured_at) return true
    return data.best_before_at >= data.manufactured_at
  },
  { message: 'best_before_at must be >= manufactured_at', path: ['best_before_at'] }
)

export const movementCreateSchema = z.object({
  warehouse_id: z.string().uuid(),
  location_from_id: z.string().uuid().optional().nullable(),
  location_to_id: z.string().uuid().optional().nullable(),
  catalog_variant_id: z.string().uuid(),
  lot_id: z.string().uuid().optional().nullable(),
  quantity: z.number(),
  type: z.enum(['receipt', 'putaway', 'pick', 'pack', 'ship', 'adjust', 'transfer', 'cycle_count']),
  reference_type: z.string().optional().nullable(),
  reference_id: z.string().uuid().optional().nullable(),
  reason: z.string().optional().nullable(),
})

export const inventoryReleaseBaseSchema = z.object({
  reservation_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  catalog_variant_id: z.string().uuid().optional(),
  source_type: z.enum(['order', 'transfer', 'manual']).optional(),
  source_id: z.string().uuid().optional(),
})

export const inventoryReleaseSchema = inventoryReleaseBaseSchema.refine(
  (data) => data.reservation_id || (data.warehouse_id && data.catalog_variant_id),
  { message: 'Either reservation_id or warehouse_id + catalog_variant_id is required' }
)

export const inventoryAllocateBaseSchema = z.object({
  reservation_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  catalog_variant_id: z.string().uuid().optional(),
  source_type: z.enum(['order', 'transfer', 'manual']).optional(),
  source_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
})

export const inventoryAllocateSchema = inventoryAllocateBaseSchema.refine(
  (data) => data.reservation_id || (data.warehouse_id && data.catalog_variant_id),
  { message: 'Either reservation_id or warehouse_id + catalog_variant_id is required' }
)

export const inventoryMoveSchema = z.object({
  warehouse_id: z.string().uuid(),
  location_from_id: z.string().uuid(),
  location_to_id: z.string().uuid(),
  catalog_variant_id: z.string().uuid(),
  lot_id: z.string().uuid().optional().nullable(),
  serial_number: z.string().optional().nullable(),
  quantity: z.number().positive(),
  reason: z.string().optional().nullable(),
})

export const cycleCountSchema = z.object({
  warehouse_id: z.string().uuid(),
  location_id: z.string().uuid(),
  catalog_variant_id: z.string().uuid(),
  lot_id: z.string().uuid().optional().nullable(),
  serial_number: z.string().optional().nullable(),
  counted_quantity: z.number().min(0),
  reason: z.string().min(1),
})
