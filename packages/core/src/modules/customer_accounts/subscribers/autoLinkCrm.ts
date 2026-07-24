import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isOwnedCompanyEntity } from '@open-mercato/core/modules/customer_accounts/lib/customerEntityOwnership'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_accounts').child({ component: 'auto-link-crm' })

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
    const user = await findOneWithDecryption(em, CustomerUser, { id: userId, tenantId, deletedAt: null }, undefined, { tenantId, organizationId })
    if (!user) return

    const { CustomerEntity, CustomerPersonProfile } = await import('@open-mercato/core/modules/customers/data/entities')

    // Defensive normalization: customerEntityId is the CRM company FK. Earlier
    // invite flows (#4362) could poison it with a person entity id, which then
    // breaks every later user edit ("Company not found"). If the linked entity
    // is a person (not a company), drop it — or recover the person's real
    // company from their profile. Correct company links are left untouched.
    if (user.customerEntityId) {
      // Normalize against the user's OWN org, not just the tenant: customerEntityId
      // is the portal's company scope key (portal user/invite routes filter on it),
      // so adopting a company from another org would widen the user's portal access
      // instead of repairing it. Anything that is not an owned company here — a
      // person id (the #4362 poisoning) or a cross-org entity — is recovered to the
      // person's own company when that company is in-org, otherwise cleared.
      const ownScope = { tenantId, organizationId: user.organizationId }
      const linked = await findOneWithDecryption(
        em,
        CustomerEntity,
        { id: user.customerEntityId, tenantId, organizationId: user.organizationId, deletedAt: null } as any,
        undefined,
        { tenantId, organizationId },
      ) as any
      if (!linked) {
        // Not resolvable inside the user's own org — a cross-org (or deleted)
        // entity. Clear it rather than leave it: this FK is the portal scope key.
        await em.nativeUpdate(
          CustomerUser,
          { id: userId, tenantId, organizationId: user.organizationId },
          { customerEntityId: null },
        )
        user.customerEntityId = null
      } else if (linked.kind === 'person') {
        const profile = await em.findOne(CustomerPersonProfile as any, {
          entity: user.customerEntityId,
          tenantId,
          organizationId: user.organizationId,
        } as any) as any
        const candidate = (profile?.companyEntityId as string | undefined) || null
        // Only adopt a recovered company that is itself in the user's org.
        const replacement = candidate && (await isOwnedCompanyEntity(em, candidate, ownScope))
          ? candidate
          : null
        await em.nativeUpdate(
          CustomerUser,
          { id: userId, tenantId, organizationId: user.organizationId },
          { customerEntityId: replacement },
        )
        user.customerEntityId = replacement
      }
    }

    if (user.personEntityId) return

    const email = (data?.email ? (data.email as string) : user.email)?.toLowerCase().trim()
    if (!email) return

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

    const profile = await em.findOne(CustomerPersonProfile as any, { entity: matchingEntity.id } as any) as any
    const companyEntityId = profile?.companyEntityId as string | undefined

    const updates: Record<string, unknown> = { personEntityId: matchingEntity.id }
    if (companyEntityId) {
      updates.customerEntityId = companyEntityId
    }

    await em.nativeUpdate(
      CustomerUser,
      { id: userId, tenantId, organizationId: user.organizationId },
      updates,
    )
  } catch (err) {
    logger.error('Failed to link customer user to CRM person', { err })
  }
}
