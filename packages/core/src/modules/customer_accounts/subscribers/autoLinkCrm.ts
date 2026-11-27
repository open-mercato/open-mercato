import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOwnedCompanyForPerson } from '@open-mercato/core/modules/customer_accounts/lib/customerEntityOwnership'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

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
  const userId = (data?.userId ?? data?.id) as string
  const tenantId = data?.tenantId as string
  const organizationId = data?.organizationId as string | undefined
  if (!userId || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')

  try {
    const user = await findOneWithDecryption(em, CustomerUser, {
      id: userId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    }, undefined, { tenantId, organizationId })
    if (!user) return
    if (!user.emailVerifiedAt || !user.isActive) return

    const { CustomerEntity } = await import('@open-mercato/core/modules/customers/data/entities')

    // Every lookup and write below normalizes against the user's OWN org, not just
    // the tenant: customerEntityId is the portal's company scope key (portal user
    // and invite routes filter on it), so adopting an entity from another org would
    // widen the user's portal access instead of repairing it.
    const ownScope = { tenantId, organizationId: user.organizationId }

    let personEntityId = user.personEntityId ?? null
    let customerEntityId = user.customerEntityId ?? null
    if (customerEntityId) {
      const linked = await findOneWithDecryption(
        em,
        CustomerEntity,
        { id: customerEntityId, ...ownScope, deletedAt: null },
        undefined,
        ownScope,
      )
      if (!linked) customerEntityId = null
      else if (linked.kind === 'person') {
        customerEntityId = await resolveOwnedCompanyForPerson(em, linked.id, ownScope)
      }
    }

    if (!personEntityId) {
      const email = user.email?.toLowerCase().trim()
      if (email) {
        const personEntities = await findWithDecryption(
          em,
          CustomerEntity,
          { ...ownScope, kind: 'person', deletedAt: null },
          { limit: 500 },
          ownScope,
        )
        personEntityId = personEntities.find((person) => person.primaryEmail?.toLowerCase().trim() === email)?.id ?? null
      }
    }
    if (personEntityId && !customerEntityId) {
      customerEntityId = await resolveOwnedCompanyForPerson(em, personEntityId, ownScope)
    }

    const updates: Partial<CustomerUser> = {}
    if (personEntityId !== (user.personEntityId ?? null)) updates.personEntityId = personEntityId
    if (customerEntityId !== (user.customerEntityId ?? null)) updates.customerEntityId = customerEntityId
    if (!Object.keys(updates).length) return

    await em.nativeUpdate(CustomerUser, {
      id: userId,
      ...ownScope,
      emailHash: user.emailHash,
      emailVerifiedAt: { $ne: null },
      deletedAt: null,
      isActive: true,
      personEntityId: user.personEntityId ?? null,
      customerEntityId: user.customerEntityId ?? null,
    }, updates)
  } catch (err) {
    logger.error('Failed to link customer user to CRM person', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_accounts', code: 'customer_accounts.crm_link_failed' })
  }
}
