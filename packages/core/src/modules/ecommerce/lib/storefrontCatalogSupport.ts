import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  availabilityItemKey,
  resolveAvailability,
  type AvailabilityItemResult,
  type AvailabilityModuleConfigReader,
  type AvailabilityState,
} from '@open-mercato/shared/lib/availability'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AssortmentScope, EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { batchLoadTranslationsMany } from '@open-mercato/core/modules/translations/lib/batch'
import type { StorefrontPrice, StorefrontPriceRange, StorefrontProductPricing } from './storefrontPricing'
import type { StoreContext } from './types'

const logger = createLogger('ecommerce')

export const STOREFRONT_PRODUCT_ENTITY_TYPE = 'catalog:catalog_product'
export const STOREFRONT_VARIANT_ENTITY_TYPE = 'catalog:catalog_product_variant'
export const STOREFRONT_CATEGORY_ENTITY_TYPE = 'catalog:catalog_product_category'
export const STOREFRONT_TAG_ENTITY_TYPE = 'catalog:catalog_product_tag'
export const STOREFRONT_OPTION_SCHEMA_ENTITY_TYPE = 'catalog:catalog_option_schema_template'

export type StorefrontAvailability = {
  state: AvailabilityState
  canFulfil: boolean
  leadTimeDays: number | null
  releaseAt: string | null
}

export type StorefrontProductListItem = {
  id: string
  handle: string | null
  title: string
  subtitle: string | null
  defaultMediaUrl: string | null
  productType: string
  isConfigurable: boolean
  hasVariants: boolean
  variantCount: number
  categories: Array<{ id: string; name: string; slug: string | null }>
  tags: string[]
  price: StorefrontPrice | null
  priceRange: StorefrontPriceRange | null
  availability: StorefrontAvailability
  badges: string[]
}

export type CategoryLineage = { id: string; ancestorIds: string[]; descendantIds: string[] }

export type CategoryRef = { id: string; name: string; slug: string | null }

export type TagRef = { id: string; label: string }

export type TranslationOverlay = Record<string, Record<string, unknown>>

export type TranslationMap = Map<string, TranslationOverlay>

export type StorefrontPolicyResolutionScope = {
  tenantId: string
  organizationId: string
  storeId: string | null
  productId: string
  variantId: string | null
}

type ResolvedPolicyField<T> = { value: T } | null | undefined

export type StorefrontResolvedPolicy = {
  hideWhenOutOfStock?: ResolvedPolicyField<boolean>
  minOrderQuantity?: ResolvedPolicyField<number | null>
  maxOrderQuantity?: ResolvedPolicyField<number | null>
  quantityIncrement?: ResolvedPolicyField<number | null>
}

export type StorefrontPolicyResolver = {
  resolveMany(
    em: EntityManager,
    scopes: StorefrontPolicyResolutionScope[],
  ): Promise<Array<StorefrontResolvedPolicy | null | undefined>>
}

export type StorefrontAvailabilityTarget = { productId: string; variantId: string | null }

export type ResolvedStorefrontAvailability = {
  result: AvailabilityItemResult | null
  policy: StorefrontResolvedPolicy | null
}

export function tryResolve<T>(container: AwilixContainer, name: string): T | null {
  try {
    return (container.resolve(name) as T | null | undefined) ?? null
  } catch {
    return null
  }
}

export function referenceId(value: unknown): string | null {
  if (typeof value === 'string') return value.length ? value : null
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'string' && id.length ? id : null
  }
  return null
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function categoryBranchAdmits(branch: AssortmentScope, lineage: Set<string>, reach: Set<string>): boolean {
  const included = stringList(branch.categoryIds)
  if (included.length > 0 && !included.some((id) => reach.has(id))) return false
  if (stringList(branch.excludeCategoryIds).some((id) => lineage.has(id))) return false
  return (branch.allOf ?? []).every((nested) => categoryBranchAdmits(nested, lineage, reach))
}

/**
 * Whether a category can hold any product the effective assortment admits: one of its own subtree
 * or ancestors is granted by some branch, and neither it nor an ancestor is excluded there. Tag and
 * product conditions are product-level and do not decide a category's visibility.
 */
export function isCategoryInAssortment(category: CategoryLineage, scope: EffectiveAssortmentScope): boolean {
  if (scope === null) return true
  const lineage = new Set([category.id, ...category.ancestorIds])
  const reach = new Set([...lineage, ...category.descendantIds])
  return scope.some((branch) => categoryBranchAdmits(branch, lineage, reach))
}

export type ActiveCategoryAncestor = { id: string; name: string; slug: string | null; ancestorIds: string[] }

/**
 * Which of the given categories have every ancestor active and not deleted — the rule the category
 * tree applies, so a category hidden there under an inactive parent is hidden everywhere. Ancestors
 * listed in `known` (already checked active) need no lookup; the rest cost one categories query, and
 * none when every category is a root or has only known ancestors. `ancestors` holds the active
 * ancestor rows, fetched and known, for callers that render them (breadcrumbs).
 */
export async function selectCategoriesWithActiveAncestors(
  em: EntityManager,
  ctx: Pick<StoreContext, 'tenantId' | 'organizationId'>,
  categories: Array<{ id: string; ancestorIds: string[] }>,
  known: { activeIds?: Iterable<string>; ancestors?: Map<string, ActiveCategoryAncestor> } = {},
): Promise<{ visibleIds: Set<string>; ancestors: Map<string, ActiveCategoryAncestor> }> {
  const ancestors = new Map(known.ancestors ?? [])
  const active = new Set([...(known.activeIds ?? []), ...ancestors.keys()])
  const unknown = Array.from(
    new Set(categories.flatMap((category) => category.ancestorIds.filter((id) => !active.has(id)))),
  )
  if (unknown.length > 0) {
    const rows = await findWithDecryption(
      em,
      CatalogProductCategory,
      { id: { $in: unknown }, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null, isActive: true },
      { fields: ['id', 'name', 'slug', 'ancestorIds'] },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    for (const row of rows) {
      active.add(row.id)
      ancestors.set(row.id, { id: row.id, name: row.name, slug: row.slug ?? null, ancestorIds: stringList(row.ancestorIds) })
    }
  }
  const visibleIds = new Set(
    categories.filter((category) => category.ancestorIds.every((id) => active.has(id))).map((category) => category.id),
  )
  return { visibleIds, ancestors }
}

export function localize(
  base: unknown,
  translations: TranslationOverlay | undefined,
  field: string,
  locales: string[],
): string | null {
  for (const locale of locales) {
    const value = nonEmptyString(translations?.[locale]?.[field])
    if (value !== null) return value
  }
  return nonEmptyString(base)
}

export function localeChain(ctx: StoreContext, preferredLocale?: string | null): string[] {
  const head = preferredLocale && ctx.store.supportedLocales.includes(preferredLocale) ? preferredLocale : ctx.effectiveLocale
  return Array.from(new Set([head, ctx.store.defaultLocale].filter((locale): locale is string => !!locale)))
}

export function toStorefrontAvailability(result: AvailabilityItemResult | null): StorefrontAvailability {
  if (!result) return { state: 'not_tracked', canFulfil: true, leadTimeDays: null, releaseAt: null }
  return {
    state: result.state,
    canFulfil: result.canFulfil,
    leadTimeDays: result.leadTimeDays,
    releaseAt: result.releaseAt,
  }
}

export function storefrontAvailabilityKey(target: StorefrontAvailabilityTarget): string {
  return availabilityItemKey({ catalogProductId: target.productId, catalogVariantId: target.variantId })
}

/**
 * One batched `resolveAvailability` (state) and one `policyResolutionService.resolveMany` (quantity
 * rules, `hideWhenOutOfStock`) for every product and variant of a response, keyed by
 * `storefrontAvailabilityKey`. A missing policy service yields `policy: null`.
 */
export async function resolveStorefrontAvailability(
  container: AwilixContainer,
  ctx: StoreContext,
  em: EntityManager,
  targets: StorefrontAvailabilityTarget[],
): Promise<Map<string, ResolvedStorefrontAvailability>> {
  const results = new Map<string, ResolvedStorefrontAvailability>()
  if (!targets.length) return results
  const items = targets.map((target) => ({
    catalogProductId: target.productId,
    catalogVariantId: target.variantId,
    quantity: 1,
  }))
  const moduleConfig = tryResolve<AvailabilityModuleConfigReader>(container, 'moduleConfigService')
  const policyResolver = tryResolve<StorefrontPolicyResolver>(container, 'policyResolutionService')
  const [availability, policies] = await Promise.all([
    resolveAvailability(
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        storeId: ctx.store.id,
        channelId: ctx.channel?.salesChannelId ?? null,
        items,
      },
      moduleConfig ? { moduleConfig, container } : { container },
    ),
    policyResolver
      ? policyResolver.resolveMany(
          em,
          targets.map((target) => ({
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            storeId: ctx.store.id,
            productId: target.productId,
            variantId: target.variantId,
          })),
        )
      : Promise.resolve([]),
  ])
  targets.forEach((target, index) => {
    const key = storefrontAvailabilityKey(target)
    results.set(key, { result: availability.byItem[key] ?? null, policy: policies[index] ?? null })
  })
  return results
}

/**
 * The response's translation overlays in one query (Storefront Public API §7.2: one call per
 * response), keyed by entity type. A failure degrades to base fields and is reported.
 */
export async function loadStorefrontTranslations(
  em: EntityManager,
  ctx: StoreContext,
  requests: Array<{ entityType: string; ids: string[] }>,
): Promise<Map<string, TranslationMap>> {
  const pending = requests.filter((request) => request.ids.length > 0)
  if (!pending.length) return new Map()
  try {
    return await batchLoadTranslationsMany(
      em.getKysely(),
      pending.map((request) => ({ entityType: request.entityType, entityIds: request.ids })),
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
  } catch (err) {
    logger.error('[internal] ecommerce storefront translation overlay failed', {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      storeId: ctx.store.id,
      err,
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'ecommerce',
      code: 'ecommerce.storefront_translations_failed',
      attributes: { entityTypes: pending.length },
    })
    return new Map()
  }
}

export type StorefrontListItemSource = {
  id: string
  handle?: unknown
  title?: unknown
  subtitle?: unknown
  defaultMediaUrl?: unknown
  productType?: unknown
  isConfigurable?: unknown
}

export type StorefrontListItemParts = {
  locales: string[]
  overlay?: TranslationOverlay
  variantCount: number
  categories: CategoryRef[]
  categoryTranslations?: TranslationMap
  tags: TagRef[]
  tagTranslations?: TranslationMap
  pricing?: StorefrontProductPricing
  availability: StorefrontAvailability
}

export function buildStorefrontListItem(
  source: StorefrontListItemSource,
  parts: StorefrontListItemParts,
): StorefrontProductListItem {
  const { locales, overlay } = parts
  const price = parts.pricing?.price ?? null
  return {
    id: source.id,
    handle: nonEmptyString(source.handle),
    title: localize(source.title, overlay, 'title', locales) ?? '',
    subtitle: localize(source.subtitle, overlay, 'subtitle', locales),
    defaultMediaUrl: nonEmptyString(source.defaultMediaUrl),
    productType: nonEmptyString(source.productType) ?? 'simple',
    isConfigurable: parseBooleanFromUnknown(source.isConfigurable) === true,
    hasVariants: parts.variantCount > 0,
    variantCount: parts.variantCount,
    categories: parts.categories.map((category) => ({
      id: category.id,
      name: localize(category.name, parts.categoryTranslations?.get(category.id), 'name', locales) ?? category.name,
      slug: category.slug,
    })),
    tags: parts.tags.map(
      (tag) => localize(tag.label, parts.tagTranslations?.get(tag.id), 'label', locales) ?? tag.label,
    ),
    price,
    priceRange: parts.pricing?.priceRange ?? null,
    availability: parts.availability,
    badges: price?.isPromotion ? ['sale'] : [],
  }
}
