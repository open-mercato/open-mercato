import { z } from 'zod'

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

const metadata = z.record(z.string(), z.unknown()).optional()

export const channelCreateSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/)
    .max(120)
    .optional(),
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
  })
  .merge(channelCreateSchema.partial())

export const shippingMethodCreateSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/)
    .max(120),
  description: z.string().trim().max(2000).optional(),
  carrierCode: z.string().trim().max(120).optional(),
  serviceLevel: z.string().trim().max(120).optional(),
  estimatedTransitDays: z.coerce.number().int().min(0).max(365).optional(),
  baseRateNet: decimal({ min: 0 }).optional(),
  baseRateGross: decimal({ min: 0 }).optional(),
  currencyCode: currencyCode.optional(),
  isActive: z.boolean().optional(),
  metadata,
})

export const shippingMethodUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(shippingMethodCreateSchema.partial())

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

export const paymentMethodCreateSchema = scoped.extend({
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
  metadata,
})

export const paymentMethodUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(paymentMethodCreateSchema.partial())

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
  metadata,
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
})

export const taxRateUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(taxRateCreateSchema.partial())

const lineKindSchema = z.enum(['product', 'service', 'shipping', 'discount', 'adjustment'])

const adjustmentKindSchema = z.enum(['tax', 'discount', 'surcharge', 'shipping', 'custom'])

const linePricingSchema = z.object({
  quantity: decimal({ min: 0 }),
  quantityUnit: z.string().trim().max(25).optional(),
  unitPriceNet: decimal({ min: 0 }).optional(),
  unitPriceGross: decimal({ min: 0 }).optional(),
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
  metadata,
  customFieldSetId: uuid().optional(),
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
  orderNumber: z.string().trim().min(1).max(191),
  externalReference: z.string().trim().max(191).optional(),
  customerReference: z.string().trim().max(191).optional(),
  customerEntityId: uuid().optional(),
  customerContactId: uuid().optional(),
  billingAddressId: uuid().optional(),
  shippingAddressId: uuid().optional(),
  currencyCode,
  exchangeRate: decimal({ min: 0 }).optional(),
  statusEntryId: uuid().optional(),
  fulfillmentStatusEntryId: uuid().optional(),
  paymentStatusEntryId: uuid().optional(),
  taxStrategyKey: z.string().trim().max(120).optional(),
  discountStrategyKey: z.string().trim().max(120).optional(),
  shippingMethodId: uuid().optional(),
  deliveryWindowId: uuid().optional(),
  paymentMethodId: uuid().optional(),
  channelId: uuid().optional(),
  placedAt: z.coerce.date().optional(),
  expectedDeliveryAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional(),
  comments: z.string().trim().max(4000).optional(),
  internalNotes: z.string().trim().max(4000).optional(),
  shippingMethodSnapshot: z.record(z.string(), z.unknown()).optional(),
  paymentMethodSnapshot: z.record(z.string(), z.unknown()).optional(),
  metadata,
  customFieldSetId: uuid().optional(),
  lines: z.array(orderLineCreateSchema.omit({ organizationId: true, tenantId: true, orderId: true })).optional(),
  adjustments: z.array(orderAdjustmentCreateSchema.omit({ organizationId: true, tenantId: true, orderId: true })).optional(),
  ...orderTotalsSchema.shape,
})

export const orderUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(orderCreateSchema.partial())

export const quoteCreateSchema = scoped.extend({
  quoteNumber: z.string().trim().min(1).max(191),
  statusEntryId: uuid().optional(),
  customerEntityId: uuid().optional(),
  customerContactId: uuid().optional(),
  currencyCode,
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  comments: z.string().trim().max(4000).optional(),
  metadata,
  customFieldSetId: uuid().optional(),
  lines: z
    .array(quoteLineCreateSchema.omit({ organizationId: true, tenantId: true, quoteId: true }))
    .optional(),
  adjustments: z
    .array(quoteAdjustmentCreateSchema.omit({ organizationId: true, tenantId: true, quoteId: true }))
    .optional(),
  ...quoteTotalsSchema.shape,
})

export const quoteUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(quoteCreateSchema.partial())

export const shipmentCreateSchema = scoped.extend({
  orderId: uuid(),
  shipmentNumber: z.string().trim().max(191).optional(),
  shippingMethodId: uuid().optional(),
  statusEntryId: uuid().optional(),
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
  amount: decimal({ min: 0 }),
  currencyCode,
  capturedAmount: decimal({ min: 0 }).optional(),
  refundedAmount: decimal({ min: 0 }).optional(),
  receivedAt: z.coerce.date().optional(),
  capturedAt: z.coerce.date().optional(),
  metadata,
  customFieldSetId: uuid().optional(),
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
      })
  )

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
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>
export type PaymentUpdateInput = z.infer<typeof paymentUpdateSchema>
export type NoteCreateInput = z.infer<typeof noteCreateSchema>
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>
