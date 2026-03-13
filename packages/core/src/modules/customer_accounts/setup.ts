import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerRole, CustomerRoleAcl } from '@open-mercato/core/modules/customer_accounts/data/entities'

interface SeedScope {
  tenantId: string
  organizationId: string
}

const DEFAULT_ROLES = [
  {
    name: 'Portal Admin',
    slug: 'portal_admin',
    description: 'Full portal administration access',
    isSystem: true,
    customerAssignable: false,
    isDefault: false,
    acl: {
      isPortalAdmin: true,
      features: ['portal.*'],
    },
  },
  {
    name: 'Buyer',
    slug: 'buyer',
    description: 'Standard buyer access with ordering capabilities',
    isSystem: true,
    customerAssignable: true,
    isDefault: true,
    acl: {
      isPortalAdmin: false,
      features: [
        'portal.account.manage',
        'portal.orders.view',
        'portal.orders.create',
        'portal.quotes.view',
        'portal.quotes.request',
        'portal.invoices.view',
        'portal.catalog.view',
      ],
    },
  },
  {
    name: 'Viewer',
    slug: 'viewer',
    description: 'Read-only portal access',
    isSystem: true,
    customerAssignable: true,
    isDefault: false,
    acl: {
      isPortalAdmin: false,
      features: [
        'portal.account.manage',
        'portal.orders.view',
        'portal.invoices.view',
        'portal.catalog.view',
      ],
    },
  },
]

async function seedDefaultRoles(em: EntityManager, scope: SeedScope): Promise<void> {
  for (const roleDef of DEFAULT_ROLES) {
    const existing = await em.findOne(CustomerRole, {
      tenantId: scope.tenantId,
      slug: roleDef.slug,
      deletedAt: null,
    })
    if (existing) continue

    const role = em.create(CustomerRole, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: roleDef.name,
      slug: roleDef.slug,
      description: roleDef.description,
      isSystem: roleDef.isSystem,
      customerAssignable: roleDef.customerAssignable,
      isDefault: roleDef.isDefault,
      createdAt: new Date(),
    } as any)
    em.persist(role)

    const acl = em.create(CustomerRoleAcl, {
      role,
      tenantId: scope.tenantId,
      featuresJson: roleDef.acl.features,
      isPortalAdmin: roleDef.acl.isPortalAdmin,
      createdAt: new Date(),
    } as any)
    em.persist(acl)
  }
  await em.flush()
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['customer_accounts.*'],
    admin: ['customer_accounts.*'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    await seedDefaultRoles(em, { tenantId, organizationId })
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    await seedDefaultRoles(em, { tenantId, organizationId })
  },
}

export default setup
