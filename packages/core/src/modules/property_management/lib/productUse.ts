import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sanitizeSearchTerm } from '@open-mercato/shared/lib/query/sanitizeSearchTerm'
import { buildAccentInsensitiveContainsPatternSql } from '@open-mercato/shared/lib/db/accentInsensitiveSearch'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import { filterRowsForVariant, resolvePriceVariantId } from '@open-mercato/core/modules/catalog/lib/pricing'
import { PRODUCT_SEARCH_EXPRESSION_SQL } from '@open-mercato/core/modules/catalog/lib/productSearch'
import type { CatalogPricingService, PriceRow, PricingContext } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { ProductUse, UnitProductPeriod, type BillingUnit, type ProductUseKind } from '../data/entities'

export type Scope = { tenantId: string; organizationId: string }

export type ProductUseInfo = { use: ProductUseKind; billingUnit: BillingUnit }

export type ResolvedUnitProduct = {
  catalogProductId: string
  catalogCategoryId: string
  productName: string
  use: ProductUseKind
  billingUnit: BillingUnit
}

export type PriceSnapshot = {
  priceAmount: string | null
  currencyCode: string | null
  priceKindId: string | null
}

export type PriceContext = {
  quantity?: number
  channelId?: string | null
  customerIds?: ReadonlyArray<string | null | undefined>
  date?: Date
}

function emptyPrice(): PriceSnapshot {
  return { priceAmount: null, currencyCode: null, priceKindId: null }
}

function pricingContextOf(context: PriceContext): PricingContext {
  const customerIds = (context.customerIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)
  return {
    quantity: context.quantity ?? 1,
    date: context.date ?? new Date(),
    channelId: context.channelId ?? null,
    ...(customerIds.length ? { customerIds } : {}),
  }
}

export type CategoryOption = { id: string; name: string; depth: number; parentId: string | null }

export type UnitProductOption = {
  id: string
  title: string
  use: ProductUseKind | null
  billingUnit: BillingUnit | null
}

export const CATALOG_OPTIONS_LIMIT = 100

export type CategoryOptionsQuery = { limit?: number; includeCategoryId?: string | null }

export type CategoryOptionsPage = { categories: CategoryOption[]; hasMore: boolean }

export type ProductOptionsQuery = { search?: string | null; limit?: number; includeProductId?: string | null }

export type ProductOptionsPage = { products: UnitProductOption[]; hasMore: boolean }

function optionsLimitOf(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return CATALOG_OPTIONS_LIMIT
  return Math.min(CATALOG_OPTIONS_LIMIT, Math.max(1, Math.floor(limit)))
}

async function unprocessable(key: string, fallback: string, field?: string): Promise<never> {
  const { translate } = await resolveTranslations()
  const message = translate(key, fallback)
  throw new CrudHttpError(422, field ? { error: message, fieldErrors: { [field]: message } } : { error: message })
}

export async function loadProductUses(em: EntityManager, scope: Scope, productIds: readonly string[]): Promise<Map<string, ProductUseInfo>> {
  const ids = Array.from(new Set(productIds.filter((id) => typeof id === 'string' && id.length > 0)))
  const result = new Map<string, ProductUseInfo>()
  if (!ids.length) return result
  const rows = await findWithDecryption(em, ProductUse, { ...scope, catalogProductId: { $in: ids } }, undefined, scope)
  for (const row of rows) result.set(row.catalogProductId, { use: row.use, billingUnit: row.billingUnit })
  return result
}

export async function loadProductOrganizations(em: EntityManager, tenantId: string, productIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(productIds.filter((id) => typeof id === 'string' && id.length > 0)))
  const result = new Map<string, string>()
  if (!ids.length) return result
  const rows = await findWithDecryption(em, CatalogProduct, { tenantId, id: { $in: ids }, deletedAt: null }, { fields: ['id', 'organizationId'] }, { tenantId })
  for (const row of rows) result.set(row.id, row.organizationId)
  return result
}

export async function loadProductUsesByProductOrganization(
  em: EntityManager,
  tenantId: string,
  productIds: readonly string[],
): Promise<Map<string, ProductUseInfo>> {
  const organizations = await loadProductOrganizations(em, tenantId, productIds)
  const byOrganization = new Map<string, string[]>()
  for (const [productId, organizationId] of organizations) {
    byOrganization.set(organizationId, [...(byOrganization.get(organizationId) ?? []), productId])
  }
  const result = new Map<string, ProductUseInfo>()
  for (const [organizationId, ids] of byOrganization) {
    const uses = await loadProductUses(em, { tenantId, organizationId }, ids)
    for (const [productId, use] of uses) result.set(productId, use)
  }
  return result
}

export async function lockProductUse(
  em: EntityManager,
  scope: Scope,
  catalogProductId: string,
  mode: 'share' | 'update',
): Promise<ProductUse | null> {
  return findOneWithDecryption(
    em,
    ProductUse,
    { ...scope, catalogProductId },
    { lockMode: mode === 'share' ? LockMode.PESSIMISTIC_READ : LockMode.PESSIMISTIC_WRITE, refresh: true },
    scope,
  )
}

export async function loadCategoryScope(em: EntityManager, scope: Scope, categoryId: string): Promise<CatalogProductCategory | null> {
  return findOneWithDecryption(em, CatalogProductCategory, { id: categoryId, ...scope, deletedAt: null }, undefined, scope)
}

function subtreeCategoryIds(category: CatalogProductCategory): string[] {
  return Array.from(new Set([category.id, ...(Array.isArray(category.descendantIds) ? category.descendantIds : [])]))
}

export async function isProductInCategory(em: EntityManager, scope: Scope, category: CatalogProductCategory, productId: string): Promise<boolean> {
  const assignment = await findOneWithDecryption(
    em,
    CatalogProductCategoryAssignment,
    { ...scope, product: productId, category: { $in: subtreeCategoryIds(category) } },
    { fields: ['id'] },
    scope,
  )
  return Boolean(assignment)
}

export async function resolveUnitProduct(
  em: EntityManager,
  scope: Scope,
  input: { catalogCategoryId: string; catalogProductId: string },
): Promise<ResolvedUnitProduct> {
  const category = await loadCategoryScope(em, scope, input.catalogCategoryId)
  if (!category) {
    return unprocessable('property_management.errors.categoryNotFound', 'The unit type is not a catalog category of this organization.', 'catalogCategoryId')
  }
  const product = await findOneWithDecryption(
    em,
    CatalogProduct,
    { id: input.catalogProductId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  if (!product) {
    return unprocessable('property_management.errors.productNotFound', 'The product is not a catalog product of this organization.', 'catalogProductId')
  }
  if (!(await isProductInCategory(em, scope, category, product.id))) {
    return unprocessable('property_management.errors.productNotInCategory', 'The product is not in the chosen unit type or one of its subcategories.', 'catalogProductId')
  }
  const uses = await loadProductUses(em, scope, [product.id])
  const use = uses.get(product.id)
  if (!use) {
    return unprocessable('property_management.errors.productUseMissing', 'The product is not marked as leasable or bookable in the catalog.', 'catalogProductId')
  }
  return {
    catalogProductId: product.id,
    catalogCategoryId: category.id,
    productName: product.title,
    use: use.use,
    billingUnit: use.billingUnit,
  }
}

function resolvePricingService(container: AwilixContainer): CatalogPricingService | null {
  try {
    return container.resolve('catalogPricingService') as CatalogPricingService
  } catch {
    return null
  }
}

function priceKindIdOf(row: PriceRow): string | null {
  const kind = row.priceKind as { id?: string } | string | null | undefined
  if (!kind) return null
  return typeof kind === 'string' ? kind : kind.id ?? null
}

async function loadDefaultVariantId(em: EntityManager, scope: Scope, productId: string): Promise<string | null> {
  const variant = await findOneWithDecryption(
    em,
    CatalogProductVariant,
    { ...scope, product: productId, isDefault: true, isActive: true, deletedAt: null },
    undefined,
    scope,
  )
  return variant?.id ?? null
}

export async function loadProductPriceRows(em: EntityManager, scope: Scope, productId: string): Promise<PriceRow[]> {
  const variantId = await loadDefaultVariantId(em, scope, productId)
  const where: FilterQuery<CatalogProductPrice> = variantId
    ? { ...scope, $or: [{ product: productId }, { variant: variantId }] }
    : { ...scope, product: productId }
  const rows = await findWithDecryption(em, CatalogProductPrice, where, { populate: ['priceKind', 'offer'] }, scope)
  return filterRowsForVariant(rows as PriceRow[], variantId)
}

function storedPriceOf(period: UnitProductPeriod): PriceSnapshot | null {
  if (!period.priceAmount || !period.currencyCode) return null
  return { priceAmount: period.priceAmount, currencyCode: period.currencyCode, priceKindId: period.priceKindId ?? null }
}

export async function periodPriceOf(
  em: EntityManager,
  container: AwilixContainer,
  scope: Scope,
  period: UnitProductPeriod,
  context: PriceContext = {},
): Promise<PriceSnapshot> {
  return storedPriceOf(period) ?? resolvePriceSnapshot(em, container, scope, period.catalogProductId, context)
}

function referenceId(reference: { id: string } | string | null | undefined): string | null {
  if (!reference) return null
  return typeof reference === 'string' ? reference : reference.id
}

async function loadDefaultVariantIds(em: EntityManager, scope: Scope, productIds: readonly string[]): Promise<Map<string, string>> {
  const variants = await findWithDecryption(
    em,
    CatalogProductVariant,
    { ...scope, product: { $in: [...productIds] }, isDefault: true, isActive: true, deletedAt: null },
    undefined,
    scope,
  )
  const result = new Map<string, string>()
  for (const variant of variants) {
    const productId = referenceId(variant.product as CatalogProduct | string | null)
    if (productId && !result.has(productId)) result.set(productId, variant.id)
  }
  return result
}

async function loadPriceRowsByProduct(em: EntityManager, scope: Scope, productIds: readonly string[]): Promise<Map<string, PriceRow[]>> {
  const variantIds = await loadDefaultVariantIds(em, scope, productIds)
  const productByVariant = new Map(Array.from(variantIds, ([productId, variantId]) => [variantId, productId]))
  const where: FilterQuery<CatalogProductPrice> = variantIds.size
    ? { ...scope, $or: [{ product: { $in: [...productIds] } }, { variant: { $in: Array.from(variantIds.values()) } }] }
    : { ...scope, product: { $in: [...productIds] } }
  const rows = (await findWithDecryption(em, CatalogProductPrice, where, { populate: ['priceKind', 'offer'] }, scope)) as PriceRow[]
  const grouped = new Map<string, PriceRow[]>()
  for (const row of rows) {
    const variantId = resolvePriceVariantId(row)
    const productId = referenceId(row.product) ?? (variantId ? productByVariant.get(variantId) ?? null : null)
    if (!productId) continue
    const list = grouped.get(productId) ?? []
    list.push(row)
    grouped.set(productId, list)
  }
  const result = new Map<string, PriceRow[]>()
  for (const productId of productIds) {
    result.set(productId, filterRowsForVariant(grouped.get(productId) ?? [], variantIds.get(productId) ?? null))
  }
  return result
}

function hasNetAmount(row: PriceRow): boolean {
  return row.unitPriceNet !== null && row.unitPriceNet !== undefined && String(row.unitPriceNet).trim().length > 0
}

async function snapshotFromRows(pricing: CatalogPricingService, rows: PriceRow[], context: PriceContext): Promise<PriceSnapshot> {
  if (!rows.length) return emptyPrice()
  const pricingContext = pricingContextOf(context)
  const netRows = rows.filter(hasNetAmount)
  const best = netRows.length ? await pricing.resolvePrice(netRows, pricingContext) : null
  if (best && hasNetAmount(best)) {
    return { priceAmount: String(best.unitPriceNet), currencyCode: best.currencyCode ?? null, priceKindId: priceKindIdOf(best) }
  }
  const fallback = await pricing.resolvePrice(rows, pricingContext)
  return { priceAmount: null, currencyCode: fallback?.currencyCode ?? null, priceKindId: null }
}

async function resolveCatalogPrices(
  em: EntityManager,
  container: AwilixContainer,
  scope: Scope,
  productIds: readonly string[],
  context: PriceContext,
): Promise<Map<string, PriceSnapshot>> {
  const result = new Map<string, PriceSnapshot>()
  if (!productIds.length) return result
  const pricing = resolvePricingService(container)
  if (!pricing) {
    for (const productId of productIds) result.set(productId, emptyPrice())
    return result
  }
  const rowsByProduct = await loadPriceRowsByProduct(em, scope, productIds)
  for (const [productId, rows] of rowsByProduct) result.set(productId, await snapshotFromRows(pricing, rows, context))
  return result
}

export async function periodPricesOf(
  em: EntityManager,
  container: AwilixContainer,
  scope: Scope,
  periods: readonly UnitProductPeriod[],
  context: PriceContext = {},
): Promise<Map<string, PriceSnapshot>> {
  const missing = Array.from(new Set(periods.filter((period) => !storedPriceOf(period)).map((period) => period.catalogProductId)))
  const catalogPrices = await resolveCatalogPrices(em, container, scope, missing, context)
  const result = new Map<string, PriceSnapshot>()
  for (const period of periods) {
    const price = storedPriceOf(period) ?? catalogPrices.get(period.catalogProductId)
    if (price) result.set(period.id, price)
  }
  return result
}

export async function openPeriodPrice(
  em: EntityManager,
  container: AwilixContainer,
  scope: Scope,
  unitId: string,
  context: PriceContext = {},
): Promise<PriceSnapshot> {
  const period = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, unitId, validTo: null }, undefined, scope)
  if (!period) return emptyPrice()
  return periodPriceOf(em, container, scope, period, context)
}

export async function recordPeriodPrice(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  catalogProductId: string,
  price: PriceSnapshot,
): Promise<void> {
  if (!price.priceAmount || !price.currencyCode) return
  const period = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, unitId, validTo: null }, undefined, scope)
  if (!period || period.catalogProductId !== catalogProductId || (period.priceAmount && period.currencyCode)) return
  period.priceAmount = price.priceAmount
  period.currencyCode = price.currencyCode
  period.priceKindId = price.priceKindId
  await em.flush()
}

export async function resolvePriceSnapshot(
  em: EntityManager,
  container: AwilixContainer,
  scope: Scope,
  productId: string,
  context: PriceContext = {},
): Promise<PriceSnapshot> {
  const pricing = resolvePricingService(container)
  if (!pricing) return emptyPrice()
  const rows = await loadProductPriceRows(em, scope, productId)
  return snapshotFromRows(pricing, rows, context)
}

export async function listUnitCategories(em: EntityManager, scope: Scope, query: CategoryOptionsQuery = {}): Promise<CategoryOptionsPage> {
  const limit = optionsLimitOf(query.limit)
  const rows = await findWithDecryption(
    em,
    CatalogProductCategory,
    { ...scope, deletedAt: null },
    { orderBy: { treePath: 'asc', name: 'asc' }, limit: limit + 1 },
    scope,
  )
  const page = rows.slice(0, limit)
  if (query.includeCategoryId && !page.some((row) => row.id === query.includeCategoryId)) {
    const included = await loadCategoryScope(em, scope, query.includeCategoryId)
    if (included) page.push(included)
  }
  return {
    categories: page.map((row) => ({ id: row.id, name: row.name, depth: row.depth ?? 0, parentId: row.parentId ?? null })),
    hasMore: rows.length > limit,
  }
}

async function findEligibleProductIds(
  em: EntityManager,
  scope: Scope,
  category: CatalogProductCategory,
  term: string,
  limit: number,
): Promise<string[]> {
  const categoryIds = subtreeCategoryIds(category)
  const searchSql = term ? ` and ${PRODUCT_SEARCH_EXPRESSION_SQL} ilike ${buildAccentInsensitiveContainsPatternSql()}` : ''
  const rows = await em.getConnection().execute<Array<{ id: string }>>(
    `select p.id from catalog_products p
      where p.organization_id = ? and p.tenant_id = ? and p.deleted_at is null
        and exists (
          select 1 from catalog_product_category_assignments a
           where a.product_id = p.id and a.organization_id = ? and a.tenant_id = ?
             and a.category_id in (${categoryIds.map(() => '?').join(', ')})
        )${searchSql}
      order by p.title asc, p.id asc
      limit ?::int`,
    [scope.organizationId, scope.tenantId, scope.organizationId, scope.tenantId, ...categoryIds, ...(term ? [term] : []), limit],
    'all',
    em.getTransactionContext(),
  )
  return rows.map((row) => String(row.id))
}

export async function listProductsForCategory(
  em: EntityManager,
  scope: Scope,
  categoryId: string,
  query: ProductOptionsQuery = {},
): Promise<ProductOptionsPage> {
  const category = await loadCategoryScope(em, scope, categoryId)
  if (!category) return { products: [], hasMore: false }
  const limit = optionsLimitOf(query.limit)
  const found = await findEligibleProductIds(em, scope, category, sanitizeSearchTerm(query.search ?? undefined), limit + 1)
  const ids = found.slice(0, limit)
  const includeId = query.includeProductId
  if (includeId && !ids.includes(includeId) && (await isProductInCategory(em, scope, category, includeId))) ids.push(includeId)
  if (!ids.length) return { products: [], hasMore: false }
  const rows = await findWithDecryption(
    em,
    CatalogProduct,
    { ...scope, id: { $in: ids }, deletedAt: null },
    { fields: ['id', 'title'] },
    scope,
  )
  const byId = new Map(rows.map((product) => [product.id, product]))
  const products = ids.flatMap((id) => {
    const product = byId.get(id)
    return product ? [product] : []
  })
  const uses = await loadProductUses(em, scope, products.map((product) => product.id))
  return {
    products: products.map((product) => {
      const use = uses.get(product.id) ?? null
      return { id: product.id, title: product.title, use: use?.use ?? null, billingUnit: use?.billingUnit ?? null }
    }),
    hasMore: found.length > limit,
  }
}

export async function loadProductNames(em: EntityManager, scope: Scope, productIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(productIds.filter((id) => id)))
  const result = new Map<string, string>()
  if (!ids.length) return result
  const rows = await findWithDecryption(em, CatalogProduct, { ...scope, id: { $in: ids } }, undefined, scope)
  for (const row of rows) result.set(row.id, row.title)
  return result
}

export async function loadCategoryNames(em: EntityManager, scope: Scope, categoryIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(categoryIds.filter((id) => id)))
  const result = new Map<string, string>()
  if (!ids.length) return result
  const rows = await findWithDecryption(em, CatalogProductCategory, { ...scope, id: { $in: ids } }, undefined, scope)
  for (const row of rows) result.set(row.id, row.name)
  return result
}
