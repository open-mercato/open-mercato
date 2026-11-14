import type { EntityManager } from '@mikro-orm/postgresql'

// Release 5, Step 2.13 (C13 "rate quoting inputs" — "origin from the store's address; else
// the primary warehouse's address"). `ecommerce.EcommerceStore` has no structured address
// today (`settings.contact.address` is one free-text string — see NOTIFY.md), so the
// store tier of C13's own three-tier origin fallback is not resolvable yet; this Step
// implements the next tier, the organization's primary `wms` warehouse, via the SAME
// scope-free-by-column, scoped-by-value raw-Kysely read `lib/cartPeer.ts` established.
// `wms` is a soft peer (gated by the caller's own `tryResolve('wmsReservationService')`).

export type WarehouseAddressPeerRow = {
  id: string
  addressLine1: string | null
  city: string | null
  postalCode: string | null
  country: string | null
}

type WmsWarehousesDatabase = {
  wms_warehouses: {
    id: string
    tenant_id: string
    organization_id: string
    is_primary: boolean
    address_line1: string | null
    city: string | null
    postal_code: string | null
    country: string | null
    deleted_at: Date | null
  }
}

export async function lookupPrimaryWarehouseAddress(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<WarehouseAddressPeerRow | null> {
  const row = await em
    .getKysely<WmsWarehousesDatabase>()
    .selectFrom('wms_warehouses')
    .select(['id', 'address_line1', 'city', 'postal_code', 'country'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('is_primary', '=', true)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  if (!row) return null
  return {
    id: row.id,
    addressLine1: row.address_line1 ?? null,
    city: row.city ?? null,
    postalCode: row.postal_code ?? null,
    country: row.country ?? null,
  }
}
