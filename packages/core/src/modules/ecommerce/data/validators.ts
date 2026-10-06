import { z } from 'zod'
import { CATALOG_PRODUCT_TYPES } from '@open-mercato/core/modules/catalog/data/types'

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

export const ecommerceStoreStatusValues = ['draft', 'active', 'archived'] as const
export const ecommerceStoreStatusSchema = z.enum(ecommerceStoreStatusValues)
export type EcommerceStoreStatus = z.infer<typeof ecommerceStoreStatusSchema>

export const ecommercePriceSortFallbackValues = ['approximate', 'unavailable'] as const
export const ecommercePriceSortFallbackSchema = z.enum(ecommercePriceSortFallbackValues)
export type EcommercePriceSortFallback = z.infer<typeof ecommercePriceSortFallbackSchema>

export const ecommercePriceDisplayModeValues = ['gross', 'net'] as const
export const ecommercePriceDisplayModeSchema = z.enum(ecommercePriceDisplayModeValues)
export type EcommercePriceDisplayMode = z.infer<typeof ecommercePriceDisplayModeSchema>

export type EcommerceBrandingFont = {
  id: string
  label: string
  stack: string
  googleFamily: string | null
}

export const ECOMMERCE_BRANDING_FONTS: readonly EcommerceBrandingFont[] = [
  {
    id: 'system-sans',
    label: 'System sans-serif',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    googleFamily: null,
  },
  { id: 'system-serif', label: 'System serif', stack: "Georgia, 'Times New Roman', Times, serif", googleFamily: null },
  {
    id: 'system-mono',
    label: 'System monospace',
    stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    googleFamily: null,
  },
  { id: 'inter', label: 'Inter', stack: "'Inter', sans-serif", googleFamily: 'Inter' },
  { id: 'roboto', label: 'Roboto', stack: "'Roboto', sans-serif", googleFamily: 'Roboto' },
  { id: 'open-sans', label: 'Open Sans', stack: "'Open Sans', sans-serif", googleFamily: 'Open Sans' },
  { id: 'lato', label: 'Lato', stack: "'Lato', sans-serif", googleFamily: 'Lato' },
  { id: 'montserrat', label: 'Montserrat', stack: "'Montserrat', sans-serif", googleFamily: 'Montserrat' },
  { id: 'poppins', label: 'Poppins', stack: "'Poppins', sans-serif", googleFamily: 'Poppins' },
  { id: 'dm-sans', label: 'DM Sans', stack: "'DM Sans', sans-serif", googleFamily: 'DM Sans' },
  { id: 'merriweather', label: 'Merriweather', stack: "'Merriweather', serif", googleFamily: 'Merriweather' },
  {
    id: 'playfair-display',
    label: 'Playfair Display',
    stack: "'Playfair Display', serif",
    googleFamily: 'Playfair Display',
  },
]

export const ecommerceBrandingFontIds: readonly string[] = ECOMMERCE_BRANDING_FONTS.map((font) => font.id)

export function findEcommerceBrandingFont(id: string): EcommerceBrandingFont | null {
  return ECOMMERCE_BRANDING_FONTS.find((font) => font.id === id) ?? null
}

const NUMBER_PATTERN = '(\\d+(?:\\.\\d+)?|\\.\\d+)'
const OKLCH_PATTERN = new RegExp(
  `^oklch\\(\\s*${NUMBER_PATTERN}(%?)\\s+${NUMBER_PATTERN}(%?)\\s+${NUMBER_PATTERN}(deg)?\\s*(?:\\/\\s*${NUMBER_PATTERN}(%?)\\s*)?\\)$`,
)
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const BORDER_RADIUS_PATTERN = /^(\d+(?:\.\d+)?|\.\d+)(rem|px)$/

const OKLCH_CHROMA_MAX = 0.5
const OKLCH_HUE_MAX = 360
const BORDER_RADIUS_REM_MAX = 5
const BORDER_RADIUS_PX_MAX = 80

function withinBounds(raw: string, percent: boolean, numericMax: number): boolean {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return false
  return percent ? value <= 100 : value <= numericMax
}

export function isValidOklchColor(value: string): boolean {
  const match = OKLCH_PATTERN.exec(value)
  if (!match) return false
  const [, lightness, lightnessPercent, chroma, chromaPercent, hue, , alpha, alphaPercent] = match
  if (!withinBounds(lightness, lightnessPercent === '%', 1)) return false
  if (!withinBounds(chroma, chromaPercent === '%', OKLCH_CHROMA_MAX)) return false
  if (!withinBounds(hue, false, OKLCH_HUE_MAX)) return false
  if (alpha !== undefined && !withinBounds(alpha, alphaPercent === '%', 1)) return false
  return true
}

export function isValidBrandingColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value) || isValidOklchColor(value)
}

export function isValidBorderRadius(value: string): boolean {
  if (value === '0') return true
  const match = BORDER_RADIUS_PATTERN.exec(value)
  if (!match) return false
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return false
  return match[2] === 'rem' ? amount <= BORDER_RADIUS_REM_MAX : amount <= BORDER_RADIUS_PX_MAX
}

const brandingColorSchema = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .max(64)
    .refine(isValidBrandingColor, { message: 'ecommerce.validation.colorInvalid' })
    .optional(),
)

const brandingFontSchema = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .refine((value) => ecommerceBrandingFontIds.includes(value), { message: 'ecommerce.validation.fontNotAllowed' })
    .optional(),
)

const borderRadiusSchema = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .max(16)
    .refine(isValidBorderRadius, { message: 'ecommerce.validation.borderRadiusInvalid' })
    .optional(),
)

const ROOT_RELATIVE_PATH_PATTERN = /^\/(?!\/)[A-Za-z0-9\-._~/%]*$/

export function isSafeAssetUrl(value: string): boolean {
  if (ROOT_RELATIVE_PATH_PATTERN.test(value)) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

const assetUrlSchema = z.preprocess(
  emptyStringToNull,
  z
    .string()
    .max(2048)
    .refine(isSafeAssetUrl, { message: 'ecommerce.validation.urlInvalid' })
    .nullable()
    .optional(),
)

const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => {
      try {
        const parsed = new URL(value)
        return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      } catch {
        return false
      }
    },
    { message: 'ecommerce.validation.urlInvalid' },
  )

const clearableStringSchema = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

const optionalStringSchema = (max: number) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().max(max).optional())

export const ecommerceStoreBrandingSchema = z
  .object({
    logoUrl: assetUrlSchema,
    faviconUrl: assetUrlSchema,
    primaryColor: brandingColorSchema,
    primaryForeground: brandingColorSchema,
    accentColor: brandingColorSchema,
    accentForeground: brandingColorSchema,
    backgroundColor: brandingColorSchema,
    foregroundColor: brandingColorSchema,
    borderRadius: borderRadiusSchema,
    fontFamilyBase: brandingFontSchema,
    fontFamilyHeading: brandingFontSchema,
  })
  .strict()

export type EcommerceStoreBranding = z.infer<typeof ecommerceStoreBrandingSchema>

const SOCIAL_NETWORK_KEY_PATTERN = /^[a-z0-9_-]{1,32}$/
const SOCIAL_LINKS_MAX = 20

export const ecommerceStoreContactSchema = z
  .object({
    email: z.preprocess(emptyStringToNull, z.string().trim().email().max(320).nullable().optional()),
    phone: clearableStringSchema(50),
    address: clearableStringSchema(1000),
    social: z
      .record(z.string().regex(SOCIAL_NETWORK_KEY_PATTERN), httpUrlSchema)
      .refine((value) => Object.keys(value).length <= SOCIAL_LINKS_MAX)
      .optional(),
  })
  .strict()

export type EcommerceStoreContact = z.infer<typeof ecommerceStoreContactSchema>

const ecommerceStoreDisplayShape = {
  priceDisplayModeDefault: ecommercePriceDisplayModeSchema,
  enableSearch: z.boolean(),
}

export const ecommerceStoreDisplaySchema = z
  .object({
    priceDisplayModeDefault: ecommercePriceDisplayModeSchema.default('gross'),
    enableSearch: z.boolean().default(true),
  })
  .strict()

export type EcommerceStoreDisplay = z.infer<typeof ecommerceStoreDisplaySchema>

const GOOGLE_SITE_VERIFICATION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export const ecommerceStoreSeoSchema = z
  .object({
    siteName: optionalStringSchema(200),
    defaultMetaDescription: optionalStringSchema(500),
    googleSiteVerification: z.preprocess(
      emptyStringToUndefined,
      z.string().regex(GOOGLE_SITE_VERIFICATION_PATTERN).optional(),
    ),
    robotsTxt: z.preprocess(emptyStringToUndefined, z.string().max(10000).optional()),
  })
  .strict()

export type EcommerceStoreSeo = z.infer<typeof ecommerceStoreSeoSchema>

export const ecommerceStoreSettingsSchema = z
  .object({
    branding: ecommerceStoreBrandingSchema.prefault({}),
    contact: ecommerceStoreContactSchema.prefault({}),
    display: ecommerceStoreDisplaySchema.prefault({}),
    seo: ecommerceStoreSeoSchema.prefault({}),
  })
  .strict()

export type EcommerceStoreSettings = z.infer<typeof ecommerceStoreSettingsSchema>

export const ecommerceStoreSettingsPatchSchema = z
  .object({
    branding: ecommerceStoreBrandingSchema.optional(),
    contact: ecommerceStoreContactSchema.optional(),
    display: z.object(ecommerceStoreDisplayShape).partial().strict().optional(),
    seo: ecommerceStoreSeoSchema.optional(),
  })
  .strict()

export type EcommerceStoreSettingsPatch = z.infer<typeof ecommerceStoreSettingsPatchSchema>

export const ECOMMERCE_STORE_CODE_PATTERN = /^[a-z0-9_-]+$/
export const ECOMMERCE_STORE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const ECOMMERCE_LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(ECOMMERCE_STORE_CODE_PATTERN, 'ecommerce.validation.codeInvalid')

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(ECOMMERCE_STORE_SLUG_PATTERN, 'ecommerce.validation.slugInvalid')

const nameSchema = z.string().trim().min(1).max(200)

const localeSchema = z.string().trim().regex(ECOMMERCE_LOCALE_PATTERN, 'ecommerce.validation.localeInvalid')

const supportedLocalesSchema = z
  .array(localeSchema)
  .min(1)
  .max(50)
  .refine((locales) => new Set(locales).size === locales.length, {
    message: 'ecommerce.validation.localesDuplicate',
  })

const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'ecommerce.validation.currencyCodeInvalid')

type LocalePair = { defaultLocale?: string; supportedLocales?: string[] }

function refineDefaultLocaleSupported(value: LocalePair, ctx: z.RefinementCtx): void {
  if (value.defaultLocale === undefined || value.supportedLocales === undefined) return
  if (value.supportedLocales.includes(value.defaultLocale)) return
  ctx.addIssue({
    code: 'custom',
    path: ['defaultLocale'],
    message: 'ecommerce.validation.defaultLocaleNotSupported',
  })
}

const ecommerceStoreBaseShape = {
  organizationId: uuid(),
  tenantId: uuid(),
  code: codeSchema,
  name: nameSchema,
  slug: slugSchema,
  status: ecommerceStoreStatusSchema,
  defaultLocale: localeSchema,
  supportedLocales: supportedLocalesSchema,
  defaultCurrencyCode: currencyCodeSchema,
  isPrimary: z.boolean(),
}

export const ecommerceStoreCreateSchema = z
  .object({
    ...ecommerceStoreBaseShape,
    status: ecommerceStoreStatusSchema.optional().default('draft'),
    isPrimary: z.boolean().optional().default(false),
    settings: ecommerceStoreSettingsSchema.prefault({}),
  })
  .strict()
  .superRefine(refineDefaultLocaleSupported)

export type EcommerceStoreCreateInput = z.infer<typeof ecommerceStoreCreateSchema>

export const ecommerceStoreUpdateSchema = z
  .object({
    id: uuid(),
    ...z.object(ecommerceStoreBaseShape).partial().shape,
    settings: ecommerceStoreSettingsPatchSchema.optional(),
  })
  .strict()
  .superRefine(refineDefaultLocaleSupported)

export type EcommerceStoreUpdateInput = z.infer<typeof ecommerceStoreUpdateSchema>

export const ecommerceStoreDeleteSchema = z.object({ id: uuid() }).strict()

export type EcommerceStoreDeleteInput = z.infer<typeof ecommerceStoreDeleteSchema>

const PATH_PREFIX_PATTERN = /^(?:\/[a-z0-9-]+)+$/
const PATH_PREFIX_MAX = 200

export function normalizePathPrefix(value: unknown): unknown {
  if (value === undefined || value === null) return value
  if (typeof value !== 'string') return value
  const lowered = value.trim().toLowerCase()
  const withoutTrailing = lowered.replace(/\/+$/, '')
  if (!withoutTrailing.length) return null
  return withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`
}

const pathPrefixSchema = z.preprocess(
  normalizePathPrefix,
  z
    .string()
    .max(PATH_PREFIX_MAX)
    .regex(PATH_PREFIX_PATTERN, 'ecommerce.validation.pathPrefixInvalid')
    .nullable()
    .optional(),
)

const ecommerceStoreDomainBindingBaseShape = {
  organizationId: uuid(),
  tenantId: uuid(),
  storeId: uuid(),
  domainMappingId: uuid(),
  pathPrefix: pathPrefixSchema,
  isPrimary: z.boolean(),
}

export const ecommerceStoreDomainBindingCreateSchema = z
  .object({
    ...ecommerceStoreDomainBindingBaseShape,
    isPrimary: z.boolean().optional().default(false),
  })
  .strict()

export type EcommerceStoreDomainBindingCreateInput = z.infer<typeof ecommerceStoreDomainBindingCreateSchema>

export const ecommerceStoreDomainBindingUpdateSchema = z
  .object({
    id: uuid(),
    ...z.object(ecommerceStoreDomainBindingBaseShape).partial().shape,
  })
  .strict()

export type EcommerceStoreDomainBindingUpdateInput = z.infer<typeof ecommerceStoreDomainBindingUpdateSchema>

export const ecommerceStoreDomainBindingDeleteSchema = z.object({ id: uuid() }).strict()

export type EcommerceStoreDomainBindingDeleteInput = z.infer<typeof ecommerceStoreDomainBindingDeleteSchema>

export const ecommerceAssortmentScopeSchema = z
  .object({
    categoryIds: z.array(uuid()).optional(),
    tagIds: z.array(uuid()).optional(),
    excludeProductIds: z.array(uuid()).optional(),
    excludeCategoryIds: z.array(uuid()).optional(),
    excludeTagIds: z.array(uuid()).optional(),
  })
  .strict()
  .nullable()

export type EcommerceAssortmentScopeInput = z.infer<typeof ecommerceAssortmentScopeSchema>

const clearableUuidSchema = z.preprocess(emptyStringToNull, uuid().nullable().optional())

const ecommerceStoreChannelBindingBaseShape = {
  organizationId: uuid(),
  tenantId: uuid(),
  storeId: uuid(),
  salesChannelId: uuid(),
  priceKindId: clearableUuidSchema,
  assortmentScope: ecommerceAssortmentScopeSchema.optional(),
  priceSortFallback: ecommercePriceSortFallbackSchema,
  isDefault: z.boolean(),
}

export const ecommerceStoreChannelBindingCreateSchema = z
  .object({
    ...ecommerceStoreChannelBindingBaseShape,
    priceSortFallback: ecommercePriceSortFallbackSchema.optional().default('approximate'),
    isDefault: z.boolean().optional().default(false),
  })
  .strict()

export type EcommerceStoreChannelBindingCreateInput = z.infer<typeof ecommerceStoreChannelBindingCreateSchema>

export const ecommerceStoreChannelBindingUpdateSchema = z
  .object({
    id: uuid(),
    ...z.object(ecommerceStoreChannelBindingBaseShape).partial().shape,
  })
  .strict()

export type EcommerceStoreChannelBindingUpdateInput = z.infer<typeof ecommerceStoreChannelBindingUpdateSchema>

export const ecommerceStoreChannelBindingDeleteSchema = z.object({ id: uuid() }).strict()

export type EcommerceStoreChannelBindingDeleteInput = z.infer<typeof ecommerceStoreChannelBindingDeleteSchema>

export const ecommerceStorefrontContextQuerySchema = z
  .object({
    storeSlug: z.string().max(120).optional(),
    locale: z.string().max(35).optional(),
    path: z.string().max(2048).optional(),
  })
  .strict()

export type EcommerceStorefrontContextQuery = z.infer<typeof ecommerceStorefrontContextQuerySchema>

export const ecommerceStorefrontProductSortValues = [
  'relevance',
  'price_asc',
  'price_desc',
  'title_asc',
  'title_desc',
  'newest',
  'featured',
] as const
export const ecommerceStorefrontProductSortSchema = z.enum(ecommerceStorefrontProductSortValues)
export type EcommerceStorefrontProductSort = z.infer<typeof ecommerceStorefrontProductSortSchema>

export const ecommerceStorefrontAvailabilityFilterValues = ['in_stock', 'available', 'all'] as const
export const ecommerceStorefrontAvailabilityFilterSchema = z.enum(ecommerceStorefrontAvailabilityFilterValues)
export type EcommerceStorefrontAvailabilityFilter = z.infer<typeof ecommerceStorefrontAvailabilityFilterSchema>

export const ECOMMERCE_STOREFRONT_MAX_PAGE_SIZE = 100
export const ECOMMERCE_STOREFRONT_DEFAULT_PAGE_SIZE = 24

const storefrontOptionCodeRegex = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

const commaSeparatedList = (maxItems: number, itemSchema: z.ZodString) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value
      const items = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
      return items.length ? Array.from(new Set(items)) : undefined
    },
    z.array(itemSchema).min(1).max(maxItems).optional(),
  )

const optionalNonNegativeAmount = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
)

export const ecommerceStorefrontProductListQuerySchema = z
  .object({
    page: z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(1).max(10_000).optional().default(1)),
    pageSize: z.preprocess(
      emptyStringToUndefined,
      z.coerce
        .number()
        .int()
        .min(1)
        .max(ECOMMERCE_STOREFRONT_MAX_PAGE_SIZE)
        .optional()
        .default(ECOMMERCE_STOREFRONT_DEFAULT_PAGE_SIZE),
    ),
    search: z.preprocess(emptyStringToUndefined, z.string().max(200).optional()),
    categoryId: z.preprocess(emptyStringToUndefined, uuid().optional()),
    categorySlug: z.preprocess(emptyStringToUndefined, z.string().max(255).optional()),
    tagSlugs: commaSeparatedList(20, z.string().max(255)),
    priceMin: optionalNonNegativeAmount,
    priceMax: optionalNonNegativeAmount,
    options: z
      .record(
        z.string().regex(storefrontOptionCodeRegex),
        z.array(z.string().min(1).max(255)).min(1).max(50),
      )
      .refine((value) => Object.keys(value).length <= 20)
      .optional(),
    productType: z.preprocess(emptyStringToUndefined, z.enum(CATALOG_PRODUCT_TYPES).optional()),
    availability: z.preprocess(
      emptyStringToUndefined,
      ecommerceStorefrontAvailabilityFilterSchema.optional().default('all'),
    ),
    sort: z.preprocess(emptyStringToUndefined, ecommerceStorefrontProductSortSchema.optional()),
    locale: z.string().max(35).optional(),
    path: z.string().max(2048).optional(),
    storeSlug: z.string().max(120).optional(),
  })
  .strict()
  .refine((value) => !(value.categoryId && value.categorySlug), {
    path: ['categorySlug'],
    message: 'categoryId and categorySlug are mutually exclusive',
  })
  .refine((value) => value.priceMin === undefined || value.priceMax === undefined || value.priceMin <= value.priceMax, {
    path: ['priceMax'],
    message: 'priceMax must not be lower than priceMin',
  })

export type EcommerceStorefrontProductListQuery = z.infer<typeof ecommerceStorefrontProductListQuerySchema>

export const ecommerceStorefrontProductDetailQuerySchema = z
  .object({
    variantId: z.preprocess(emptyStringToUndefined, uuid().optional()),
    locale: z.string().max(35).optional(),
    path: z.string().max(2048).optional(),
    storeSlug: z.string().max(120).optional(),
  })
  .strict()

export type EcommerceStorefrontProductDetailQuery = z.infer<typeof ecommerceStorefrontProductDetailQuerySchema>

export const ecommerceStorefrontProductParamsSchema = z.object({
  idOrHandle: z.string().trim().min(1).max(255),
})

export type EcommerceStorefrontProductParams = z.infer<typeof ecommerceStorefrontProductParamsSchema>
