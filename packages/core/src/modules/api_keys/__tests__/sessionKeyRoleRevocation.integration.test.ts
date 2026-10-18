import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createMemoryStrategy } from '@open-mercato/cache'
import { User, UserRole, Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { ApiKey } from '../data/entities'
import { createApiKey, createSessionApiKey } from '../services/apiKeyService'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resetSharedApiKeyAuthCacheForTests } from '@open-mercato/shared/lib/auth/apiKeyAuthCache'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'

const mockCreateRequestContainer = jest.fn()

jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: () => ({}),
  resolveEncryptionMode: () => 'disabled',
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (manager: FixtureReader, entity: unknown, where: unknown) => manager.find(entity, where),
  findOneWithDecryption: (manager: FixtureReader, entity: unknown, where: unknown) => manager.findOne(entity, where),
}))
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (manager: { flush(): Promise<void> }, phases: Array<() => Promise<void>>) => {
    for (const phase of phases) {
      await phase()
      await manager.flush()
    }
  },
}))
jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({
  lockRoleWriterAuthorizationState: async () => undefined,
}))

type Fixture = Record<string, unknown>
type FixtureReader = {
  find(entity: unknown, where: unknown): Promise<object[]>
  findOne(entity: unknown, where: unknown): Promise<object | null>
}
type FixtureManager = FixtureReader & {
  create(entity: unknown, values: Fixture): ApiKey
  persist(record: ApiKey): FixtureManager
  flush(): Promise<void>
  fork(): FixtureManager
}

function asFixture(value: unknown): Fixture | null {
  return value !== null && typeof value === 'object' ? value as Fixture : null
}

function matches(actual: unknown, expected: unknown): boolean {
  if (expected == null) return actual == null
  const predicate = asFixture(expected)
  const record = asFixture(actual)
  if (!predicate) return (record?.id ?? actual) === expected
  if (Array.isArray(predicate.$in)) return predicate.$in.some((candidate) => matches(actual, candidate))
  return Object.entries(predicate).every(([field, value]) => matches(record?.[field], value))
}

function createFixtureManager(fixtures: Map<unknown, object[]>): FixtureManager {
  const manager: FixtureManager = {
    async find(entity: unknown, where: unknown): Promise<object[]> {
      return (fixtures.get(entity) ?? []).filter((record) => matches(record, where))
    },
    async findOne(entity: unknown, where: unknown): Promise<object | null> {
      return (await manager.find(entity, where))[0] ?? null
    },
    create(entity: unknown, values: Fixture): ApiKey {
      if (entity !== ApiKey) throw new Error('[internal] Unexpected fixture entity')
      return Object.assign(new ApiKey(), { id: randomUUID(), deletedAt: null }, values)
    },
    persist(record: ApiKey) {
      const records = fixtures.get(ApiKey) ?? []
      if (!records.includes(record)) fixtures.set(ApiKey, [...records, record])
      return manager
    },
    async flush(): Promise<void> {},
    fork() {
      return manager
    },
  }
  return manager
}

afterEach(() => resetSharedApiKeyAuthCacheForTests())

it('revokes an issued session credential immediately across independently warmed ACL caches', async () => {
  resetSharedApiKeyAuthCacheForTests()
  registerModules([{ id: 'customers' }])
  const tenantId = randomUUID()
  const user = Object.assign(new User(), { id: randomUUID(), tenantId, organizationId: null, deletedAt: null })
  const privilegedRole = Object.assign(new Role(), { id: randomUUID(), name: 'superadmin', tenantId, deletedAt: null })
  const readerRole = Object.assign(new Role(), { id: randomUUID(), name: 'reader', tenantId, deletedAt: null })
  const issuedRoleIds = [privilegedRole.id, readerRole.id].sort()
  const fixtures = new Map<unknown, object[]>([
    [User, [user]],
    [Role, [privilegedRole, readerRole]],
    [UserRole, [privilegedRole, readerRole].map((role) => Object.assign(new UserRole(), {
      id: randomUUID(), user, role, deletedAt: null,
    }))],
    [RoleAcl, [
      Object.assign(new RoleAcl(), {
        id: randomUUID(), role: privilegedRole, tenantId, isSuperAdmin: true,
        featuresJson: ['customers.people.edit'], organizationsJson: null, deletedAt: null,
      }),
      Object.assign(new RoleAcl(), {
        id: randomUUID(), role: readerRole, tenantId, isSuperAdmin: false,
        featuresJson: ['customers.people.view'], organizationsJson: null, deletedAt: null,
      }),
    ]],
  ])
  const manager = createFixtureManager(fixtures)
  const entityManager = manager as unknown as EntityManager
  mockCreateRequestContainer.mockResolvedValue({ resolve: () => entityManager })
  const session = await createSessionApiKey(entityManager, {
    sessionToken: 'sess_revocation_integration', userId: user.id, userRoles: issuedRoleIds,
    tenantId, organizationId: null, ttlMinutes: 120,
  })
  const independent = await createApiKey(entityManager, {
    name: 'independent credential', tenantId, organizationId: null,
    roles: issuedRoleIds, createdBy: user.id,
  })
  const workers = [createMemoryStrategy(), createMemoryStrategy()].map((cache) => ({
    cache, rbac: new RbacService(entityManager, cache),
  }))
  const scope = { tenantId, organizationId: null }
  const authenticate = (secret: string) => getAuthFromRequest(new Request('https://example.test/api/customers/people', {
    headers: { 'x-api-key': secret },
  }))
  for (const worker of workers) {
    const auth = await authenticate(session.secret)
    expect(auth).toMatchObject({ keyId: session.keyId, isSuperAdmin: true })
    const acl = await worker.rbac.loadAcl(auth!.sub, scope)
    await worker.cache.set(`rbac:${auth!.sub}:${tenantId}:null`, acl)
    await expect(worker.rbac.userHasAllFeatures(auth!.sub, ['customers.people.edit'], scope)).resolves.toBe(true)
    const independentAuth = await authenticate(independent.secret)
    await expect(worker.rbac.userHasAllFeatures(independentAuth!.sub, ['customers.people.edit'], scope)).resolves.toBe(true)
  }

  fixtures.set(UserRole, (fixtures.get(UserRole) ?? []).filter((link) => (link as UserRole).role.id !== privilegedRole.id))

  for (const worker of workers) {
    const auth = await authenticate(session.secret)
    expect(auth).toMatchObject({ keyId: session.keyId, roles: ['reader'], isSuperAdmin: false })
    await expect(worker.rbac.userHasAllFeatures(auth!.sub, ['customers.people.edit'], scope)).resolves.toBe(false)
    await expect(worker.rbac.userHasAllFeatures(auth!.sub, ['customers.people.view'], scope)).resolves.toBe(true)
    const independentAuth = await authenticate(independent.secret)
    expect(independentAuth).toMatchObject({ isSuperAdmin: true })
    await expect(worker.rbac.userHasAllFeatures(independentAuth!.sub, ['customers.people.edit'], scope)).resolves.toBe(true)
  }
  expect((await manager.findOne(ApiKey, { id: session.keyId }) as ApiKey).rolesJson).toEqual(issuedRoleIds)
})
