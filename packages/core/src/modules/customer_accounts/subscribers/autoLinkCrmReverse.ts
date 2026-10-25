import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { resolveOwnedCompanyForPerson } from '@open-mercato/core/modules/customer_accounts/lib/customerEntityOwnership'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_accounts').child({ component: 'auto-link-crm-reverse' })

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

    const emailHashes = lookupHashCandidates(email.toLowerCase().trim())

    const customerUser = await em.findOne(CustomerUser, {
      emailHash: { $in: emailHashes },
      tenantId,
      deletedAt: null,
      personEntityId: null,
    })

    if (customerUser) {
      const updates: Record<string, unknown> = { personEntityId: (entity as any).id }
      if (!customerUser.customerEntityId) {
        const companyEntityId = await resolveOwnedCompanyForPerson(em, entity.id, {
          tenantId: customerUser.tenantId,
          organizationId: customerUser.organizationId,
        })
        if (companyEntityId) updates.customerEntityId = companyEntityId
      }
      const where = { id: customerUser.id, personEntityId: null }
      const affected = await em.nativeUpdate(
        CustomerUser,
        { ...where, ...(updates.customerEntityId ? { customerEntityId: null } : {}) },
        updates,
      )
      if (affected === 0 && updates.customerEntityId) {
        await em.nativeUpdate(CustomerUser, where, { personEntityId: entity.id })
      }
    }
  } catch (err) {
    logger.error('Failed to link CRM person to customer user', { err })
  }
}
