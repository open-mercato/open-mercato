import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { resolveOwnedCompanyForPerson } from '@open-mercato/core/modules/customer_accounts/lib/customerEntityOwnership'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

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
  if (!payload || typeof payload !== 'object') return
  const data = payload as Record<string, unknown>
  const eventId = typeof data.id === 'string' ? data.id : undefined
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : undefined
  const organizationId = typeof data.organizationId === 'string' ? data.organizationId : undefined
  if (!eventId || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')

  try {
    const { CustomerEntity, CustomerPersonProfile } = await import('@open-mercato/core/modules/customers/data/entities')
    const eventScope = { tenantId, ...(organizationId ? { organizationId } : {}) }

    let entity = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: eventId, ...eventScope, kind: 'person', deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )

    if (!entity) {
      const profile = await findOneWithDecryption(
        em,
        CustomerPersonProfile,
        { id: eventId, ...eventScope },
        undefined,
        eventScope,
      )
      const profileEntity: unknown = profile?.entity
      const personEntityId = typeof profileEntity === 'string' ? profileEntity : profile?.entity?.id
      if (personEntityId && profile?.organizationId) {
        const profileScope = { tenantId, organizationId: profile.organizationId }
        entity = await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: personEntityId, ...profileScope, kind: 'person', deletedAt: null },
          undefined,
          profileScope,
        )
      }
    }

    if (!entity?.organizationId) return
    const ownScope = { tenantId, organizationId: entity.organizationId }
    const email = entity.primaryEmail
    if (!email) return

    const emailHashes = lookupHashCandidates(email.toLowerCase().trim())

    const userWhere = {
      emailHash: { $in: emailHashes },
      ...ownScope,
      deletedAt: null,
      personEntityId: null,
    }
    const customerUser = await findOneWithDecryption(em, CustomerUser, userWhere, undefined, ownScope)

    if (customerUser) {
      const updates: Partial<CustomerUser> = { personEntityId: entity.id, updatedAt: new Date() }
      if (!customerUser.customerEntityId) {
        const companyEntityId = await resolveOwnedCompanyForPerson(em, entity.id, ownScope)
        if (companyEntityId) updates.customerEntityId = companyEntityId
      }
      const affected = await em.nativeUpdate(CustomerUser, {
        id: customerUser.id,
        ...userWhere,
        customerEntityId: customerUser.customerEntityId ?? null,
      }, updates)
      if (affected === 0) return
    }
  } catch (err) {
    logger.error('Failed to link CRM person to customer user', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_accounts', code: 'customer_accounts.reverse_crm_link_failed' })
  }
}
