import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct } from '../data/entities'
import {
  computeProductScopeKeys,
  PRODUCT_SCOPE_CATEGORY_PREFIX,
  PRODUCT_SCOPE_TAG_PREFIX,
} from '../lib/productScopeKeys'

export type ScopedProductScope = {
  tenantId: string
  organizationId: string
}

/**
 * The shape a buyer-scoping consumer (promotions, the future `cart` module) needs per product:
 * ancestor-expanded category ids and tag ids in the same `scope_keys` convention as
 * `productScopeKeys.ts`, plus `isActive` so a caller can decide whether an inactive-but-visible
 * product should still be treated as orderable.
 */
export type ScopedProductRecord = {
  id: string
  categoryIds: string[]
  tagIds: string[]
  isActive: boolean
}

export interface CatalogScopedProductService {
  /**
   * Batch-resolves `ScopedProductRecord` for `ids`, scoped to `tenantId`/`organizationId`. Every
   * requested id gets an entry: `null` for a product that does not exist, is soft-deleted, or
   * belongs to another tenant/organization — never simply omitted, so a caller can distinguish
   * "not found" from "not requested". A found-but-inactive product is returned with
   * `isActive: false`, not `null`.
   */
  loadScopedProducts(
    em: EntityManager,
    ids: string[],
    scope: ScopedProductScope,
  ): Promise<Map<string, ScopedProductRecord | null>>
}

function splitScopeKeys(keys: string[]): { categoryIds: string[]; tagIds: string[] } {
  const categoryIds: string[] = []
  const tagIds: string[] = []
  for (const key of keys) {
    if (key.startsWith(PRODUCT_SCOPE_CATEGORY_PREFIX)) {
      categoryIds.push(key.slice(PRODUCT_SCOPE_CATEGORY_PREFIX.length))
    } else if (key.startsWith(PRODUCT_SCOPE_TAG_PREFIX)) {
      tagIds.push(key.slice(PRODUCT_SCOPE_TAG_PREFIX.length))
    }
  }
  return { categoryIds, tagIds }
}

export class DefaultCatalogScopedProductService implements CatalogScopedProductService {
  async loadScopedProducts(
    em: EntityManager,
    ids: string[],
    scope: ScopedProductScope,
  ): Promise<Map<string, ScopedProductRecord | null>> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)))
    const result = new Map<string, ScopedProductRecord | null>()
    if (!uniqueIds.length) return result
    for (const id of uniqueIds) result.set(id, null)

    const products = await findWithDecryption(
      em,
      CatalogProduct,
      {
        id: { $in: uniqueIds },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      { fields: ['id', 'isActive'] },
      scope,
    )
    if (!products.length) return result

    const foundIds = products.map((product) => product.id)
    const db = em.getKysely<any>()
    const scopeKeysByProduct = await computeProductScopeKeys(db, foundIds, scope)

    for (const product of products) {
      const keys = scopeKeysByProduct.get(product.id) ?? []
      const { categoryIds, tagIds } = splitScopeKeys(keys)
      result.set(product.id, {
        id: product.id,
        categoryIds,
        tagIds,
        isActive: product.isActive,
      })
    }
    return result
  }
}
