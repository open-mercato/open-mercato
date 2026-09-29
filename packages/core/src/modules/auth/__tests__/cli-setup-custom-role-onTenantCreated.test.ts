/** @jest-environment node */
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/auth/cli'

// Regression test for https://github.com/open-mercato/open-mercato/issues/6076:
// setupInitialTenant used to call ensureDefaultRoleAcls (which grants
// defaultRoleFeatures to roles that already exist) BEFORE running module
// onTenantCreated hooks. A module that creates a custom role inside its own
// onTenantCreated hook — the only per-tenant hook a module has — therefore
// ended initial tenant setup with the role present but no RoleAcl grant at
// all, until someone manually ran `mercato auth sync-role-acls`.

let claimsClerkRoleCreated = false

const testModules: Module[] = [
  {
    id: 'claims',
    setup: {
      defaultRoleFeatures: { 'claims-clerk': ['claims.read', 'claims.update'] },
      onTenantCreated: async () => {
        // Simulates a module persisting its custom role once the tenant exists.
        claimsClerkRoleCreated = true
      },
    },
  },
]
registerModules(testModules)
registerCliModules(testModules)

// Mock DI container and EM, mirroring cli-setup-acl.test.ts.
const persistedEntities: any[] = []
const findOne = jest.fn()
const findOneOrFail = jest.fn()
const create = jest.fn((entity: any, data: any) => {
  if (entity?.name === 'Tenant') return { id: 'tenant-1', ...data }
  if (entity?.name === 'Organization') return { id: 'org-1', ...data }
  return { ...data }
})
const find = jest.fn(async () => [])
const persist = jest.fn(function persist(this: any, entity: any) {
  persistedEntities.push(entity)
  return this
})
const flush = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (_: string) => {
    const baseEm = { findOne, findOneOrFail, create, find, persist, flush }
    return {
      ...baseEm,
      transactional: async (cb: (tem: any) => any) => {
        const tem = { ...baseEm }
        return await cb(tem)
      },
    }
  } }),
}))

describe('auth CLI setup seeds ACLs for roles created inside onTenantCreated', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    claimsClerkRoleCreated = false
  })

  it('grants defaultRoleFeatures to a custom role a module creates in its own onTenantCreated hook', async () => {
    const setup = cli.find((c: any) => c.command === 'setup')!

    findOne.mockImplementation(async (_Entity: any, where: any) => {
      if (where?.name === 'superadmin') return { id: 'r-superadmin', name: 'superadmin' }
      if (where?.name === 'admin') return { id: 'r-admin', name: 'admin' }
      if (where?.name === 'employee') return { id: 'r-employee', name: 'employee' }
      if (where?.name === 'claims-clerk') {
        // Only resolvable once the onTenantCreated hook has run, exactly like a
        // real DB lookup after the role row has been persisted.
        return claimsClerkRoleCreated ? { id: 'r-claims-clerk', name: 'claims-clerk' } : null
      }
      return null
    })
    findOneOrFail.mockImplementation(async (_: any, where: any) => ({ id: 'role-' + where.name, name: where.name }))

    await setup.run(['--orgName', 'Acme', '--email', 'root@acme.com', '--password', 'secret', '--skip-password-policy'])

    expect(claimsClerkRoleCreated).toBe(true)

    const roleAclCreates = persistedEntities.filter((row) => 'tenantId' in row && Array.isArray(row.featuresJson))
    const claimsClerkAcl = roleAclCreates.find((row) => row.featuresJson.includes('claims.read'))
    expect(claimsClerkAcl).toBeDefined()
    expect(claimsClerkAcl?.featuresJson).toEqual(expect.arrayContaining(['claims.read', 'claims.update']))
  }, 20000)
})
