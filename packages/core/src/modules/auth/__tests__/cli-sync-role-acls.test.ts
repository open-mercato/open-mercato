/** @jest-environment node */
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/auth/cli'

const testModules: Module[] = [
  { id: 'auth', setup: { defaultRoleFeatures: { superadmin: ['auth.admin'], admin: ['auth.*'], employee: ['auth.view'] } } },
  { id: 'customers', setup: { defaultRoleFeatures: { admin: ['customers.*'], employee: ['customers.view'] } } },
  { id: 'reports', setup: { defaultRoleFeatures: { reports_viewer: ['reports.view'] } } },
  // A module whose feature is a PORTAL one — the half that used to be reachable
  // only at tenant bootstrap, so it never landed on roles that already existed.
  { id: 'staff', setup: { defaultCustomerRoleFeatures: { buyer: ['portal.time_reports.view'] } } },
  // The module that owns CustomerRole/CustomerRoleAcl. Its presence is what makes
  // the portal half of the sync runnable at all — see the disabled-module case below.
  { id: 'customer_accounts' },
]
registerModules(testModules)
registerCliModules(testModules)

type RoleStub = { id: string; name: string; tenantId: string | null }
type RoleAclStub = { role: RoleStub; tenantId: string; featuresJson: string[]; isSuperAdmin: boolean }
type CustomerRoleStub = { id: string; slug: string; tenantId: string }
type CustomerRoleAclStub = { role: CustomerRoleStub; tenantId: string; featuresJson: string[] }

let persistedAcls: RoleAclStub[] = []
let existingAcls: RoleAclStub[] = []
let tenantsList: Array<{ id: string }> = []
let rolesByTenant: Record<string, RoleStub[]> = {}
let customerRolesByTenant: Record<string, CustomerRoleStub[]> = {}
let existingCustomerAcls: CustomerRoleAclStub[] = []
/**
 * Stands in for MikroORM's own behavior when `customer_accounts` is not in
 * `modules.ts`: the entity is never registered, so any query against it throws
 * rather than returning null. Reaching one of these at all is the failure.
 */
let portalEntitiesUnregistered = false

const findOne = jest.fn(async (Entity: any, where: any) => {
  if (portalEntitiesUnregistered && (Entity?.name === 'CustomerRole' || Entity?.name === 'CustomerRoleAcl')) {
    throw new Error(`Metadata for entity ${Entity.name} not found`)
  }
  if (Entity?.name === 'Role') {
    const tid = where?.tenantId ?? null
    const roles = rolesByTenant[tid ?? '__null__'] ?? []
    return roles.find((r) => r.name === where?.name) ?? null
  }
  if (Entity?.name === 'RoleAcl') {
    return existingAcls.find((a) => a.role?.id === where?.role?.id && a.tenantId === where?.tenantId) ?? null
  }
  if (Entity?.name === 'CustomerRole') {
    const roles = customerRolesByTenant[where?.tenantId] ?? []
    return roles.find((r) => r.slug === where?.slug) ?? null
  }
  if (Entity?.name === 'CustomerRoleAcl') {
    // The lookup passes the role id, not the entity.
    return existingCustomerAcls.find((a) => a.role?.id === where?.role && a.tenantId === where?.tenantId) ?? null
  }
  if (Entity?.name === 'Tenant') {
    const id = where?.id
    if (!id) return null
    return tenantsList.find((t) => t.id === id) ?? null
  }
  return null
})
const find = jest.fn(async (Entity: any) => {
  if (Entity?.name === 'Tenant') return tenantsList
  return []
})
const create = jest.fn((_entity: any, data: any) => ({ ...data }))
const persist = jest.fn(function persist(this: any, entity: any) {
  if (entity && 'featuresJson' in entity) {
    const existingIdx = persistedAcls.findIndex((a) => a.role?.id === entity.role?.id && a.tenantId === entity.tenantId)
    if (existingIdx >= 0) persistedAcls[existingIdx] = entity
    else persistedAcls.push(entity)
  }
  return this
})
const flush = jest.fn(async () => {})
const persistAndFlush = jest.fn(async (entity: any) => {
  persist(entity)
  await flush()
})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_: string) => ({
      findOne,
      find,
      create,
      persist,
      persistAndFlush,
      flush,
      transactional: async (cb: (tem: any) => any) =>
        cb({ findOne, find, create, persist, persistAndFlush, flush }),
    }),
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (em: any, Entity: any, where: any) => em.findOne(Entity, where),
  findWithDecryption: async (em: any, Entity: any, where: any) => em.find(Entity, where),
}))

function seedRoles(tenantId: string) {
  rolesByTenant[tenantId] = [
    { id: `r-superadmin-${tenantId}`, name: 'superadmin', tenantId },
    { id: `r-admin-${tenantId}`, name: 'admin', tenantId },
    { id: `r-employee-${tenantId}`, name: 'employee', tenantId },
    { id: `r-reports-${tenantId}`, name: 'reports_viewer', tenantId },
  ]
  if (!tenantsList.some((t) => t.id === tenantId)) tenantsList.push({ id: tenantId })
}

describe('auth CLI sync-role-acls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    persistedAcls = []
    existingAcls = []
    tenantsList = []
    rolesByTenant = {}
    customerRolesByTenant = {}
    existingCustomerAcls = []
    portalEntitiesUnregistered = false
    registerCliModules(testModules)
  })

  it('creates RoleAcl rows for built-in + custom roles on --tenant <id>', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    expect(cmd).toBeDefined()
    seedRoles('t-1')

    await cmd.run(['--tenant', 't-1'])

    const superadminAcl = persistedAcls.find((a) => a.role?.name === 'superadmin')
    const adminAcl = persistedAcls.find((a) => a.role?.name === 'admin')
    const employeeAcl = persistedAcls.find((a) => a.role?.name === 'employee')
    const reportsAcl = persistedAcls.find((a) => a.role?.name === 'reports_viewer')

    expect(superadminAcl?.isSuperAdmin).toBe(true)
    expect(superadminAcl?.featuresJson).toEqual(expect.arrayContaining(['auth.admin']))
    expect(adminAcl?.featuresJson).toEqual(expect.arrayContaining(['auth.*', 'customers.*']))
    expect(employeeAcl?.featuresJson).toEqual(expect.arrayContaining(['auth.view', 'customers.view']))
    expect(reportsAcl?.featuresJson).toEqual(['reports.view'])
  })

  it('is additive and idempotent — preserves existing features, adds missing ones', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    seedRoles('t-1')
    const adminRole = rolesByTenant['t-1'].find((r) => r.name === 'admin')!
    existingAcls = [
      {
        role: adminRole,
        tenantId: 't-1',
        featuresJson: ['auth.*', 'legacy.custom.kept'],
        isSuperAdmin: false,
      },
    ]

    await cmd.run(['--tenant', 't-1'])

    const adminAcl = persistedAcls.find((a) => a.role?.name === 'admin')
    expect(adminAcl?.featuresJson).toEqual(expect.arrayContaining(['auth.*', 'customers.*', 'legacy.custom.kept']))
  })

  it('--no-superadmin skips writing the superadmin ACL', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    seedRoles('t-1')

    await cmd.run(['--tenant', 't-1', '--no-superadmin'])

    const superadminAcl = persistedAcls.find((a) => a.role?.name === 'superadmin')
    expect(superadminAcl).toBeUndefined()
    const adminAcl = persistedAcls.find((a) => a.role?.name === 'admin')
    expect(adminAcl).toBeDefined()
  })

  it('iterates every tenant when --tenant is omitted', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    tenantsList = [{ id: 't-1' }, { id: 't-2' }]
    seedRoles('t-1')
    seedRoles('t-2')

    await cmd.run([])

    const adminAclT1 = persistedAcls.find((a) => a.role?.name === 'admin' && a.tenantId === 't-1')
    const adminAclT2 = persistedAcls.find((a) => a.role?.name === 'admin' && a.tenantId === 't-2')
    expect(adminAclT1).toBeDefined()
    expect(adminAclT2).toBeDefined()
  })

  it('logs and exits when no tenants found (no-flag mode)', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    await cmd.run([])

    expect(persistedAcls).toEqual([])
    expect(logSpy).toHaveBeenCalledWith('No tenants found; nothing to sync.')
    logSpy.mockRestore()
  })

  /**
   * A portal feature declared by a module reaches the customer roles a tenant is
   * already using. Before this, `defaultCustomerRoleFeatures` was merged only at
   * tenant bootstrap, so the "Time reports" page shipped invisible to every
   * customer whose Buyer role predated it (#5900).
   */
  it('grants newly declared portal features to existing customer roles', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    seedRoles('t-1')
    const buyerRole: CustomerRoleStub = { id: 'cr-buyer-t-1', slug: 'buyer', tenantId: 't-1' }
    customerRolesByTenant['t-1'] = [buyerRole]
    existingCustomerAcls = [
      { role: buyerRole, tenantId: 't-1', featuresJson: ['portal.orders.view'] },
    ]

    await cmd.run(['--tenant', 't-1'])

    const buyerAcl = persistedAcls.find((a) => (a.role as unknown as CustomerRoleStub)?.slug === 'buyer')
    expect(buyerAcl?.featuresJson).toEqual(
      expect.arrayContaining(['portal.orders.view', 'portal.time_reports.view']),
    )
  })

  it('leaves a customer role that already holds the feature untouched', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    seedRoles('t-1')
    const buyerRole: CustomerRoleStub = { id: 'cr-buyer-t-1', slug: 'buyer', tenantId: 't-1' }
    customerRolesByTenant['t-1'] = [buyerRole]
    existingCustomerAcls = [
      { role: buyerRole, tenantId: 't-1', featuresJson: ['portal.time_reports.view'] },
    ]

    await cmd.run(['--tenant', 't-1'])

    expect(persistedAcls.find((a) => (a.role as unknown as CustomerRoleStub)?.slug === 'buyer')).toBeUndefined()
  })

  it('still syncs staff roles for a tenant that has no customer roles at all', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    seedRoles('t-1')

    await cmd.run(['--tenant', 't-1'])

    expect(persistedAcls.find((a) => a.role?.name === 'admin')).toBeDefined()
  })

  /**
   * A deployment that enables `staff` (so a module declares
   * `defaultCustomerRoleFeatures`) but not `customer_accounts` (so nothing
   * registers `CustomerRole`). The portal half must not run at all: guarding only
   * the dynamic import did not skip it, because every core module ships in
   * `@open-mercato/core` regardless of `modules.ts`, so the import resolved and
   * the first `findOne(CustomerRole)` aborted the command — and with it every
   * `mercato init` on that deployment.
   */
  it('skips the portal half entirely when customer_accounts is disabled', async () => {
    registerCliModules(testModules.filter((mod) => mod.id !== 'customer_accounts'))
    portalEntitiesUnregistered = true
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    seedRoles('t-1')
    const buyerRole: CustomerRoleStub = { id: 'cr-buyer-t-1', slug: 'buyer', tenantId: 't-1' }
    customerRolesByTenant['t-1'] = [buyerRole]
    existingCustomerAcls = [{ role: buyerRole, tenantId: 't-1', featuresJson: [] }]

    // Bare await on purpose: completing at all is the regression signal, and an
    // unwrapped rejection reports the real `Metadata for entity ... not found`
    // rather than a matcher's "rejected instead of resolved".
    await cmd.run(['--tenant', 't-1'])

    expect(findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'CustomerRole' }),
      expect.anything(),
    )
    const adminAcl = persistedAcls.find((a) => a.role?.name === 'admin')
    expect(adminAcl?.featuresJson).toEqual(expect.arrayContaining(['auth.*', 'customers.*']))
  })

  it('errors and writes nothing when --tenant points at a non-existent tenant', async () => {
    const cmd = cli.find((c: any) => c.command === 'sync-role-acls')!
    seedRoles('t-1')
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await cmd.run(['--tenant', 't-missing'])

    expect(persistedAcls).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith('❌ Tenant not found: t-missing')
    errorSpy.mockRestore()
  })
})
