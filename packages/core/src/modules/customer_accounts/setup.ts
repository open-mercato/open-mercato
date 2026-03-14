import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { hash } from 'bcryptjs'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import {
  CustomerRole,
  CustomerRoleAcl,
  CustomerUser,
  CustomerUserRole,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

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

  async seedExamples({ em, tenantId, organizationId }) {
    const BCRYPT_COST = 10
    const exampleUsers = [
      { email: 'alice.johnson@example.com', displayName: 'Alice Johnson', password: 'Password123!', roleSlug: 'portal_admin' },
      { email: 'bob.smith@example.com', displayName: 'Bob Smith', password: 'Password123!', roleSlug: 'buyer' },
      { email: 'carol.white@example.com', displayName: 'Carol White', password: 'Password123!', roleSlug: 'viewer' },
    ]

    for (const entry of exampleUsers) {
      const emailHash = hashForLookup(entry.email)
      const existing = await em.findOne(CustomerUser, { emailHash, tenantId, deletedAt: null })
      if (existing) continue

      const passwordHash = await hash(entry.password, BCRYPT_COST)
      const user = em.create(CustomerUser, {
        email: entry.email,
        emailHash,
        passwordHash,
        displayName: entry.displayName,
        tenantId,
        organizationId,
        isActive: true,
        failedLoginAttempts: 0,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
      } as any)
      em.persist(user)

      const role = await em.findOne(CustomerRole, { tenantId, slug: entry.roleSlug, deletedAt: null })
      if (role) {
        const userRole = em.create(CustomerUserRole, {
          user,
          role,
          createdAt: new Date(),
        } as any)
        em.persist(userRole)
      }
    }
    await em.flush()
  },
}

export default setup
