import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct } from '../../catalog/data/entities'
import { CatalogProductPrice } from '../../catalog/data/entities'

interface CatalogProductForExtraction {
  id: string
  name: string
  sku?: string
  price?: string
}

const MAX_CATALOG_PRODUCTS = 50

export async function fetchCatalogProductsForExtraction(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<CatalogProductForExtraction[]> {
  try {
    const products = await findWithDecryption(
      em,
      CatalogProduct,
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
      CatalogProductPrice,
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
      const productId = typeof price.product === 'string' ? price.product : price.product?.id
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
