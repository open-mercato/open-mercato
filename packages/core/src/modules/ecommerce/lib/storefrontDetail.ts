import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductPrice,
  CatalogProductCategoryAssignment,
  CatalogProductTagAssignment,
  CatalogOffer,
  CatalogOptionSchemaTemplate,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import type { PriceRow } from '@open-mercato/core/modules/catalog/lib/pricing'
import { resolvePriceKindCode } from '@open-mercato/core/modules/catalog/lib/pricing'
import type { StoreContext } from './storeContext'
import { filterByPriceKind } from './storefrontProducts'

export type StorefrontVariantPricing = {
  currencyCode: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  displayMode: string
  isPromotion: boolean
}

export type StorefrontVariant = {
  id: string
  name: string | null
  sku: string | null
  optionValues: Record<string, string> | null
  isDefault: boolean
  isActive: boolean
  pricing: StorefrontVariantPricing | null
  dimensions: { width?: number | null; height?: number | null; depth?: number | null; unit?: string | null } | null
  weightValue: string | null
  weightUnit: string | null
}

export type StorefrontProductMedia = {
  id: string
  url: string
  alt: string | null
}

export type StorefrontRelatedProduct = {
  id: string
  handle: string | null
  title: string
  defaultMediaUrl: string | null
  priceRange: { min: string; max: string; currencyCode: string } | null
}

export type StorefrontProductDetail = {
  product: {
    id: string
    handle: string | null
    title: string
    subtitle: string | null
    description: string | null
    sku: string | null
    productType: string
    isConfigurable: boolean
    defaultMediaUrl: string | null
    media: StorefrontProductMedia[]
    dimensions: { width?: number | null; height?: number | null; depth?: number | null; unit?: string | null } | null
    weightValue: string | null
    weightUnit: string | null
    categories: Array<{ id: string; name: string; slug: string | null }>
    tags: string[]
    optionSchema: {
      name: string | null
      description: string | null
      options: Array<{
        code: string
        label: string
        inputType: string
        isRequired: boolean
        choices: Array<{ code: string; label: string | null }>
      }>
    } | null
    variants: StorefrontVariant[]
    pricing: StorefrontVariantPricing | null
    relatedProducts: StorefrontRelatedProduct[]
  }
  effectiveLocale: string
}

function buildPricingContext(storeCtx: StoreContext) {
  return {
    channelId: storeCtx.channelBinding?.salesChannelId ?? null,
    quantity: 1,
    date: new Date(),
  }
}

function resolveLocalizedTitle(
  product: CatalogProduct,
  offer: CatalogOffer | null,
  locale: string,
): string {
  if (offer?.localizedContent) {
    const locContent = offer.localizedContent[locale]
    if (locContent?.title) return locContent.title
    const lang = locale.split('-')[0]
    const fallbackKey = Object.keys(offer.localizedContent).find((k) => k.startsWith(lang))
    if (fallbackKey && offer.localizedContent[fallbackKey]?.title) {
      return offer.localizedContent[fallbackKey].title!
    }
    if (offer.title) return offer.title
  }
  return product.title
}

function resolveLocalizedDescription(
  product: CatalogProduct,
  offer: CatalogOffer | null,
  locale: string,
): string | null {
  if (offer?.localizedContent) {
    const locContent = offer.localizedContent[locale]
    if (locContent?.description) return locContent.description
    const lang = locale.split('-')[0]
    const fallbackKey = Object.keys(offer.localizedContent).find((k) => k.startsWith(lang))
    if (fallbackKey && offer.localizedContent[fallbackKey]?.description) {
      return offer.localizedContent[fallbackKey].description!
    }
    if (offer.description) return offer.description
  }
  return product.description ?? null
}

function buildVariantPricing(best: PriceRow | null): StorefrontVariantPricing | null {
  if (!best) return null
  return {
    currencyCode: best.currencyCode,
    unitPriceNet: best.unitPriceNet ?? null,
    unitPriceGross: best.unitPriceGross ?? null,
    displayMode: typeof best.priceKind === 'object' && best.priceKind
      ? best.priceKind.displayMode ?? 'excluding-tax'
      : 'excluding-tax',
    isPromotion: typeof best.priceKind === 'object' && best.priceKind
      ? best.priceKind.isPromotion ?? false
      : resolvePriceKindCode(best) === 'promotion',
  }
}

export async function fetchStorefrontProductDetail(
  em: EntityManager,
  pricingService: CatalogPricingService,
  storeCtx: StoreContext,
  idOrHandle: string,
): Promise<StorefrontProductDetail | null> {
  const { organizationId, tenantId, effectiveLocale } = storeCtx

  const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
  const where = UUID_REGEX.test(idOrHandle)
    ? { id: idOrHandle, organizationId, tenantId, isActive: true, deletedAt: null }
    : { handle: idOrHandle, organizationId, tenantId, isActive: true, deletedAt: null }

  const product = await em.findOne(CatalogProduct, where as object)
  if (!product) return null

  const [variants, allPrices, categoryAssignments, tagAssignments, channelOffer, optionSchema] = await Promise.all([
    em.find(
      CatalogProductVariant,
      { product: product.id, organizationId, tenantId, deletedAt: null },
      { orderBy: { isDefault: 'desc', createdAt: 'asc' } },
    ),
    em.find(
      CatalogProductPrice,
      { product: product.id, organizationId, tenantId },
      { populate: ['offer', 'variant', 'product', 'priceKind'] },
    ),
    em.find(
      CatalogProductCategoryAssignment,
      { product: product.id, organizationId, tenantId },
      { populate: ['category'] },
    ),
    em.find(
      CatalogProductTagAssignment,
      { product: product.id, organizationId, tenantId },
      { populate: ['tag'] },
    ),
    storeCtx.channelBinding
      ? em.findOne(CatalogOffer, {
          product: product.id,
          channelId: storeCtx.channelBinding.salesChannelId,
          isActive: true,
          deletedAt: null,
        })
      : Promise.resolve(null),
    product.optionSchemaTemplate
      ? em.findOne(CatalogOptionSchemaTemplate, {
          id: typeof product.optionSchemaTemplate === 'string'
            ? product.optionSchemaTemplate
            : product.optionSchemaTemplate.id,
        })
      : Promise.resolve(null),
  ])

  // Storefront channel is the funnel: product must have an active offer in the resolved sales channel.
  if (storeCtx.channelBinding?.salesChannelId && !channelOffer) {
    return null
  }

  const variantIds = variants.map((v) => v.id)
  let variantPrices: typeof allPrices = allPrices
  if (variantIds.length > 0) {
    variantPrices = await em.find(
      CatalogProductPrice,
      {
        $or: [
          { product: product.id },
          { variant: { $in: variantIds } },
        ],
        organizationId,
        tenantId,
      },
      { populate: ['offer', 'variant', 'product', 'priceKind'] },
    )
  }

  const title = resolveLocalizedTitle(product, channelOffer, effectiveLocale)
  const description = resolveLocalizedDescription(product, channelOffer, effectiveLocale)
  const subtitle = product.subtitle ?? null

  const categories = categoryAssignments
    .map((a) => {
      const cat = typeof a.category === 'string' ? null : a.category ?? null
      if (!cat) return null
      return { id: cat.id, name: cat.name, slug: cat.slug ?? null }
    })
    .filter((c): c is { id: string; name: string; slug: string | null } => c !== null)

  const tags = tagAssignments
    .map((a) => {
      const tag = typeof a.tag === 'string' ? null : a.tag ?? null
      return tag?.label ?? null
    })
    .filter((t): t is string => t !== null)

  const pricingCtx = buildPricingContext(storeCtx)

  const filteredVariantPrices = filterByPriceKind(variantPrices, storeCtx.channelBinding?.priceKindId)
  const productLevelPrices = filteredVariantPrices.filter((p) => !p.variant)
  const bestProductPrice = await pricingService.resolvePrice(productLevelPrices, pricingCtx)

  const resolvedVariants: StorefrontVariant[] = []
  for (const variant of variants) {
    const variantCandidates = filteredVariantPrices.filter(
      (p) => {
        const vid = typeof p.variant === 'string' ? p.variant : p.variant?.id
        return vid === variant.id || (!p.variant && !!p.product)
      },
    )
    const best = await pricingService.resolvePrice(variantCandidates, pricingCtx)
    resolvedVariants.push({
      id: variant.id,
      name: variant.name ?? null,
      sku: variant.sku ?? null,
      optionValues: variant.optionValues ?? null,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
      pricing: buildVariantPricing(best),
      dimensions: variant.dimensions ?? null,
      weightValue: variant.weightValue ?? null,
      weightUnit: variant.weightUnit ?? null,
    })
  }

  // Related products — same category, different product, max 8
  const primaryCategoryId = categories[0]?.id ?? null
  let relatedProducts: StorefrontRelatedProduct[] = []
  if (primaryCategoryId) {
    const relatedAssignments = await em.find(
      CatalogProductCategoryAssignment,
      {
        category: primaryCategoryId,
        organizationId,
        tenantId,
        product: { $ne: product.id },
      },
      { populate: ['product'], limit: 8 },
    )
    const relatedCandidates = relatedAssignments
      .map((assignment) => (typeof assignment.product === 'string' ? null : assignment.product ?? null))
      .filter((related): related is CatalogProduct => !!related && related.isActive && !related.deletedAt)
    const relatedCandidateIds = relatedCandidates.map((related) => related.id)
    const relatedAllowedSet = storeCtx.channelBinding?.salesChannelId
      ? new Set(
          (
            await em.find(
              CatalogOffer,
              {
                product: { $in: relatedCandidateIds },
                channelId: storeCtx.channelBinding.salesChannelId,
                isActive: true,
                deletedAt: null,
              },
              { fields: ['product'] },
            )
          )
            .map((offer) =>
              typeof offer.product === 'string' ? offer.product : offer.product?.id ?? null,
            )
            .filter((id): id is string => !!id),
        )
      : null
    for (const assignment of relatedAssignments) {
      const related = typeof assignment.product === 'string' ? null : assignment.product ?? null
      if (!related || !related.isActive || related.deletedAt) continue
      if (relatedAllowedSet && !relatedAllowedSet.has(related.id)) continue
      const rawRelatedPrices = await em.find(
        CatalogProductPrice,
        { product: related.id, organizationId, tenantId },
        { populate: ['priceKind'] },
      )
      const relatedPrices = filterByPriceKind(rawRelatedPrices, storeCtx.channelBinding?.priceKindId)
      const bestRelated = await pricingService.resolvePrice(relatedPrices, pricingCtx)
      const relatedVal = bestRelated
        ? { min: bestRelated.unitPriceGross ?? bestRelated.unitPriceNet ?? '0', max: bestRelated.unitPriceGross ?? bestRelated.unitPriceNet ?? '0', currencyCode: bestRelated.currencyCode }
        : null
      relatedProducts.push({
        id: related.id,
        handle: related.handle ?? null,
        title: related.title,
        defaultMediaUrl: related.defaultMediaUrl ?? null,
        priceRange: relatedVal,
      })
    }
  }

  const optionSchemaData = optionSchema?.schema ?? null

  return {
    product: {
      id: product.id,
      handle: product.handle ?? null,
      title,
      subtitle,
      description,
      sku: product.sku ?? null,
      productType: product.productType,
      isConfigurable: product.isConfigurable,
      defaultMediaUrl: product.defaultMediaUrl ?? null,
      media: product.defaultMediaUrl
        ? [{ id: product.defaultMediaId ?? product.id, url: product.defaultMediaUrl, alt: title }]
        : [],
      dimensions: product.dimensions ?? null,
      weightValue: product.weightValue ?? null,
      weightUnit: product.weightUnit ?? null,
      categories,
      tags,
      optionSchema: optionSchemaData
        ? {
            name: optionSchemaData.name ?? null,
            description: optionSchemaData.description ?? null,
            options: (optionSchemaData.options ?? []).map((opt) => ({
              code: opt.code,
              label: opt.label,
              inputType: opt.inputType,
              isRequired: opt.isRequired ?? false,
              choices: (opt.choices ?? []).map((c) => ({ code: c.code, label: c.label ?? null })),
            })),
          }
        : null,
      variants: resolvedVariants,
      pricing: buildVariantPricing(bestProductPrice),
      relatedProducts,
    },
    effectiveLocale,
  }
}
