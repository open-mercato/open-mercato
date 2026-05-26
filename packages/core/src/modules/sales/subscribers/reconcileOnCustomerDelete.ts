import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

export const metadata = {
  event: 'customers.person.deleted',
  persistent: true,
  id: 'sales:reconcile-on-person-delete',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T; eventName?: string },
): Promise<void> {
  const data = payload as Record<string, unknown>
  const entityId = (data?.entityId as string | undefined) ?? (data?.id as string | undefined)
  const tenantId = data?.tenantId as string | undefined
  if (!entityId || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')

  try {
    await Promise.all([
      em.nativeUpdate(
        SalesOrder,
        { customerEntityId: entityId, tenantId },
        { customerEntityId: null },
      ),
      em.nativeUpdate(
        SalesQuote,
        { customerEntityId: entityId, tenantId },
        { customerEntityId: null },
      ),
    ])
  } catch (err) {
    console.error('[sales:reconcile-on-person-delete] Failed to null customerEntityId on sales documents:', err)
  }
}
