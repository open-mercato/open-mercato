import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityName } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { tryResolve } from './tryResolve'

// The `catalog` columns read here through soft-resolved entity classes, so
// `availability` never imports `catalog`.
type CatalogRecordRow = {
  id: string
  organizationId: string
  tenantId: string
  deletedAt: Date | null
}

type CatalogVariantRow = CatalogRecordRow & { product: { id: string } | string }

export type CatalogTargetIssue = 'productNotFound' | 'variantNotFound' | 'variantProductMismatch'

export type CatalogTarget = {
  tenantId: string
  organizationId: string
  productId: string | null | undefined
  variantId: string | null | undefined
}

function variantProductId(variant: CatalogVariantRow): string | null {
  if (typeof variant.product === 'string') return variant.product
  return variant.product?.id ?? null
}

// Checks that a product (and variant) id names a live catalog record of the caller's
// organization, and that the variant belongs to the product. Degrades to "no issue"
// when `catalog` is not installed: each entity class is soft-resolved from DI.
// `checkProduct: false` skips the product lookup for callers where a missing product
// is harmless (a policy row for it decides nothing) but a foreign variant is not.
export async function findCatalogTargetIssue(
  em: EntityManager,
  container: { resolve: <R = unknown>(name: string) => R },
  target: CatalogTarget,
  options: { checkProduct?: boolean } = {},
): Promise<CatalogTargetIssue | null> {
  const { tenantId, organizationId, productId, variantId } = target
  const scope = { tenantId, organizationId }
  if (productId && options.checkProduct !== false) {
    const CatalogProduct = tryResolve<EntityName<CatalogRecordRow>>(container, 'CatalogProduct')
    if (CatalogProduct) {
      const product = await findOneWithDecryption(
        em,
        CatalogProduct,
        { id: productId, organizationId, tenantId, deletedAt: null },
        undefined,
        scope,
      )
      if (!product) return 'productNotFound'
    }
  }
  if (variantId) {
    const CatalogProductVariant = tryResolve<EntityName<CatalogVariantRow>>(container, 'CatalogProductVariant')
    if (CatalogProductVariant) {
      const variant = await findOneWithDecryption(
        em,
        CatalogProductVariant,
        { id: variantId, organizationId, tenantId, deletedAt: null },
        undefined,
        scope,
      )
      if (!variant) return 'variantNotFound'
      if (productId && variantProductId(variant) !== productId) return 'variantProductMismatch'
    }
  }
  return null
}
