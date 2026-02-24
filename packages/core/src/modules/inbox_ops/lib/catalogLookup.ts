import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

interface CatalogProductForExtraction {
  id: string
  name: string
  sku?: string
  price?: string
}

interface CatalogProductLike {
  id: string
  title: string
  sku?: string | null
  tenantId?: string
  organizationId?: string
  deletedAt?: Date | null
  updatedAt?: Date
}

interface CatalogProductPriceLike {
  product?: unknown
  unitPriceNet?: string | null
  unitPriceGross?: string | null
  tenantId?: string
  organizationId?: string
  createdAt?: Date
}

interface CatalogLookupDeps {
  catalogProductClass: EntityClass<CatalogProductLike>
  catalogProductPriceClass: EntityClass<CatalogProductPriceLike>
}

const MAX_CATALOG_PRODUCTS = 50

export async function fetchCatalogProductsForExtraction(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  deps?: CatalogLookupDeps,
): Promise<CatalogProductForExtraction[]> {
  if (!deps?.catalogProductClass || !deps?.catalogProductPriceClass) return []

  try {
    const products = await findWithDecryption(
      em,
      deps.catalogProductClass,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      { limit: MAX_CATALOG_PRODUCTS, orderBy: { updatedAt: 'DESC' } },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (!products || products.length === 0) return []

    const productIds = products.map((p) => p.id)

    const prices = await findWithDecryption(
      em,
      deps.catalogProductPriceClass,
      {
        product: { $in: productIds },
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      { orderBy: { createdAt: 'DESC' } },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    const priceByProduct = new Map<string, string>()
    for (const price of prices) {
      const rawProduct = price.product
      const productId = typeof rawProduct === 'string'
        ? rawProduct
        : rawProduct && typeof rawProduct === 'object' && 'id' in rawProduct
          ? String((rawProduct as Record<string, unknown>).id)
          : undefined
      if (productId && !priceByProduct.has(productId)) {
        const amount = price.unitPriceNet ?? price.unitPriceGross ?? null
        if (amount) priceByProduct.set(productId, amount)
      }
    }

    return products.map((product) => ({
      id: product.id,
      name: product.title,
      sku: product.sku ?? undefined,
      price: priceByProduct.get(product.id),
    }))
  } catch (err) {
    console.error('[inbox_ops:catalogLookup] Failed to fetch catalog products:', err)
    return []
  }
}
