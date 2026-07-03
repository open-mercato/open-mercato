import { z } from 'zod'

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const clearableString = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

const optionalString = (max: number) => z.string().trim().max(max).optional()
const positiveDecimal = () => z.coerce.number().positive().max(999_999_999)
const nullableDecimal = () => z.coerce.number().min(0).max(999_999_999).nullable().optional()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

export const CLAIM_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'info_requested',
  'approved',
  'awaiting_return',
  'received',
  'inspecting',
  'resolved',
  'rejected',
  'closed',
  'cancelled',
] as const

export const CLAIM_TYPES = ['warranty', 'return', 'core_return', 'vendor_recovery'] as const

export const CLAIM_DISPOSITIONS = [
  'restock',
  'repair',
  'replace',
  'credit',
  'refund',
  'field_destroy',
  'scrap',
  'return_to_vendor',
  'deny',
] as const

export const CLAIM_LINE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'received',
  'inspected',
  'resolved',
] as const

export const CLAIM_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const CLAIM_CHANNELS = ['portal', 'staff', 'api'] as const
export const CLAIM_WARRANTY_STATUSES = ['in_warranty', 'out_of_warranty', 'unknown'] as const
export const CLAIM_EVENT_KINDS = ['status_changed', 'comment', 'assignment', 'system'] as const
export const CLAIM_EVENT_VISIBILITIES = ['internal', 'customer'] as const

export type WarrantyClaimStatus = (typeof CLAIM_STATUSES)[number]
export type WarrantyClaimType = (typeof CLAIM_TYPES)[number]
export type WarrantyClaimDisposition = (typeof CLAIM_DISPOSITIONS)[number]
export type WarrantyClaimLineStatus = (typeof CLAIM_LINE_STATUSES)[number]
export type WarrantyClaimPriority = (typeof CLAIM_PRIORITIES)[number]
export type WarrantyClaimChannel = (typeof CLAIM_CHANNELS)[number]
export type WarrantyClaimWarrantyStatus = (typeof CLAIM_WARRANTY_STATUSES)[number]
export type WarrantyClaimEventKind = (typeof CLAIM_EVENT_KINDS)[number]
export type WarrantyClaimEventVisibility = (typeof CLAIM_EVENT_VISIBILITIES)[number]

export const claimStatusSchema = z.enum(CLAIM_STATUSES)
export const claimTypeSchema = z.enum(CLAIM_TYPES)
export const claimDispositionSchema = z.enum(CLAIM_DISPOSITIONS)
export const claimLineStatusSchema = z.enum(CLAIM_LINE_STATUSES)
export const claimPrioritySchema = z.enum(CLAIM_PRIORITIES)
export const claimChannelSchema = z.enum(CLAIM_CHANNELS)
export const claimWarrantyStatusSchema = z.enum(CLAIM_WARRANTY_STATUSES)
export const claimEventKindSchema = z.enum(CLAIM_EVENT_KINDS)
export const claimEventVisibilitySchema = z.enum(CLAIM_EVENT_VISIBILITIES)

export const CLAIM_INTAKE_UPDATE_FIELDS = [
  'customerId',
  'customerName',
  'orderId',
  'reasonCode',
  'priority',
  'notes',
] as const

export const CLAIM_FULFILLMENT_UPDATE_FIELDS = [
  'advanceReplacement',
  'replacementOrderId',
  'advanceShippedAt',
  'salesReturnId',
  'vendorName',
  'vendorRef',
  'resolutionSummary',
] as const

const claimLineFields = {
  lineNo: z.coerce.number().int().min(1).max(10000).optional(),
  productId: uuid().nullable().optional(),
  variantId: uuid().nullable().optional(),
  sku: clearableString(191),
  productName: clearableString(300),
  orderLineId: uuid().nullable().optional(),
  serialNumber: clearableString(191),
  lotNumber: clearableString(191),
  purchaseDate: z.coerce.date().nullable().optional(),
  warrantyMonths: z.coerce.number().int().min(0).max(600).nullable().optional(),
  warrantyExpiresAt: z.coerce.date().nullable().optional(),
  warrantyStatus: claimWarrantyStatusSchema.optional(),
  faultCode: clearableString(120),
  faultDescription: clearableString(4000),
  qtyClaimed: positiveDecimal().optional(),
  qtyApproved: nullableDecimal(),
  qtyReceived: nullableDecimal(),
  conditionOnReceipt: clearableString(1000),
  inspectionNotes: clearableString(4000),
  disposition: claimDispositionSchema.nullable().optional(),
  lineStatus: claimLineStatusSchema.optional(),
  creditAmount: nullableDecimal(),
  restockingFee: nullableDecimal(),
  coreChargeAmount: nullableDecimal(),
  coreCreditAmount: nullableDecimal(),
}

export const claimInitialLineCreateSchema = z.object(claimLineFields).strict().superRefine((line, ctx) => {
  const qtyClaimed = line.qtyClaimed ?? 1
  if (typeof line.qtyApproved === 'number' && line.qtyApproved > qtyClaimed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'qtyApproved must not exceed qtyClaimed', path: ['qtyApproved'] })
  }
  if (typeof line.qtyReceived === 'number' && line.qtyReceived > qtyClaimed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'qtyReceived must not exceed qtyClaimed', path: ['qtyReceived'] })
  }
})

export const claimCreateSchema = scopedSchema
  .extend({
    claimType: claimTypeSchema,
    channel: claimChannelSchema.optional(),
    priority: claimPrioritySchema.optional(),
    customerId: uuid().nullable().optional(),
    customerName: clearableString(300),
    vendorName: clearableString(300),
    vendorRef: clearableString(191),
    orderId: uuid().nullable().optional(),
    salesReturnId: uuid().nullable().optional(),
    replacementOrderId: uuid().nullable().optional(),
    advanceReplacement: z.boolean().optional(),
    advanceShippedAt: z.coerce.date().nullable().optional(),
    reasonCode: clearableString(120),
    rejectionReasonCode: clearableString(120),
    resolutionSummary: clearableString(4000),
    notes: clearableString(8000),
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    lines: z.array(claimInitialLineCreateSchema).max(200).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.claimType === 'vendor_recovery') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vendor recovery claims are created only via the vendor-recovery action',
        path: ['claimType'],
      })
    }
  })

const claimUpdateFields = z.object({
  customerId: uuid().nullable().optional(),
  customerName: clearableString(300),
  orderId: uuid().nullable().optional(),
  reasonCode: clearableString(120),
  priority: claimPrioritySchema.optional(),
  notes: clearableString(8000),
  advanceReplacement: z.boolean().optional(),
  replacementOrderId: uuid().nullable().optional(),
  advanceShippedAt: z.coerce.date().nullable().optional(),
  salesReturnId: uuid().nullable().optional(),
  vendorName: clearableString(300),
  vendorRef: clearableString(191),
  resolutionSummary: clearableString(4000),
})

export const claimUpdateSchema = z
  .object({ id: uuid() })
  .merge(scopedSchema.partial())
  .merge(claimUpdateFields.partial())
  .strict()

export const claimLineCreateSchema = scopedSchema
  .extend({
    claimId: uuid(),
    ...claimLineFields,
  })
  .strict()

export const claimLineUpdateSchema = z
  .object({
    id: uuid(),
    claimId: uuid().optional(),
  })
  .merge(scopedSchema.partial())
  .merge(z.object(claimLineFields).partial())
  .strict()

export const claimListQuerySchema = z
  .object({
    status: claimStatusSchema.optional(),
    claimType: claimTypeSchema.optional(),
    priority: claimPrioritySchema.optional(),
    customerId: uuid().optional(),
    orderId: uuid().optional(),
    assigneeUserId: uuid().optional(),
    ids: z
      .preprocess((value) => {
        if (typeof value === 'string') {
          return value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        }
        return value
      }, z.array(uuid()).min(1).max(10000).optional()),
    search: optionalString(300),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.enum(['slaDueAt', 'createdAt', 'updatedAt']).optional(),
    sortDirection: z.enum(['asc', 'desc']).optional(),
  })
  .strict()

export const transitionClaimInputSchema = z
  .object({
    id: uuid(),
    toStatus: claimStatusSchema,
    rejectionReasonCode: clearableString(120),
    resolutionSummary: clearableString(4000),
  })
  .strict()

export const assignClaimInputSchema = z
  .object({
    id: uuid(),
    assigneeUserId: uuid().nullable(),
  })
  .strict()

export const commentClaimInputSchema = z
  .object({
    claimId: uuid(),
    body: z.string().trim().min(1).max(8000),
    visibility: claimEventVisibilitySchema.default('internal'),
    actorCustomerId: uuid().optional(),
  })
  .strict()

export const vendorRecoveryInputSchema = z
  .object({
    claimId: uuid(),
    lineIds: z.array(uuid()).min(1).max(200),
    vendorName: z.string().trim().min(1).max(300),
    vendorRef: clearableString(191),
  })
  .strict()

const portalClaimLineInputSchema = z
  .object({
    orderLineId: uuid().nullable().optional(),
    productId: uuid().nullable().optional(),
    sku: clearableString(191),
    serialNumber: clearableString(191),
    faultCode: clearableString(120),
    faultDescription: z.string().trim().min(1).max(4000),
    qtyClaimed: positiveDecimal().optional(),
  })
  .strict()

export const portalIntakeInputSchema = z
  .object({
    orderId: uuid().nullable().optional(),
    reasonCode: z.string().trim().min(1).max(120),
    notes: clearableString(8000),
    lines: z.array(portalClaimLineInputSchema).min(1).max(200),
  })
  .strict()

export type ClaimCreateInput = z.infer<typeof claimCreateSchema>
export type ClaimUpdateInput = z.infer<typeof claimUpdateSchema>
export type ClaimInitialLineCreateInput = z.infer<typeof claimInitialLineCreateSchema>
export type ClaimLineCreateInput = z.infer<typeof claimLineCreateSchema>
export type ClaimLineUpdateInput = z.infer<typeof claimLineUpdateSchema>
export type ClaimListQueryInput = z.infer<typeof claimListQuerySchema>
export type TransitionClaimInput = z.infer<typeof transitionClaimInputSchema>
export type AssignClaimInput = z.infer<typeof assignClaimInputSchema>
export type CommentClaimInput = z.infer<typeof commentClaimInputSchema>
export type VendorRecoveryInput = z.infer<typeof vendorRecoveryInputSchema>
export type PortalIntakeInput = z.infer<typeof portalIntakeInputSchema>
