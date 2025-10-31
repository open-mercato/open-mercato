import { hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Role, RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { normalizeTenantId } from './tenantAccess'

const DEFAULT_ROLE_NAMES = ['employee', 'admin', 'superadmin'] as const
const DEMO_SUPERADMIN_EMAIL = 'superadmin@acme.com'

export type EnsureRolesOptions = {
  roleNames?: string[]
  tenantId?: string | null
}

async function ensureRolesInContext(
  em: EntityManager,
  roleNames: string[],
  tenantId: string | null,
) {
  for (const name of roleNames) {
    const existing = await em.findOne(Role, { name, tenantId })
    if (existing) continue
    if (tenantId !== null) {
      const globalRole = await em.findOne(Role, { name, tenantId: null })
      if (globalRole) {
        globalRole.tenantId = tenantId
        em.persist(globalRole)
        continue
      }
    }
    em.persist(em.create(Role, { name, tenantId, createdAt: new Date() }))
  }
}

export async function ensureRoles(em: EntityManager, options: EnsureRolesOptions = {}) {
  const roleNames = options.roleNames ?? [...DEFAULT_ROLE_NAMES]
  const tenantId = normalizeTenantId(options.tenantId ?? null) ?? null
  await em.transactional(async (tem) => {
    await ensureRolesInContext(tem, roleNames, tenantId)
    await tem.flush()
  })
}

async function findRoleByName(
  em: EntityManager,
  name: string,
  tenantId: string | null,
): Promise<Role | null> {
  const normalizedTenant = normalizeTenantId(tenantId ?? null) ?? null
  let role = await em.findOne(Role, { name, tenantId: normalizedTenant })
  if (!role && normalizedTenant !== null) {
    role = await em.findOne(Role, { name, tenantId: null })
  }
  return role
}

async function findRoleByNameOrFail(
  em: EntityManager,
  name: string,
  tenantId: string | null,
): Promise<Role> {
  const role = await findRoleByName(em, name, tenantId)
  if (!role) throw new Error(`ROLE_NOT_FOUND:${name}`)
  return role
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
      const roleTenantId = normalizeTenantId(existingUser.tenantId ?? null) ?? null

      await ensureRolesInContext(tem, roleNames, roleTenantId)
      await tem.flush()

      const requiredRoleSet = new Set([...roleNames, ...primaryRoles])
      const links = await tem.find(UserRole, { user: existingUser }, { populate: ['role'] })
      const currentRoles = new Set(links.map((link) => link.role.name))
      for (const roleName of requiredRoleSet) {
        if (!currentRoles.has(roleName)) {
          const role = await findRoleByNameOrFail(tem, roleName, roleTenantId)
          tem.persist(tem.create(UserRole, { user: existingUser, role, createdAt: new Date() }))
        }
      }
      await tem.flush()
      const roles = Array.from(new Set([...currentRoles, ...roleNames]))
      userSnapshots.push({ user: existingUser, roles, created: false })
      return
    }

    const tenant = tem.create(Tenant, {
      name: `${options.orgName} Tenant`,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    tem.persist(tenant)
    await tem.flush()

    const organization = tem.create(Organization, {
      name: options.orgName,
      tenant,
      isActive: true,
      depth: 0,
      ancestorIds: [],
      childIds: [],
      descendantIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    tem.persist(organization)
    await tem.flush()

    tenantId = String(tenant.id)
    organizationId = String(organization.id)
    const roleTenantId = tenantId

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
    await ensureRolesInContext(tem, roleNames, roleTenantId)
    await tem.flush()

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
        const role = await findRoleByNameOrFail(tem, roleName, roleTenantId)
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
  const roleTenantId = normalizeTenantId(tenantId) ?? null
  const superadminRole = includeSuperadminRole ? await findRoleByName(em, 'superadmin', roleTenantId) : null
  const adminRole = await findRoleByName(em, 'admin', roleTenantId)
  const employeeRole = await findRoleByName(em, 'employee', roleTenantId)

  if (includeSuperadminRole && superadminRole) {
    await ensureRoleAclFor(em, superadminRole, tenantId, ['directory.tenants.*'], { isSuperAdmin: true })
  }
  if (adminRole) {
    const adminFeatures = [
      'auth.*',
      'entities.*',
      'attachments.*',
      'query_index.*',
      'vector.*',
      'configs.system_status.view',
      'configs.manage',
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
      'vector.*',
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
      createdAt: new Date(),
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
