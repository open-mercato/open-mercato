/** @jest-environment node */
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/auth/cli'
import { setupInitialTenant } from '../lib/setup-app'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { TenantSetupContext } from '@open-mercato/shared/modules/setup'
import { bindRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import { createTransactionalEntityManagerDouble } from '../../../test-utils/transactionalEntityManagerDouble'

// Regression test for https://github.com/open-mercato/open-mercato/issues/6076:
// setupInitialTenant used to call ensureDefaultRoleAcls (which grants
// defaultRoleFeatures to roles that already exist) BEFORE running module
// onTenantCreated hooks. A module that creates a custom role inside its own
// onTenantCreated hook — the only per-tenant hook a module has — therefore
// ended initial tenant setup with the role present but no RoleAcl grant at
// all, until someone manually ran `mercato auth sync-role-acls`.

let claimsClerkRoleCreated = false
const mockOnTenantCreated = jest.fn(async (_context: TenantSetupContext) => {
  claimsClerkRoleCreated = true
})

const testModules: Module[] = [
  {
    id: 'claims',
    setup: {
      defaultRoleFeatures: { 'claims-clerk': ['claims.read', 'claims.update'] },
      onTenantCreated: mockOnTenantCreated,
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

const mockDispose = jest.fn(async () => {})
const mockCreateRequestContainer = jest.fn(async () => {
  const em = createTransactionalEntityManagerDouble({ findOne, findOneOrFail, create, find, persist, flush })
  const scope = { resolve: () => em, dispose: mockDispose }
  bindRequestScopeContainer(scope as unknown as AppContainer)
  return scope
})
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))

describe('auth CLI setup seeds ACLs for roles created inside onTenantCreated', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    claimsClerkRoleCreated = false
    findOne.mockImplementation(async (_Entity, where) => {
      if (where?.name === 'superadmin') return { id: 'r-superadmin', name: 'superadmin' }
      if (where?.name === 'admin') return { id: 'r-admin', name: 'admin' }
      if (where?.name === 'employee') return { id: 'r-employee', name: 'employee' }
      if (where?.name === 'claims-clerk') {
        return claimsClerkRoleCreated ? { id: 'r-claims-clerk', name: 'claims-clerk' } : null
      }
      return null
    })
    findOneOrFail.mockImplementation(async (_Entity, where) => ({ id: 'role-' + where.name, name: where.name }))
  })

  afterEach(() => registerModules(testModules))

  it('grants defaultRoleFeatures to a custom role a module creates inside its setup scope', async () => {
    const setup = cli.find((entry) => entry.command === 'setup')!

    await setup.run(['--orgName', 'Acme', '--email', 'root@acme.com', '--password', 'secret', '--skip-password-policy'])

    expect(claimsClerkRoleCreated).toBe(true)
    expect(mockCreateRequestContainer).toHaveBeenCalledTimes(1)
    const cliContainer = await mockCreateRequestContainer.mock.results[0]!.value
    expect(mockOnTenantCreated).toHaveBeenCalledWith({
      em: cliContainer.resolve(),
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      container: cliContainer,
      enabledModuleIds: new Set(['claims']),
    })

    const roleAclCreates = persistedEntities.filter((row) => 'tenantId' in row && Array.isArray(row.featuresJson))
    const claimsClerkAcl = roleAclCreates.find((row) => row.featuresJson.includes('claims.read'))
    expect(claimsClerkAcl).toBeDefined()
    expect(claimsClerkAcl?.featuresJson).toEqual(expect.arrayContaining(['claims.read', 'claims.update']))
  }, 20000)

  it('bootstraps and disposes the hook scope for legacy setup calls that include Configs', async () => {
    const em = (await mockCreateRequestContainer()).resolve() as unknown as EntityManager
    mockCreateRequestContainer.mockClear()
    registerModules([{ id: 'configs' }, ...testModules])

    await setupInitialTenant(em, {
      orgName: 'Acme',
      primaryUser: { email: 'root@example.com', password: 'secret' },
      includeDerivedUsers: false,
    })

    expect(mockCreateRequestContainer).toHaveBeenCalledTimes(1)
    const hookContainer = await mockCreateRequestContainer.mock.results[0]!.value
    expect(mockOnTenantCreated).toHaveBeenCalledWith(expect.objectContaining({
      em,
      container: hookContainer,
      enabledModuleIds: new Set(['configs', 'claims']),
    }))
    expect(mockDispose).toHaveBeenCalledTimes(1)
  })

  it('uses the supplied container and its explicit effective setup module set', async () => {
    const callerScope = await mockCreateRequestContainer()
    const em = callerScope.resolve() as unknown as EntityManager
    mockCreateRequestContainer.mockClear()
    registerModules([{ id: 'configs' }, ...testModules])

    await setupInitialTenant(em, {
      orgName: 'Acme',
      primaryUser: { email: 'root@example.com', password: 'secret' },
      includeDerivedUsers: false,
      container: callerScope as unknown as AppContainer,
      modules: testModules,
    })

    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    expect(mockDispose).not.toHaveBeenCalled()
    expect(mockOnTenantCreated).toHaveBeenCalledWith(expect.objectContaining({
      em,
      container: callerScope,
      enabledModuleIds: new Set(['claims']),
    }))
  })
})
