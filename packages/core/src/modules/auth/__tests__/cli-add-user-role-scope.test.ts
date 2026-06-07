/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
  isEncryptionDebugEnabled: () => false,
}))

import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/auth/cli'

jest.setTimeout(60_000)

const testModules: Module[] = [
  { id: 'auth', setup: { defaultRoleFeatures: { admin: ['auth.*'] } } },
  { id: 'directory', setup: { defaultRoleFeatures: { admin: ['directory.*'] } } },
]
registerModules(testModules)
registerCliModules(testModules)

const TENANT_ID = 'tenant-1'

type FakeRole = { id: string; name: string; tenantId: string | null }

let createdRoles: FakeRole[]
let globalRole: FakeRole
let findOne: jest.Mock
let create: jest.Mock
let persist: jest.Mock
let flush: jest.Mock

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_: string) => ({
      findOne,
      findOneOrFail: jest.fn(),
      create,
      find: jest.fn(async () => []),
      persist,
      flush,
    }),
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async (_em: any, Entity: any, where: any) => {
    const name = (Entity && Entity.name) || ''
    if (name === 'Organization' && where?.id === 'org-1') {
      return { id: 'org-1', tenant: { id: TENANT_ID } }
    }
    return null
  }),
}))

const addUserCommand = cli.find((c: any) => c.command === 'add-user')!

const BASE_ARGS = [
  '--email', 'agent@acme.com',
  '--password', 'Str0ng!Passw0rd',
  '--organizationId', 'org-1',
]

describe('mercato auth add-user role scoping', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    globalRole = { id: 'global-role', name: 'shared', tenantId: null }
    createdRoles = []
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    findOne = jest.fn(async (Entity: any, where: any) => {
      const name = (Entity && Entity.name) || ''
      if (name === 'Role') {
        const tenantId = where?.tenantId ?? null
        if (where?.name === globalRole.name && tenantId === globalRole.tenantId) return globalRole
        const created = createdRoles.find((r) => r.name === where?.name && r.tenantId === tenantId)
        return created ?? null
      }
      return null
    })
    create = jest.fn((Entity: any, data: any) => {
      const name = (Entity && Entity.name) || ''
      if (name === 'Role') {
        const role: FakeRole = { id: 'role-' + createdRoles.length, name: data.name, tenantId: data.tenantId ?? null }
        createdRoles.push(role)
        return role
      }
      return { id: 'entity-' + name, ...data }
    })
    persist = jest.fn(function persist(this: any) { return this })
    flush = jest.fn(async () => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('never re-scopes a global role to the tenant and creates a tenant-scoped role instead', async () => {
    await addUserCommand.run([...BASE_ARGS, '--roles', 'shared'])

    expect(globalRole.tenantId).toBeNull()

    const tenantScoped = createdRoles.find((r) => r.name === 'shared' && r.tenantId === TENANT_ID)
    expect(tenantScoped).toBeDefined()

    const globalLookup = findOne.mock.calls.find(([Entity, where]: [any, any]) => {
      const name = (Entity && Entity.name) || ''
      return name === 'Role' && (where?.tenantId ?? null) === null
    })
    expect(globalLookup).toBeUndefined()
  })

  it('reuses an existing tenant-scoped role without creating a duplicate', async () => {
    createdRoles.push({ id: 'existing', name: 'shared', tenantId: TENANT_ID })
    const createdBefore = createdRoles.length

    await addUserCommand.run([...BASE_ARGS, '--roles', 'shared'])

    expect(globalRole.tenantId).toBeNull()
    const sharedTenantRoles = createdRoles.filter((r) => r.name === 'shared' && r.tenantId === TENANT_ID)
    expect(sharedTenantRoles).toHaveLength(1)
    expect(createdRoles.length).toBe(createdBefore)
  })
})
