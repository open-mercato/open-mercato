import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { createContainer, asValue } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { createCacheService } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { transactionCommitSubscriber } from '@open-mercato/shared/lib/db/afterCommit'
import { ModuleConfig } from '../../data/entities'
import { register } from '../../di'
import type { InstanceConfigInitializer } from '../instance-config-initializer'
import type { ModuleConfigService } from '../module-config-service'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip
const database = 'instance_config_test'

describeWithPostgres('Configs instance initialization against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver, EntityManager> | undefined
  let container: AppContainer
  let em: EntityManager
  let initializer: InstanceConfigInitializer
  let service: ModuleConfigService

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: database, POSTGRES_USER: database, POSTGRES_PASSWORD: database })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager>({
      driver: PostgreSqlDriver,
      metadataProvider: ReflectMetadataProvider,
      entities: [ModuleConfig],
      subscribers: [transactionCommitSubscriber],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: database,
      user: database,
      password: database,
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  beforeEach(() => {
    em = orm!.em.fork()
    container = createContainer()
    container.register({
      em: asValue(em),
      cache: asValue(createCacheService({ strategy: 'memory' })),
    })
    register(container)
    initializer = container.resolve('instanceConfigInitializer')
    service = container.resolve('moduleConfigService')
  })

  afterEach(async () => container?.dispose())

  function newKey() {
    return { moduleId: 'test_config', name: randomUUID() }
  }

  test('inserts a single instance-scoped row and refreshes a cached miss without changing tenant overrides', async () => {
    const key = newKey()
    const initialValue = { kind: 'shipped' }
    const tenantScope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const tenantValue = { kind: 'tenant' }
    await service.setValue(key.moduleId, key.name, tenantValue, tenantScope)
    expect(await service.getRecord(key.moduleId, key.name)).toBeNull()

    await Promise.all(
      Array.from({ length: 4 }, () => initializer.initialize(em.fork(), { ...key, initialValue, merge: () => undefined })),
    )

    const rows = await em.fork().find(ModuleConfig, key)
    expect(rows).toHaveLength(2)
    expect(await service.getRecord(key.moduleId, key.name)).toMatchObject({
      source: 'instance',
      organizationId: null,
      tenantId: null,
      value: initialValue,
    })
    expect(await service.getRecord(key.moduleId, key.name, tenantScope)).toMatchObject({
      source: 'tenant',
      organizationId: tenantScope.organizationId,
      tenantId: tenantScope.tenantId,
      value: tenantValue,
    })
  })

  test('serializes existing row merges and keeps a subsequent no-op untouched', async () => {
    const key = newKey()
    const save = await service.setValue(key.moduleId, key.name, { count: 0 })
    expect(save?.value).toEqual({ count: 0 })
    const merge = (current: unknown) => ({ value: { count: (current as { count: number }).count + 1 } })

    await Promise.all(
      Array.from({ length: 4 }, () => initializer.initialize(em.fork(), { ...key, initialValue: { count: 0 }, merge })),
    )

    const afterMerge = await em.fork().findOneOrFail(ModuleConfig, key)
    expect(afterMerge.valueJson).toEqual({ count: 4 })
    expect((await service.getRecord(key.moduleId, key.name))?.value).toEqual({ count: 4 })

    await initializer.initialize(em.fork(), { ...key, initialValue: null, merge: () => undefined })
    const afterRepeat = await em.fork().findOneOrFail(ModuleConfig, key)
    expect(afterRepeat.id).toBe(afterMerge.id)
    expect(afterRepeat.updatedAt).toEqual(afterMerge.updatedAt)
  })

  test('invalidates a warmed value only after outer commit and discards work rolled back to a savepoint', async () => {
    const key = newKey()
    const before = { resources: [] }
    const after = { resources: ['*'] }
    await service.setValue(key.moduleId, key.name, before)
    const invalidate = jest.spyOn(service, 'invalidate')
    const args = { ...key, initialValue: after, merge: () => ({ value: after }) }

    await em.fork().transactional(async (outer) => {
      await expect(outer.transactional(async (savepoint) => {
        await initializer.initialize(savepoint, args)
        throw new Error('[internal] rollback savepoint')
      })).rejects.toThrow('rollback savepoint')
      expect((await outer.findOneOrFail(ModuleConfig, key, { refresh: true })).valueJson).toEqual(before)
      expect(invalidate).not.toHaveBeenCalled()
    })
    expect(invalidate).not.toHaveBeenCalled()

    await expect(em.fork().transactional(async (outer) => {
      await outer.transactional(async (savepoint) => initializer.initialize(savepoint, args))
      expect(invalidate).not.toHaveBeenCalled()
      throw new Error('[internal] rollback outer transaction')
    })).rejects.toThrow('rollback outer transaction')
    expect(invalidate).not.toHaveBeenCalled()
    expect((await service.getRecord(key.moduleId, key.name))?.value).toEqual(before)

    await em.fork().transactional(async (outer) => {
      await outer.transactional(async (savepoint) => initializer.initialize(savepoint, args))
      expect(invalidate).not.toHaveBeenCalled()
      expect((await service.getRecord(key.moduleId, key.name))?.value).toEqual(before)
    })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect((await service.getRecord(key.moduleId, key.name))?.value).toEqual(after)
  })

  test('leaves an invalid organization-scoped collision unchanged', async () => {
    const key = newKey()
    const organizationId = randomUUID()
    const value = { scope: 'organization' }
    await service.setValue(key.moduleId, key.name, value, { organizationId })
    const merge = jest.fn()

    await expect(initializer.initialize(em, { ...key, initialValue: {}, merge })).rejects.toThrow('instance scope')

    const row = await em.fork().findOneOrFail(ModuleConfig, key)
    expect(merge).not.toHaveBeenCalled()
    expect(row.organizationId).toBe(organizationId)
    expect(row.valueJson).toEqual(value)
  })
})
