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
  .object({
    id: uuid(),
    // Optional status-change note merged into lot.metadata.notes by the update command.
    notes: z.string().trim().max(500).optional(),
  })
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
  reasonCode: z.string().trim().max(80).optional(),
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

/** Statuses clients may set on create/update — terminal received/closed come from receive/complete. */
const asnWritableStatusSchema = z.enum(['draft', 'in_transit'])

export const receivingLineCreateFieldsSchema = z.object({
  catalogVariantId: uuid(),
  expectedQty: positiveQuantity,
  lotNumber: z.string().trim().max(120).optional().nullable(),
  serialNumbers: z.array(z.string().trim().min(1).max(120)).optional().nullable(),
  targetStagingLocationId: uuid().optional().nullable(),
  metadata: metadataSchema,
})

export const asnCreateSchema = scopedSchema.extend({
  warehouseId: uuid(),
  vendorId: uuid().optional().nullable(),
  status: asnWritableStatusSchema.optional(),
  expectedAt: z.coerce.date(),
  referenceNumber: z.string().trim().max(120).optional().nullable(),
  /**
   * Stable external linkage key; unique per org when set (procurement goods receipt, etc.).
   * Server/system creates only — public HTTP create strips this; authenticated clients cannot set it.
   */
  sourceKey: z.string().trim().min(1).max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(receivingLineCreateFieldsSchema).optional(),
  metadata: metadataSchema,
})

/** Public ASN create body — omits `sourceKey` so clients cannot spoof procurement linkage. */
export const asnCreatePublicSchema = asnCreateSchema.omit({ sourceKey: true })

export const asnUpdateSchema = z
  .object({ id: uuid() })
  .merge(
    scopedSchema
      .extend({
        warehouseId: uuid(),
        vendorId: uuid().nullable(),
        status: asnWritableStatusSchema,
        expectedAt: z.coerce.date(),
        referenceNumber: z.string().trim().max(120).nullable(),
        notes: z.string().trim().max(2000).nullable(),
        metadata: metadataSchema,
      })
      .partial(),
  )

export const receivingLineCreateSchema = scopedSchema.extend({
  asnId: uuid(),
  catalogVariantId: uuid(),
  expectedQty: positiveQuantity,
  lotNumber: z.string().trim().max(120).optional().nullable(),
  serialNumbers: z.array(z.string().trim().min(1).max(120)).optional().nullable(),
  targetStagingLocationId: uuid().optional().nullable(),
  metadata: metadataSchema,
})

// Lifecycle fields (receivedQty / qcStatus / rejectionReason) are intentionally
// omitted — only `wms.asns.receive-line` may mutate them.
export const receivingLineUpdateSchema = z
  .object({ id: uuid() })
  .merge(
    scopedSchema
      .extend({
        catalogVariantId: uuid(),
        expectedQty: positiveQuantity,
        lotNumber: z.string().trim().max(120).nullable(),
        serialNumbers: z.array(z.string().trim().min(1).max(120)).nullable(),
        targetStagingLocationId: uuid().nullable(),
        metadata: metadataSchema,
      })
      .partial(),
  )

export const asnReceiveLineSchema = scopedSchema
  .extend({
    asnId: uuid(),
    lineId: uuid(),
    receivedQty: positiveQuantity,
    /**
     * Absolute received quantity the client intends after this attempt.
     * Required for QC-pass and QC-fail so retries after success remain
     * idempotent (applyQty=0) even if prior qty advanced. Do not derive from
     * delta alone — QC-fail still advances audit receivedQty.
     */
    targetReceivedQty: positiveQuantity.optional(),
    /** Optional client-stable attempt id; extra stabilizer alongside absolute target. */
    idempotencyKey: uuid().optional(),
    targetStagingLocationId: uuid().optional(),
    lotId: uuid().optional(),
    lotNumber: z.string().trim().max(120).optional(),
    serialNumbers: z.array(z.string().trim().min(1).max(120)).optional(),
    qcStatus: z.enum(['passed', 'failed']),
    rejectionReason: z.string().trim().max(500).optional(),
    performedBy: uuid(),
    receivedAt: z.coerce.date().optional(),
    metadata: metadataSchema,
  })
  .superRefine((value, ctx) => {
    if (value.targetReceivedQty == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetReceivedQty'],
        message: 'target_received_qty_required',
      })
    }
  })

export const asnCloseSchema = scopedSchema.extend({
  id: uuid(),
  closeWhenShort: z.boolean().optional(),
})

export const putawayTaskCreateSchema = scopedSchema.extend({
  warehouseId: uuid(),
  sourceLocationId: uuid(),
  targetLocationId: uuid().optional().nullable(),
  catalogVariantId: uuid(),
  lotId: uuid().optional().nullable(),
  quantity: positiveQuantity,
  priority: z.coerce.number().int().min(0).max(100).optional(),
  assignedTo: uuid().optional().nullable(),
  metadata: metadataSchema,
})

// Status and assignee transitions are intentionally omitted — only lifecycle
// commands (assign/start/complete/cancel) may change those fields.
export const putawayTaskUpdateSchema = z
  .object({ id: uuid() })
  .merge(
    scopedSchema
      .extend({
        warehouseId: uuid(),
        sourceLocationId: uuid(),
        targetLocationId: uuid().nullable(),
        catalogVariantId: uuid(),
        lotId: uuid().nullable(),
        quantity: positiveQuantity,
        priority: z.coerce.number().int().min(0).max(100),
        metadata: metadataSchema,
      })
      .partial(),
  )

export const putawayTaskCreateFromBalanceSchema = scopedSchema.extend({
  warehouseId: uuid(),
  sourceLocationId: uuid(),
  targetLocationId: uuid(),
  catalogVariantId: uuid(),
  lotId: uuid().optional(),
  quantity: positiveQuantity,
  priority: z.coerce.number().int().min(0).max(100).optional(),
  assignedTo: uuid().optional().nullable(),
  metadata: metadataSchema,
})

export const putawayTaskAssignSchema = scopedSchema.extend({
  id: uuid(),
  assignedTo: uuid(),
})

export const putawayTaskStartSchema = scopedSchema.extend({
  id: uuid(),
})

export const putawayTaskCompleteSchema = scopedSchema.extend({
  id: uuid(),
  confirmedQuantity: positiveQuantity,
  targetLocationId: uuid(),
  lotId: uuid().optional(),
  performedBy: uuid(),
  performedAt: z.coerce.date().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  metadata: metadataSchema,
})

export const putawayTaskCancelSchema = scopedSchema.extend({
  id: uuid(),
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
export type AsnCreateInput = z.infer<typeof asnCreateSchema>
export type AsnCreatePublicInput = z.infer<typeof asnCreatePublicSchema>
export type AsnUpdateInput = z.infer<typeof asnUpdateSchema>
export type ReceivingLineCreateInput = z.infer<typeof receivingLineCreateSchema>
export type ReceivingLineUpdateInput = z.infer<typeof receivingLineUpdateSchema>
export type AsnReceiveLineInput = z.infer<typeof asnReceiveLineSchema>
export type AsnCloseInput = z.infer<typeof asnCloseSchema>
export type PutawayTaskCreateInput = z.infer<typeof putawayTaskCreateSchema>
export type PutawayTaskUpdateInput = z.infer<typeof putawayTaskUpdateSchema>
export type PutawayTaskCreateFromBalanceInput = z.infer<typeof putawayTaskCreateFromBalanceSchema>
export type PutawayTaskAssignInput = z.infer<typeof putawayTaskAssignSchema>
export type PutawayTaskStartInput = z.infer<typeof putawayTaskStartSchema>
export type PutawayTaskCompleteInput = z.infer<typeof putawayTaskCompleteSchema>
export type PutawayTaskCancelInput = z.infer<typeof putawayTaskCancelSchema>

export const scanResolveLocationSchema = scopedSchema.extend({
  warehouseId: uuid(),
  code: z.string().trim().min(1).max(120),
})

export const scanResolveLotSchema = scopedSchema.extend({
  catalogVariantId: uuid(),
  lotNumber: z.string().trim().min(1).max(120),
})

export const scanReceiveSchema = scopedSchema
  .extend({
    asnId: uuid(),
    lineId: uuid(),
    locationCode: z.string().trim().min(1).max(120),
    lotNumber: z.string().trim().max(120).optional(),
    serialNumbers: z.array(z.string().trim().min(1).max(120)).optional(),
    receivedQty: positiveQuantity,
    /**
     * Absolute received quantity after this attempt. Required for QC-pass and
     * QC-fail so identical retries no-op (applyQty=0). Do not derive as
     * prior+delta in scan resolve — that doubles stock/audit qty on retry.
     */
    targetReceivedQty: positiveQuantity.optional(),
    /** Optional client-stable attempt id; extra stabilizer alongside absolute target. */
    idempotencyKey: uuid().optional(),
    qcStatus: z.enum(['passed', 'failed']),
    rejectionReason: z.string().trim().max(500).optional(),
    performedBy: uuid(),
    receivedAt: z.coerce.date().optional(),
    metadata: metadataSchema,
  })
  .superRefine((value, ctx) => {
    if (value.targetReceivedQty == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetReceivedQty'],
        message: 'target_received_qty_required',
      })
    }
  })

export const scanPutawaySchema = scopedSchema.extend({
  taskId: uuid(),
  targetLocationCode: z.string().trim().min(1).max(120),
  confirmedQuantity: positiveQuantity,
  lotId: uuid().optional(),
  performedBy: uuid(),
  performedAt: z.coerce.date().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  metadata: metadataSchema,
})

export type ScanResolveLocationInput = z.infer<typeof scanResolveLocationSchema>
export type ScanResolveLotInput = z.infer<typeof scanResolveLotSchema>
export type ScanReceiveInput = z.infer<typeof scanReceiveSchema>
export type ScanPutawayInput = z.infer<typeof scanPutawaySchema>

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
      referenceLabel: z.string().nullable().optional(),
      reason: z.string().nullable(),
      reasonCode: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      locationLabel: z.string(),
      performedAt: z.string(),
    }),
  ),
})

export type OperationalDashboardQueryInput = z.infer<typeof operationalDashboardQuerySchema>
export type OperationalDashboardResponse = z.infer<typeof operationalDashboardResponseSchema>
