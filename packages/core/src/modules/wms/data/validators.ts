import { z } from 'zod'

const uuid = () => z.string().uuid()
const numericQuantity = z.coerce.number().finite()
const positiveQuantity = numericQuantity.gt(0)
const nonNegativeQuantity = numericQuantity.min(0)

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const warehouseLocationTypeSchema = z.enum(['zone', 'aisle', 'rack', 'bin', 'slot', 'dock', 'staging'])
const inventoryStrategySchema = z.enum(['fifo', 'lifo', 'fefo'])
const inventoryLotStatusSchema = z.enum(['available', 'hold', 'quarantine', 'expired'])
const inventoryReservationSourceTypeSchema = z.enum(['order', 'transfer', 'manual'])
const inventoryReservationStatusSchema = z.enum(['active', 'released', 'fulfilled'])
const inventoryMovementTypeSchema = z.enum([
  'receipt',
  'putaway',
  'pick',
  'pack',
  'ship',
  'adjust',
  'transfer',
  'cycle_count',
  'return_receive',
])
const inventoryMovementReferenceTypeSchema = z.enum(['po', 'so', 'transfer', 'manual', 'qc', 'rma'])

const metadataSchema = z.record(z.string(), z.unknown()).optional()

const enforcePrimaryRequiresActiveWarehouse = (
  payload: { isActive?: boolean; isPrimary?: boolean },
  ctx: z.RefinementCtx,
) => {
  if (payload.isPrimary === true && payload.isActive === false) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['isPrimary'],
      message: 'Inactive warehouses cannot be marked as primary.',
    })
  }
}

const warehouseFieldsSchema = scopedSchema.extend({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(80),
  isActive: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  addressLine1: z.string().trim().max(255).optional(),
  city: z.string().trim().max(150).optional(),
  postalCode: z.string().trim().max(40).optional(),
  country: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(120).optional(),
  metadata: metadataSchema,
})

export const warehouseCreateSchema = warehouseFieldsSchema.superRefine(enforcePrimaryRequiresActiveWarehouse)

export const warehouseUpdateSchema = z
  .object({ id: uuid() })
  .merge(warehouseFieldsSchema.partial())
  .superRefine(enforcePrimaryRequiresActiveWarehouse)

export const warehouseZoneCreateSchema = scopedSchema.extend({
  warehouseId: uuid(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  priority: z.coerce.number().int().min(0).optional(),
  metadata: metadataSchema,
})

export const warehouseZoneUpdateSchema = z.object({ id: uuid() }).merge(warehouseZoneCreateSchema.partial())

export const warehouseLocationCreateSchema = scopedSchema.extend({
  warehouseId: uuid(),
  code: z.string().trim().min(1).max(120),
  type: warehouseLocationTypeSchema,
  parentId: uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  capacityUnits: nonNegativeQuantity.optional(),
  capacityWeight: nonNegativeQuantity.optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
  metadata: metadataSchema,
})

export const warehouseLocationUpdateSchema = z.object({ id: uuid() }).merge(warehouseLocationCreateSchema.partial())

const productInventoryProfileBaseSchema = scopedSchema.extend({
  catalogProductId: uuid(),
  catalogVariantId: uuid().nullable().optional(),
  defaultUom: z.string().trim().min(1).max(32),
  trackLot: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  trackExpiration: z.boolean().optional(),
  defaultStrategy: inventoryStrategySchema,
  reorderPoint: nonNegativeQuantity.optional(),
  safetyStock: nonNegativeQuantity.optional(),
  metadata: metadataSchema,
})

const enforceFefoWhenExpirationTracked = (
  payload: { trackExpiration?: boolean; defaultStrategy?: 'fifo' | 'lifo' | 'fefo' },
  ctx: z.RefinementCtx,
) => {
  if (
    payload.trackExpiration === true &&
    payload.defaultStrategy !== undefined &&
    payload.defaultStrategy !== 'fefo'
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultStrategy'],
      message: 'FEFO is required when expiration tracking is enabled.',
    })
  }
}

export const productInventoryProfileCreateSchema =
  productInventoryProfileBaseSchema.superRefine(enforceFefoWhenExpirationTracked)

export const productInventoryProfileUpdateSchema = z
  .object({ id: uuid() })
  .merge(productInventoryProfileBaseSchema.partial())
  .superRefine(enforceFefoWhenExpirationTracked)

const inventoryLotBaseSchema = scopedSchema.extend({
  catalogVariantId: uuid(),
  sku: z.string().trim().min(1).max(120),
  lotNumber: z.string().trim().min(1).max(120),
  batchNumber: z.string().trim().max(120).optional(),
  manufacturedAt: z.coerce.date().optional(),
  bestBeforeAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  status: inventoryLotStatusSchema.optional(),
  metadata: metadataSchema,
})

const enforceLotDateOrdering = (
  payload: { manufacturedAt?: Date; bestBeforeAt?: Date; expiresAt?: Date },
  ctx: z.RefinementCtx,
) => {
  if (payload.manufacturedAt && payload.bestBeforeAt && payload.bestBeforeAt < payload.manufacturedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bestBeforeAt'],
      message: 'Best-before date must be on or after manufactured date.',
    })
  }
  if (payload.bestBeforeAt && payload.expiresAt && payload.expiresAt < payload.bestBeforeAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiresAt'],
      message: 'Expiration date must be on or after best-before date.',
    })
  }
  if (payload.manufacturedAt && payload.expiresAt && payload.expiresAt < payload.manufacturedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiresAt'],
      message: 'Expiration date must be on or after manufactured date.',
    })
  }
}

export const inventoryLotCreateSchema = inventoryLotBaseSchema.superRefine(enforceLotDateOrdering)

export const inventoryLotUpdateSchema = z
  .object({ id: uuid() })
  .merge(inventoryLotBaseSchema.partial())
  .superRefine(enforceLotDateOrdering)

const inventoryLowStockFilterSchema = z.enum(['belowReorder', 'belowSafety'])

export const inventoryBalanceListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  warehouseId: uuid().optional(),
  locationId: uuid().optional(),
  catalogVariantId: uuid().optional(),
  lotId: uuid().optional(),
  serialNumber: z.string().trim().max(120).optional(),
  lowStock: inventoryLowStockFilterSchema.optional(),
  search: z.string().optional(),
}).passthrough()

export const inventoryMovementListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  warehouseId: uuid().optional(),
  locationId: uuid().optional(),
  catalogVariantId: uuid().optional(),
  lotId: uuid().optional(),
  referenceType: inventoryMovementReferenceTypeSchema.optional(),
  referenceId: uuid().optional(),
  type: inventoryMovementTypeSchema.optional(),
  search: z.string().optional(),
}).passthrough()

export const inventoryReservationListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  warehouseId: uuid().optional(),
  catalogVariantId: uuid().optional(),
  lotId: uuid().optional(),
  sourceType: inventoryReservationSourceTypeSchema.optional(),
  sourceId: uuid().optional(),
  status: inventoryReservationStatusSchema.optional(),
  search: z.string().optional(),
}).passthrough()

export const inventoryReceiveSchema = scopedSchema.extend({
  warehouseId: uuid(),
  locationId: uuid(),
  catalogVariantId: uuid(),
  lotId: uuid().optional(),
  lotNumber: z.string().trim().max(120).optional(),
  serialNumber: z.string().trim().max(120).optional(),
  quantity: positiveQuantity,
  referenceType: inventoryMovementReferenceTypeSchema,
  referenceId: uuid(),
  performedBy: uuid(),
  receivedAt: z.coerce.date().optional(),
  performedAt: z.coerce.date().optional(),
  reason: z.string().trim().max(500).optional(),
  metadata: metadataSchema,
})

export const inventoryReservationCreateSchema = scopedSchema.extend({
  warehouseId: uuid(),
  catalogVariantId: uuid(),
  lotId: uuid().optional(),
  serialNumber: z.string().trim().max(120).optional(),
  quantity: positiveQuantity,
  sourceType: inventoryReservationSourceTypeSchema,
  sourceId: uuid(),
  expiresAt: z.coerce.date().optional(),
  strategy: inventoryStrategySchema.optional(),
  metadata: metadataSchema,
})

export const inventoryReservationReleaseSchema = scopedSchema.extend({
  reservationId: uuid(),
  reason: z.string().trim().min(1).max(120),
  reasonCode: z.string().trim().max(80).optional(),
  metadata: metadataSchema,
})

export const inventoryReservationAllocateSchema = scopedSchema.extend({
  reservationId: uuid(),
  metadata: metadataSchema,
})

export const inventoryAdjustSchema = scopedSchema.extend({
  warehouseId: uuid(),
  locationId: uuid(),
  catalogVariantId: uuid(),
  lotId: uuid().optional(),
  serialNumber: z.string().trim().max(120).optional(),
  delta: numericQuantity.refine((value) => value !== 0, {
    message: 'Inventory delta must be non-zero.',
  }),
  reason: z.string().trim().min(1).max(500),
  reasonCode: z.string().trim().max(80).optional(),
  referenceType: inventoryMovementReferenceTypeSchema.default('manual'),
  referenceId: uuid(),
  performedBy: uuid(),
  performedAt: z.coerce.date().optional(),
  metadata: metadataSchema,
})

export const inventoryMoveSchema = scopedSchema.extend({
  warehouseId: uuid(),
  fromLocationId: uuid(),
  toLocationId: uuid(),
  catalogVariantId: uuid(),
  lotId: uuid().optional(),
  serialNumber: z.string().trim().max(120).optional(),
  quantity: positiveQuantity,
  type: inventoryMovementTypeSchema.optional(),
  reason: z.string().trim().min(1).max(500),
  reasonCode: z.string().trim().max(80).optional(),
  referenceType: inventoryMovementReferenceTypeSchema.default('manual'),
  referenceId: uuid(),
  performedBy: uuid(),
  performedAt: z.coerce.date().optional(),
  metadata: metadataSchema,
})

export const inventoryCycleCountSchema = scopedSchema.extend({
  warehouseId: uuid(),
  locationId: uuid(),
  catalogVariantId: uuid(),
  lotId: uuid().optional(),
  serialNumber: z.string().trim().max(120).optional(),
  countedQuantity: nonNegativeQuantity,
  autoAdjust: z.boolean().default(true),
  reason: z.string().trim().min(1).max(500),
  referenceId: uuid(),
  performedBy: uuid(),
  performedAt: z.coerce.date().optional(),
  metadata: metadataSchema,
})

export const inventoryMovementCreateSchema = scopedSchema.extend({
  warehouseId: uuid(),
  locationFromId: uuid().optional(),
  locationToId: uuid().optional(),
  catalogVariantId: uuid(),
  lotId: uuid().optional(),
  serialNumber: z.string().trim().max(120).optional(),
  quantity: positiveQuantity,
  type: inventoryMovementTypeSchema,
  referenceType: inventoryMovementReferenceTypeSchema,
  referenceId: uuid(),
  performedBy: uuid(),
  performedAt: z.coerce.date(),
  receivedAt: z.coerce.date(),
  reason: z.string().trim().max(500).optional(),
  metadata: metadataSchema,
})

export type WarehouseCreateInput = z.infer<typeof warehouseCreateSchema>
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>
export type WarehouseZoneCreateInput = z.infer<typeof warehouseZoneCreateSchema>
export type WarehouseZoneUpdateInput = z.infer<typeof warehouseZoneUpdateSchema>
export type WarehouseLocationCreateInput = z.infer<typeof warehouseLocationCreateSchema>
export type WarehouseLocationUpdateInput = z.infer<typeof warehouseLocationUpdateSchema>
export type ProductInventoryProfileCreateInput = z.infer<typeof productInventoryProfileCreateSchema>
export type ProductInventoryProfileUpdateInput = z.infer<typeof productInventoryProfileUpdateSchema>
export type InventoryLotCreateInput = z.infer<typeof inventoryLotCreateSchema>
export type InventoryLotUpdateInput = z.infer<typeof inventoryLotUpdateSchema>
export type InventoryReceiveInput = z.infer<typeof inventoryReceiveSchema>
export type InventoryReservationCreateInput = z.infer<typeof inventoryReservationCreateSchema>
export type InventoryReservationReleaseInput = z.infer<typeof inventoryReservationReleaseSchema>
export type InventoryReservationAllocateInput = z.infer<typeof inventoryReservationAllocateSchema>
export type InventoryAdjustInput = z.infer<typeof inventoryAdjustSchema>
export type InventoryMoveInput = z.infer<typeof inventoryMoveSchema>
export type InventoryCycleCountInput = z.infer<typeof inventoryCycleCountSchema>

export const salesOrderWarehouseAssignBodySchema = scopedSchema.extend({
  warehouseId: uuid(),
  notes: z.string().trim().max(500).optional(),
  metadata: metadataSchema,
})

export const salesOrderWarehouseAssignSchema = salesOrderWarehouseAssignBodySchema.extend({
  salesOrderId: uuid(),
})

export const salesOrderWarehouseUnassignSchema = scopedSchema.extend({
  salesOrderId: uuid(),
  metadata: metadataSchema,
})

export type SalesOrderWarehouseAssignInput = z.infer<typeof salesOrderWarehouseAssignSchema>
export type SalesOrderWarehouseUnassignInput = z.infer<typeof salesOrderWarehouseUnassignSchema>

export const inventoryImportRawRowSchema = z.object({
  warehouseCode: z.string().trim().optional(),
  warehouseId: uuid().optional(),
  locationCode: z.string().trim().optional(),
  locationId: uuid().optional(),
  sku: z.string().trim().optional(),
  catalogVariantId: uuid().optional(),
  quantity: z.string().trim().optional(),
  lotNumber: z.string().trim().optional(),
  lotId: uuid().optional(),
  serialNumber: z.string().trim().optional(),
})

export const inventoryImportModeSchema = z.enum(['additive', 'reconcile']).default('additive')

export const inventoryImportValidateSchema = scopedSchema.extend({
  importBatchId: uuid().optional(),
  skipDuplicates: z.boolean().optional(),
  mode: inventoryImportModeSchema,
  rows: z.array(inventoryImportRawRowSchema).min(1).max(5000),
})

export const inventoryImportApplyRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  warehouseId: uuid(),
  locationId: uuid(),
  catalogVariantId: uuid(),
  quantity: nonNegativeQuantity,
  delta: numericQuantity,
  lotId: uuid().optional(),
  serialNumber: z.string().trim().max(120).optional(),
})

export const inventoryImportApplySchema = scopedSchema.extend({
  importBatchId: uuid(),
  reason: z.string().trim().min(1).max(500).default('CSV import inventory receipt'),
  continueOnError: z.boolean().optional(),
  mode: inventoryImportModeSchema,
  rows: z.array(inventoryImportApplyRowSchema).min(1).max(5000),
})

export type InventoryImportApplyServerInput = z.infer<typeof inventoryImportApplySchema> & {
  performedBy: string
}

export type InventoryImportMode = z.infer<typeof inventoryImportModeSchema>
export type InventoryImportValidateInput = z.infer<typeof inventoryImportValidateSchema>
export type InventoryImportApplyInput = InventoryImportApplyServerInput
export type InventoryImportApplyRowInput = z.infer<typeof inventoryImportApplyRowSchema>

export const operationalDashboardQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
})

export const operationalDashboardKpiSchema = z.object({
  id: z.enum(['lowStock', 'reorderCritical', 'expiringSoon', 'pastDue', 'agingReservations', 'todaysMoves']),
  count: z.number(),
  deltaSinceYesterday: z.number().nullable(),
  sparkline: z.array(z.number()),
})

export const operationalDashboardExpiryLotSchema = z.object({
  id: z.string().uuid(),
  lotNumber: z.string(),
  sku: z.string(),
  expiresAt: z.string(),
  availableQuantity: z.number(),
  category: z.enum(['expiringSoon', 'pastDue']),
})

export const operationalDashboardResponseSchema = z.object({
  lastUpdatedAt: z.string(),
  warehouseId: z.string().uuid().nullable(),
  kpis: z.array(operationalDashboardKpiSchema),
  expiryLots: z.array(operationalDashboardExpiryLotSchema),
  monthlyTrends: z.array(
    z.object({
      month: z.string(),
      receive: z.number(),
      allocate: z.number(),
    }),
  ),
  recentActivity: z.array(
    z.object({
      id: z.string().uuid(),
      movementType: z.string(),
      quantity: z.number(),
      variantSku: z.string().nullable(),
      variantId: z.string().uuid(),
      referenceType: z.string().nullable(),
      referenceId: z.string().nullable(),
      reason: z.string().nullable(),
      locationLabel: z.string(),
      performedAt: z.string(),
    }),
  ),
})

export type OperationalDashboardQueryInput = z.infer<typeof operationalDashboardQuerySchema>
export type OperationalDashboardResponse = z.infer<typeof operationalDashboardResponseSchema>
