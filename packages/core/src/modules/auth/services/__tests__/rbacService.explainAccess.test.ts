import type { EntityManager } from '@mikro-orm/postgresql'
import { createMemoryStrategy } from '@open-mercato/cache'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import {
  applyAclFeatureOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'

type MockModule = { id: string }

let mockEnabledModules: MockModule[] | null = null

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (...args: unknown[]) => unknown }, entity: unknown, where: unknown, options?: unknown) =>
    em.find(entity, where, options),
  findOneWithDecryption: (em: { findOne: (...args: unknown[]) => unknown }, entity: unknown, where: unknown, options?: unknown) =>
    em.findOne(entity, where, options),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/modules/registry')
  return {
    ...actual,
    getModules: () => {
      if (!mockEnabledModules) throw new Error('[internal] modules not registered')
      return mockEnabledModules
    },
    tryGetModules: () => mockEnabledModules,
  }
})

import {
  ACCESS_EXPLANATION_REASONS,
  RbacService,
  type AccessExplanation,
} from '@open-mercato/core/modules/auth/services/rbacService'

const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const ORG_CHILD = 'org-child'
const USER_ID = 'user-1'
const API_KEY_ID = 'key-1'

const ALL_MODULES: MockModule[] = [
  { id: 'auth' },
  { id: 'customers' },
  { id: 'sales' },
  { id: 'catalog' },
  { id: 'insights' },
]

type Row = Record<string, unknown>

type FakeTables = {
  users: Row[]
  userAcls: Row[]
  userRoles: Row[]
  roles: Row[]
  roleAcls: Row[]
  apiKeys: Row[]
  organizations: Row[]
}

function isPlainObject(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

function comparable(value: unknown): unknown {
  if (isPlainObject(value) && 'id' in value) return value.id
  return value === undefined ? null : value
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (isPlainObject(condition) && Array.isArray(condition.$in)) return condition.$in.includes(comparable(value))
    if (isPlainObject(condition)) return isPlainObject(value) && matchesWhere(value, condition)
    return comparable(value) === condition
  })
}

function createFakeEntityManager(tables: FakeTables) {
  const tableFor = (entity: unknown): Row[] => {
    if (entity === User) return tables.users
    if (entity === UserAcl) return tables.userAcls
    if (entity === UserRole) return tables.userRoles
    if (entity === Role) return tables.roles
    if (entity === RoleAcl) return tables.roleAcls
    if (entity === ApiKey) return tables.apiKeys
    if (entity === Organization) return tables.organizations
    throw new Error(`[internal] unexpected entity ${String(entity)}`)
  }
  const em = {
    find: jest.fn(async (entity: unknown, where: Row) => tableFor(entity).filter((row) => matchesWhere(row, where ?? {}))),
    findOne: jest.fn(async (entity: unknown, where: Row) => tableFor(entity).find((row) => matchesWhere(row, where ?? {})) ?? null),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createHierarchyService(tables: FakeTables) {
  return {
    resolveAncestorIds: jest.fn(async ({ tenantId, organizationId }: { tenantId: string; organizationId: string }) => {
      const organization = tables.organizations.find((row) => row.id === organizationId && comparable(row.tenant) === tenantId)
      return organization ? (organization.ancestorIds as string[]) : null
    }),
  }
}

function createService(tables: FakeTables): RbacService {
  return new RbacService(
    createFakeEntityManager(tables) as unknown as EntityManager,
    createMemoryStrategy(),
    createHierarchyService(tables),
  )
}

function role(id: string, name: string, tenantId = TENANT_ID, deletedAt: Date | null = null): Row {
  return { id, name, tenantId, deletedAt }
}

function roleAcl(roleRow: Row, grant: { features?: string[]; superAdmin?: boolean; organizations?: string[] | null; deletedAt?: Date | null }): Row {
  return {
    role: { id: roleRow.id },
    tenantId: roleRow.tenantId,
    featuresJson: grant.features ?? [],
    isSuperAdmin: grant.superAdmin === true,
    organizationsJson: grant.organizations === undefined ? null : grant.organizations,
    deletedAt: grant.deletedAt ?? null,
  }
}

function baseTables(): FakeTables {
  return {
    users: [{ id: USER_ID, tenantId: TENANT_ID, organizationId: ORG_A }],
    userAcls: [],
    userRoles: [],
    roles: [],
    roleAcls: [],
    apiKeys: [],
    organizations: [
      { id: ORG_A, tenant: { id: TENANT_ID }, ancestorIds: [], deletedAt: null },
      { id: ORG_B, tenant: { id: TENANT_ID }, ancestorIds: [], deletedAt: null },
      { id: ORG_CHILD, tenant: { id: TENANT_ID }, ancestorIds: [ORG_A], deletedAt: null },
    ],
  }
}

function assignRole(tables: FakeTables, roleRow: Row): void {
  tables.userRoles.push({ user: { id: USER_ID }, role: roleRow })
}

type Scenario = {
  name: string
  principal: 'user' | 'api_key'
  build: (tables: FakeTables) => void
}

const SCENARIOS: Scenario[] = [
  { name: 'no grants', principal: 'user', build: () => undefined },
  {
    name: 'global super admin via user ACL',
    principal: 'user',
    build: (tables) => {
      tables.userAcls.push({ user: { id: USER_ID }, tenantId: TENANT_ID, isSuperAdmin: true, featuresJson: [], organizationsJson: null })
    },
  },
  {
    name: 'super admin via unrestricted role',
    principal: 'user',
    build: (tables) => {
      const adminRole = role('role-super', 'Super')
      tables.roles.push(adminRole)
      tables.roleAcls.push(roleAcl(adminRole, { superAdmin: true }))
      assignRole(tables, adminRole)
    },
  },
  {
    name: 'super admin via organization-restricted role',
    principal: 'user',
    build: (tables) => {
      const adminRole = role('role-super-a', 'Super A')
      tables.roles.push(adminRole)
      tables.roleAcls.push(roleAcl(adminRole, { superAdmin: true, organizations: [ORG_A] }))
      assignRole(tables, adminRole)
    },
  },
  {
    name: 'user ACL override with a wildcard',
    principal: 'user',
    build: (tables) => {
      tables.userAcls.push({ user: { id: USER_ID }, tenantId: TENANT_ID, isSuperAdmin: false, featuresJson: ['customers.*'], organizationsJson: null })
      const salesRole = role('role-sales', 'Sales')
      tables.roles.push(salesRole)
      tables.roleAcls.push(roleAcl(salesRole, { features: ['sales.orders.view', 'catalog.products.view'] }))
      assignRole(tables, salesRole)
    },
  },
  {
    name: 'user ACL restricted to one organization',
    principal: 'user',
    build: (tables) => {
      tables.userAcls.push({
        user: { id: USER_ID },
        tenantId: TENANT_ID,
        isSuperAdmin: false,
        featuresJson: ['customers.people.view', 'sales.orders.view'],
        organizationsJson: [ORG_A],
      })
    },
  },
  {
    name: 'wildcard role',
    principal: 'user',
    build: (tables) => {
      const crmRole = role('role-crm', 'CRM')
      tables.roles.push(crmRole)
      tables.roleAcls.push(roleAcl(crmRole, { features: ['customers.*', 'catalog.products.view'] }))
      assignRole(tables, crmRole)
    },
  },
  {
    name: 'organization-restricted role next to a global role',
    principal: 'user',
    build: (tables) => {
      const globalRole = role('role-global', 'Global')
      const scopedRole = role('role-scoped', 'Scoped')
      tables.roles.push(globalRole, scopedRole)
      tables.roleAcls.push(
        roleAcl(globalRole, { features: ['customers.people.view'] }),
        roleAcl(scopedRole, { features: ['sales.orders.view', 'customers.deals.manage'], organizations: [ORG_A] }),
      )
      assignRole(tables, globalRole)
      assignRole(tables, scopedRole)
    },
  },
  {
    name: 'organization-restricted role only',
    principal: 'user',
    build: (tables) => {
      const scopedRole = role('role-scoped-only', 'Scoped only')
      tables.roles.push(scopedRole)
      tables.roleAcls.push(roleAcl(scopedRole, { features: ['customers.*', 'sales.orders.view'], organizations: [ORG_A] }))
      assignRole(tables, scopedRole)
    },
  },
  {
    name: 'deny-all role allowlist',
    principal: 'user',
    build: (tables) => {
      const emptyRole = role('role-empty', 'Empty orgs')
      tables.roles.push(emptyRole)
      tables.roleAcls.push(roleAcl(emptyRole, { features: ['customers.*'], organizations: [] }))
      assignRole(tables, emptyRole)
    },
  },
  {
    name: 'API key with a wildcard role',
    principal: 'api_key',
    build: (tables) => {
      const keyRole = role('role-key', 'Key role')
      tables.roles.push(keyRole)
      tables.roleAcls.push(roleAcl(keyRole, { features: ['customers.*', 'sales.orders.view'] }))
      tables.apiKeys.push({ id: API_KEY_ID, tenantId: TENANT_ID, organizationId: null, rolesJson: [keyRole.id], expiresAt: null, deletedAt: null })
    },
  },
  {
    name: 'API key bound to an organization',
    principal: 'api_key',
    build: (tables) => {
      const keyRole = role('role-key-org', 'Key org role')
      tables.roles.push(keyRole)
      tables.roleAcls.push(roleAcl(keyRole, { features: ['customers.people.view', 'catalog.products.view'] }))
      tables.apiKeys.push({ id: API_KEY_ID, tenantId: TENANT_ID, organizationId: ORG_A, rolesJson: [keyRole.id], expiresAt: null, deletedAt: null })
    },
  },
  {
    name: 'API key with a super-admin role',
    principal: 'api_key',
    build: (tables) => {
      const keyRole = role('role-key-super', 'Key super')
      tables.roles.push(keyRole)
      tables.roleAcls.push(roleAcl(keyRole, { superAdmin: true }))
      tables.apiKeys.push({ id: API_KEY_ID, tenantId: TENANT_ID, organizationId: null, rolesJson: [keyRole.id], expiresAt: null, deletedAt: null })
    },
  },
  {
    name: 'expired API key',
    principal: 'api_key',
    build: (tables) => {
      const keyRole = role('role-key-expired', 'Expired')
      tables.roles.push(keyRole)
      tables.roleAcls.push(roleAcl(keyRole, { features: ['customers.*'] }))
      tables.apiKeys.push({
        id: API_KEY_ID,
        tenantId: TENANT_ID,
        organizationId: null,
        rolesJson: [keyRole.id],
        expiresAt: new Date(Date.now() - 60_000),
        deletedAt: null,
      })
    },
  },
]

const ORGANIZATIONS: Array<string | null> = [null, ORG_A, ORG_B, ORG_CHILD]

const FEATURE_SETS: string[][] = [
  ['customers.people.view'],
  ['customers.people.view', 'sales.orders.view'],
  ['catalog.products.view'],
  ['customers.deals.manage'],
]

type ModuleMode = { name: string; modules: MockModule[] | null }

const MODULE_MODES: ModuleMode[] = [
  { name: 'registry unavailable', modules: null },
  { name: 'all modules enabled', modules: ALL_MODULES },
  { name: 'catalog disabled', modules: ALL_MODULES.filter((module) => module.id !== 'catalog') },
]

const REMOVAL_MODES: Array<{ name: string; removed: string[] }> = [
  { name: 'no removed features', removed: [] },
  { name: 'customers.deals.manage removed', removed: ['customers.deals.manage'] },
]

function principalId(scenario: Scenario): string {
  return scenario.principal === 'api_key' ? `api_key:${API_KEY_ID}` : USER_ID
}

function assertExplanationShape(explanation: AccessExplanation, features: readonly string[]): void {
  expect(explanation.required.map((entry) => entry.feature)).toEqual(Array.from(new Set(features)))
  const allGranted = explanation.required.every((entry) => entry.granted)
  expect(explanation.decision === 'granted').toBe(allGranted)
  for (const entry of explanation.required) {
    if (entry.granted) expect(entry.reason).toBeNull()
    else expect(entry.reason).not.toBeNull()
  }
  expect(explanation.reasons.length === 0).toBe(explanation.decision === 'granted')
  for (const reason of explanation.reasons) expect(ACCESS_EXPLANATION_REASONS).toContain(reason)
}

describe('RbacService.explainAccess', () => {
  afterEach(() => {
    mockEnabledModules = null
    resetModuleContractOverridesForTests()
  })

  describe('parity with userHasAllFeatures', () => {
    const observed = { granted: 0, denied: 0, reasons: new Set<string>() }
    const combinations = SCENARIOS.flatMap((scenario) => MODULE_MODES.flatMap((moduleMode) => REMOVAL_MODES.map((removal) => ({
      scenario,
      moduleMode,
      removal,
    }))))

    it.each(combinations.map((combination) => [
      `${combination.scenario.name} / ${combination.moduleMode.name} / ${combination.removal.name}`,
      combination,
    ]))('%s', async (_label, { scenario, moduleMode, removal }) => {
      mockEnabledModules = moduleMode.modules ? [...moduleMode.modules] : null
      if (removal.removed.length) applyAclFeatureOverrides(Object.fromEntries(removal.removed.map((feature) => [feature, null])))
      const tables = baseTables()
      scenario.build(tables)
      const subject = principalId(scenario)
      for (const organizationId of ORGANIZATIONS) {
        for (const features of FEATURE_SETS) {
          const scope = { tenantId: TENANT_ID, organizationId }
          const expected = await createService(tables).userHasAllFeatures(subject, [...features], scope)
          const explanation = await createService(tables).explainAccess(subject, features, scope, { detail: true })
          expect({ organizationId, features, decision: explanation.decision }).toEqual({
            organizationId,
            features,
            decision: expected ? 'granted' : 'denied',
          })
          assertExplanationShape(explanation, features)
          expect(explanation.consistentWithFreshRead).toBe(true)
          expect(explanation.confidence).toBe('proven')
          expect(explanation.detail?.principal).toBe(scenario.principal)
          observed[explanation.decision] += 1
          for (const reason of explanation.reasons) observed.reasons.add(reason)
        }
      }
    })

    it('exercised both decisions and every reason', () => {
      expect(observed.granted).toBeGreaterThan(0)
      expect(observed.denied).toBeGreaterThan(0)
      expect(Array.from(observed.reasons).sort()).toEqual([...ACCESS_EXPLANATION_REASONS].sort())
    })
  })

  describe('reasons', () => {
    it('reports a missing feature with the grant source and roles that would grant it', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      const crmRole = role('role-crm', 'CRM')
      const salesRole = role('role-sales', 'Sales')
      const deletedRole = role('role-deleted', 'Deleted', TENANT_ID, new Date())
      const foreignRole = role('role-foreign', 'Foreign', OTHER_TENANT_ID)
      const adminRole = role('role-admin', 'Admin')
      tables.roles.push(crmRole, salesRole, deletedRole, foreignRole, adminRole)
      tables.roleAcls.push(
        roleAcl(crmRole, { features: ['customers.people.view'] }),
        roleAcl(salesRole, { features: ['sales.*'], organizations: [ORG_B] }),
        roleAcl(deletedRole, { features: ['sales.orders.view'] }),
        roleAcl(foreignRole, { features: ['sales.orders.view'] }),
        roleAcl(adminRole, { superAdmin: true }),
        roleAcl(role('role-removed-acl', 'Removed ACL'), { features: ['sales.orders.view'], deletedAt: new Date() }),
      )
      tables.roles.push(role('role-removed-acl', 'Removed ACL'))
      assignRole(tables, crmRole)

      const explanation = await createService(tables).explainAccess(
        USER_ID,
        ['customers.people.view', 'sales.orders.view'],
        { tenantId: TENANT_ID, organizationId: ORG_A },
        { detail: true },
      )

      expect(explanation.decision).toBe('denied')
      expect(explanation.reasons).toEqual(['missing_feature'])
      expect(explanation.required).toEqual([
        { feature: 'customers.people.view', granted: true, reason: null },
        { feature: 'sales.orders.view', granted: false, reason: 'missing_feature' },
      ])
      expect(explanation.detail).toMatchObject({
        principal: 'user',
        source: 'roles',
        organizationId: ORG_A,
        organizationAllowed: true,
        userAcl: null,
        roles: [
          {
            roleId: 'role-crm',
            roleName: 'CRM',
            isSuperAdmin: false,
            organizations: null,
            appliesToOrganization: true,
            grantedFeatures: ['customers.people.view'],
          },
        ],
        grantedOrganizationIds: [],
      })
      expect(explanation.detail?.rolesThatWouldGrant).toEqual([
        { roleId: 'role-admin', roleName: 'Admin', isSuperAdmin: true, organizations: null, appliesToOrganization: true, grantedFeatures: ['customers.people.view', 'sales.orders.view'] },
      ])
    })

    it('lists the roles that would grant every requested feature with their organization applicability', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      const salesRole = role('role-sales', 'Sales')
      const adminRole = role('role-admin', 'Admin')
      const deletedRole = role('role-deleted', 'Deleted', TENANT_ID, new Date())
      tables.roles.push(salesRole, adminRole, deletedRole)
      tables.roleAcls.push(
        roleAcl(salesRole, { features: ['sales.*'], organizations: [ORG_B] }),
        roleAcl(adminRole, { superAdmin: true }),
        roleAcl(deletedRole, { features: ['sales.orders.view'] }),
      )
      const service = createService(tables)

      await expect(service.findRolesGrantingFeatures(TENANT_ID, ['sales.orders.view'], { organizationId: ORG_A })).resolves.toEqual([
        { roleId: 'role-admin', roleName: 'Admin', isSuperAdmin: true, organizations: null, appliesToOrganization: true, grantedFeatures: ['sales.orders.view'] },
        { roleId: 'role-sales', roleName: 'Sales', isSuperAdmin: false, organizations: [ORG_B], appliesToOrganization: false, grantedFeatures: ['sales.orders.view'] },
      ])
      await expect(service.findRolesGrantingFeatures(TENANT_ID, [])).resolves.toEqual([])
      await expect(service.findRolesGrantingFeatures(null, ['sales.orders.view'])).resolves.toEqual([])
    })

    it('reports a feature granted only in another organization as organization_out_of_scope', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      const globalRole = role('role-global', 'Global')
      const scopedRole = role('role-scoped', 'Scoped')
      tables.roles.push(globalRole, scopedRole)
      tables.roleAcls.push(
        roleAcl(globalRole, { features: ['customers.people.view'] }),
        roleAcl(scopedRole, { features: ['sales.orders.view'], organizations: [ORG_A] }),
      )
      assignRole(tables, globalRole)
      assignRole(tables, scopedRole)

      const explanation = await createService(tables).explainAccess(
        USER_ID,
        ['sales.orders.view'],
        { tenantId: TENANT_ID, organizationId: ORG_B },
        { detail: true },
      )

      expect(explanation.decision).toBe('denied')
      expect(explanation.reasons).toEqual(['organization_out_of_scope'])
      expect(explanation.detail?.grantedOrganizationIds).toEqual([ORG_A, ORG_CHILD])
      expect(explanation.detail?.roles.find((entry) => entry.roleId === 'role-scoped')).toMatchObject({
        appliesToOrganization: false,
        grantedFeatures: ['sales.orders.view'],
      })

      const childExplanation = await createService(tables).explainAccess(USER_ID, ['sales.orders.view'], {
        tenantId: TENANT_ID,
        organizationId: ORG_CHILD,
      })
      expect(childExplanation.decision).toBe('granted')
      expect(childExplanation.detail).toBeNull()
    })

    it('reports an organization outside the ACL allowlist as organization_out_of_scope', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      tables.userAcls.push({ user: { id: USER_ID }, tenantId: TENANT_ID, isSuperAdmin: false, featuresJson: ['sales.*'], organizationsJson: [ORG_A] })

      const explanation = await createService(tables).explainAccess(USER_ID, ['sales.orders.view'], { tenantId: TENANT_ID, organizationId: ORG_B })

      expect(explanation.required).toEqual([{ feature: 'sales.orders.view', granted: false, reason: 'organization_out_of_scope' }])
      expect(explanation.reasons).toEqual(['organization_out_of_scope'])
    })

    it('reports a user ACL override only when an applicable role would grant the denied feature', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      tables.userAcls.push({ user: { id: USER_ID }, tenantId: TENANT_ID, isSuperAdmin: false, featuresJson: ['customers.*'], organizationsJson: null })
      const scopedRole = role('role-scoped', 'Scoped')
      tables.roles.push(scopedRole)
      tables.roleAcls.push(roleAcl(scopedRole, { features: ['sales.orders.view'], organizations: [ORG_A] }))
      assignRole(tables, scopedRole)
      const required = ['sales.orders.view']

      const elsewhere = await createService(tables).explainAccess(USER_ID, required, { tenantId: TENANT_ID, organizationId: ORG_B })
      expect(elsewhere.reasons).toEqual(['missing_feature'])

      const applicable = await createService(tables).explainAccess(USER_ID, required, { tenantId: TENANT_ID, organizationId: ORG_A })
      expect(applicable.reasons).toEqual(['missing_feature', 'user_acl_override'])
    })

    it('reports a per-user ACL that replaces role grants', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      tables.userAcls.push({ user: { id: USER_ID }, tenantId: TENANT_ID, isSuperAdmin: false, featuresJson: ['customers.*'], organizationsJson: null })
      const salesRole = role('role-sales', 'Sales')
      tables.roles.push(salesRole)
      tables.roleAcls.push(roleAcl(salesRole, { features: ['sales.orders.view'] }))
      assignRole(tables, salesRole)

      const explanation = await createService(tables).explainAccess(
        USER_ID,
        ['customers.people.view', 'sales.orders.view'],
        { tenantId: TENANT_ID, organizationId: ORG_A },
        { detail: true },
      )

      expect(explanation.reasons).toEqual(['missing_feature', 'user_acl_override'])
      expect(explanation.detail).toMatchObject({
        source: 'user_acl',
        userAcl: { isSuperAdmin: false, organizations: null, grantedFeatures: ['customers.people.view'] },
        roles: [{ roleId: 'role-sales', grantedFeatures: ['sales.orders.view'], appliesToOrganization: true }],
      })
    })

    it('does not report a user ACL override when access is granted', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      tables.userAcls.push({ user: { id: USER_ID }, tenantId: TENANT_ID, isSuperAdmin: false, featuresJson: ['customers.*'], organizationsJson: null })

      const explanation = await createService(tables).explainAccess(USER_ID, ['customers.people.view'], { tenantId: TENANT_ID, organizationId: ORG_A })

      expect(explanation).toMatchObject({ decision: 'granted', reasons: [], confidence: 'proven', detail: null })
    })

    it('reports a feature of a disabled module even for a super administrator', async () => {
      mockEnabledModules = ALL_MODULES.filter((module) => module.id !== 'catalog')
      const tables = baseTables()
      tables.userAcls.push({ user: { id: USER_ID }, tenantId: TENANT_ID, isSuperAdmin: true, featuresJson: [], organizationsJson: null })

      const explanation = await createService(tables).explainAccess(
        USER_ID,
        ['catalog.products.view', 'customers.people.view'],
        { tenantId: TENANT_ID, organizationId: ORG_A },
        { detail: true },
      )

      expect(explanation.decision).toBe('denied')
      expect(explanation.reasons).toEqual(['module_disabled'])
      expect(explanation.required).toEqual([
        { feature: 'catalog.products.view', granted: false, reason: 'module_disabled' },
        { feature: 'customers.people.view', granted: true, reason: null },
      ])
      expect(explanation.detail?.source).toBe('super_admin')
    })

    it('reports a feature removed by an ACL override', async () => {
      mockEnabledModules = [...ALL_MODULES]
      applyAclFeatureOverrides({ 'customers.deals.manage': null })
      const tables = baseTables()
      const crmRole = role('role-crm', 'CRM')
      tables.roles.push(crmRole)
      tables.roleAcls.push(roleAcl(crmRole, { features: ['customers.*'] }))
      assignRole(tables, crmRole)

      const explanation = await createService(tables).explainAccess(USER_ID, ['customers.deals.manage'], { tenantId: TENANT_ID, organizationId: ORG_A })

      expect(explanation.reasons).toEqual(['feature_removed'])
    })

    it('explains an API key principal from its roles', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      const keyRole = role('role-key', 'Key role')
      tables.roles.push(keyRole)
      tables.roleAcls.push(roleAcl(keyRole, { features: ['customers.people.view'] }))
      tables.apiKeys.push({ id: API_KEY_ID, tenantId: TENANT_ID, organizationId: null, rolesJson: [keyRole.id], expiresAt: null, deletedAt: null })

      const explanation = await createService(tables).explainAccess(
        `api_key:${API_KEY_ID}`,
        ['sales.orders.view'],
        { tenantId: TENANT_ID, organizationId: ORG_A },
        { detail: true },
      )

      expect(explanation.reasons).toEqual(['missing_feature'])
      expect(explanation.detail).toMatchObject({
        principal: 'api_key',
        source: 'api_key',
        userAcl: null,
        roles: [{ roleId: 'role-key', roleName: 'Key role', grantedFeatures: [] }],
      })
    })

    it('resolves the tenant from the principal when the scope has none', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      const crmRole = role('role-crm', 'CRM')
      tables.roles.push(crmRole)
      tables.roleAcls.push(roleAcl(crmRole, { features: ['customers.people.view'] }))
      assignRole(tables, crmRole)
      const service = createService(tables)

      const explanation = await service.explainAccess(USER_ID, ['customers.people.view'], { tenantId: null, organizationId: null }, { detail: true })

      expect(explanation.decision).toBe('granted')
      expect(await service.userHasAllFeatures(USER_ID, ['customers.people.view'], { tenantId: null, organizationId: null })).toBe(true)
      expect(explanation.detail?.roles.map((entry) => entry.roleId)).toEqual(['role-crm'])
    })
  })

  describe('cache freshness', () => {
    it('keeps the guard decision but lowers confidence when the cached ACL is stale', async () => {
      mockEnabledModules = [...ALL_MODULES]
      const tables = baseTables()
      const crmRole = role('role-crm', 'CRM')
      tables.roles.push(crmRole)
      tables.roleAcls.push(roleAcl(crmRole, { features: ['customers.people.view'] }))
      assignRole(tables, crmRole)
      const service = createService(tables)
      const scope = { tenantId: TENANT_ID, organizationId: ORG_A }

      await expect(service.userHasAllFeatures(USER_ID, ['customers.people.view'], scope)).resolves.toBe(true)
      tables.roleAcls[0].featuresJson = []

      const explanation = await service.explainAccess(USER_ID, ['customers.people.view'], scope, { detail: true })
      await expect(service.userHasAllFeatures(USER_ID, ['customers.people.view'], scope)).resolves.toBe(true)

      expect(explanation.decision).toBe('granted')
      expect(explanation.consistentWithFreshRead).toBe(false)
      expect(explanation.confidence).toBe('inferred')
      expect(explanation.detail?.roles).toEqual([
        expect.objectContaining({ roleId: 'role-crm', grantedFeatures: [] }),
      ])
    })
  })
})
