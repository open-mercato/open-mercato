/** @jest-environment node */
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/auth/cli'

const testModules: Module[] = [
  { id: 'auth', setup: { defaultRoleFeatures: { superadmin: ['auth.admin'], admin: ['auth.*'], employee: ['auth.view'] } } },
  { id: 'customers', setup: { defaultRoleFeatures: { admin: ['customers.*'], employee: ['customers.view'] } } },
  { id: 'reports', setup: { defaultRoleFeatures: { reports_viewer: ['reports.view'] } } },
]
registerModules(testModules)
registerCliModules(testModules)

type RoleStub = { id: string; name: string; tenantId: string | null }
type RoleAclStub = { role: RoleStub; tenantId: string; featuresJson: string[]; isSuperAdmin: boolean }

let persistedAcls: RoleAclStub[] = []
let existingAcls: RoleAclStub[] = []
let tenantsList: Array<{ id: string }> = []
let rolesByTenant: Record<string, RoleStub[]> = {}

const findOne = jest.fn(async (Entity: any, where: any) => {
  if (Entity?.name === 'Role') {
    const tid = where?.tenantId ?? null
    const roles = rolesByTenant[tid ?? '__null__'] ?? []
    return roles.find((r) => r.name === where?.name) ?? null
  }
  if (Entity?.name === 'RoleAcl') {
    return existingAcls.find((a) => a.role?.id === where?.role?.id && a.tenantId === where?.tenantId) ?? null
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

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_: string) => ({
      findOne,
      find,
      create,
      persist,
      flush,
      transactional: async (cb: (tem: any) => any) => cb({ findOne, find, create, persist, flush }),
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
}

describe('auth CLI sync-role-acls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    persistedAcls = []
    existingAcls = []
    tenantsList = []
    rolesByTenant = {}
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
})
