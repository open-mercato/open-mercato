import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

/**
 * Shared primitives (spec § Data Models / API Contracts).
 */
const uomSchema = z
  .string()
  .trim()
  .min(1, 'UoM code is required')
  .max(20, 'UoM code is too long')
  .regex(/^[A-Za-z0-9_]+$/, 'UoM code must be an alphanumeric/underscore canonical unit code')

const positiveQtySchema = z.coerce.number().positive('Quantity must be greater than zero')
const nonNegativeNumberSchema = z.coerce.number().min(0, 'Value must be zero or greater')
const technologyStatusSchema = z.enum(['draft', 'active', 'archived'])

const listBaseSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  id: z.string().uuid().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
}

// ---------------------------------------------------------------------------
// Work centers
// ---------------------------------------------------------------------------

export const workCenterCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  kind: z.enum(['machine', 'manual', 'line', 'subcontractor']),
  costRatePerHour: nonNegativeNumberSchema,
  parallelStations: z.coerce.number().int().min(1).default(1),
  efficiencyFactor: z.coerce.number().positive('Efficiency factor must be greater than zero').default(1),
  availabilityRuleSetId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
})

export const workCenterUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(['machine', 'manual', 'line', 'subcontractor']).optional(),
  costRatePerHour: nonNegativeNumberSchema.optional(),
  parallelStations: z.coerce.number().int().min(1).optional(),
  efficiencyFactor: z.coerce.number().positive().optional(),
  availabilityRuleSetId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const workCenterDeleteSchema = z.object({ id: z.string().uuid() })

export const workCenterListQuerySchema = z.object({
  ...listBaseSchema,
  kind: z.enum(['machine', 'manual', 'line', 'subcontractor']).optional(),
  isActive: z
    .string()
    .optional()
    .transform((val) => (val === undefined ? undefined : parseBooleanToken(val) ?? undefined)),
})

// ---------------------------------------------------------------------------
// BOM items (nested payload, part of the BOM aggregate)
// ---------------------------------------------------------------------------

export const bomItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  componentProductId: z.string().uuid('componentProductId is required'),
  componentVariantId: z.string().uuid().optional().nullable(),
  qtyPerUnit: positiveQtySchema,
  uom: uomSchema,
  scrapFactor: nonNegativeNumberSchema.default(0),
  isPhantom: z.boolean().default(false),
  operationSequence: z.coerce.number().int().min(1).optional().nullable(),
})

// ---------------------------------------------------------------------------
// BOMs
// ---------------------------------------------------------------------------

export const bomCreateSchema = z.object({
  productId: z.string().uuid('productId is required'),
  variantId: z.string().uuid().optional().nullable(),
  version: z.coerce.number().int().min(1).optional(),
  status: technologyStatusSchema.default('draft'),
  validFrom: z.coerce.date().optional().nullable(),
  validTo: z.coerce.date().optional().nullable(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  items: z.array(bomItemInputSchema).default([]),
})

export const bomUpdateSchema = z.object({
  id: z.string().uuid(),
  status: technologyStatusSchema.optional(),
  validFrom: z.coerce.date().optional().nullable(),
  validTo: z.coerce.date().optional().nullable(),
  name: z.string().trim().min(1).max(200).optional(),
  items: z.array(bomItemInputSchema).optional(),
})

export const bomDeleteSchema = z.object({ id: z.string().uuid() })
export const bomCopyVersionSchema = z.object({ id: z.string().uuid() })
export const bomActivateSchema = z.object({ id: z.string().uuid() })

export const bomListQuerySchema = z.object({
  ...listBaseSchema,
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  status: technologyStatusSchema.optional(),
})

// ---------------------------------------------------------------------------
// Routing operations (nested payload, part of the routing aggregate)
// ---------------------------------------------------------------------------

export const routingOperationInputSchema = z.object({
  id: z.string().uuid().optional(),
  sequence: z.coerce.number().int().min(1, 'sequence must be at least 1'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  workCenterId: z.string().uuid('workCenterId is required'),
  setupTimeMinutes: nonNegativeNumberSchema.default(0),
  runTimePerUnitSeconds: nonNegativeNumberSchema.default(0),
  isReportingPoint: z.boolean().default(false),
})

// ---------------------------------------------------------------------------
// Routings
// ---------------------------------------------------------------------------

export const routingCreateSchema = z.object({
  productId: z.string().uuid('productId is required'),
  variantId: z.string().uuid().optional().nullable(),
  version: z.coerce.number().int().min(1).optional(),
  status: technologyStatusSchema.default('draft'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  operations: z.array(routingOperationInputSchema).default([]),
})

export const routingUpdateSchema = z.object({
  id: z.string().uuid(),
  status: technologyStatusSchema.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  operations: z.array(routingOperationInputSchema).optional(),
})

export const routingDeleteSchema = z.object({ id: z.string().uuid() })
export const routingCopyVersionSchema = z.object({ id: z.string().uuid() })
export const routingActivateSchema = z.object({ id: z.string().uuid() })

export const routingListQuerySchema = z.object({
  ...listBaseSchema,
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  status: technologyStatusSchema.optional(),
})

// ---------------------------------------------------------------------------
// Planning params
// ---------------------------------------------------------------------------

export const planningParamsCreateSchema = z.object({
  productId: z.string().uuid('productId is required'),
  variantId: z.string().uuid().optional().nullable(),
  procurement: z.enum(['make', 'buy']),
  leadTimeDays: z.coerce.number().int().min(0).default(0),
  minLot: nonNegativeNumberSchema.default(0),
  lotMultiple: nonNegativeNumberSchema.default(0),
  safetyStock: nonNegativeNumberSchema.default(0),
  backflush: z.boolean().default(true),
})

export const planningParamsUpdateSchema = z.object({
  id: z.string().uuid(),
  procurement: z.enum(['make', 'buy']).optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  minLot: nonNegativeNumberSchema.optional(),
  lotMultiple: nonNegativeNumberSchema.optional(),
  safetyStock: nonNegativeNumberSchema.optional(),
  backflush: z.boolean().optional(),
})

export const planningParamsDeleteSchema = z.object({ id: z.string().uuid() })

export const planningParamsListQuerySchema = z.object({
  ...listBaseSchema,
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  procurement: z.enum(['make', 'buy']).optional(),
})

// ---------------------------------------------------------------------------
// Stock ledger (Phase 2 — manual receipt, opening balance/correction, storno)
// ---------------------------------------------------------------------------

export const stockReceiveSchema = z.object({
  productId: z.string().uuid('productId is required'),
  variantId: z.string().uuid().optional().nullable(),
  qty: positiveQtySchema,
  uom: uomSchema,
  batchNumber: z.string().trim().min(1).max(100).optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  reasonEntryId: z.string().uuid().optional().nullable(),
  // Only 'manual' (the API/UI receipt route) and 'import' (the CSV import
  // route) are reachable through this schema — 'order'/'report' are Phase
  // 3/4 concerns emitted internally, not via a user-facing receive call.
  sourceType: z.enum(['manual', 'import']).default('manual'),
})

export const stockAdjustSchema = z.object({
  productId: z.string().uuid('productId is required'),
  variantId: z.string().uuid().optional().nullable(),
  // Signed: positive increases on-hand, negative decreases it (opening
  // balance load or a correction), matching StockLedgerService.adjust.
  qty: z.coerce.number().refine((value) => value !== 0, 'Adjustment quantity must not be zero'),
  uom: uomSchema,
  batchNumber: z.string().trim().min(1).max(100).optional().nullable(),
  // TODO(dictionaries): once a `production.stock.adjustment_reason` dictionary
  // exists this becomes `reasonEntryId` (uuid FK), matching `reasonEntryId` on
  // `StockMovement`. Until then this is a required free-text note that is
  // only carried in the command's audit-log context (see commands/stock.ts) —
  // it is NOT persisted on the movement row itself.
  reason: z.string().trim().min(1, 'Reason is required').max(500),
})

export const stockReverseMovementSchema = z.object({
  movementId: z.string().uuid('movementId is required'),
})

export const stockListQuerySchema = z.object({
  ...listBaseSchema,
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
})

export const stockMovementsListQuerySchema = z.object({
  ...listBaseSchema,
  productId: z.string().uuid('productId is required'),
  variantId: z.string().uuid().optional(),
})

export const stockBatchesListQuerySchema = z.object({
  productId: z.string().uuid('productId is required'),
})

/**
 * One row of the CSV stock-import file (`api/stock/import/route.ts`).
 * Column names mirror the CSV header verbatim (snake_case), matching the
 * `sync_excel` adapter convention this route mirrors.
 */
export const stockImportRowSchema = z.object({
  product_id: z.string().uuid('product_id must be a UUID'),
  variant_id: z.string().uuid().optional().nullable(),
  qty: positiveQtySchema,
  uom: uomSchema,
  batch_number: z.string().trim().min(1).max(100).optional().nullable(),
  expires_at: z.coerce.date().optional().nullable(),
})

export const STOCK_IMPORT_MAX_ROWS = 10_000

// ---------------------------------------------------------------------------
// Production orders (Phase 3)
// ---------------------------------------------------------------------------

export const orderSourceTypeSchema = z.enum(['sales_order', 'mrp', 'manual'])

export const orderCreateSchema = z.object({
  productId: z.string().uuid('productId is required'),
  variantId: z.string().uuid().optional().nullable(),
  qtyPlanned: positiveQtySchema,
  uom: uomSchema,
  dueDate: z.coerce.date().optional().nullable(),
  priority: z.coerce.number().int().min(0).default(0),
  sourceType: orderSourceTypeSchema.default('manual'),
  sourceId: z.string().uuid().optional().nullable(),
})

export const orderUpdateSchema = z.object({
  id: z.string().uuid(),
  qtyPlanned: positiveQtySchema.optional(),
  uom: uomSchema.optional(),
  dueDate: z.coerce.date().optional().nullable(),
  priority: z.coerce.number().int().min(0).optional(),
})

export const orderDeleteSchema = z.object({ id: z.string().uuid() })
export const orderPlanSchema = z.object({ id: z.string().uuid() })
export const orderReleaseSchema = z.object({ id: z.string().uuid() })
export const orderCancelSchema = z.object({ id: z.string().uuid() })
export const orderCloseSchema = z.object({ id: z.string().uuid() })

export const orderStatusSchema = z.enum([
  'draft',
  'planned',
  'released',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
])

export const orderListQuerySchema = z.object({
  ...listBaseSchema,
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  // Comma-separated list of statuses (the orders list UI's multi-select
  // status filter, task 3.4) — a single value stays backward compatible
  // with the pre-existing equality filter (see `buildOrderListFilters`).
  status: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || value.split(',').every((part) => orderStatusSchema.safeParse(part.trim()).success),
      'status must be one of the allowed values',
    ),
  sourceType: orderSourceTypeSchema.optional(),
  sourceId: z.string().uuid().optional(),
})

// ---------------------------------------------------------------------------
// Shop-floor reports (Phase 4)
// ---------------------------------------------------------------------------

export const reportTypeSchema = z.enum(['partial', 'final'])

export const reportCreateSchema = z
  .object({
    orderOperationId: z.string().uuid('orderOperationId is required'),
    qtyGood: nonNegativeNumberSchema.default(0),
    qtyScrap: nonNegativeNumberSchema.default(0),
    scrapReasonEntryId: z.string().uuid().optional().nullable(),
    startedAt: z.coerce.date().optional().nullable(),
    finishedAt: z.coerce.date().optional().nullable(),
    reportType: reportTypeSchema,
  })
  .refine((value) => value.qtyGood > 0 || value.qtyScrap > 0, {
    message: 'At least one of qtyGood/qtyScrap must be greater than zero',
    path: ['qtyGood'],
  })

export const reportReverseSchema = z.object({ id: z.string().uuid() })

export const reportListQuerySchema = z.object({
  ...listBaseSchema,
  orderId: z.string().uuid().optional(),
  orderOperationId: z.string().uuid().optional(),
})

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type WorkCenterCreateInput = z.infer<typeof workCenterCreateSchema>
export type WorkCenterUpdateInput = z.infer<typeof workCenterUpdateSchema>
export type WorkCenterListQuery = z.infer<typeof workCenterListQuerySchema>

export type BomItemInputPayload = z.infer<typeof bomItemInputSchema>
export type BomCreateInput = z.infer<typeof bomCreateSchema>
export type BomUpdateInput = z.infer<typeof bomUpdateSchema>
export type BomListQuery = z.infer<typeof bomListQuerySchema>

export type RoutingOperationInputPayload = z.infer<typeof routingOperationInputSchema>
export type RoutingCreateInput = z.infer<typeof routingCreateSchema>
export type RoutingUpdateInput = z.infer<typeof routingUpdateSchema>
export type RoutingListQuery = z.infer<typeof routingListQuerySchema>

export type PlanningParamsCreateInput = z.infer<typeof planningParamsCreateSchema>
export type PlanningParamsUpdateInput = z.infer<typeof planningParamsUpdateSchema>
export type PlanningParamsListQuery = z.infer<typeof planningParamsListQuerySchema>

export type StockReceiveInput = z.infer<typeof stockReceiveSchema>
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>
export type StockReverseMovementInput = z.infer<typeof stockReverseMovementSchema>
export type StockListQuery = z.infer<typeof stockListQuerySchema>
export type StockMovementsListQuery = z.infer<typeof stockMovementsListQuerySchema>
export type StockBatchesListQuery = z.infer<typeof stockBatchesListQuerySchema>
export type StockImportRow = z.infer<typeof stockImportRowSchema>

export type OrderCreateInput = z.infer<typeof orderCreateSchema>
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>
export type OrderListQuery = z.infer<typeof orderListQuerySchema>

export type ReportCreateInput = z.infer<typeof reportCreateSchema>
export type ReportReverseInput = z.infer<typeof reportReverseSchema>
export type ReportListQuery = z.infer<typeof reportListQuerySchema>
