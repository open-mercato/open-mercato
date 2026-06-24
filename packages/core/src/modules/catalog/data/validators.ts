import { z } from 'zod'
import {
  CATALOG_EXCISE_CATEGORIES,
  CATALOG_GTIN_TYPES,
  CATALOG_GTU_CODES,
  CATALOG_HAZMAT_PACKING_GROUPS,
  CATALOG_PRICE_DISPLAY_MODES,
  CATALOG_PRODUCT_TYPES,
  CATALOG_SERVICE_WORK_ALLOCATION_MODES,
  CATALOG_SERVICE_WORK_TARGET_TYPES,
} from './types'
import { isValidGtin, normalizeGtinValue } from '../lib/gtin'
import { REFERENCE_UNIT_CODES } from '../lib/unitCodes'
import {
  getCatalogPriceAmountValidationMessage,
  validateCatalogPriceAmountInput,
} from '../lib/priceValidation'

const uuid = () => z.string().uuid()

const scoped = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const tenantScoped = z.object({
  tenantId: uuid(),
})

const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'currency code must be a three-letter ISO code')

const metadataSchema = z.record(z.string(), z.unknown()).optional()

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9\-_]+$/, 'code must contain lowercase letters, digits, hyphen, or underscore')
  .max(150)

const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9\-_]+$/, 'handle must contain lowercase letters, digits, hyphen, or underscore')
  .max(150)

const skuSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9\-_\.]+$/, 'SKU may include letters, numbers, hyphen, underscore, or period')
  .max(191)

const variantOptionValuesSchema = z
  .record(
    z
      .string()
      .trim()
      .min(1)
      .max(191),
    z.string().trim().max(255)
  )
  .optional()

const optionChoiceSchema = z.object({
  code: slugSchema,
  label: z.string().trim().max(255).optional(),
})

const optionDefinitionSchema = z.object({
  code: slugSchema,
  label: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional(),
  inputType: z.enum(['select', 'text', 'textarea', 'number']),
  isRequired: z.boolean().optional(),
  isMultiple: z.boolean().optional(),
  choices: z.array(optionChoiceSchema).max(200).optional(),
})

const optionSchema = z.object({
  version: z.number().int().min(1).optional(),
  name: z.string().trim().max(255).optional(),
  description: z.string().trim().max(4000).optional(),
  options: z.array(optionDefinitionSchema).max(64),
})

const tagLabelSchema = z.string().trim().min(1).max(100)

const offerBaseSchema = z.object({
  channelId: uuid(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).optional(),
  defaultMediaId: uuid().optional().nullable(),
  defaultMediaUrl: z.string().trim().max(500).optional().nullable(),
  metadata: metadataSchema,
  isActive: z.boolean().optional(),
})

const offerInputSchema = offerBaseSchema.extend({
  id: uuid().optional(),
})

export const offerCreateSchema = scoped.merge(
  offerBaseSchema.extend({
    productId: uuid(),
  })
)

export const offerUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(
    offerBaseSchema
      .extend({
        productId: uuid().optional(),
      })
      .partial()
  )

const productTypeSchema = z.enum(CATALOG_PRODUCT_TYPES)
const serviceWorkTargetTypeSchema = z.enum(CATALOG_SERVICE_WORK_TARGET_TYPES)
const serviceWorkAllocationModeSchema = z.enum(CATALOG_SERVICE_WORK_ALLOCATION_MODES)
const uomRoundingModeSchema = z.enum(['half_up', 'down', 'up'])
const unitPriceReferenceUnitSchema = z.enum(REFERENCE_UNIT_CODES)
const unitPriceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  referenceUnit: unitPriceReferenceUnitSchema.nullable().optional(),
  baseQuantity: z.coerce.number().positive().optional(),
})

const catalogPriceAmountSchema = z
  .custom<number>((value) => validateCatalogPriceAmountInput(value).ok, {
    message: getCatalogPriceAmountValidationMessage(),
  })
  .transform((value) => {
    const result = validateCatalogPriceAmountInput(value)
    if (!result.ok) {
      throw new Error('catalogPriceAmountSchema transform reached invalid state')
    }
    return result.numeric
  })

function productUomCrossFieldRefinement(
  input: {
    defaultUnit?: string | null
    defaultSalesUnit?: string | null
    unitPriceEnabled?: boolean
    unitPriceReferenceUnit?: string | null
    unitPriceBaseQuantity?: number
    unitPrice?: { enabled?: boolean; referenceUnit?: string | null; baseQuantity?: number }
  },
  ctx: z.RefinementCtx,
) {
  const defaultUnit = typeof input.defaultUnit === 'string' ? input.defaultUnit.trim() : ''
  const defaultSalesUnit =
    typeof input.defaultSalesUnit === 'string' ? input.defaultSalesUnit.trim() : ''
  if (defaultSalesUnit && !defaultUnit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultSalesUnit'],
      message: 'catalog.products.validation.baseUnitRequired',
    })
  }
  const unitPriceEnabled = input.unitPrice?.enabled ?? input.unitPriceEnabled ?? false
  if (!unitPriceEnabled) return
  const referenceUnit =
    input.unitPrice?.referenceUnit ?? input.unitPriceReferenceUnit ?? null
  const baseQuantity =
    input.unitPrice?.baseQuantity ?? input.unitPriceBaseQuantity ?? null
  if (!referenceUnit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unitPrice'],
      message: 'catalog.products.validation.referenceUnitRequired',
    })
  }
  if (baseQuantity === null || baseQuantity === undefined || Number(baseQuantity) <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unitPrice'],
      message: 'catalog.products.unitPrice.errors.baseQuantity',
    })
  }
}

// Base schema without refinements (used for .partial() in update schema)
const productBaseSchema = scoped.extend({
  title: z.string().trim().min(1).max(255),
  subtitle: z.string().trim().max(255).optional(),
  description: z.string().trim().max(4000).optional(),
  sku: skuSchema.nullable().optional(),
  handle: handleSchema.optional(),
  taxRateId: uuid().nullable().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
  productType: productTypeSchema.default('simple'),
  statusEntryId: uuid().optional(),
  primaryCurrencyCode: currencyCodeSchema.optional(),
  defaultUnit: z.string().trim().max(50).optional().nullable(),
  defaultSalesUnit: z.string().trim().max(50).optional().nullable(),
  defaultSalesUnitQuantity: z.coerce.number().positive().optional(),
  uomRoundingScale: z.coerce.number().int().min(0).max(6).optional(),
  uomRoundingMode: uomRoundingModeSchema.optional(),
  unitPriceEnabled: z.boolean().optional(),
  unitPriceReferenceUnit: unitPriceReferenceUnitSchema.nullable().optional(),
  unitPriceBaseQuantity: z.coerce.number().positive().optional(),
  unitPrice: unitPriceConfigSchema.optional(),
  defaultMediaId: uuid().optional().nullable(),
  defaultMediaUrl: z.string().trim().max(500).optional().nullable(),
  weightValue: z.coerce.number().min(0).optional().nullable(),
  weightUnit: z.string().trim().max(25).optional().nullable(),
  dimensions: z
    .object({
      width: z.coerce.number().min(0).optional(),
      height: z.coerce.number().min(0).optional(),
      depth: z.coerce.number().min(0).optional(),
      unit: z.string().trim().max(25).optional(),
    })
    .optional()
    .nullable(),
  optionSchemaId: uuid().nullable().optional(),
  optionSchema: optionSchema.optional(),
  customFieldsetCode: slugSchema.nullable().optional(),
  isConfigurable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  countryOfOriginCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'catalog.products.validation.countryCodeInvalid')
    .nullable()
    .optional(),
  pkwiuCode: z.string().trim().min(1).max(32).nullable().optional(),
  cnCode: z.string().trim().min(1).max(32).nullable().optional(),
  hsCode: z.string().trim().min(1).max(32).nullable().optional(),
  taxClassificationCode: z.string().trim().min(1).max(64).nullable().optional(),
  gtuCodes: z
    .array(z.enum(CATALOG_GTU_CODES))
    .max(13)
    .transform((codes) => Array.from(new Set(codes)).sort())
    .nullable()
    .optional(),
  ageMin: z.coerce.number().int().min(0).max(120).nullable().optional(),
  isExciseGood: z.boolean().optional(),
  exciseCategory: z.enum(CATALOG_EXCISE_CATEGORIES).nullable().optional(),
  requiresPrescription: z.boolean().optional(),
  hazmatClass: z.string().trim().min(1).max(32).nullable().optional(),
  unNumber: z
    .string()
    .trim()
    .regex(/^(?:UN)?[0-9]{4}$/i, 'catalog.products.validation.unNumberInvalid')
    .transform((value) => {
      const upper = value.toUpperCase()
      return upper.startsWith('UN') ? upper : `UN${upper}`
    })
    .nullable()
    .optional(),
  hazmatPackingGroup: z.enum(CATALOG_HAZMAT_PACKING_GROUPS).nullable().optional(),
  containsLithiumBattery: z.boolean().optional(),
  launchAt: z.coerce.date().nullable().optional(),
  endOfLifeAt: z.coerce.date().nullable().optional(),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
  minOrderQty: z.coerce.number().int().min(1).nullable().optional(),
  maxOrderQty: z.coerce.number().int().min(1).nullable().optional(),
  orderQtyIncrement: z.coerce.number().int().min(1).nullable().optional(),
  requiresShipping: z.boolean().optional(),
  isQuoteOnly: z.boolean().optional(),
  seoTitle: z.string().trim().min(1).max(255).nullable().optional(),
  seoDescription: z.string().trim().min(1).max(1000).nullable().optional(),
  canonicalUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\/\S+$/, 'catalog.products.validation.canonicalUrlInvalid')
    .nullable()
    .optional(),
  metadata: metadataSchema,
  offers: z.array(offerInputSchema.omit({ id: true })).optional(),
  categoryIds: z.array(uuid()).max(100).optional(),
  tags: z.array(tagLabelSchema).max(100).optional(),
})

// Cross-field checks chained on the exported schemas only — refining the base
// schema itself would break `.partial()` in the update schema.
const productComplianceCrossFieldRefinement = (
  input: {
    minOrderQty?: number | null
    maxOrderQty?: number | null
    launchAt?: Date | null
    endOfLifeAt?: Date | null
    availableFrom?: Date | null
    availableUntil?: Date | null
  },
  ctx: z.RefinementCtx,
) => {
  if (
    input.minOrderQty != null &&
    input.maxOrderQty != null &&
    input.maxOrderQty < input.minOrderQty
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxOrderQty'],
      message: 'catalog.products.validation.orderQtyRange',
    })
  }
  if (input.launchAt && input.endOfLifeAt && input.endOfLifeAt < input.launchAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endOfLifeAt'],
      message: 'catalog.products.validation.lifecycleDateRange',
    })
  }
  if (
    input.availableFrom &&
    input.availableUntil &&
    input.availableUntil < input.availableFrom
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['availableUntil'],
      message: 'catalog.products.validation.availabilityDateRange',
    })
  }
}

export const productCreateSchema = productBaseSchema
  .superRefine(productUomCrossFieldRefinement)
  .superRefine(productComplianceCrossFieldRefinement)

export const productUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(productBaseSchema.partial())
  .extend({
    productType: productTypeSchema.optional(),
  })
  .superRefine(productUomCrossFieldRefinement)
  .superRefine(productComplianceCrossFieldRefinement)

export const serviceMediaInputSchema = z.object({
  id: uuid().optional(),
  fileId: uuid().optional().nullable(),
  url: z.string().trim().max(1000).optional().nullable(),
  alt: z.string().trim().max(500).optional().nullable(),
  contentType: z.string().trim().max(191).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  isDefault: z.boolean().optional(),
  metadata: metadataSchema,
})

export const serviceWorkRequirementInputSchema = z.object({
  id: uuid().optional(),
  targetType: serviceWorkTargetTypeSchema,
  targetId: uuid().optional().nullable(),
  labelSnapshot: z.string().trim().min(1).max(255),
  allocationMode: serviceWorkAllocationModeSchema,
  allocationValue: z.coerce.number().positive().max(100000),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  metadata: metadataSchema,
})

const serviceBaseSchema = scoped.extend({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).optional().nullable(),
  scope: z.string().trim().max(4000).optional().nullable(),
  categoryId: uuid().optional().nullable(),
  defaultPriceAmount: catalogPriceAmountSchema.optional().nullable(),
  defaultPriceCurrencyCode: currencyCodeSchema.optional().nullable(),
  defaultMediaId: uuid().optional().nullable(),
  defaultMediaUrl: z.string().trim().max(1000).optional().nullable(),
  metadata: metadataSchema,
  isActive: z.boolean().optional(),
  media: z.array(serviceMediaInputSchema).max(100).optional(),
  workRequirements: z.array(serviceWorkRequirementInputSchema).max(100).optional(),
})

export const serviceCreateSchema = serviceBaseSchema

export const serviceUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(serviceBaseSchema.partial())

// Base schema without refinements (used for .partial() in update schema)
const variantBaseSchema = scoped.extend({
  productId: uuid(),
  name: z.string().trim().max(255).optional(),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9\-_\.]+$/)
    .max(191)
    .optional(),
  barcode: z.string().trim().max(191).optional(),
  gtinType: z.enum(CATALOG_GTIN_TYPES).nullable().optional(),
  hsCode: z.string().trim().min(1).max(32).nullable().optional(),
  statusEntryId: uuid().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  defaultMediaId: uuid().optional().nullable(),
  defaultMediaUrl: z.string().trim().max(500).optional().nullable(),
  weightValue: z.coerce.number().min(0).optional(),
  weightUnit: z.string().trim().max(25).optional(),
  taxRateId: uuid().nullable().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
  dimensions: z
    .object({
      width: z.coerce.number().min(0).optional(),
      height: z.coerce.number().min(0).optional(),
      depth: z.coerce.number().min(0).optional(),
      unit: z.string().trim().max(25).optional(),
    })
    .optional(),
  metadata: metadataSchema,
  optionValues: variantOptionValuesSchema,
  customFieldsetCode: slugSchema.nullable().optional(),
})

// Payload-level GTIN check. Partial updates carrying only one of
// (gtinType, barcode) are re-validated against the merged record state in the
// catalog.variants.update command — zod cannot see the stored half here.
const variantGtinRefinement =
  (mode: 'create' | 'update') =>
  (
    input: {
      gtinType?: (typeof CATALOG_GTIN_TYPES)[number] | null
      barcode?: string
    },
    ctx: z.RefinementCtx,
  ) => {
    const gtinType = input.gtinType
    if (!gtinType) return
    const barcode = input.barcode
    if (barcode === undefined) {
      if (mode === 'create') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['barcode'],
          message: 'catalog.variants.validation.gtinBarcodeRequired',
        })
      }
      return
    }
    if (!barcode.trim().length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['barcode'],
        message: 'catalog.variants.validation.gtinBarcodeRequired',
      })
      return
    }
    if (!isValidGtin(gtinType, normalizeGtinValue(gtinType, barcode))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['barcode'],
        message: 'catalog.variants.validation.gtinChecksum',
      })
    }
  }

export const variantCreateSchema = variantBaseSchema.superRefine(
  variantGtinRefinement('create'),
)

export const variantUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(variantBaseSchema.partial())
  .superRefine(variantGtinRefinement('update'))

export const optionSchemaTemplateCreateSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  code: slugSchema.optional(),
  description: z.string().trim().max(4000).optional(),
  schema: optionSchema,
  metadata: metadataSchema,
  isActive: z.boolean().optional(),
})

export const optionSchemaTemplateUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(optionSchemaTemplateCreateSchema.partial())

const priceDisplayModeSchema = z.enum(CATALOG_PRICE_DISPLAY_MODES)

export const priceKindCreateSchema = tenantScoped.extend({
  code: slugSchema,
  title: z.string().trim().min(1).max(255),
  displayMode: priceDisplayModeSchema.default('excluding-tax'),
  currencyCode: currencyCodeSchema.optional(),
  isPromotion: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const priceKindUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(priceKindCreateSchema.partial())

export const priceCreateSchema = scoped.extend({
  variantId: uuid().optional(),
  productId: uuid().optional(),
  offerId: uuid().optional(),
  currencyCode: currencyCodeSchema,
  priceKindId: uuid(),
  minQuantity: z.coerce.number().int().min(1).optional(),
  maxQuantity: z.coerce.number().int().min(1).optional(),
  unitPriceNet: catalogPriceAmountSchema.optional(),
  unitPriceGross: catalogPriceAmountSchema.optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  taxRateId: uuid().nullable().optional(),
  channelId: uuid().optional(),
  userId: uuid().optional(),
  userGroupId: uuid().optional(),
  customerId: uuid().optional(),
  customerGroupId: uuid().optional(),
  metadata: metadataSchema,
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
})

export const priceUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(priceCreateSchema.partial())

export const categoryCreateSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  slug: slugSchema.optional().nullable(),
  description: z.string().trim().max(2000).optional(),
  parentId: uuid().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const categoryUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(categoryCreateSchema.partial())

export const productUnitConversionCreateSchema = scoped.extend({
  productId: uuid(),
  unitCode: z.string().trim().min(1).max(50),
  toBaseFactor: z.coerce.number().positive().max(1_000_000),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
  metadata: metadataSchema,
})

export const productUnitConversionUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(productUnitConversionCreateSchema.omit({ productId: true }).partial())

export const productUnitConversionDeleteSchema = scoped.extend({
  id: uuid(),
})

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>
export type ServiceMediaInput = z.infer<typeof serviceMediaInputSchema>
export type ServiceWorkRequirementInput = z.infer<typeof serviceWorkRequirementInputSchema>
export type VariantCreateInput = z.infer<typeof variantCreateSchema>
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>
export type OptionSchemaTemplateCreateInput = z.infer<typeof optionSchemaTemplateCreateSchema>
export type OptionSchemaTemplateUpdateInput = z.infer<typeof optionSchemaTemplateUpdateSchema>
export type PriceKindCreateInput = z.infer<typeof priceKindCreateSchema>
export type PriceKindUpdateInput = z.infer<typeof priceKindUpdateSchema>
export type PriceCreateInput = z.infer<typeof priceCreateSchema>
export type PriceUpdateInput = z.infer<typeof priceUpdateSchema>
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type OfferInput = z.infer<typeof offerInputSchema>
export type OfferCreateInput = z.infer<typeof offerCreateSchema>
export type OfferUpdateInput = z.infer<typeof offerUpdateSchema>
export type ProductUnitConversionCreateInput = z.infer<typeof productUnitConversionCreateSchema>
export type ProductUnitConversionUpdateInput = z.infer<typeof productUnitConversionUpdateSchema>
export type ProductUnitConversionDeleteInput = z.infer<typeof productUnitConversionDeleteSchema>
