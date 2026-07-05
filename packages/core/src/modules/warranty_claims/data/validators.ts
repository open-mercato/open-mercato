import { z } from 'zod'
import { parseGuideSteps } from '../lib/troubleshooting'

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const clearableString = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

const clearableEmail = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().email().max(max).nullable().optional())

const optionalString = (max: number) => z.string().trim().max(max).optional()
const requiredOptionalString = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().min(1).max(max).optional())
const positiveDecimal = () => z.coerce.number().positive().max(999_999_999)
const nullableDecimal = () => z.coerce.number().min(0).max(999_999_999).nullable().optional()
const nullableIsoDateString = () => z.preprocess(emptyStringToNull, z.string().datetime().nullable().optional())
const jsonObjectSchema = z.record(z.string(), z.unknown())
const optimisticLockTokenSchema = z.union([z.string().datetime(), z.date()]).nullable().optional()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const hasOwn = (input: object, key: string): boolean => Object.prototype.hasOwnProperty.call(input, key)

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
export const CLAIM_CONDITION_GRADES = ['A', 'B', 'C', 'D'] as const
export const CLAIM_QUARANTINE_STATUSES = ['none', 'held', 'released'] as const
export const REGISTRATION_COVERAGE_TYPES = ['standard', 'extended', 'none'] as const
export const REGISTRATION_SOURCES = ['order', 'manual', 'third_party'] as const

export type WarrantyClaimStatus = (typeof CLAIM_STATUSES)[number]
export type WarrantyClaimType = (typeof CLAIM_TYPES)[number]
export type WarrantyClaimDisposition = (typeof CLAIM_DISPOSITIONS)[number]
export type WarrantyClaimLineStatus = (typeof CLAIM_LINE_STATUSES)[number]
export type WarrantyClaimPriority = (typeof CLAIM_PRIORITIES)[number]
export type WarrantyClaimChannel = (typeof CLAIM_CHANNELS)[number]
export type WarrantyClaimWarrantyStatus = (typeof CLAIM_WARRANTY_STATUSES)[number]
export type WarrantyClaimEventKind = (typeof CLAIM_EVENT_KINDS)[number]
export type WarrantyClaimEventVisibility = (typeof CLAIM_EVENT_VISIBILITIES)[number]
export type WarrantyClaimConditionGrade = (typeof CLAIM_CONDITION_GRADES)[number]
export type WarrantyClaimQuarantineStatus = (typeof CLAIM_QUARANTINE_STATUSES)[number]
export type WarrantyClaimRegistrationCoverageType = (typeof REGISTRATION_COVERAGE_TYPES)[number]
export type WarrantyClaimRegistrationSource = (typeof REGISTRATION_SOURCES)[number]

export const claimStatusSchema = z.enum(CLAIM_STATUSES)
export const claimTypeSchema = z.enum(CLAIM_TYPES)
export const claimDispositionSchema = z.enum(CLAIM_DISPOSITIONS)
export const claimLineStatusSchema = z.enum(CLAIM_LINE_STATUSES)
export const claimPrioritySchema = z.enum(CLAIM_PRIORITIES)
export const claimChannelSchema = z.enum(CLAIM_CHANNELS)
export const claimWarrantyStatusSchema = z.enum(CLAIM_WARRANTY_STATUSES)
export const claimEventKindSchema = z.enum(CLAIM_EVENT_KINDS)
export const claimEventVisibilitySchema = z.enum(CLAIM_EVENT_VISIBILITIES)
export const claimConditionGradeSchema = z.enum(CLAIM_CONDITION_GRADES)
export const claimQuarantineStatusSchema = z.enum(CLAIM_QUARANTINE_STATUSES)
export const registrationCoverageTypeSchema = z.enum(REGISTRATION_COVERAGE_TYPES)
export const registrationSourceSchema = z.enum(REGISTRATION_SOURCES)

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
  conditionGrade: claimConditionGradeSchema.nullable().optional(),
  quarantineStatus: claimQuarantineStatusSchema.optional(),
  inspectionNotes: clearableString(4000),
  assessmentPayload: jsonObjectSchema.nullable().optional(),
  disposition: claimDispositionSchema.nullable().optional(),
  creditAmount: nullableDecimal(),
  restockingFee: nullableDecimal(),
  coreChargeAmount: nullableDecimal(),
  coreCreditAmount: nullableDecimal(),
  vendorName: clearableString(300),
}

const settingsCurrencyCodeSchema = z.preprocess(
  emptyStringToNull,
  z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable().optional(),
)

const settingsAmountSchema = z.preprocess(
  emptyStringToNull,
  z.coerce.number().min(0).nullable().optional(),
)

export const warrantyClaimSettingsUpdateSchema = z
  .object({
    slaHours: z.coerce.number().int().min(1).max(8760).optional(),
    slaPauseOnInfoRequested: z.boolean().optional(),
    slaAtRiskThresholdPct: z.coerce.number().int().min(1).max(100).optional(),
    autoApproveEnabled: z.boolean().optional(),
    autoApproveMaxAmount: settingsAmountSchema,
    autoApproveCurrencyCode: settingsCurrencyCodeSchema,
    autoApproveRequireInWarranty: z.boolean().optional(),
    defaultWarrantyMonths: z.coerce.number().int().min(0).max(600).nullable().optional(),
    businessHours: jsonObjectSchema.nullable().optional(),
    escalationTiers: z.array(jsonObjectSchema).nullable().optional(),
    adjudicationUseRules: z.boolean().optional(),
    quarantineGrades: z.array(z.string().trim().min(1).max(20)).nullable().optional(),
    returnLabelProvider: clearableString(120),
  })
  .strict()

export const warrantyClaimSettingsSaveSchema = scopedSchema.merge(warrantyClaimSettingsUpdateSchema).strict()

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
    externalRef: clearableString(190),
    intakeMessageRef: clearableString(998),
    contactEmail: clearableString(320),
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
  .merge(z.object({
    ...claimLineFields,
    lineStatus: claimLineStatusSchema.optional(),
  }).partial())
  .strict()
  .superRefine((line, ctx) => {
    const qtyClaimed = hasOwn(line, 'qtyClaimed') && typeof line.qtyClaimed === 'number' ? line.qtyClaimed : null
    if (qtyClaimed !== null && hasOwn(line, 'qtyApproved') && typeof line.qtyApproved === 'number' && line.qtyApproved > qtyClaimed) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'qtyApproved must not exceed qtyClaimed', path: ['qtyApproved'] })
    }
    if (qtyClaimed !== null && hasOwn(line, 'qtyReceived') && typeof line.qtyReceived === 'number' && line.qtyReceived > qtyClaimed) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'qtyReceived must not exceed qtyClaimed', path: ['qtyReceived'] })
    }
  })

export const claimLineReceiveSchema = scopedSchema
  .extend({
    id: uuid(),
    conditionGrade: claimConditionGradeSchema,
    inspectionNotes: clearableString(4000),
    updatedAt: optimisticLockTokenSchema,
  })
  .strict()

export const claimLineReleaseQuarantineSchema = scopedSchema
  .extend({
    id: uuid(),
    updatedAt: optimisticLockTokenSchema,
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

export const claimSetReturnLabelSchema = scopedSchema
  .extend({
    id: uuid(),
    labelUrl: requiredOptionalString(2048),
    trackingNumber: requiredOptionalString(191),
    carrier: requiredOptionalString(120),
    updatedAt: optimisticLockTokenSchema,
  })
  .strict()
  .refine(
    (input) => Boolean(input.labelUrl || input.trackingNumber || input.carrier),
    { message: 'At least one return-label field is required' },
  )

const portalClaimLineInputSchema = z
  .object({
    orderLineId: uuid().nullable().optional(),
    productId: uuid().nullable().optional(),
    sku: clearableString(191),
    productName: clearableString(191),
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

export const externalClaimLineInputSchema = z
  .object({
    productId: uuid().nullable().optional(),
    sku: clearableString(191),
    productName: clearableString(191),
    serialNumber: clearableString(191),
    faultCode: clearableString(120),
    faultDescription: z.string().trim().min(1).max(4000),
    qtyClaimed: positiveDecimal().optional(),
    purchaseDate: z.coerce.date().nullable().optional(),
    warrantyMonths: z.coerce.number().int().min(0).max(600).nullable().optional(),
  })
  .strict()

export const externalClaimIntakeSchema = z
  .object({
    externalRef: z.string().trim().min(1).max(190),
    orderId: uuid().nullable().optional(),
    orderNumber: clearableString(120),
    customerId: uuid().nullable().optional(),
    contactName: clearableString(191),
    contactEmail: clearableString(320),
    reasonCode: clearableString(120),
    notes: clearableString(8000),
    lines: z.array(externalClaimLineInputSchema).min(1).max(200),
  })
  .strict()
  .refine(
    (value) => Boolean(value.orderId || value.orderNumber || value.customerId || value.contactEmail),
    { message: '[internal] contactEmail is required when no order or customer reference is provided', path: ['contactEmail'] },
  )

export const externalClaimLookupQuerySchema = z
  .object({
    id: uuid().optional(),
    claimNumber: z.string().trim().min(1).max(60).optional(),
    externalRef: z.string().trim().min(1).max(190).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.id || value.claimNumber || value.externalRef), {
    message: '[internal] one of id, claimNumber, externalRef is required',
  })

const registrationFields = {
  serialNumber: clearableString(191),
  productId: uuid().nullable().optional(),
  variantId: uuid().nullable().optional(),
  sku: clearableString(191),
  productName: clearableString(300),
  customerId: uuid().nullable().optional(),
  orderId: uuid().nullable().optional(),
  purchaseDate: nullableIsoDateString(),
  warrantyMonths: z.coerce.number().int().min(0).max(600).nullable().optional(),
  warrantyExpiresAt: nullableIsoDateString(),
  coverageType: registrationCoverageTypeSchema.nullable().optional(),
  source: registrationSourceSchema.nullable().optional(),
  proofAttachmentId: uuid().nullable().optional(),
  notes: clearableString(8000),
}

export const registrationCreateSchema = scopedSchema
  .extend(registrationFields)
  .strict()

export const registrationUpdateSchema = z
  .object({ id: uuid() })
  .merge(scopedSchema.partial())
  .merge(z.object(registrationFields).partial())
  .strict()

export const registrationDeleteSchema = scopedSchema
  .extend({ id: uuid() })
  .strict()

const recoveryRatePctSchema = z
  .union([
    z.number().min(0).max(100),
    z.string().trim().regex(/^\d+(\.\d{1,2})?$/).refine((value) => Number(value) <= 100),
  ])
  .nullable()
  .optional()

const vendorPolicyFields = {
  vendorRef: clearableString(191),
  coverageMonths: z.coerce.number().int().min(0).max(600).nullable().optional(),
  claimableReasonCodes: z.array(z.string().trim().min(1).max(120)).nullable().optional(),
  recoveryRatePct: recoveryRatePctSchema,
  contactEmail: clearableEmail(320),
  autoGenerateRecovery: z.boolean().optional(),
  isActive: z.boolean().optional(),
}

export const vendorPolicyCreateSchema = scopedSchema
  .extend({
    vendorName: z.string().trim().min(1).max(300),
    ...vendorPolicyFields,
  })
  .strict()

export const vendorPolicyUpdateSchema = z
  .object({ id: uuid() })
  .merge(scopedSchema.partial())
  .merge(
    z.object({
      vendorName: z.string().trim().min(1).max(300).optional(),
      ...vendorPolicyFields,
    }).partial()
  )
  .strict()

export const vendorPolicyDeleteSchema = scopedSchema
  .extend({ id: uuid() })
  .strict()

const troubleshootingStepsSchema = z.unknown().nullable().optional().superRefine((value, ctx) => {
  if (value === undefined || value === null) return
  if (parseGuideSteps(value)) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'warranty_claims.errors.invalidTroubleshootingSteps',
  })
})

const troubleshootingGuideFields = {
  claimType: claimTypeSchema.nullable().optional(),
  reasonCode: clearableString(120),
  steps: troubleshootingStepsSchema,
  isActive: z.boolean().optional(),
}

export const troubleshootingGuideCreateSchema = scopedSchema
  .extend({
    title: z.string().trim().min(1).max(300),
    ...troubleshootingGuideFields,
  })
  .strict()

export const troubleshootingGuideUpdateSchema = z
  .object({ id: uuid() })
  .merge(scopedSchema.partial())
  .merge(
    z.object({
      title: z.string().trim().min(1).max(300).optional(),
      ...troubleshootingGuideFields,
    }).partial()
  )
  .strict()

export const troubleshootingGuideDeleteSchema = scopedSchema
  .extend({ id: uuid() })
  .strict()

export type ClaimCreateInput = z.infer<typeof claimCreateSchema>
export type ClaimUpdateInput = z.infer<typeof claimUpdateSchema>
export type ClaimInitialLineCreateInput = z.infer<typeof claimInitialLineCreateSchema>
export type ClaimLineCreateInput = z.infer<typeof claimLineCreateSchema>
export type ClaimLineUpdateInput = z.infer<typeof claimLineUpdateSchema>
export type ClaimLineReceiveInput = z.infer<typeof claimLineReceiveSchema>
export type ClaimLineReleaseQuarantineInput = z.infer<typeof claimLineReleaseQuarantineSchema>
export type WarrantyClaimSettingsUpdateInput = z.infer<typeof warrantyClaimSettingsUpdateSchema>
export type WarrantyClaimSettingsSaveInput = z.infer<typeof warrantyClaimSettingsSaveSchema>
export type TransitionClaimInput = z.infer<typeof transitionClaimInputSchema>
export type AssignClaimInput = z.infer<typeof assignClaimInputSchema>
export type CommentClaimInput = z.infer<typeof commentClaimInputSchema>
export type VendorRecoveryInput = z.infer<typeof vendorRecoveryInputSchema>
export type ClaimSetReturnLabelInput = z.infer<typeof claimSetReturnLabelSchema>
export type PortalIntakeInput = z.infer<typeof portalIntakeInputSchema>
export type ExternalClaimLineInput = z.infer<typeof externalClaimLineInputSchema>
export type ExternalClaimIntakeInput = z.infer<typeof externalClaimIntakeSchema>
export type ExternalClaimLookupQuery = z.infer<typeof externalClaimLookupQuerySchema>
export type RegistrationCreateInput = z.infer<typeof registrationCreateSchema>
export type RegistrationUpdateInput = z.infer<typeof registrationUpdateSchema>
export type RegistrationDeleteInput = z.infer<typeof registrationDeleteSchema>
export type WarrantyClaimRegistrationCreateInput = RegistrationCreateInput
export type WarrantyClaimRegistrationUpdateInput = RegistrationUpdateInput
export type WarrantyClaimRegistrationDeleteInput = RegistrationDeleteInput
export type VendorPolicyCreateInput = z.infer<typeof vendorPolicyCreateSchema>
export type VendorPolicyUpdateInput = z.infer<typeof vendorPolicyUpdateSchema>
export type VendorPolicyDeleteInput = z.infer<typeof vendorPolicyDeleteSchema>
export type WarrantyVendorPolicyCreateInput = VendorPolicyCreateInput
export type WarrantyVendorPolicyUpdateInput = VendorPolicyUpdateInput
export type WarrantyVendorPolicyDeleteInput = VendorPolicyDeleteInput
export type TroubleshootingGuideCreateInput = z.infer<typeof troubleshootingGuideCreateSchema>
export type TroubleshootingGuideUpdateInput = z.infer<typeof troubleshootingGuideUpdateSchema>
export type TroubleshootingGuideDeleteInput = z.infer<typeof troubleshootingGuideDeleteSchema>
export type WarrantyTroubleshootingGuideCreateInput = TroubleshootingGuideCreateInput
export type WarrantyTroubleshootingGuideUpdateInput = TroubleshootingGuideUpdateInput
export type WarrantyTroubleshootingGuideDeleteInput = TroubleshootingGuideDeleteInput
