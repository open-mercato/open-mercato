import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

export const metadata = {
  event: 'customers.address.deleted',
  persistent: true,
  id: 'sales:reconcile-on-address-delete',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T; eventName?: string },
): Promise<void> {
  const data = payload as Record<string, unknown>
  const addressId = data?.id as string | undefined
  const tenantId = data?.tenantId as string | undefined
  if (!addressId || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')

  try {
    await Promise.all([
      em.nativeUpdate(
        SalesOrder,
        { billingAddressId: addressId, tenantId },
        { billingAddressId: null },
      ),
      em.nativeUpdate(
        SalesOrder,
        { shippingAddressId: addressId, tenantId },
        { shippingAddressId: null },
      ),
      em.nativeUpdate(
        SalesQuote,
        { billingAddressId: addressId, tenantId },
        { billingAddressId: null },
      ),
      em.nativeUpdate(
        SalesQuote,
        { shippingAddressId: addressId, tenantId },
        { shippingAddressId: null },
      ),
    ])
  } catch (err) {
    console.error('[sales:reconcile-on-address-delete] Failed to null address references on sales documents:', err)
  }
}
