import type { DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { runWithDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  tableClassification: 'identity',
  bindingValidators: [async (identity) => {
    const organization = identity.organization
    if (!identity.context.tenantId) return true
    return runWithDatabaseExecutionContext({ kind: 'identity', source: 'identity', tenantId: identity.context.tenantId, operation: 'organization-binding' }, async () => {
      const [{ createRequestContainer }, { findOneWithDecryption }, { Organization, Tenant }] = await Promise.all([
        import('@open-mercato/shared/lib/di/container'), import('@open-mercato/shared/lib/encryption/find'), import('./data/entities'),
      ])
      const container = await createRequestContainer()
      const em = container.resolve<import('@mikro-orm/postgresql').EntityManager>('em')
      if (!await findOneWithDecryption(em, Tenant, { id: identity.context.tenantId, isActive: true, deletedAt: null })) return false
      if (!organization) return true
      return await findOneWithDecryption(em, Organization, {
        id: organization.id, tenant: identity.context.tenantId, isActive: true, deletedAt: null,
        ...(organization.slug ? { slug: organization.slug } : {}),
      }) !== null
    })
  }],
}
