import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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
  const eventId = data?.id as string
  const tenantId = data?.tenantId as string
  const organizationId = data?.organizationId as string | undefined
  if (!eventId || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')

  try {
    const { CustomerEntity } = await import('@open-mercato/core/modules/customers/data/entities')

    let entity = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: eventId, tenantId, kind: 'person', deletedAt: null } as any,
      undefined,
      { tenantId, organizationId },
    )

    if (!entity) {
      const { CustomerPersonProfile } = await import('@open-mercato/core/modules/customers/data/entities')
      const profile = await em.findOne(CustomerPersonProfile as any, { id: eventId } as any, { populate: ['entity'] }) as any
      if (profile?.entity) {
        entity = await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: profile.entity.id ?? profile.entity, tenantId, deletedAt: null } as any,
          undefined,
          { tenantId, organizationId },
        )
      }
    }

    if (!entity) return
    const email = (entity as any).primaryEmail as string | null
    if (!email) return

    const emailHash = hashForLookup(email.toLowerCase().trim())

    const personProfile = await em.getConnection().execute(
      `SELECT company_entity_id FROM customer_people WHERE entity_id = ? LIMIT 1`,
      [(entity as any).id],
    )
    const companyEntityId = personProfile?.[0]?.company_entity_id as string | undefined

    const customerUser = await em.findOne(CustomerUser, {
      emailHash,
      tenantId,
      deletedAt: null,
      personEntityId: null,
    })

    if (customerUser) {
      const updates: Record<string, unknown> = { personEntityId: (entity as any).id }
      if (companyEntityId && !customerUser.customerEntityId) {
        updates.customerEntityId = companyEntityId
      }
      await em.nativeUpdate(CustomerUser, { id: customerUser.id }, updates)
    }
  } catch (err) {
    console.error('[customer_accounts:auto-link-crm-reverse] Failed to link CRM person to customer user:', err)
  }
}
