import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { CatalogPricingService, PriceRow } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { ProductUse, type BillingUnit, type ProductUseKind } from '../data/entities'

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

export type CategoryOption = { id: string; name: string; depth: number; parentId: string | null }

export type UnitProductOption = {
  id: string
  title: string
  use: ProductUseKind | null
  billingUnit: BillingUnit | null
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

export async function loadCategoryScope(em: EntityManager, scope: Scope, categoryId: string): Promise<CatalogProductCategory | null> {
  return findOneWithDecryption(em, CatalogProductCategory, { id: categoryId, ...scope, deletedAt: null }, undefined, scope)
}

export async function eligibleProductIdsForCategory(em: EntityManager, scope: Scope, category: CatalogProductCategory): Promise<string[]> {
  const categoryIds = [category.id, ...(Array.isArray(category.descendantIds) ? category.descendantIds : [])]
  const assignments = await findWithDecryption(
    em,
    CatalogProductCategoryAssignment,
    { ...scope, category: { $in: categoryIds } },
    undefined,
    scope,
  )
  const ids = new Set<string>()
  for (const assignment of assignments) {
    const product = assignment.product as CatalogProduct | string
    ids.add(typeof product === 'string' ? product : product.id)
  }
  return Array.from(ids)
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
  const eligible = await eligibleProductIdsForCategory(em, scope, category)
  if (!eligible.includes(product.id)) {
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

export async function resolvePriceSnapshot(
  em: EntityManager,
  container: AwilixContainer,
  scope: Scope,
  productId: string,
): Promise<PriceSnapshot> {
  const empty: PriceSnapshot = { priceAmount: null, currencyCode: null, priceKindId: null }
  const pricing = resolvePricingService(container)
  if (!pricing) return empty
  const rows = await findWithDecryption(
    em,
    CatalogProductPrice,
    { ...scope, product: productId, variant: null },
    { populate: ['priceKind'] },
    scope,
  )
  if (!rows.length) return empty
  const best = await pricing.resolvePrice(rows as PriceRow[], { quantity: 1, date: new Date() })
  if (!best) return empty
  return {
    priceAmount: best.unitPriceNet ?? best.unitPriceGross ?? null,
    currencyCode: best.currencyCode ?? null,
    priceKindId: priceKindIdOf(best),
  }
}

export async function listUnitCategories(em: EntityManager, scope: Scope): Promise<CategoryOption[]> {
  const rows = await findWithDecryption(
    em,
    CatalogProductCategory,
    { ...scope, deletedAt: null },
    { orderBy: { treePath: 'asc', name: 'asc' } },
    scope,
  )
  return rows.map((row) => ({ id: row.id, name: row.name, depth: row.depth ?? 0, parentId: row.parentId ?? null }))
}

export async function listProductsForCategory(em: EntityManager, scope: Scope, categoryId: string): Promise<UnitProductOption[]> {
  const category = await loadCategoryScope(em, scope, categoryId)
  if (!category) return []
  const ids = await eligibleProductIdsForCategory(em, scope, category)
  if (!ids.length) return []
  const products = await findWithDecryption(
    em,
    CatalogProduct,
    { ...scope, id: { $in: ids }, deletedAt: null },
    { orderBy: { title: 'asc' } },
    scope,
  )
  const uses = await loadProductUses(em, scope, products.map((product) => product.id))
  return products.map((product) => {
    const use = uses.get(product.id) ?? null
    return { id: product.id, title: product.title, use: use?.use ?? null, billingUnit: use?.billingUnit ?? null }
  })
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
