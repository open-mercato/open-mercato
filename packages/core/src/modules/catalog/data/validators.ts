import { z } from 'zod'
import { CATALOG_PRICE_DISPLAY_MODES, CATALOG_PRODUCT_TYPES } from './types'
import { REFERENCE_UNIT_CODES } from '../lib/unitCodes'

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
const uomRoundingModeSchema = z.enum(['half_up', 'down', 'up'])
const unitPriceReferenceUnitSchema = z.enum(REFERENCE_UNIT_CODES)
const unitPriceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  referenceUnit: unitPriceReferenceUnitSchema.nullable().optional(),
  baseQuantity: z.coerce.number().positive().optional(),
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

export const productCreateSchema = scoped
  .extend({
    title: z.string().trim().min(1).max(255),
    subtitle: z.string().trim().max(255).optional(),
    description: z.string().trim().max(4000).optional(),
    sku: skuSchema.optional(),
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
    omnibusExempt: z.boolean().optional(),
    firstListedAt: z.coerce.date().optional().nullable(),
    metadata: metadataSchema,
    offers: z.array(offerInputSchema.omit({ id: true })).optional(),
    categoryIds: z.array(uuid()).max(100).optional(),
    tags: z.array(tagLabelSchema).max(100).optional(),
  })
  .superRefine(productUomCrossFieldRefinement)

export const productUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(productCreateSchema.partial())
  .extend({
    productType: productTypeSchema.optional(),
  })
  .superRefine(productUomCrossFieldRefinement)

export const variantCreateSchema = scoped.extend({
  productId: uuid(),
  name: z.string().trim().max(255).optional(),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9\-_\.]+$/)
    .max(191)
    .optional(),
  barcode: z.string().trim().max(191).optional(),
  statusEntryId: uuid().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  defaultMediaId: uuid().optional().nullable(),
  defaultMediaUrl: z.string().trim().max(500).optional().nullable(),
  weightValue: z.coerce.number().min(0).optional(),
  weightUnit: z.string().trim().max(25).optional(),
  taxRateId: uuid().nullable().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
  omnibusExempt: z.boolean().nullable().optional(),
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

export const variantUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(variantCreateSchema.partial())

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
  unitPriceNet: z.coerce.number().min(0).optional(),
  unitPriceGross: z.coerce.number().min(0).optional(),
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

const iso3166Alpha2 = z.string().regex(/^[A-Z]{2}$/, 'Must be ISO 3166-1 alpha-2 country code').refine(
  (v) => v !== 'EU',
  'Use individual member state codes, not "EU"'
)

export const omnibusChannelConfigSchema = z.object({
  presentedPriceKindId: uuid(),
  countryCode: iso3166Alpha2.optional(),
  lookbackDays: z.number().int().min(1).max(365).optional(),
  minimizationAxis: z.enum(['gross', 'net']).optional(),
  progressiveReductionRule: z.boolean().optional(),
  perishableGoodsRule: z.enum(['standard', 'exempt', 'last_price']).optional(),
  perishableLookbackDays: z.number().int().positive().optional(),
  newArrivalRule: z.enum(['standard', 'shorter_window']).optional(),
  newArrivalsLookbackDays: z.number().int().positive().nullable().optional(),
})

export const omnibusConfigSchema = z.object({
  enabled: z.boolean().optional(),
  lookbackDays: z.number().int().min(1).max(365).optional(),
  enabledCountryCodes: z.array(iso3166Alpha2).optional(),
  noChannelMode: z.enum(['best_effort', 'require_channel']).optional(),
  channels: z.record(z.string(), omnibusChannelConfigSchema).optional(),
})

export type OmnibusChannelConfig = z.infer<typeof omnibusChannelConfigSchema>
export type OmnibusConfig = z.infer<typeof omnibusConfigSchema>

export type ProductUnitConversionCreateInput = z.infer<typeof productUnitConversionCreateSchema>
export type ProductUnitConversionUpdateInput = z.infer<typeof productUnitConversionUpdateSchema>
export type ProductUnitConversionDeleteInput = z.infer<typeof productUnitConversionDeleteSchema>
