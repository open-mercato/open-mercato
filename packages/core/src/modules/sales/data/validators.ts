import { z } from 'zod'
import {
  createDictionaryEntrySchema,
  updateDictionaryEntrySchema,
} from '@open-mercato/core/modules/dictionaries/data/validators'
import { getPaymentProvider, getShippingProvider } from '../lib/providers'

const uuid = () => z.string().uuid()

const scoped = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'currency code must be a three-letter ISO code')

const decimal = (opts?: { min?: number; max?: number }) => {
  let schema = z.coerce.number()
  if (typeof opts?.min === 'number') schema = schema.min(opts.min)
  if (typeof opts?.max === 'number') schema = schema.max(opts.max)
  return schema
}

const percentage = () => decimal({ min: 0, max: 100 })

const jsonRecord = z.record(z.string(), z.unknown())

const metadata = jsonRecord.optional()
const providerSettings = jsonRecord.optional()

const channelCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9\-_]+$/)
  .max(120)

const numberFormatSchema = z.string().trim().min(1).max(191)
const statusListSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(200)
  .optional()
  .nullable()

export const salesSettingsUpsertSchema = scoped.extend({
  orderNumberFormat: numberFormatSchema,
  quoteNumberFormat: numberFormatSchema,
  orderNextNumber: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
  quoteNextNumber: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
  orderCustomerEditableStatuses: statusListSchema,
  orderAddressEditableStatuses: statusListSchema,
})

export type SalesSettingsUpsertInput = z.infer<typeof salesSettingsUpsertSchema>

export const salesEditingSettingsSchema = scoped.extend({
  orderNumberFormat: numberFormatSchema.optional(),
  quoteNumberFormat: numberFormatSchema.optional(),
  orderCustomerEditableStatuses: statusListSchema,
  orderAddressEditableStatuses: statusListSchema,
})

export type SalesEditingSettingsInput = z.infer<typeof salesEditingSettingsSchema>

export const channelCreateSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  code: channelCodeSchema,
  description: z.string().trim().max(2000).optional(),
  statusEntryId: uuid().optional(),
  websiteUrl: z.string().trim().url().max(300).optional(),
  contactEmail: z.string().trim().email().max(320).optional(),
  contactPhone: z.string().trim().max(50).optional(),
  addressLine1: z.string().trim().max(255).optional(),
  addressLine2: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(30).optional(),
  country: z.string().trim().max(2).optional(),
  latitude: decimal().optional(),
  longitude: decimal().optional(),
  isActive: z.boolean().optional(),
  metadata,
})

export const channelUpdateSchema = z
  .object({
    id: uuid(),
    code: channelCodeSchema,
  })
  .merge(channelCreateSchema.omit({ code: true }).partial())

// Base schema without refinements (used for .partial() in update schema)
const shippingMethodBaseSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/)
    .max(120),
  description: z.string().trim().max(2000).optional(),
  carrierCode: z.string().trim().max(120).optional(),
  providerKey: z.string().trim().max(120).optional(),
  serviceLevel: z.string().trim().max(120).optional(),
  estimatedTransitDays: z.coerce.number().int().min(0).max(365).optional(),
  baseRateNet: decimal({ min: 0 }).optional(),
  baseRateGross: decimal({ min: 0 }).optional(),
  currencyCode: currencyCode.optional(),
  isActive: z.boolean().optional(),
  providerSettings,
  metadata,
})

// Refinement for provider settings validation
const shippingMethodRefine = (value: { providerKey?: string; providerSettings?: Record<string, unknown> }, ctx: z.RefinementCtx) => {
  if (value.providerKey) {
    const provider = getShippingProvider(value.providerKey)
    const schema = provider?.settings?.schema
    if (schema) {
      const parsed = schema.safeParse(value.providerSettings ?? {})
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: parsed.error.issues?.[0]?.message ?? 'Invalid provider configuration',
          path: ['providerSettings'],
        })
      }
    }
  }
}

export const shippingMethodCreateSchema = shippingMethodBaseSchema.superRefine(shippingMethodRefine)

export const shippingMethodUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(shippingMethodBaseSchema.partial())
  .superRefine(shippingMethodRefine)

export const deliveryWindowCreateSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/)
    .max(120),
  description: z.string().trim().max(2000).optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  cutoffTime: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
  metadata,
})

export const deliveryWindowUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(deliveryWindowCreateSchema.partial())

// Base schema without refinements (used for .partial() in update schema)
const paymentMethodBaseSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/)
    .max(120),
  description: z.string().trim().max(2000).optional(),
  providerKey: z.string().trim().max(120).optional(),
  terms: z.string().trim().max(4000).optional(),
  isActive: z.boolean().optional(),
  providerSettings,
  metadata,
})

// Refinement for provider settings validation
const paymentMethodRefine = (value: { providerKey?: string; providerSettings?: Record<string, unknown> }, ctx: z.RefinementCtx) => {
  if (value.providerKey) {
    const provider = getPaymentProvider(value.providerKey)
    const schema = provider?.settings?.schema
    if (schema) {
      const parsed = schema.safeParse(value.providerSettings ?? {})
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: parsed.error.issues?.[0]?.message ?? 'Invalid provider configuration',
          path: ['providerSettings'],
        })
      }
    }
  }
}

export const paymentMethodCreateSchema = paymentMethodBaseSchema.superRefine(paymentMethodRefine)

export const paymentMethodUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(paymentMethodBaseSchema.partial())
  .superRefine(paymentMethodRefine)

export const salesTagCreateSchema = scoped.extend({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/, 'Slug must be lowercase and may contain dashes or underscores'),
  label: z.string().trim().min(1).max(120),
  color: z.string().trim().max(30).optional(),
  description: z.string().trim().max(400).optional(),
})

export const salesTagUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(salesTagCreateSchema.partial())

export const taxRateCreateSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/)
    .max(120),
  rate: percentage(),
  countryCode: z.string().trim().length(2).optional(),
  regionCode: z.string().trim().max(6).optional(),
  postalCode: z.string().trim().max(30).optional(),
  city: z.string().trim().max(120).optional(),
  customerGroupId: uuid().optional(),
  productCategoryId: uuid().optional(),
  channelId: uuid().optional(),
  priority: z.coerce.number().int().min(0).max(10).optional(),
  isCompound: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  metadata,
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
})

export const taxRateUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(taxRateCreateSchema.partial())

const statusDictionaryEntryCreateSchema = z.object({
  value: createDictionaryEntrySchema.shape.value,
  label: z.string().trim().min(1).max(150).optional(),
  color: createDictionaryEntrySchema.shape.color,
  icon: createDictionaryEntrySchema.shape.icon,
})

const statusDictionaryEntryUpdateFieldsSchema = z.object({
  value: updateDictionaryEntrySchema.shape.value,
  label: z.string().trim().min(1).max(150).optional(),
  color: updateDictionaryEntrySchema.shape.color,
  icon: updateDictionaryEntrySchema.shape.icon,
})

const validateStatusDictionaryUpdate = (
  payload: z.infer<typeof statusDictionaryEntryUpdateFieldsSchema>,
) => Object.values(payload).some((value) => value !== undefined)

const statusDictionaryEntryUpdateSchema = statusDictionaryEntryUpdateFieldsSchema.refine(
  validateStatusDictionaryUpdate,
  { message: 'Provide at least one field to update.' },
)

export const statusDictionaryCreateSchema = scoped.merge(statusDictionaryEntryCreateSchema)

export const statusDictionaryUpdateSchema = scoped
  .merge(statusDictionaryEntryUpdateFieldsSchema)
  .safeExtend({ id: uuid() })
  .refine(validateStatusDictionaryUpdate, { message: 'Provide at least one field to update.' })

const lineKindSchema = z.enum(['product', 'service', 'shipping', 'discount', 'adjustment'])

const adjustmentKindSchema = z.string().trim().min(1).max(150)

const linePricingSchema = z.object({
  quantity: decimal({ min: 0 }),
  quantityUnit: z.string().trim().max(25).optional(),
  normalizedQuantity: decimal({ min: 0 }).optional(),
  normalizedUnit: z.string().trim().max(25).nullable().optional(),
  unitPriceNet: decimal({ min: 0 }).optional(),
  unitPriceGross: decimal({ min: 0 }).optional(),
  priceId: uuid().optional(),
  priceMode: z.enum(['net', 'gross']).optional(),
  taxRateId: uuid().optional(),
  discountAmount: decimal({ min: 0 }).optional(),
  discountPercent: percentage().optional(),
  taxRate: percentage().optional(),
  taxAmount: decimal({ min: 0 }).optional(),
  totalNetAmount: decimal({ min: 0 }).optional(),
  totalGrossAmount: decimal({ min: 0 }).optional(),
})

const lineSharedSchema = z.object({
  kind: lineKindSchema.optional(),
  statusEntryId: uuid().optional(),
  productId: uuid().optional(),
  productVariantId: uuid().optional(),
  name: z.string().trim().max(255).optional(),
  description: z.string().trim().max(4000).optional(),
  comment: z.string().trim().max(2000).optional(),
  currencyCode,
  configuration: z.record(z.string(), z.unknown()).optional(),
  promotionCode: z.string().trim().max(120).optional(),
  promotionSnapshot: z.record(z.string(), z.unknown()).optional(),
  uomSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata,
  customFieldSetId: uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
})

export const orderLineCreateSchema = scoped.extend({
  orderId: uuid(),
  lineNumber: z.coerce.number().int().min(0).optional(),
  ...lineSharedSchema.shape,
  ...linePricingSchema.shape,
  catalogSnapshot: z.record(z.string(), z.unknown()).optional(),
})

export const orderLineUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(orderLineCreateSchema.partial())

export const quoteLineCreateSchema = scoped.extend({
  quoteId: uuid(),
  lineNumber: z.coerce.number().int().min(0).optional(),
  ...lineSharedSchema.shape,
  ...linePricingSchema.shape,
  catalogSnapshot: z.record(z.string(), z.unknown()).optional(),
})

export const quoteLineUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(quoteLineCreateSchema.partial())

export const orderAdjustmentCreateSchema = scoped.extend({
  orderId: uuid(),
  orderLineId: uuid().optional(),
  scope: z.enum(['order', 'line']).optional(),
  kind: adjustmentKindSchema.optional(),
  code: z.string().trim().max(120).optional(),
  label: z.string().trim().max(255).optional(),
  calculatorKey: z.string().trim().max(120).optional(),
  promotionId: uuid().optional(),
  rate: percentage().optional(),
  amountNet: decimal().optional(),
  amountGross: decimal().optional(),
  currencyCode: currencyCode.optional(),
  metadata,
  customFields: z.record(z.string(), z.unknown()).optional(),
  position: z.coerce.number().int().min(0).optional(),
})

export const orderAdjustmentUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(orderAdjustmentCreateSchema.partial())

export const quoteAdjustmentCreateSchema = scoped.extend({
  quoteId: uuid(),
  quoteLineId: uuid().optional(),
  scope: z.enum(['order', 'line']).optional(),
  kind: adjustmentKindSchema.optional(),
  code: z.string().trim().max(120).optional(),
  label: z.string().trim().max(255).optional(),
  calculatorKey: z.string().trim().max(120).optional(),
  promotionId: uuid().optional(),
  rate: percentage().optional(),
  amountNet: decimal().optional(),
  amountGross: decimal().optional(),
  currencyCode: currencyCode.optional(),
  metadata,
  customFields: z.record(z.string(), z.unknown()).optional(),
  position: z.coerce.number().int().min(0).optional(),
})

export const quoteAdjustmentUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(quoteAdjustmentCreateSchema.partial())

const orderTotalsSchema = z.object({
  subtotalNetAmount: decimal({ min: 0 }).optional(),
  subtotalGrossAmount: decimal({ min: 0 }).optional(),
  discountTotalAmount: decimal({ min: 0 }).optional(),
  taxTotalAmount: decimal({ min: 0 }).optional(),
  shippingNetAmount: decimal({ min: 0 }).optional(),
  shippingGrossAmount: decimal({ min: 0 }).optional(),
  surchargeTotalAmount: decimal({ min: 0 }).optional(),
  grandTotalNetAmount: decimal({ min: 0 }).optional(),
  grandTotalGrossAmount: decimal({ min: 0 }).optional(),
  paidTotalAmount: decimal({ min: 0 }).optional(),
  refundedTotalAmount: decimal({ min: 0 }).optional(),
  outstandingAmount: decimal().optional(),
  lineItemCount: z.coerce.number().int().min(0).optional(),
})

const quoteTotalsSchema = z.object({
  subtotalNetAmount: decimal({ min: 0 }).optional(),
  subtotalGrossAmount: decimal({ min: 0 }).optional(),
  discountTotalAmount: decimal({ min: 0 }).optional(),
  taxTotalAmount: decimal({ min: 0 }).optional(),
  grandTotalNetAmount: decimal({ min: 0 }).optional(),
  grandTotalGrossAmount: decimal({ min: 0 }).optional(),
  lineItemCount: z.coerce.number().int().min(0).optional(),
})

export const orderCreateSchema = scoped.extend({
  orderNumber: z.string().trim().min(1).max(191).optional(),
  externalReference: z.string().trim().max(191).optional(),
  customerReference: z.string().trim().max(191).optional(),
  customerEntityId: uuid().optional(),
  customerContactId: uuid().optional(),
  customerSnapshot: jsonRecord.optional(),
  billingAddressId: uuid().optional(),
  shippingAddressId: uuid().optional(),
  billingAddressSnapshot: jsonRecord.optional(),
  shippingAddressSnapshot: jsonRecord.optional(),
  currencyCode,
  exchangeRate: decimal({ min: 0 }).optional(),
  statusEntryId: uuid().optional(),
  fulfillmentStatusEntryId: uuid().optional(),
  paymentStatusEntryId: uuid().optional(),
  taxStrategyKey: z.string().trim().max(120).optional(),
  discountStrategyKey: z.string().trim().max(120).optional(),
  taxInfo: jsonRecord.optional(),
  shippingMethodId: uuid().optional(),
  shippingMethodCode: z.string().trim().max(120).optional(),
  deliveryWindowId: uuid().optional(),
  deliveryWindowCode: z.string().trim().max(120).optional(),
  paymentMethodId: uuid().optional(),
  paymentMethodCode: z.string().trim().max(120).optional(),
  channelId: uuid().optional(),
  placedAt: z.coerce.date().optional(),
  expectedDeliveryAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional(),
  comments: z.string().trim().max(4000).optional(),
  internalNotes: z.string().trim().max(4000).optional(),
  shippingMethodSnapshot: jsonRecord.optional(),
  deliveryWindowSnapshot: jsonRecord.optional(),
  paymentMethodSnapshot: jsonRecord.optional(),
  metadata,
  customFieldSetId: uuid().optional(),
  lines: z.array(orderLineCreateSchema.omit({ organizationId: true, tenantId: true, orderId: true })).optional(),
  adjustments: z.array(orderAdjustmentCreateSchema.omit({ organizationId: true, tenantId: true, orderId: true })).optional(),
  tags: z.array(uuid()).optional(),
  ...orderTotalsSchema.shape,
})

export const orderUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(orderCreateSchema.partial())

export const quoteCreateSchema = scoped.extend({
  quoteNumber: z.string().trim().min(1).max(191).optional(),
  statusEntryId: uuid().optional(),
  customerEntityId: uuid().optional(),
  customerContactId: uuid().optional(),
  channelId: uuid().optional(),
  customerSnapshot: jsonRecord.optional(),
  billingAddressId: uuid().optional(),
  shippingAddressId: uuid().optional(),
  billingAddressSnapshot: jsonRecord.optional(),
  shippingAddressSnapshot: jsonRecord.optional(),
  currencyCode,
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  comments: z.string().trim().max(4000).optional(),
  taxInfo: jsonRecord.optional(),
  shippingMethodId: uuid().optional(),
  shippingMethodCode: z.string().trim().max(120).optional(),
  deliveryWindowId: uuid().optional(),
  deliveryWindowCode: z.string().trim().max(120).optional(),
  paymentMethodId: uuid().optional(),
  paymentMethodCode: z.string().trim().max(120).optional(),
  shippingMethodSnapshot: jsonRecord.optional(),
  deliveryWindowSnapshot: jsonRecord.optional(),
  paymentMethodSnapshot: jsonRecord.optional(),
  metadata,
  customFieldSetId: uuid().optional(),
  lines: z
    .array(quoteLineCreateSchema.omit({ organizationId: true, tenantId: true, quoteId: true }))
    .optional(),
  adjustments: z
    .array(quoteAdjustmentCreateSchema.omit({ organizationId: true, tenantId: true, quoteId: true }))
    .optional(),
  tags: z.array(uuid()).optional(),
  ...quoteTotalsSchema.shape,
})

export const quoteUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(quoteCreateSchema.partial())

const documentKind = z.enum(['order', 'quote'])

const documentAddressFields = {
  documentId: uuid(),
  documentKind,
  customerAddressId: uuid().optional(),
  name: z.string().trim().max(255).nullable().optional(),
  purpose: z.string().trim().max(120).nullable().optional(),
  companyName: z.string().trim().max(255).nullable().optional(),
  addressLine1: z.string().trim().min(1).max(255),
  addressLine2: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(60).nullable().optional(),
  country: z.string().trim().max(2).nullable().optional(),
  buildingNumber: z.string().trim().max(60).nullable().optional(),
  flatNumber: z.string().trim().max(60).nullable().optional(),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
}

export const documentAddressCreateSchema = scoped.extend(documentAddressFields)

export const documentAddressUpdateSchema = scoped.extend({
  id: uuid(),
  ...documentAddressFields,
})

export const documentAddressDeleteSchema = scoped.extend({
  id: uuid(),
  documentId: uuid(),
  documentKind,
})

export const shipmentCreateSchema = scoped.extend({
  orderId: uuid(),
  shipmentNumber: z.string().trim().max(191).optional(),
  shippingMethodId: uuid().optional(),
  statusEntryId: uuid().optional(),
  documentStatusEntryId: uuid().optional(),
  lineStatusEntryId: uuid().optional(),
  carrierName: z.string().trim().max(191).optional(),
  trackingNumbers: z.array(z.string().trim().max(191)).optional(),
  shippedAt: z.coerce.date().optional(),
  deliveredAt: z.coerce.date().optional(),
  weightValue: decimal({ min: 0 }).optional(),
  weightUnit: z.string().trim().max(25).optional(),
  declaredValueNet: decimal({ min: 0 }).optional(),
  declaredValueGross: decimal({ min: 0 }).optional(),
  currencyCode: currencyCode.optional(),
  notes: z.string().trim().max(4000).optional(),
  metadata,
  shipmentAddressSnapshot: jsonRecord.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  items: z
    .array(
      z.object({
        orderLineId: uuid(),
        quantity: decimal({ min: 0 }),
        metadata,
      })
    )
    .optional(),
})

export const shipmentUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(shipmentCreateSchema.partial())

export const invoiceCreateSchema = scoped.extend({
  orderId: uuid().optional(),
  invoiceNumber: z.string().trim().min(1).max(191),
  statusEntryId: uuid().optional(),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  currencyCode,
  metadata,
  customFieldSetId: uuid().optional(),
  lines: z
    .array(
      z.object({
        orderLineId: uuid().optional(),
        lineNumber: z.coerce.number().int().min(0).optional(),
        kind: lineKindSchema.optional(),
        description: z.string().trim().max(4000).optional(),
        quantity: decimal({ min: 0 }),
        quantityUnit: z.string().trim().max(25).optional(),
        currencyCode,
        unitPriceNet: decimal({ min: 0 }).optional(),
        unitPriceGross: decimal({ min: 0 }).optional(),
        discountAmount: decimal({ min: 0 }).optional(),
        discountPercent: percentage().optional(),
        taxRate: percentage().optional(),
        taxAmount: decimal({ min: 0 }).optional(),
        totalNetAmount: decimal({ min: 0 }).optional(),
        totalGrossAmount: decimal({ min: 0 }).optional(),
        metadata,
      })
    )
    .optional(),
  subtotalNetAmount: decimal({ min: 0 }).optional(),
  subtotalGrossAmount: decimal({ min: 0 }).optional(),
  discountTotalAmount: decimal({ min: 0 }).optional(),
  taxTotalAmount: decimal({ min: 0 }).optional(),
  grandTotalNetAmount: decimal({ min: 0 }).optional(),
  grandTotalGrossAmount: decimal({ min: 0 }).optional(),
  paidTotalAmount: decimal({ min: 0 }).optional(),
  outstandingAmount: decimal().optional(),
})

export const invoiceUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(invoiceCreateSchema.partial())

export const creditMemoCreateSchema = scoped.extend({
  orderId: uuid().optional(),
  invoiceId: uuid().optional(),
  creditMemoNumber: z.string().trim().min(1).max(191),
  statusEntryId: uuid().optional(),
  issueDate: z.coerce.date().optional(),
  currencyCode,
  metadata,
  customFieldSetId: uuid().optional(),
  lines: z
    .array(
      z.object({
        orderLineId: uuid().optional(),
        lineNumber: z.coerce.number().int().min(0).optional(),
        description: z.string().trim().max(4000).optional(),
        quantity: decimal({ min: 0 }),
        quantityUnit: z.string().trim().max(25).optional(),
        currencyCode,
        unitPriceNet: decimal({ min: 0 }).optional(),
        unitPriceGross: decimal({ min: 0 }).optional(),
        taxRate: percentage().optional(),
        taxAmount: decimal({ min: 0 }).optional(),
        totalNetAmount: decimal({ min: 0 }).optional(),
        totalGrossAmount: decimal({ min: 0 }).optional(),
        metadata,
      })
    )
    .optional(),
  subtotalNetAmount: decimal({ min: 0 }).optional(),
  subtotalGrossAmount: decimal({ min: 0 }).optional(),
  taxTotalAmount: decimal({ min: 0 }).optional(),
  grandTotalNetAmount: decimal({ min: 0 }).optional(),
  grandTotalGrossAmount: decimal({ min: 0 }).optional(),
})

export const creditMemoUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(creditMemoCreateSchema.partial())

export const paymentCreateSchema = scoped.extend({
  orderId: uuid().optional(),
  paymentMethodId: uuid().optional(),
  paymentReference: z.string().trim().max(191).optional(),
  statusEntryId: uuid().optional(),
  documentStatusEntryId: uuid().optional(),
  lineStatusEntryId: uuid().optional(),
  amount: decimal({ min: 0 }),
  currencyCode,
  capturedAmount: decimal({ min: 0 }).optional(),
  refundedAmount: decimal({ min: 0 }).optional(),
  receivedAt: z.coerce.date().optional(),
  capturedAt: z.coerce.date().optional(),
  metadata,
  customFieldSetId: uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  allocations: z
    .array(
      z.object({
        orderId: uuid().optional(),
        invoiceId: uuid().optional(),
        amount: decimal({ min: 0 }),
        currencyCode,
        metadata,
      })
    )
    .optional(),
})

export const paymentUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(paymentCreateSchema.partial())

export const noteCreateSchema = scoped.extend({
  contextType: z.enum(['order', 'quote', 'invoice', 'credit_memo']),
  contextId: uuid(),
  orderId: uuid().optional(),
  quoteId: uuid().optional(),
  authorUserId: uuid().optional(),
  body: z.string().trim().min(1).max(8000),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const noteUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(
    z
      .object({
        body: z.string().trim().min(1).max(8000).optional(),
      })
      .extend({
        authorUserId: uuid().optional(),
        appearanceIcon: z.string().trim().max(100).optional().nullable(),
        appearanceColor: z
          .string()
          .trim()
          .regex(/^#([0-9a-fA-F]{6})$/)
          .optional()
          .nullable(),
      })
  )

export const documentNumberRequestSchema = scoped.extend({
  kind: z.enum(['order', 'quote']),
  format: numberFormatSchema.optional(),
})

export type DocumentNumberRequestInput = z.infer<typeof documentNumberRequestSchema>

export type ChannelCreateInput = z.infer<typeof channelCreateSchema>
export type ChannelUpdateInput = z.infer<typeof channelUpdateSchema>
export type ShippingMethodCreateInput = z.infer<typeof shippingMethodCreateSchema>
export type ShippingMethodUpdateInput = z.infer<typeof shippingMethodUpdateSchema>
export type DeliveryWindowCreateInput = z.infer<typeof deliveryWindowCreateSchema>
export type DeliveryWindowUpdateInput = z.infer<typeof deliveryWindowUpdateSchema>
export type PaymentMethodCreateInput = z.infer<typeof paymentMethodCreateSchema>
export type PaymentMethodUpdateInput = z.infer<typeof paymentMethodUpdateSchema>
export type TaxRateCreateInput = z.infer<typeof taxRateCreateSchema>
export type TaxRateUpdateInput = z.infer<typeof taxRateUpdateSchema>
export type OrderCreateInput = z.infer<typeof orderCreateSchema>
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>
export type OrderLineCreateInput = z.infer<typeof orderLineCreateSchema>
export type OrderLineUpdateInput = z.infer<typeof orderLineUpdateSchema>
export type OrderAdjustmentCreateInput = z.infer<typeof orderAdjustmentCreateSchema>
export type OrderAdjustmentUpdateInput = z.infer<typeof orderAdjustmentUpdateSchema>
export type QuoteCreateInput = z.infer<typeof quoteCreateSchema>
export type QuoteUpdateInput = z.infer<typeof quoteUpdateSchema>
export type QuoteLineCreateInput = z.infer<typeof quoteLineCreateSchema>
export type QuoteLineUpdateInput = z.infer<typeof quoteLineUpdateSchema>
export type QuoteAdjustmentCreateInput = z.infer<typeof quoteAdjustmentCreateSchema>
export type QuoteAdjustmentUpdateInput = z.infer<typeof quoteAdjustmentUpdateSchema>
export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>
export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>
export type CreditMemoCreateInput = z.infer<typeof creditMemoCreateSchema>
export type CreditMemoUpdateInput = z.infer<typeof creditMemoUpdateSchema>
export const quoteSendSchema = z.object({
  quoteId: z.string().uuid(),
  validForDays: z.coerce.number().int().min(1).max(365).default(14),
})

export const quoteAcceptSchema = z.object({
  token: z.string().uuid(),
})

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>
export type PaymentUpdateInput = z.infer<typeof paymentUpdateSchema>
export type NoteCreateInput = z.infer<typeof noteCreateSchema>
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>
export type SalesTagCreateInput = z.infer<typeof salesTagCreateSchema>
export type SalesTagUpdateInput = z.infer<typeof salesTagUpdateSchema>
export type DocumentAddressCreateInput = z.infer<typeof documentAddressCreateSchema>
export type DocumentAddressUpdateInput = z.infer<typeof documentAddressUpdateSchema>
export type DocumentAddressDeleteInput = z.infer<typeof documentAddressDeleteSchema>
export type QuoteSendInput = z.infer<typeof quoteSendSchema>
export type QuoteAcceptInput = z.infer<typeof quoteAcceptSchema>
