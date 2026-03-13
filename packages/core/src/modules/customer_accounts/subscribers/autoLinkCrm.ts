import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'

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
  const email = data?.email as string
  const tenantId = data?.tenantId as string
  if (!userId || !email || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')
  const emailHash = hashForLookup(email)

  try {
    // Find CRM person by email hash
    const person = await em.getConnection().execute(
      `SELECT id, customer_entity_id FROM customer_person_profiles WHERE email_hash = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
      [emailHash, tenantId],
    )

    if (person && person.length > 0) {
      const personId = person[0].id
      const customerEntityId = person[0].customer_entity_id

      const updates: Record<string, unknown> = { personEntityId: personId }
      if (customerEntityId) {
        updates.customerEntityId = customerEntityId
      }

      await em.nativeUpdate(CustomerUser, { id: userId }, updates)
    }
  } catch {
    // Best effort — CRM module may not be enabled
  }
}
