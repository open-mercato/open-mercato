import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata = {
  event: 'customers.company.deleted',
  persistent: true,
  id: 'customer_accounts:unlink-on-company-delete',
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
    await em.nativeUpdate(
      CustomerUser,
      { customerEntityId: entityId, tenantId },
      { customerEntityId: null, updatedAt: new Date() },
    )
  } catch (err) {
    console.error('[customer_accounts:unlink-on-company-delete] Failed to clear customerEntityId on customer users:', err)
  }
}
