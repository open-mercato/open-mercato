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
import { syncDefaultCustomerRoleAcls } from './lib/customerRoleAclSync'

interface SeedScope {
  tenantId: string
  organizationId: string
}

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'system'
    scheduleType: 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload?: Record<string, unknown>
    sourceType: 'module'
    sourceModule: string
    isEnabled?: boolean
  }) => Promise<void>
}

// Stable, deterministic UUIDs for the two domain-routing system schedules so
// re-running setup re-upserts the same rows instead of creating duplicates.
const DOMAIN_VERIFICATION_SCHEDULE_ID = '5e9ef5fc-1f4d-5b3d-8b58-8e1a5a4d1001'
const DOMAIN_TLS_RETRY_SCHEDULE_ID = '5e9ef5fc-1f4d-5b3d-8b58-8e1a5a4d1002'

function intervalSecondsFromEnv(envName: string, fallbackSeconds: number): string {
  const parsed = Number.parseInt(process.env[envName] ?? '', 10)
  const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds
  return `${seconds}s`
}

async function registerDomainSchedules(
  container: { hasRegistration?: (name: string) => boolean; resolve: (name: string) => unknown },
): Promise<void> {
  if (typeof container.hasRegistration !== 'function' || !container.hasRegistration('schedulerService')) {
    return
  }
  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike

  await schedulerService.register({
    id: DOMAIN_VERIFICATION_SCHEDULE_ID,
    name: 'Custom domain — DNS auto-verification',
    description:
      'Re-runs DNS verification for custom-domain mappings stuck in pending or dns_failed, and triggers TLS health checks on success.',
    scopeType: 'system',
    scheduleType: 'interval',
    scheduleValue: intervalSecondsFromEnv('DOMAIN_AUTO_VERIFY_INTERVAL_SECONDS', 300),
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: 'domain-verification',
    sourceType: 'module',
    sourceModule: 'customer_accounts',
    isEnabled: true,
  })

  await schedulerService.register({
    id: DOMAIN_TLS_RETRY_SCHEDULE_ID,
    name: 'Custom domain — TLS retry',
    description:
      'Retries TLS certificate provisioning for verified or tls_failed custom-domain mappings, with batch cap and adaptive backoff on Let\'s Encrypt rate limits.',
    scopeType: 'system',
    scheduleType: 'interval',
    scheduleValue: intervalSecondsFromEnv('DOMAIN_TLS_RETRY_INTERVAL_SECONDS', 1800),
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: 'domain-tls-retry',
    sourceType: 'module',
    sourceModule: 'customer_accounts',
    isEnabled: true,
  })
}

/**
 * The customer roles this module seeds, and therefore the ONLY slugs another
 * module's `defaultCustomerRoleFeatures` can target: the merge below skips a
 * slug with no matching role (`if (!role) continue`), so a typo is a silent
 * no-op rather than an error. Exported so a contributing module can assert its
 * keys against the real list instead of hoping.
 */
export const DEFAULT_CUSTOMER_ROLE_SLUGS = ['portal_admin', 'buyer', 'viewer'] as const

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

const DEFAULT_CUSTOMER_ROLE_FEATURES = Object.fromEntries(
  DEFAULT_ROLES.map((role) => [role.slug, [...role.acl.features]]),
)


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
  // Keep the portal feature catalog declarative so the shared feature policy
  // can project portal.* into concrete capabilities without importing core.
  defaultCustomerRoleFeatures: DEFAULT_CUSTOMER_ROLE_FEATURES,

  async onTenantCreated({ em, tenantId, organizationId }) {
    await seedDefaultRoles(em, { tenantId, organizationId })
  },

  async seedDefaults({ em, tenantId, organizationId, container }) {
    await seedDefaultRoles(em, { tenantId, organizationId })
    // Merge defaultCustomerRoleFeatures from all enabled modules. Existing
    // tenants replay the same merge via `mercato customer_accounts
    // sync-customer-role-acls`.
    try {
      const { getModules } = await import('@open-mercato/shared/lib/modules/registry')
      const allModules = getModules()
      await syncDefaultCustomerRoleAcls(em, tenantId, allModules)
    } catch {
      // Modules may not be registered yet during initial setup
    }

    // System-scoped schedules: register is idempotent, so re-running setup
    // (or running it for additional tenants) just upserts the same two rows.
    try {
      await registerDomainSchedules(
        container as { hasRegistration?: (name: string) => boolean; resolve: (name: string) => unknown },
      )
    } catch {
      // Scheduler may not be installed in this deployment; ignore.
    }
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
