import { z } from 'zod'
import { CATALOG_PRODUCT_TYPES } from '@open-mercato/core/modules/catalog/data/types'
import {
  ecommercePriceDisplayModeSchema,
  ecommercePriceSortFallbackSchema,
  ecommerceStorefrontProductSortSchema,
} from '../../../data/validators'

const availabilityStateSchema = z.enum(['in_stock', 'low_stock', 'out_of_stock', 'backorder', 'preorder', 'not_tracked'])

export const storefrontPriceSchema = z.object({
  currencyCode: z.string(),
  displayMode: ecommercePriceDisplayModeSchema,
  amount: z.number(),
  formatted: z.string(),
  isPromotion: z.boolean(),
  originalAmount: z.number().nullable(),
  formattedOriginal: z.string().nullable(),
  lowestPriorAmount: z.number().nullable(),
  formattedLowestPrior: z.string().nullable(),
})

export const storefrontPriceRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
  formattedMin: z.string(),
  formattedMax: z.string(),
})

export const storefrontPriceTierSchema = z.object({
  minQuantity: z.number(),
  maxQuantity: z.number().nullable(),
  amount: z.number(),
  formatted: z.string(),
})

export const storefrontAvailabilitySchema = z.object({
  state: availabilityStateSchema,
  canFulfil: z.boolean(),
  leadTimeDays: z.number().nullable(),
  releaseAt: z.string().nullable(),
})

export const storefrontProductListItemSchema = z.object({
  id: z.string().uuid(),
  handle: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  defaultMediaUrl: z.string().nullable(),
  productType: z.string(),
  isConfigurable: z.boolean(),
  hasVariants: z.boolean(),
  variantCount: z.number().int(),
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string().nullable() })),
  tags: z.array(z.string()),
  price: storefrontPriceSchema.nullable(),
  priceRange: storefrontPriceRangeSchema.nullable(),
  availability: storefrontAvailabilitySchema,
  badges: z.array(z.string()),
})

const storefrontFacetsSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      slug: z.string().nullable(),
      depth: z.number().int(),
      parentId: z.string().uuid().nullable(),
      count: z.number().int(),
    }),
  ),
  tags: z.array(z.object({ slug: z.string(), label: z.string(), count: z.number().int() })),
  priceRange: z.object({ min: z.number(), max: z.number(), currencyCode: z.string() }).nullable(),
  options: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      values: z.array(z.object({ code: z.string(), label: z.string(), count: z.number().int() })),
    }),
  ),
  productTypes: z.array(z.object({ type: z.string(), label: z.string(), count: z.number().int() })),
  availability: z.array(z.object({ state: availabilityStateSchema, count: z.number().int() })),
  availabilityScope: z.literal('page'),
  total: z.number().int(),
})

const storefrontAppliedFiltersSchema = z.object({
  search: z.string().optional(),
  category: z
    .object({ id: z.string().uuid(), slug: z.string().nullable(), includesDescendants: z.literal(true) })
    .optional(),
  tagSlugs: z.array(z.string()).optional(),
  price: z.object({ min: z.number().nullable(), max: z.number().nullable(), approximate: z.boolean() }).optional(),
  options: z.record(z.string(), z.array(z.string())).optional(),
  productType: z.enum(CATALOG_PRODUCT_TYPES).optional(),
  availability: z.object({ value: z.enum(['in_stock', 'available']), scope: z.literal('page') }).optional(),
})

export const storefrontProductListResponseSchema = z.object({
  items: z.array(storefrontProductListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
  facets: storefrontFacetsSchema.describe(
    'Cross-excluded facet counts over the buyer assortment; priceRange is buyer-priced, availability counts the returned page',
  ),
  effectiveLocale: z.string(),
  requestedLocale: z.string().nullable(),
  currencyCode: z.string(),
  taxMode: ecommercePriceDisplayModeSchema,
  appliedFilters: storefrontAppliedFiltersSchema,
  availableSorts: z.array(ecommerceStorefrontProductSortSchema),
  appliedSort: ecommerceStorefrontProductSortSchema,
  priceSort: z.object({ cap: z.number().int(), fallback: ecommercePriceSortFallbackSchema, capExceeded: z.boolean() }),
  sortApproximate: z.boolean(),
  sortUnavailable: z.boolean(),
})

const dimensionsSchema = z
  .object({
    length: z.number().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    unit: z.string().nullable(),
  })
  .nullable()

const optionSchemaSchema = z
  .object({
    version: z.number().int().optional(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    options: z.array(
      z.object({
        code: z.string(),
        label: z.string(),
        description: z.string().nullable().optional(),
        inputType: z.string(),
        isRequired: z.boolean().optional(),
        isMultiple: z.boolean().optional(),
        choices: z.array(z.object({ code: z.string(), label: z.string().nullable().optional() })).optional(),
      }),
    ),
  })
  .nullable()

export const storefrontProductDetailResponseSchema = storefrontProductListItemSchema
  .omit({ categories: true })
  .extend({
    description: z.string().nullable(),
    sku: z.string().nullable(),
    media: z.array(z.object({ id: z.string(), url: z.string(), alt: z.string().nullable(), sortOrder: z.number().int() })),
    dimensions: dimensionsSchema,
    weightValue: z.number().nullable(),
    weightUnit: z.string().nullable(),
    categories: z.array(
      z.object({ id: z.string().uuid(), name: z.string(), slug: z.string().nullable(), ancestorIds: z.array(z.string().uuid()) }),
    ),
    breadcrumb: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string().nullable() })),
    optionSchema: optionSchemaSchema,
    variants: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        sku: z.string().nullable(),
        optionValues: z.record(z.string(), z.string()),
        isDefault: z.boolean(),
        price: storefrontPriceSchema.nullable(),
        priceTiers: z.array(storefrontPriceTierSchema).describe('Quantity tiers of this variant for this buyer'),
        availability: storefrontAvailabilitySchema,
        dimensions: dimensionsSchema,
        weightValue: z.number().nullable(),
        weightUnit: z.string().nullable(),
      }),
    ),
    selectedVariantId: z
      .string()
      .uuid()
      .nullable()
      .describe('The requested variantId when it is one of variants, else the default variant, else null'),
    quantityRules: z.object({
      minOrderQuantity: z.number().nullable(),
      maxOrderQuantity: z.number().nullable(),
      quantityIncrement: z.number().nullable(),
    }),
    priceTiers: z
      .array(storefrontPriceTierSchema)
      .describe('Quantity tiers of selectedVariantId when one is selected, else of the product'),
    relatedProducts: z.array(storefrontProductListItemSchema).max(8),
    seo: z.object({ title: z.string().nullable(), description: z.string().nullable(), canonicalUrl: z.string().nullable() }),
  })
