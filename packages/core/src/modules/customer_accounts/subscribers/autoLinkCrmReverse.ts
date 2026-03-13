import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'

export const metadata = {
  event: 'customers.person.created',
  persistent: true,
  id: 'customer_accounts:auto-link-crm-reverse',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T; eventName?: string },
): Promise<void> {
  const data = payload as Record<string, unknown>
  const personId = data?.id as string
  const email = data?.email as string
  const tenantId = data?.tenantId as string
  const customerEntityId = data?.customerEntityId as string | undefined
  if (!personId || !email || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')
  const emailHash = hashForLookup(email)

  try {
    const customerUser = await em.findOne(CustomerUser, {
      emailHash,
      tenantId,
      deletedAt: null,
      personEntityId: null,
    })

    if (customerUser) {
      const updates: Record<string, unknown> = { personEntityId: personId }
      if (customerEntityId && !customerUser.customerEntityId) {
        updates.customerEntityId = customerEntityId
      }
      await em.nativeUpdate(CustomerUser, { id: customerUser.id }, updates)
    }
  } catch {
    // Best effort — module may not be fully initialized
  }
}
