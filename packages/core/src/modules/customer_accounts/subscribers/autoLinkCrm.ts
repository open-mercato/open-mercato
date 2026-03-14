import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata = {
  event: 'customer_accounts.user.created',
  persistent: true,
  id: 'customer_accounts:auto-link-crm',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T; eventName?: string },
): Promise<void> {
  const data = payload as Record<string, unknown>
  const userId = data?.id as string
  const tenantId = data?.tenantId as string
  const organizationId = data?.organizationId as string | undefined
  if (!userId || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')

  try {
    let email: string | undefined
    if (data?.email) {
      email = (data.email as string).toLowerCase().trim()
    } else {
      const user = await em.findOne(CustomerUser, { id: userId, tenantId, deletedAt: null })
      if (user) email = user.email?.toLowerCase().trim()
    }
    if (!email) return

    const { CustomerEntity } = await import('@open-mercato/core/modules/customers/data/entities')

    const personEntities = await findWithDecryption(
      em,
      CustomerEntity,
      { tenantId, kind: 'person', deletedAt: null } as any,
      { limit: 500 } as any,
      { tenantId, organizationId },
    )

    const matchingEntity = personEntities.find(
      (e: any) => e.primaryEmail && e.primaryEmail.toLowerCase().trim() === email,
    ) as any

    if (!matchingEntity) return

    const profileRows = await em.getConnection().execute(
      `SELECT company_entity_id FROM customer_people WHERE entity_id = ? LIMIT 1`,
      [matchingEntity.id],
    )
    const companyEntityId = profileRows?.[0]?.company_entity_id as string | undefined

    const updates: Record<string, unknown> = { personEntityId: matchingEntity.id }
    if (companyEntityId) {
      updates.customerEntityId = companyEntityId
    }

    await em.nativeUpdate(CustomerUser, { id: userId }, updates)
  } catch (err) {
    console.error('[customer_accounts:auto-link-crm] Failed to link customer user to CRM person:', err)
  }
}
