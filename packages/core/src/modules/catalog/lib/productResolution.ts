import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct } from '../data/entities'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ResolveCatalogProductLookup = {
  sku?: string | null
  externalId?: string | null
}

export type ResolveCatalogProductScope = {
  organizationId: string
  tenantId: string
}

function normalizeLookupValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Public seam for cross-module callers (e.g. the `sync_magento` order mapper) to look up a
 * {@link CatalogProduct} without reaching into the catalog ORM directly. Uses
 * `findOneWithDecryption` so encrypted product fields are respected, and always scopes the query by
 * `organizationId` + `tenantId` plus `deletedAt: null`.
 *
 * Catalog does not store a foreign external id on the product — those mappings live per-integration
 * in `SyncExternalIdMapping` (data_sync) and resolve to the local OM product id. `externalId` here is
 * therefore matched against the OM product `id` (the value an external→local mapping yields) and only
 * when it is a valid UUID, so a stray non-UUID value falls through to the SKU lookup instead of
 * raising a Postgres uuid-cast error. When both identifiers are supplied the `externalId` match takes
 * precedence, mirroring the mapping-first/SKU-fallback order used by the existing sync importers.
 */
export async function resolveProductBySkuOrExternalId(
  em: EntityManager,
  lookup: ResolveCatalogProductLookup,
  scope: ResolveCatalogProductScope,
): Promise<CatalogProduct | null> {
  const externalId = normalizeLookupValue(lookup.externalId)
  const sku = normalizeLookupValue(lookup.sku)
  if (!externalId && !sku) return null

  if (externalId && UUID_REGEX.test(externalId)) {
    const byExternalId = await findOneWithDecryption(
      em,
      CatalogProduct,
      {
        id: externalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (byExternalId) return byExternalId
  }

  if (sku) {
    return findOneWithDecryption(
      em,
      CatalogProduct,
      {
        sku,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
  }

  return null
}
