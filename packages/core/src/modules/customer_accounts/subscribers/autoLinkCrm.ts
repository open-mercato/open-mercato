import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOwnedCompanyForPerson } from '@open-mercato/core/modules/customer_accounts/lib/customerEntityOwnership'
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

    const { CustomerEntity } = await import('@open-mercato/core/modules/customers/data/entities')

    // Every lookup and write below normalizes against the user's OWN org, not just
    // the tenant: customerEntityId is the portal's company scope key (portal user
    // and invite routes filter on it), so adopting an entity from another org would
    // widen the user's portal access instead of repairing it.
    const ownScope = { tenantId, organizationId: user.organizationId }

    // Defensive normalization for NEW users only — this subscriber runs on
    // `customer_accounts.user.created`, which is never re-emitted for an existing
    // row. customerEntityId is the CRM company FK, and earlier invite flows (#4362)
    // could poison it with a person entity id, which then breaks every later user
    // edit ("Company not found"). If the linked entity is a person (not a company)
    // or sits outside the user's org, drop it — or recover the person's real company
    // from their profile. Correct company links are left untouched. Rows created
    // before this change keep their bad FK; see #4473 for the backfill.
    if (user.customerEntityId) {
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
        // Only adopt a recovered company that is itself in the user's org.
        const replacement = await resolveOwnedCompanyForPerson(em, user.customerEntityId, ownScope)
        await em.nativeUpdate(
          CustomerUser,
          { id: userId, tenantId, organizationId: user.organizationId },
          { customerEntityId: replacement },
        )
        user.customerEntityId = replacement
      }
    }

    // A user invited from a CRM person card arrives with personEntityId already
    // set, so the email-matching path below never runs for it. Derive the company
    // FK from that person's own profile instead of leaving it null forever — the
    // portal Users page, portal invitations, and the company detail "Portal users"
    // group all key off customerEntityId (#4362).
    if (user.personEntityId) {
      if (user.customerEntityId) return
      const recovered = await resolveOwnedCompanyForPerson(em, user.personEntityId, ownScope)
      if (recovered) {
        await em.nativeUpdate(
          CustomerUser,
          { id: userId, tenantId, organizationId: user.organizationId },
          { customerEntityId: recovered },
        )
      }
      return
    }

    const email = (data?.email ? (data.email as string) : user.email)?.toLowerCase().trim()
    if (!email) return

    // Scope the candidate lookup to the user's own org. The fifth argument is a
    // decryption scope, not a filter, so without organizationId in the `where`
    // this matches people across every org in the tenant and writes a cross-org
    // link that the normalization block above just cleared.
    const personEntities = await findWithDecryption(
      em,
      CustomerEntity,
      { tenantId, organizationId: user.organizationId, kind: 'person', deletedAt: null } as any,
      { limit: 500 } as any,
      { tenantId, organizationId },
    )

    const matchingEntity = personEntities.find(
      (e: any) => e.primaryEmail && e.primaryEmail.toLowerCase().trim() === email,
    ) as any

    if (!matchingEntity) return

    const companyEntityId = await resolveOwnedCompanyForPerson(em, matchingEntity.id, ownScope)

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

