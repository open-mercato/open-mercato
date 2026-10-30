import { z } from 'zod'
import { fieldsetCodeRegex } from '@open-mercato/shared/modules/entities/validators'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../lib/defaults'
import { CHECKOUT_LINK_STATUSES } from '../lib/constants'

function normalizeBlankString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const source = value as Record<string, unknown>
  const title = typeof source.title === 'string' ? source.title.trim() : ''
  const markdown = typeof source.markdown === 'string' ? source.markdown.trim() : ''
  const required = source.required === true
  if (!title && !markdown && !required) return undefined
  return value
}

function requiredTrimmedString(message: string) {
  return z.string().trim().min(1, { message })
}

const hexColorSchema = z.string().regex(/^#([0-9a-fA-F]{6})$/, {
  message: 'checkout.validation.common.invalidColor',
})
const currencyCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, {
  message: 'checkout.validation.common.invalidCurrencyCode',
})
const optionalTrimmedString = z.preprocess(
  normalizeBlankString,
  z.string().trim().min(1, { message: 'checkout.validation.common.required' }).optional().nullable(),
)
const optionalUrlSchema = z.preprocess(
  normalizeBlankString,
  z.string().url('checkout.validation.common.invalidUrl').optional().nullable(),
)
const optionalFieldsetCodeSchema = z.preprocess(
  normalizeBlankString,
  z.string().regex(fieldsetCodeRegex, {
    message: 'checkout.validation.common.invalidFieldsetCode',
  }).optional().nullable(),
)
const positiveMoneySchema = z.coerce.number().finite('checkout.validation.common.invalidNumber').nonnegative('checkout.validation.common.nonNegativeNumber')
const linkStatusSchema = z.enum(CHECKOUT_LINK_STATUSES)
const themeModeSchema = z.enum(['light', 'dark', 'auto'])
const checkoutTypeSchema = z.enum(['pay_link', 'simple_checkout'])

export const customerFieldOptionSchema = z.object({
  value: requiredTrimmedString('checkout.validation.common.required'),
  label: requiredTrimmedString('checkout.validation.common.required'),
})

export const customerFieldDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][A-Za-z0-9]*$/, {
    message: 'checkout.validation.customerFields.key.invalid',
  }),
  label: requiredTrimmedString('checkout.validation.common.required'),
  kind: z.enum(['text', 'multiline', 'boolean', 'select', 'radio']),
  required: z.boolean(),
  fixed: z.boolean(),
  placeholder: optionalTrimmedString,
  options: z.array(customerFieldOptionSchema).optional(),
  sortOrder: z.coerce.number().int('checkout.validation.common.integer').min(0, {
    message: 'checkout.validation.common.nonNegativeInteger',
  }),
})

export const legalDocumentSchema = z.preprocess(
  normalizeOptionalDocument,
  z.object({
    title: requiredTrimmedString('checkout.validation.common.required'),
    markdown: requiredTrimmedString('checkout.validation.common.required'),
    required: z.boolean().default(false),
  }).optional(),
)

export const legalDocumentsSchema = z.object({
  terms: legalDocumentSchema.optional(),
  privacyPolicy: legalDocumentSchema.optional(),
}).optional()

export const priceListItemSchema = z.object({
  id: requiredTrimmedString('checkout.validation.common.required'),
  description: requiredTrimmedString('checkout.validation.common.required'),
  amount: positiveMoneySchema,
  currencyCode: currencyCodeSchema,
})

export const gatewaySettingsSchema = z.record(z.string(), z.unknown()).optional()

const checkoutContentSchema = z.object({
  name: requiredTrimmedString('checkout.validation.name.required'),
  title: optionalTrimmedString,
  subtitle: optionalTrimmedString,
  description: z.string().optional().nullable(),
  logoAttachmentId: z.string().uuid('checkout.validation.common.invalidUuid').optional().nullable(),
  logoUrl: optionalUrlSchema,
  primaryColor: hexColorSchema.optional().nullable(),
  secondaryColor: hexColorSchema.optional().nullable(),
  backgroundColor: hexColorSchema.optional().nullable(),
  themeMode: themeModeSchema.default('auto'),
  pricingMode: z.enum(['fixed', 'custom_amount', 'price_list']),
  fixedPriceAmount: positiveMoneySchema.optional().nullable(),
  fixedPriceCurrencyCode: currencyCodeSchema.optional().nullable(),
  fixedPriceIncludesTax: z.boolean().default(true),
  fixedPriceOriginalAmount: positiveMoneySchema.optional().nullable(),
  customAmountMin: positiveMoneySchema.optional().nullable(),
  customAmountMax: positiveMoneySchema.optional().nullable(),
  customAmountCurrencyCode: currencyCodeSchema.optional().nullable(),
  priceListItems: z.array(priceListItemSchema).optional().nullable(),
  gatewayProviderKey: optionalTrimmedString,
  gatewaySettings: gatewaySettingsSchema,
  customFieldsetCode: optionalFieldsetCodeSchema,
  collectCustomerDetails: z.boolean().default(true),
  customerFieldsSchema: z.array(customerFieldDefinitionSchema).default([...DEFAULT_CHECKOUT_CUSTOMER_FIELDS]),
  legalDocuments: legalDocumentsSchema,
  displayCustomFieldsOnPage: z.boolean().default(false),
  successTitle: optionalTrimmedString,
  successMessage: z.string().optional().nullable(),
  cancelTitle: optionalTrimmedString,
  cancelMessage: z.string().optional().nullable(),
  errorTitle: optionalTrimmedString,
  errorMessage: z.string().optional().nullable(),
  successEmailSubject: optionalTrimmedString,
  successEmailBody: z.string().optional().nullable(),
  sendSuccessEmail: z.boolean().default(true),
  errorEmailSubject: optionalTrimmedString,
  errorEmailBody: z.string().optional().nullable(),
  sendErrorEmail: z.boolean().default(true),
  startEmailSubject: optionalTrimmedString,
  startEmailBody: z.string().optional().nullable(),
  sendStartEmail: z.boolean().default(true),
  password: optionalTrimmedString,
  maxCompletions: z.coerce.number().int('checkout.validation.common.integer').positive('checkout.validation.common.positiveInteger').optional().nullable(),
  status: linkStatusSchema.default('draft'),
  checkoutType: checkoutTypeSchema.default('pay_link'),
})

const checkoutContentUpdateSchema = checkoutContentSchema.partial().extend({
  themeMode: themeModeSchema.optional(),
  fixedPriceIncludesTax: z.boolean().optional(),
  collectCustomerDetails: z.boolean().optional(),
  customerFieldsSchema: z.array(customerFieldDefinitionSchema).optional(),
  displayCustomFieldsOnPage: z.boolean().optional(),
  sendSuccessEmail: z.boolean().optional(),
  sendErrorEmail: z.boolean().optional(),
  sendStartEmail: z.boolean().optional(),
  status: linkStatusSchema.optional(),
  checkoutType: checkoutTypeSchema.optional(),
})

function validatePricingConsistency<T extends z.infer<typeof checkoutContentSchema>>(value: T, ctx: z.RefinementCtx) {
  if (value.pricingMode === 'fixed') {
    if (value.fixedPriceAmount == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'checkout.validation.fixedPriceAmount.required', path: ['fixedPriceAmount'] })
    }
    if (!value.fixedPriceCurrencyCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'checkout.validation.fixedPriceCurrencyCode.required', path: ['fixedPriceCurrencyCode'] })
    }
  }

  if (value.pricingMode === 'custom_amount') {
    if (value.customAmountMin == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'checkout.validation.customAmountMin.required', path: ['customAmountMin'] })
    }
    if (value.customAmountMax == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'checkout.validation.customAmountMax.required', path: ['customAmountMax'] })
    }
    if (!value.customAmountCurrencyCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'checkout.validation.customAmountCurrencyCode.required', path: ['customAmountCurrencyCode'] })
    }
    if (value.customAmountMin != null && value.customAmountMax != null && value.customAmountMin > value.customAmountMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'checkout.validation.customAmount.range', path: ['customAmountMax'] })
    }
  }

  if (value.pricingMode === 'price_list') {
    if (!Array.isArray(value.priceListItems) || value.priceListItems.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'checkout.validation.priceListItems.required', path: ['priceListItems'] })
      return
    }
    const currencies = new Set(value.priceListItems.map((item) => item.currencyCode))
    if (currencies.size > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'checkout.validation.priceListItems.singleCurrency', path: ['priceListItems'] })
    }
  }
}

export const createTemplateSchema = checkoutContentSchema.superRefine((value, ctx) => {
  validatePricingConsistency(value, ctx)
  if (!value.gatewayProviderKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'checkout.validation.gatewayProviderKey.required',
      path: ['gatewayProviderKey'],
    })
  }
})

function applyPartialPricingConsistency(value: Record<string, unknown>, ctx: z.RefinementCtx) {
  if (!value.pricingMode) return
  validatePricingConsistency({
    ...checkoutContentSchema.parse({
      ...value,
      name: value.name ?? 'placeholder',
      pricingMode: value.pricingMode,
      customerFieldsSchema: value.customerFieldsSchema ?? [...DEFAULT_CHECKOUT_CUSTOMER_FIELDS],
    }),
    ...value,
  }, ctx)
}

export const updateTemplateSchema = checkoutContentUpdateSchema.extend({
  id: z.string().uuid('checkout.validation.common.invalidUuid'),
}).superRefine((value, ctx) => {
  applyPartialPricingConsistency(value, ctx)
  if (Object.prototype.hasOwnProperty.call(value, 'gatewayProviderKey') && !value.gatewayProviderKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'checkout.validation.gatewayProviderKey.required',
      path: ['gatewayProviderKey'],
    })
  }
})

export const createLinkSchema = createTemplateSchema.safeExtend({
  templateId: z.string().uuid('checkout.validation.common.invalidUuid').optional().nullable(),
  slug: optionalTrimmedString,
})

export const updateLinkSchema = checkoutContentUpdateSchema.safeExtend({
  id: z.string().uuid('checkout.validation.common.invalidUuid'),
  templateId: z.string().uuid('checkout.validation.common.invalidUuid').optional().nullable(),
  slug: optionalTrimmedString,
}).superRefine((value, ctx) => {
  applyPartialPricingConsistency(value, ctx)
})

export const transactionStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled', 'expired'])

export const transactionCreateSchema = z.object({
  linkId: z.string().uuid('checkout.validation.common.invalidUuid'),
  amount: positiveMoneySchema,
  currencyCode: currencyCodeSchema,
  idempotencyKey: requiredTrimmedString('checkout.validation.common.required'),
  customerData: z.record(z.string(), z.unknown()).default({}),
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
  email: optionalTrimmedString,
  phone: optionalTrimmedString,
  gatewayTransactionId: z.string().uuid('checkout.validation.common.invalidUuid').optional().nullable(),
  paymentStatus: optionalTrimmedString,
  selectedPriceItemId: optionalTrimmedString,
  acceptedLegalConsents: z.record(z.string(), z.unknown()).optional().nullable(),
  ipAddress: optionalTrimmedString,
  userAgent: z.string().optional().nullable(),
  tenantId: z.string().uuid('checkout.validation.common.invalidUuid'),
  organizationId: z.string().uuid('checkout.validation.common.invalidUuid'),
})

export const transactionUpdateStatusSchema = z.object({
  id: z.string().uuid('checkout.validation.common.invalidUuid'),
  status: transactionStatusSchema,
  paymentStatus: optionalTrimmedString,
  gatewayTransactionId: z.string().uuid('checkout.validation.common.invalidUuid').optional().nullable(),
  tenantId: z.string().uuid('checkout.validation.common.invalidUuid'),
  organizationId: z.string().uuid('checkout.validation.common.invalidUuid'),
})

export const publicPasswordVerifySchema = z.object({
  password: z.string().min(1, { message: 'checkout.validation.common.required' }),
})

export const publicSubmitSchema = z.object({
  customerData: z.record(z.string(), z.unknown()),
  acceptedLegalConsents: z.object({
    terms: z.boolean().optional(),
    privacyPolicy: z.boolean().optional(),
  }).default({}),
  amount: z.coerce.number().finite().nonnegative().optional(),
  selectedPriceItemId: optionalTrimmedString,
})

export type CustomerFieldDefinitionInput = z.infer<typeof customerFieldDefinitionSchema>
export type PriceListItemInput = z.infer<typeof priceListItemSchema>
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>
export type CreateLinkInput = z.infer<typeof createLinkSchema>
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>
export type CreateTransactionInput = z.infer<typeof transactionCreateSchema>
export type UpdateTransactionStatusInput = z.infer<typeof transactionUpdateStatusSchema>

// Release 5, Step 2.12 (B.1) / Step 3.5 (B.2, §9.0). `{ source: 'cart' }` is the
// buyer-initiated path (X-Cart-Token). `{ source: 'link' }` is merchant-initiated
// (D-R5-19): a bare `slug` of a `checkoutType: 'simple_checkout'` `CheckoutLink` — a
// `checkoutType: 'pay_link'` link never reaches `checkout.session.create` at all (Phase A
// keeps its own cart-less path, C10).
export const checkoutSessionCreateSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('cart'),
  }),
  z.object({
    source: z.literal('link'),
    slug: requiredTrimmedString('checkout.validation.common.required'),
  }),
])

// §9's route table: `PATCH /sessions/current` — "Contact, addresses, consent, terms
// acceptance". Step/delivery/payment fields (§5.2, B.3) are not part of this Step's
// skeleton. Every field is optional — the route applies only the keys the caller sends.
const optionalAddressSchema = z.record(z.string(), z.unknown()).optional().nullable()

export const checkoutSessionUpdateSchema = z.object({
  email: optionalTrimmedString,
  phone: optionalTrimmedString,
  shippingAddress: optionalAddressSchema,
  billingAddress: optionalAddressSchema,
  billingSameAsShipping: z.boolean().optional(),
  locale: optionalTrimmedString,
  consentFlags: z.record(z.string(), z.unknown()).optional().nullable(),
  termsAccepted: z.boolean().optional(),
})

// §9's route table: `POST /sessions/current/delivery` (B.3, §5.3). The buyer sends back
// only the `deliveryMethodCode` of one of the options `GET .../delivery-options` just
// offered — never a price (§13 Entitlement: "a client asking for a method without
// entitlement is refused, never trusted"). The route re-resolves the real rate server-side
// and refuses an unknown code with `422 delivery_unavailable`.
export const checkoutSessionDeliverySelectSchema = z.object({
  deliveryMethodCode: requiredTrimmedString('checkout.validation.common.required'),
})

// Release 5, Step 4.2 (B.4, §9's route table: `POST /sessions/current/submit`).
// `paymentMethodCode` is the command's own direct input per Step 4.1's resolved decision
// ("submit takes the method as a direct input... no `POST /sessions/current/payment`
// selection route is built"); the Idempotency-Key header (§7.1 precondition 2) is
// validated at the route, not in this schema.
//
// Release 5, Step 5.1 (B.5, §8.4/§9's route table: "POST .../payment | Select a method;
// PO number"). The spec names a dedicated payment-selection route as the PO number's
// input point, but Step 4.1 already resolved "no selection route, submit takes the method
// directly" for `paymentMethodCode` — `poNumber` follows the SAME resolved shape rather
// than reopening that decision for one more field. Optional at the schema level; the
// command itself (`commands/submit.ts`) is what refuses a missing PO number with `422
// purchase_order_number_required` when the resolved `requiresPoNumber` term demands one.
export const checkoutSessionSubmitSchema = z.object({
  paymentMethodCode: requiredTrimmedString('checkout.validation.common.required'),
  poNumber: optionalTrimmedString,
})

export type CheckoutSessionCreateInput = z.infer<typeof checkoutSessionCreateSchema>
export type CheckoutSessionUpdateInput = z.infer<typeof checkoutSessionUpdateSchema>
export type CheckoutSessionDeliverySelectInput = z.infer<typeof checkoutSessionDeliverySelectSchema>
export type CheckoutSessionSubmitInput = z.infer<typeof checkoutSessionSubmitSchema>
export type PublicSubmitInput = z.infer<typeof publicSubmitSchema>
