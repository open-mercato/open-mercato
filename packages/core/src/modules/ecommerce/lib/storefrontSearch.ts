import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { sanitizeSearchTerm } from '@open-mercato/shared/lib/query/sanitizeSearchTerm'
import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { SearchStrategy } from '@open-mercato/shared/modules/search'
import { E } from '#generated/entities.ids.generated'
import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { scoreProductSearchRelevance } from '@open-mercato/core/modules/catalog/lib/productFilters'
import { compareCodeUnits } from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import {
  ECOMMERCE_STOREFRONT_SUGGEST_MIN_QUERY_LENGTH,
  type EcommerceStorefrontSearchSuggestQuery,
} from '../data/validators'
import {
  STOREFRONT_CATEGORY_ENTITY_TYPE,
  STOREFRONT_PRODUCT_ENTITY_TYPE,
  loadStorefrontTranslations,
  localeChain,
  localize,
  nonEmptyString,
  referenceId,
  resolvePublicDefaultMediaUrls,
  resolveStorefrontAvailability,
  storefrontAvailabilityKey,
  toStorefrontAvailability,
  tryResolve,
} from './storefrontCatalogSupport'
import { loadStorefrontVisibleCategories, type StorefrontVisibleCategory } from './storefrontCategories'
import { resolveStorefrontPrices, type StorefrontProductPricing } from './storefrontPricing'
import {
  buildStorefrontProductScope,
  buildStorefrontSearchIndexDocFilter,
  composeStorefrontProductFilters,
  type StorefrontProductScope,
} from './storefrontProductScope'
import { buildStorefrontProductFilterClause } from './storefrontProducts'
import type { StoreContext } from './types'

/**
 * `GET /search/suggest` (Storefront Public API rev 4 §4.5, §8).
 *
 * Products are ranked by one backend, chosen per request by `selectStorefrontSearchBackend`:
 * the `tokens` strategy or the `vector` strategy on the `pgvector` driver of `@open-mercato/search`
 * (D19), each receiving `buildStorefrontSearchIndexDocFilter` so the assortment scope is evaluated
 * inside the ranking query and a restricted buyer is never starved by out-of-scope hits (§8.2,
 * R14); otherwise the Phase 1 `ILIKE` path (§8.1) over the scoped catalogue. Meilisearch,
 * `chromadb` and `qdrant` cannot evaluate the scope and are never used. Whatever ranked them, the
 * products are re-read through `buildStorefrontProductScope`, priced for the buyer, and hidden when
 * their policy hides out-of-stock products, exactly like the listing page. The payload is the same
 * for every backend (§8.3); facets are never computed.
 *
 * Categories match the localized name of the buyer's visible categories (the `/categories`
 * visibility rule) and are independent of the backend. `suggestions` stays empty in this phase.
 */

export type StorefrontSearchBackendPreference = 'auto' | 'ilike' | 'tokens' | 'vector'

export type StorefrontSearchBackend = 'ilike' | 'tokens' | 'vector'

export type StorefrontSearchBackendSelection =
  | { backend: 'ilike' }
  | { backend: 'tokens' | 'vector'; strategy: SearchStrategy }

export type StorefrontSearchSuggestProduct = {
  id: string
  handle: string | null
  title: string
  defaultMediaUrl: string | null
  formattedPrice: string | null
}

export type StorefrontSearchSuggestCategory = { id: string; name: string; slug: string | null }

export type StorefrontSearchSuggestResponse = {
  products: StorefrontSearchSuggestProduct[]
  categories: StorefrontSearchSuggestCategory[]
  suggestions: string[]
  effectiveLocale: string
}

export type SuggestStorefrontSearchOptions = {
  /** Overrides `OM_ECOMMERCE_STOREFRONT_SEARCH`; intended for tests. */
  backendPreference?: StorefrontSearchBackendPreference
  date?: Date
}

/** `auto` (default): `tokens`, then `pgvector`, then `ILIKE`; any other value forces that backend or `ILIKE`. */
export const STOREFRONT_SEARCH_BACKEND_ENV = 'OM_ECOMMERCE_STOREFRONT_SEARCH'

/** `ILIKE` candidates read (title order) before relevance ranking picks the `limit` best. */
export const STOREFRONT_SUGGEST_ILIKE_WINDOW = 100

const AUTO_ORDER: readonly StorefrontSearchBackend[] = ['tokens', 'vector']

const logger = createLogger('ecommerce').child({ component: 'storefront-search' })

type StrategyRegistry = {
  getStrategy(strategyId: string): SearchStrategy | undefined
  isStrategyAvailable(strategyId: string): Promise<boolean>
}

type Runtime = {
  container: AwilixContainer
  ctx: StoreContext
  em: EntityManager
  queryEngine: QueryEngine
  scope: StorefrontProductScope
  decryptionScope: { tenantId: string; organizationId: string }
  date: Date
}

type RankedProduct = { id: string; score: number }

type ProductRecord = {
  id: string
  title?: string | null
  sku?: string | null
  handle?: string | null
  default_media_id?: string | null
  default_media_url?: string | null
}

type OrderedProduct = { record: ProductRecord; score: number; relevance: number; title: string }

export function readStorefrontSearchBackendPreference(
  value: string | undefined = process.env[STOREFRONT_SEARCH_BACKEND_ENV],
): StorefrontSearchBackendPreference {
  const token = value?.trim().toLowerCase()
  if (token === 'ilike' || token === 'tokens' || token === 'vector') return token
  return 'auto'
}

function isStrategyRegistry(value: unknown): value is StrategyRegistry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StrategyRegistry>
  return typeof candidate.getStrategy === 'function' && typeof candidate.isStrategyAvailable === 'function'
}

function tokensCanRank(term: string): boolean {
  const config = resolveSearchConfig()
  return config.enabled && tokenizeText(term, config).hashes.length > 0
}

async function isAvailable(registry: StrategyRegistry, strategyId: string): Promise<boolean> {
  try {
    return await registry.isStrategyAvailable(strategyId)
  } catch {
    return false
  }
}

/**
 * The ranking backend for one search term (§8.2, D19). A search strategy qualifies only when it is
 * registered, available and declares `supportsIndexDocFilter` — the `tokens` strategy, and the
 * `vector` strategy over `pgvector`; `tokens` additionally needs search enabled and a term that
 * tokenizes (shorter than the minimum token length it does not). Anything else is `ILIKE`.
 */
export async function selectStorefrontSearchBackend(
  container: AwilixContainer,
  term: string,
  preference: StorefrontSearchBackendPreference = readStorefrontSearchBackendPreference(),
): Promise<StorefrontSearchBackendSelection> {
  if (preference === 'ilike') return { backend: 'ilike' }
  const registry = tryResolve<unknown>(container, 'searchService')
  if (!isStrategyRegistry(registry)) return { backend: 'ilike' }
  const order = preference === 'auto' ? AUTO_ORDER : [preference]
  for (const backend of order) {
    if (backend === 'ilike') continue
    const strategy = registry.getStrategy(backend)
    if (!strategy || strategy.supportsIndexDocFilter !== true) continue
    if (backend === 'tokens' && !tokensCanRank(term)) continue
    if (!(await isAvailable(registry, backend))) continue
    return { backend, strategy }
  }
  return { backend: 'ilike' }
}

function normalizeForMatch(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function compareOrdered(left: OrderedProduct, right: OrderedProduct): number {
  return (
    right.score - left.score ||
    left.relevance - right.relevance ||
    left.title.localeCompare(right.title) ||
    compareCodeUnits(left.record.id, right.record.id)
  )
}

async function rankWithStrategy(
  runtime: Runtime,
  strategy: SearchStrategy,
  term: string,
  limit: number,
): Promise<RankedProduct[]> {
  const { ctx } = runtime
  const results = await strategy.search(term, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    entityTypes: [E.catalog.catalog_product],
    limit,
    indexDocFilter: buildStorefrontSearchIndexDocFilter(ctx),
  })
  const seen = new Set<string>()
  const ranked: RankedProduct[] = []
  for (const result of results) {
    if (result.entityId !== E.catalog.catalog_product || seen.has(result.recordId)) continue
    seen.add(result.recordId)
    ranked.push({ id: result.recordId, score: Number.isFinite(result.score) ? result.score : 0 })
  }
  return ranked.slice(0, limit)
}

async function rankWithIlike(runtime: Runtime, term: string, limit: number): Promise<RankedProduct[]> {
  const { scope } = runtime
  const clause = await buildStorefrontProductFilterClause(runtime.container, runtime.ctx, { search: term })
  const result = await runtime.queryEngine.query<ProductRecord>(E.catalog.catalog_product, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    withDeleted: scope.withDeleted,
    filters: composeStorefrontProductFilters(scope, clause),
    fields: ['id', 'title', 'sku'],
    sort: [{ field: 'title', dir: SortDir.Asc }],
    page: { page: 1, pageSize: STOREFRONT_SUGGEST_ILIKE_WINDOW },
  })
  const needle = term.toLowerCase()
  return result.items
    .filter((item) => typeof item.id === 'string')
    .map((record) => ({
      record,
      score: 0,
      relevance: scoreProductSearchRelevance(needle, record.title, record.sku),
      title: nonEmptyString(record.title) ?? '',
    }))
    .sort(compareOrdered)
    .slice(0, limit)
    .map((entry) => ({ id: entry.record.id, score: 0 }))
}

async function rankProducts(
  runtime: Runtime,
  selection: StorefrontSearchBackendSelection,
  term: string,
  limit: number,
): Promise<RankedProduct[]> {
  if (selection.backend === 'ilike') return rankWithIlike(runtime, term, limit)
  try {
    return await rankWithStrategy(runtime, selection.strategy, term, limit)
  } catch (err) {
    logger.error('[internal] ecommerce storefront search backend failed; falling back to ILIKE', {
      backend: selection.backend,
      tenantId: runtime.ctx.tenantId,
      storeId: runtime.ctx.store.id,
      err,
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'ecommerce',
      code: 'ecommerce.storefront_search_backend_failed',
      attributes: { backend: selection.backend },
    })
    return rankWithIlike(runtime, term, limit)
  }
}

async function loadProductsByIds(runtime: Runtime, ids: string[]): Promise<ProductRecord[]> {
  if (!ids.length) return []
  const { scope } = runtime
  const result = await runtime.queryEngine.query<ProductRecord>(E.catalog.catalog_product, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    withDeleted: scope.withDeleted,
    filters: composeStorefrontProductFilters(scope, { id: { $in: ids } }),
    fields: ['id', 'title', 'sku', 'handle', 'default_media_id', 'default_media_url'],
    page: { page: 1, pageSize: ids.length },
  })
  return result.items.filter((item) => typeof item.id === 'string')
}

async function loadVariantIds(runtime: Runtime, productIds: string[]): Promise<Map<string, string[]>> {
  const byProduct = new Map<string, string[]>()
  if (!productIds.length) return byProduct
  const { ctx } = runtime
  const variants = await findWithDecryption(
    runtime.em,
    CatalogProductVariant,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      isActive: true,
      product: { $in: productIds },
    },
    { fields: ['id', 'product'] },
    runtime.decryptionScope,
  )
  for (const variant of variants) {
    const productId = referenceId(variant.product)
    if (!productId) continue
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), variant.id])
  }
  return byProduct
}

async function loadPricing(runtime: Runtime, productIds: string[]): Promise<Map<string, StorefrontProductPricing>> {
  if (!productIds.length) return new Map()
  const variants = await loadVariantIds(runtime, productIds)
  return resolveStorefrontPrices(
    runtime.container,
    runtime.ctx,
    productIds.map((productId) => ({ productId, variantIds: variants.get(productId) ?? [] })),
    { date: runtime.date },
  )
}

async function loadHiddenProductIds(runtime: Runtime, productIds: string[]): Promise<Set<string>> {
  const hidden = new Set<string>()
  if (!productIds.length) return hidden
  const targets = productIds.map((productId) => ({ productId, variantId: null }))
  const resolved = await resolveStorefrontAvailability(runtime.container, runtime.ctx, runtime.em, targets)
  for (const target of targets) {
    const entry = resolved.get(storefrontAvailabilityKey(target))
    if (entry?.policy?.hideWhenOutOfStock?.value !== true) continue
    if (toStorefrontAvailability(entry.result ?? null).state === 'out_of_stock') hidden.add(target.productId)
  }
  return hidden
}

function formattedPrice(pricing: StorefrontProductPricing | undefined): string | null {
  return pricing?.price?.formatted ?? pricing?.priceRange?.formattedMin ?? null
}

function matchCategories(
  categories: Map<string, StorefrontVisibleCategory>,
  translations: Map<string, Record<string, Record<string, unknown>>> | undefined,
  locales: string[],
  term: string,
  limit: number,
): StorefrontSearchSuggestCategory[] {
  const needle = normalizeForMatch(term)
  const matches: Array<{ category: StorefrontSearchSuggestCategory; relevance: number }> = []
  for (const row of categories.values()) {
    const name = localize(row.name, translations?.get(row.id), 'name', locales) ?? row.name
    const normalized = normalizeForMatch(name)
    if (!normalized.includes(needle)) continue
    matches.push({
      category: { id: row.id, name, slug: row.slug },
      relevance: scoreProductSearchRelevance(needle, normalized, null),
    })
  }
  return matches
    .sort(
      (left, right) =>
        left.relevance - right.relevance ||
        left.category.name.localeCompare(right.category.name) ||
        compareCodeUnits(left.category.id, right.category.id),
    )
    .slice(0, limit)
    .map((entry) => entry.category)
}

function emptyResponse(ctx: StoreContext): StorefrontSearchSuggestResponse {
  return { products: [], categories: [], suggestions: [], effectiveLocale: ctx.effectiveLocale }
}

/** The normalized term the suggest response is computed and cached for; `''` when shorter than the minimum. */
export function normalizeStorefrontSuggestTerm(q: string): string {
  const term = sanitizeSearchTerm(q).replace(/\s+/g, ' ')
  return Array.from(term).length >= ECOMMERCE_STOREFRONT_SUGGEST_MIN_QUERY_LENGTH ? term : ''
}

export async function suggestStorefrontSearch(
  container: AwilixContainer,
  ctx: StoreContext,
  query: Pick<EcommerceStorefrontSearchSuggestQuery, 'q' | 'limit'>,
  options: SuggestStorefrontSearchOptions = {},
): Promise<StorefrontSearchSuggestResponse> {
  const term = normalizeStorefrontSuggestTerm(query.q)
  const assortment = ctx.buyer.assortmentScope
  if (!term || (assortment !== null && assortment.length === 0)) return emptyResponse(ctx)
  const em = tryResolve<EntityManager>(container, 'em')
  const queryEngine = tryResolve<QueryEngine>(container, 'queryEngine')
  if (!em || !queryEngine) throw new Error('[internal] ecommerce storefront search requires em and queryEngine')
  const runtime: Runtime = {
    container,
    ctx,
    em,
    queryEngine,
    scope: buildStorefrontProductScope(ctx),
    decryptionScope: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    date: options.date ?? new Date(),
  }
  const selection = await selectStorefrontSearchBackend(container, term, options.backendPreference)
  const [ranked, categories] = await Promise.all([
    rankProducts(runtime, selection, term, query.limit),
    loadStorefrontVisibleCategories(runtime),
  ])
  const rankedIds = ranked.map((entry) => entry.id)
  const [records, translations, pricing, hidden] = await Promise.all([
    loadProductsByIds(runtime, rankedIds),
    loadStorefrontTranslations(em, ctx, [
      { entityType: STOREFRONT_PRODUCT_ENTITY_TYPE, ids: rankedIds },
      { entityType: STOREFRONT_CATEGORY_ENTITY_TYPE, ids: Array.from(categories.keys()) },
    ]),
    loadPricing(runtime, rankedIds),
    loadHiddenProductIds(runtime, rankedIds),
  ])
  const visibleRecords = records.filter((record) => !hidden.has(record.id))
  const mediaUrls = await resolvePublicDefaultMediaUrls(
    em,
    ctx,
    visibleRecords.map((record) => ({
      id: record.id,
      defaultMediaId: record.default_media_id,
      defaultMediaUrl: record.default_media_url,
    })),
  )
  const locales = localeChain(ctx)
  const productTranslations = translations.get(STOREFRONT_PRODUCT_ENTITY_TYPE)
  const scores = new Map(ranked.map((entry) => [entry.id, entry.score]))
  const needle = term.toLowerCase()
  const products = visibleRecords
    .map((record) => ({
      record,
      score: scores.get(record.id) ?? 0,
      relevance: scoreProductSearchRelevance(needle, record.title, record.sku),
      title: nonEmptyString(record.title) ?? '',
    }))
    .sort(compareOrdered)
    .map(({ record }) => ({
      id: record.id,
      handle: nonEmptyString(record.handle),
      title: localize(record.title, productTranslations?.get(record.id), 'title', locales) ?? '',
      defaultMediaUrl: mediaUrls.get(record.id) ?? null,
      formattedPrice: formattedPrice(pricing.get(record.id)),
    }))
  return {
    products,
    categories: matchCategories(
      categories,
      translations.get(STOREFRONT_CATEGORY_ENTITY_TYPE),
      locales,
      term,
      query.limit,
    ),
    suggestions: [],
    effectiveLocale: ctx.effectiveLocale,
  }
}
