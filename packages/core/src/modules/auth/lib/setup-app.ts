import { hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Role, RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'

const DEFAULT_ROLE_NAMES = ['employee', 'admin', 'superadmin'] as const
const DEMO_SUPERADMIN_EMAIL = 'superadmin@acme.com'

export type EnsureRolesOptions = {
  roleNames?: string[]
}

export async function ensureRoles(em: EntityManager, options: EnsureRolesOptions = {}) {
  const roleNames = options.roleNames ?? [...DEFAULT_ROLE_NAMES]
  await em.transactional(async (tem) => {
    for (const name of roleNames) {
      const existing = await tem.findOne(Role, { name })
      if (!existing) tem.persist(tem.create(Role, { name, tenantId: null }))
    }
    await tem.flush()
  })
}

type PrimaryUserInput = {
  email: string
  password?: string
  hashedPassword?: string | null
  firstName?: string | null
  lastName?: string | null
  displayName?: string | null
  confirm?: boolean
}

export type SetupInitialTenantOptions = {
  orgName: string
  primaryUser: PrimaryUserInput
  roleNames?: string[]
  includeDerivedUsers?: boolean
  failIfUserExists?: boolean
  primaryUserRoles?: string[]
  includeSuperadminRole?: boolean
}

export type SetupInitialTenantResult = {
  tenantId: string
  organizationId: string
  users: Array<{ user: User; roles: string[]; created: boolean }>
  reusedExistingUser: boolean
}

export async function setupInitialTenant(
  em: EntityManager,
  options: SetupInitialTenantOptions,
): Promise<SetupInitialTenantResult> {
  const {
    primaryUser,
    includeDerivedUsers = true,
    failIfUserExists = false,
    primaryUserRoles,
    includeSuperadminRole = true,
  } = options
  const primaryRolesInput = primaryUserRoles && primaryUserRoles.length ? primaryUserRoles : ['superadmin']
  const primaryRoles = includeSuperadminRole
    ? primaryRolesInput
    : primaryRolesInput.filter((role) => role !== 'superadmin')
  if (primaryRoles.length === 0) {
    throw new Error('PRIMARY_ROLES_REQUIRED')
  }
  const defaultRoleNames = options.roleNames ?? [...DEFAULT_ROLE_NAMES]
  const resolvedRoleNames = includeSuperadminRole
    ? defaultRoleNames
    : defaultRoleNames.filter((role) => role !== 'superadmin')
  const roleNames = Array.from(new Set([...resolvedRoleNames, ...primaryRoles]))
  await ensureRoles(em, { roleNames })

  const mainEmail = primaryUser.email
  const existingUser = await em.findOne(User, { email: mainEmail })
  if (existingUser && failIfUserExists) {
    throw new Error('USER_EXISTS')
  }

  let tenantId: string | undefined
  let organizationId: string | undefined
  let reusedExistingUser = false
  const userSnapshots: Array<{ user: User; roles: string[]; created: boolean }> = []

  await em.transactional(async (tem) => {
    if (existingUser) {
      reusedExistingUser = true
      tenantId = existingUser.tenantId ? String(existingUser.tenantId) : undefined
      organizationId = existingUser.organizationId ? String(existingUser.organizationId) : undefined

      const requiredRoleSet = new Set([...roleNames, ...primaryRoles])
      const links = await tem.find(UserRole, { user: existingUser }, { populate: ['role'] })
      const currentRoles = new Set(links.map((link) => link.role.name))
      for (const roleName of requiredRoleSet) {
        if (!currentRoles.has(roleName)) {
          const role = await tem.findOneOrFail(Role, { name: roleName })
          tem.persist(tem.create(UserRole, { user: existingUser, role }))
        }
      }
      await tem.flush()
      const roles = Array.from(new Set([...currentRoles, ...roleNames]))
      userSnapshots.push({ user: existingUser, roles, created: false })
      return
    }

    const tenant = tem.create(Tenant, { name: `${options.orgName} Tenant` })
    tem.persist(tenant)
    await tem.flush()

    const organization = tem.create(Organization, { name: options.orgName, tenant })
    tem.persist(organization)
    await tem.flush()

    tenantId = String(tenant.id)
    organizationId = String(organization.id)

    const baseUsers: Array<{ email: string; roles: string[]; name?: string | null }> = [
      { email: primaryUser.email, roles: primaryRoles, name: resolvePrimaryName(primaryUser) },
    ]
    if (includeDerivedUsers) {
      const [local, domain] = String(primaryUser.email).split('@')
      const isSuperadminLocal = (local || '').toLowerCase() === 'superadmin' && !!domain
      if (isSuperadminLocal) {
        baseUsers.push({ email: `admin@${domain}`, roles: ['admin'] })
        baseUsers.push({ email: `employee@${domain}`, roles: ['employee'] })
      }
    }

    const passwordHash = await resolvePasswordHash(primaryUser)
    for (const base of baseUsers) {
      let user = await tem.findOne(User, { email: base.email })
      const confirm = primaryUser.confirm ?? true
      if (user) {
        user.passwordHash = passwordHash
        user.organizationId = organization.id
        user.tenantId = tenant.id
        if (base.name) user.name = base.name
        if (confirm) user.isConfirmed = true
        tem.persist(user)
        userSnapshots.push({ user, roles: base.roles, created: false })
      } else {
        user = tem.create(User, {
          email: base.email,
          passwordHash,
          organizationId: organization.id,
          tenantId: tenant.id,
          name: base.name ?? null,
          isConfirmed: confirm,
        })
        tem.persist(user)
        userSnapshots.push({ user, roles: base.roles, created: true })
      }
      await tem.flush()
      for (const roleName of base.roles) {
        const role = await tem.findOneOrFail(Role, { name: roleName })
        const existingLink = await tem.findOne(UserRole, { user, role })
        if (!existingLink) tem.persist(tem.create(UserRole, { user, role }))
      }
      await tem.flush()
    }
  })

  if (!tenantId || !organizationId) {
    throw new Error('SETUP_FAILED')
  }

  if (!reusedExistingUser) {
    await rebuildHierarchyForTenant(em, tenantId)
  }

  await ensureDefaultRoleAcls(em, tenantId, { includeSuperadminRole })
  await deactivateDemoSuperAdminIfSelfOnboardingEnabled(em)

  return {
    tenantId,
    organizationId,
    users: userSnapshots,
    reusedExistingUser,
  }
}

function resolvePrimaryName(input: PrimaryUserInput): string | null {
  if (input.displayName && input.displayName.trim()) return input.displayName.trim()
  const parts = [input.firstName, input.lastName].map((value) => value?.trim()).filter(Boolean)
  if (parts.length) return parts.join(' ')
  return null
}

async function resolvePasswordHash(input: PrimaryUserInput): Promise<string | null> {
  if (typeof input.hashedPassword === 'string') return input.hashedPassword
  if (input.password) return hash(input.password, 10)
  return null
}

async function ensureDefaultRoleAcls(
  em: EntityManager,
  tenantId: string,
  options: { includeSuperadminRole?: boolean } = {},
) {
  const includeSuperadminRole = options.includeSuperadminRole ?? true
  const superadminRole = includeSuperadminRole ? await em.findOne(Role, { name: 'superadmin' }) : null
  const adminRole = await em.findOne(Role, { name: 'admin' })
  const employeeRole = await em.findOne(Role, { name: 'employee' })

  if (includeSuperadminRole && superadminRole) {
    await ensureRoleAclFor(em, superadminRole, tenantId, ['directory.tenants.*'], { isSuperAdmin: true })
  }
  if (adminRole) {
    const adminFeatures = [
      'auth.*',
      'entities.*',
      'attachments.*',
      'query_index.*',
      'catalog.*',
      'sales.*',
      'audit_logs.*',
      'directory.organizations.view',
      'directory.organizations.manage',
      'customers.*',
      'customers.people.view',
      'customers.people.manage',
      'customers.companies.view',
      'customers.companies.manage',
      'customers.deals.view',
      'customers.deals.manage',
      'dictionaries.view',
      'dictionaries.manage',
      'example.*',
      'dashboards.*',
      'dashboards.admin.assign-widgets',
      'api_keys.*',
      'perspectives.use',
      'perspectives.role_defaults',
      'api_docs.view',
    ]
    await ensureRoleAclFor(em, adminRole, tenantId, adminFeatures, { remove: ['directory.organizations.*', 'directory.tenants.*'] })
  }
  if (employeeRole) {
    await ensureRoleAclFor(em, employeeRole, tenantId, [
      'customers.*',
      'customers.people.view',
      'customers.people.manage',
      'customers.companies.view',
      'customers.companies.manage',
      'catalog.*',
      'sales.*',
      'dictionaries.view',
      'example.*',
      'example.widgets.*',
      'dashboards.view',
      'dashboards.configure',
      'audit_logs.undo_self',
      'perspectives.use',
    ])
  }
}

async function ensureRoleAclFor(
  em: EntityManager,
  role: Role,
  tenantId: string,
  features: string[],
  options: { isSuperAdmin?: boolean; remove?: string[] } = {},
) {
  const existing = await em.findOne(RoleAcl, { role, tenantId })
  if (!existing) {
    const acl = em.create(RoleAcl, {
      role,
      tenantId,
      featuresJson: features,
      isSuperAdmin: !!options.isSuperAdmin,
    })
    await em.persistAndFlush(acl)
    return
  }
  const currentFeatures = Array.isArray(existing.featuresJson) ? existing.featuresJson : []
  const merged = Array.from(new Set([...currentFeatures, ...features]))
  const removeSet = new Set(options.remove ?? [])
  const sanitized =
    removeSet.size
      ? merged.filter((value) => {
          if (removeSet.has(value)) return false
          for (const entry of removeSet) {
            if (entry.endsWith('.*')) {
              const prefix = entry.slice(0, -1) // keep trailing dot
              if (value === entry || value.startsWith(prefix)) return false
            }
          }
          return true
        })
      : merged
  const changed =
    sanitized.length !== currentFeatures.length ||
    sanitized.some((value, index) => value !== currentFeatures[index])
  if (changed) existing.featuresJson = sanitized
  if (options.isSuperAdmin && !existing.isSuperAdmin) {
    existing.isSuperAdmin = true
  }
  if (changed || options.isSuperAdmin) {
    await em.persistAndFlush(existing)
  }
}

async function deactivateDemoSuperAdminIfSelfOnboardingEnabled(em: EntityManager) {
  if (process.env.SELF_SERVICE_ONBOARDING_ENABLED !== 'true') return
  try {
    const user = await em.findOne(User, { email: DEMO_SUPERADMIN_EMAIL })
    if (!user) return
    let dirty = false
    if (user.passwordHash) {
      user.passwordHash = null
      dirty = true
    }
    if (user.isConfirmed !== false) {
      user.isConfirmed = false
      dirty = true
    }
    if (dirty) {
      await em.persistAndFlush(user)
    }
  } catch (error) {
    console.error('[auth.setup] failed to deactivate demo superadmin user', error)
  }
}
