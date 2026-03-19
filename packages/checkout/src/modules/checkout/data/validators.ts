import { z } from 'zod'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../setup'

const hexColorSchema = z.string().regex(/^#([0-9a-fA-F]{6})$/)
const currencyCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)
const optionalTrimmedString = z.string().trim().min(1).optional().nullable()
const positiveMoneySchema = z.coerce.number().finite().nonnegative()

export const customerFieldOptionSchema = z.object({
  value: z.string().trim().min(1),
  label: z.string().trim().min(1),
})

export const customerFieldDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  label: z.string().trim().min(1),
  kind: z.enum(['text', 'multiline', 'boolean', 'select', 'radio']),
  required: z.boolean(),
  fixed: z.boolean(),
  placeholder: optionalTrimmedString,
  options: z.array(customerFieldOptionSchema).optional(),
  sortOrder: z.coerce.number().int().min(0),
})

export const legalDocumentSchema = z.object({
  title: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
  required: z.boolean().default(false),
})

export const legalDocumentsSchema = z.object({
  terms: legalDocumentSchema.optional(),
  privacyPolicy: legalDocumentSchema.optional(),
}).optional()

export const priceListItemSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().trim().min(1),
  amount: positiveMoneySchema,
  currencyCode: currencyCodeSchema,
})

export const gatewaySettingsSchema = z.record(z.string(), z.unknown()).optional()

const checkoutContentSchema = z.object({
  name: z.string().trim().min(1),
  title: optionalTrimmedString,
  subtitle: optionalTrimmedString,
  description: z.string().optional().nullable(),
  logoAttachmentId: z.string().uuid().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  primaryColor: hexColorSchema.optional().nullable(),
  secondaryColor: hexColorSchema.optional().nullable(),
  backgroundColor: hexColorSchema.optional().nullable(),
  themeMode: z.enum(['light', 'dark', 'auto']).default('auto'),
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
  errorEmailSubject: optionalTrimmedString,
  errorEmailBody: z.string().optional().nullable(),
  startEmailSubject: optionalTrimmedString,
  startEmailBody: z.string().optional().nullable(),
  password: optionalTrimmedString,
  maxCompletions: z.coerce.number().int().positive().optional().nullable(),
  isActive: z.boolean().default(true),
  checkoutType: z.enum(['pay_link', 'simple_checkout']).default('pay_link'),
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

export const createTemplateSchema = checkoutContentSchema.superRefine(validatePricingConsistency)

export const updateTemplateSchema = checkoutContentSchema.partial().extend({
  id: z.string().uuid(),
  password: optionalTrimmedString,
  customerFieldsSchema: z.array(customerFieldDefinitionSchema).optional(),
}).superRefine((value, ctx) => {
  if (value.pricingMode) {
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
})

export const createLinkSchema = createTemplateSchema.extend({
  templateId: z.string().uuid().optional().nullable(),
  slug: optionalTrimmedString,
})

export const updateLinkSchema = createLinkSchema.partial().extend({
  id: z.string().uuid(),
  slug: optionalTrimmedString,
})

export const transactionStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled', 'expired'])

export const transactionCreateSchema = z.object({
  linkId: z.string().uuid(),
  amount: positiveMoneySchema,
  currencyCode: currencyCodeSchema,
  customerData: z.record(z.string(), z.unknown()).default({}),
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
  email: optionalTrimmedString,
  phone: optionalTrimmedString,
  gatewayTransactionId: z.string().uuid().optional().nullable(),
  paymentStatus: optionalTrimmedString,
  selectedPriceItemId: optionalTrimmedString,
  acceptedLegalConsents: z.record(z.string(), z.unknown()).optional().nullable(),
  ipAddress: optionalTrimmedString,
  userAgent: z.string().optional().nullable(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const transactionUpdateStatusSchema = z.object({
  id: z.string().uuid(),
  status: transactionStatusSchema,
  paymentStatus: optionalTrimmedString,
  gatewayTransactionId: z.string().uuid().optional().nullable(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const publicPasswordVerifySchema = z.object({
  password: z.string().min(1),
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
export type PublicSubmitInput = z.infer<typeof publicSubmitSchema>
