/** @jest-environment node */
import { randomBytes } from 'node:crypto'
import { MikroORM, PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import cli from '@open-mercato/core/modules/auth/cli'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import seedTenant, { metadata as tenantMetadata } from '@open-mercato/core/modules/entities/subscribers/seed-tenant-encryption-maps'
import retryTenant, { metadata as retryMetadata } from '@open-mercato/core/modules/entities/subscribers/seed-tenant-encryption-maps-retry'
import seedOrganization, { metadata as organizationMetadata } from '@open-mercato/core/modules/entities/subscribers/seed-organization-encryption-maps'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { createEventBus } from '@open-mercato/events/bus'
import type { EventBus } from '@open-mercato/events/types'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolve }),
}))
jest.mock('@open-mercato/queue', () => ({
  createQueue: () => ({ enqueue: jest.fn(async () => {}) }),
}))

let mockEm: EntityManager
let mockEventBus: EventBus
let mockEncryption: TenantDataEncryptionService
const mockResolve = <T = unknown>(name: string): T => {
  if (name === 'em') return mockEm as T
  if (name === 'eventBus') return mockEventBus as T
  if (name === 'tenantEncryptionService') return mockEncryption as T
  throw new Error(`[internal] Unexpected DI key: ${name}`)
}
const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('auth add-org against PostgreSQL (#7687)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: Awaited<ReturnType<typeof MikroORM.init>> | undefined
  const previousEncryption = process.env.TENANT_DATA_ENCRYPTION

  beforeAll(async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'seeding_test', POSTGRES_USER: 'seeding_test', POSTGRES_PASSWORD: 'seeding_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(), port: postgres.getMappedPort(5432),
      dbName: 'seeding_test', user: 'seeding_test', password: 'seeding_test',
      entities: [Tenant, Organization, EncryptionMap],
    })
    await orm.schema.create()
    mockEm = orm.em.fork() as EntityManager
    const key = randomBytes(32).toString('base64')
    mockEncryption = new TenantDataEncryptionService(mockEm, { kms: {
      isHealthy: () => true,
      getTenantDek: async (tenantId) => ({ tenantId, key, fetchedAt: Date.now() }),
      createTenantDek: async (tenantId) => ({ tenantId, key, fetchedAt: Date.now() }),
    } })
    registerModules([{ id: 'test', defaultEncryptionMaps: [{ entityId: 'test:record', fields: [{ field: 'secret' }] }] }])
    mockEventBus = createEventBus({ resolve: mockResolve, queueStrategy: 'local' })
    mockEventBus.on(tenantMetadata.event, seedTenant, tenantMetadata)
    mockEventBus.on(retryMetadata.event, retryTenant, retryMetadata)
    mockEventBus.on(organizationMetadata.event, seedOrganization, organizationMetadata)
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
    registerModules([])
    if (previousEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousEncryption
  })

  it('creates both policies before the first write and safely redelivers tenant creation', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await cli.find((command) => command.command === 'add-org')!.run(['--name', 'Issue 7687 regression'])
      const organizations = await mockEm.find(Organization, { name: 'Issue 7687 regression' })
      expect(organizations).toHaveLength(1)
      const organization = organizations[0]!
      const tenantId = organization.tenant.id
      const maps = await mockEm.find(EncryptionMap, { tenantId, deletedAt: null })
      expect(maps.map((map) => map.organizationId).sort()).toEqual([organization.id, null].sort())
      expect(maps.every((map) => map.isActive)).toBe(true)
      for (const organizationId of [null, organization.id]) {
        const encrypted = await mockEncryption.encryptEntityPayload('test:record', { secret: 'must not be plaintext' }, tenantId, organizationId)
        expect(isEncryptedPayloadShape(encrypted.secret)).toBe(true)
      }
      await mockEventBus.dispatchQueued!('directory.tenant.created', { id: tenantId, tenantId: null, organizationId: null })
      expect(await mockEm.count(EncryptionMap, { tenantId, deletedAt: null })).toBe(2)
    } finally {
      logSpy.mockRestore()
    }
  })
})
