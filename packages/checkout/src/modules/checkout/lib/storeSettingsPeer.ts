import type { EntityManager } from '@mikro-orm/postgresql'

// Release 5, Step 2.13 (C13/D-R5-35). The storefront-cart flat-rate carrier fallback
// lives on `ecommerce.EcommerceStore.settings.shipping.flatRate` (additive jsonb field,
// `packages/core/src/modules/ecommerce/data/validators.ts`'s `ecommerceStoreShippingSchema`).
// Read here via the same raw-Kysely peer-read style `lib/cartPeer.ts`/`lib/warehousePeer.ts`
// use — `ecommerce` is a soft peer (D-R5-18 table), gated by the caller's own
// `tryResolve('storeContextService')`.

export type StoreFlatRateFallback = { amount: number; currencyCode: string }

type EcommerceStoresDatabase = {
  ecommerce_stores: {
    id: string
    tenant_id: string
    organization_id: string
    settings: unknown
    deleted_at: Date | null
  }
}

export async function lookupStoreFlatRateFallback(
  em: EntityManager,
  storeId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<StoreFlatRateFallback | null> {
  const row = await em
    .getKysely<EcommerceStoresDatabase>()
    .selectFrom('ecommerce_stores')
    .select(['settings'])
    .where('id', '=', storeId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  if (!row) return null

  const settings = row.settings as { shipping?: { flatRate?: { amount?: unknown; currencyCode?: unknown } | null } } | null
  const flatRate = settings?.shipping?.flatRate
  if (!flatRate) return null
  const amount = Number(flatRate.amount)
  const currencyCode = typeof flatRate.currencyCode === 'string' ? flatRate.currencyCode : null
  if (!Number.isFinite(amount) || !currencyCode) return null
  return { amount, currencyCode }
}
