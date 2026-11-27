import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { StartedTestContainer } from 'testcontainers'
import { runRepair } from '../../../../../../.ai/skills/om-repair-resource-type-references/scripts/repair'
import {
  ResourcesResource,
  ResourcesResourceActivity,
  ResourcesResourceComment,
  ResourcesResourceTag,
  ResourcesResourceTagAssignment,
  ResourcesResourceType,
} from '../data/entities'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
}))

const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
const scopeArgs = ['--tenant', scope.tenantId, '--org', scope.organizationId]
const bootstrap = jest.fn(async () => undefined)
const createContainer = jest.mocked(createRequestContainer)

describe('resource type repair options', () => {
  it.each([
    { args: [] },
    { args: ['--tenant', scope.tenantId, '--apply'] },
    { args: ['--org', scope.organizationId, '--apply'] },
    { args: ['--tenant', 'all', '--org', scope.organizationId, '--apply'] },
    { args: [...scopeArgs, '--apply=false'] },
    { args: [...scopeArgs, '--apply'] },
    { args: [...scopeArgs, '--journal', 'preview.json'] },
    { args: [...scopeArgs, 'unexpected'] },
    { args: [...scopeArgs, '--unknown'] },
  ])('rejects $args before opening a database connection', async ({ args }) => {
    await expect(runRepair(args, bootstrap)).rejects.toThrow()
    expect(bootstrap).not.toHaveBeenCalled()
    expect(createContainer).not.toHaveBeenCalled()
  })
})

const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describePostgres('resource type repair with PostgreSQL', () => {
  let postgres: StartedTestContainer
  let orm: MikroORM<PostgreSqlDriver>
  let journalDir: string
  let applyArgs: string[]
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(),
  }
  const eventBus = { emitEvent: jest.fn() }
  const oldVersion = new Date('2099-01-01T00:00:00.000Z')
  const otherTenant = { ...scope, tenantId: randomUUID() }
  const otherOrg = { ...scope, organizationId: randomUUID() }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    const fixture = { POSTGRES_DB: 'resource_repair', POSTGRES_USER: 'fixture', POSTGRES_PASSWORD: randomUUID() }
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment(fixture)
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: fixture.POSTGRES_DB,
      user: fixture.POSTGRES_USER,
      password: fixture.POSTGRES_PASSWORD,
      entities: [
        ResourcesResource,
        ResourcesResourceActivity,
        ResourcesResourceComment,
        ResourcesResourceTag,
        ResourcesResourceTagAssignment,
        ResourcesResourceType,
      ],
    })
    await orm.schema.create()
  }, 60000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    journalDir = await mkdtemp(join(tmpdir(), 'om-resource-repair-'))
    applyArgs = [...scopeArgs, '--apply', '--journal', join(journalDir, 'repair.json')]
    const em = orm.em.fork()
    await em.nativeDelete(ResourcesResource, {})
    await em.nativeDelete(ResourcesResourceType, {})
    createContainer.mockResolvedValue({
      resolve: (key: string) => ({ em, dataEngine, eventBus })[key as 'em' | 'dataEngine' | 'eventBus'],
      dispose: jest.fn(),
    } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  })

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true })
  })

  it('previews, clears only invalid live references and then does no work on a second run', async () => {
    const em = orm.em.fork()
    const retired = em.create(ResourcesResourceType, { ...scope, name: 'Retired', deletedAt: oldVersion })
    const local = em.create(ResourcesResourceType, { ...scope, name: 'Local' })
    const foreignOrg = em.create(ResourcesResourceType, { ...otherOrg, name: 'Foreign organization' })
    const foreignTenant = em.create(ResourcesResourceType, { ...otherTenant, name: 'Foreign tenant' })
    await em.flush()

    const fixtures = [
      { name: 'missing', resourceTypeId: randomUUID(), clears: true },
      { name: 'retired', resourceTypeId: retired.id, clears: true },
      { name: 'other organization type', resourceTypeId: foreignOrg.id, clears: true },
      { name: 'other tenant type', resourceTypeId: foreignTenant.id, clears: true },
      { name: 'valid', resourceTypeId: local.id, clears: false },
      { name: 'unassigned', resourceTypeId: null, clears: false },
      { name: 'deleted resource', resourceTypeId: randomUUID(), deletedAt: oldVersion, clears: false },
      { name: 'other organization resource', resourceTypeId: randomUUID(), ...otherOrg, clears: false },
      { name: 'other tenant resource', resourceTypeId: randomUUID(), ...otherTenant, clears: false },
      { name: 'another owning organization', resourceTypeId: foreignOrg.id, ...otherOrg, clears: false },
      { name: 'inactive live resource', resourceTypeId: retired.id, isActive: false, clears: true },
    ]
    const resources = fixtures.map(({ clears, ...fixture }) => ({
      row: em.create(ResourcesResource, { ...scope, updatedAt: oldVersion, ...fixture }),
      clears,
    }))
    await em.flush()

    const snapshot = async () => orm.em.fork().find(ResourcesResource, {}, { orderBy: { name: 'asc' } })
    const original = await snapshot()
    const candidateIds = resources.filter(({ clears }) => clears).map(({ row }) => row.id)
    expect(await runRepair(scopeArgs, bootstrap)).toEqual({ mode: 'preview', found: candidateIds.length, cleared: 0 })
    expect(await snapshot()).toEqual(original)
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
    expect(invalidateCrudCache).not.toHaveBeenCalled()

    expect(await runRepair(applyArgs, bootstrap)).toEqual({
      mode: 'apply', found: candidateIds.length, cleared: candidateIds.length,
    })
    const repaired = await snapshot()
    for (const row of repaired) {
      const previous = original.find(({ id }) => id === row.id)!
      if (candidateIds.includes(row.id)) {
        expect(row).toEqual({ ...previous, resourceTypeId: null, updatedAt: new Date(oldVersion.getTime() + 1) })
      } else {
        expect(row).toEqual(previous)
      }
    }
    expect(dataEngine.markOrmEntityChange.mock.calls.map(([change]) => change.identifiers))
      .toEqual(expect.arrayContaining(candidateIds.map((id) => ({ id, ...scope }))))
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(candidateIds.length)
    expect(dataEngine.flushOrmEntityChanges).toHaveBeenCalledTimes(1)
    expect(eventBus.emitEvent).toHaveBeenCalledTimes(candidateIds.length)
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'resources.resource.updated', { id: candidateIds[0], ...scope },
      { ...scope, persistent: true, emitterModuleId: 'resources' },
    )
    expect(invalidateCrudCache).toHaveBeenCalledWith(
      expect.anything(), 'resources.resource', scope, scope.tenantId, 'resource-type-reference-repair',
    )
    expect(invalidateCrudCache).toHaveBeenCalledTimes(1)

    expect(await runRepair(applyArgs, bootstrap)).toEqual({ mode: 'apply', found: 0, cleared: 0 })
    expect(await snapshot()).toEqual(repaired)
    expect(dataEngine.flushOrmEntityChanges).toHaveBeenCalledTimes(1)
    expect(invalidateCrudCache).toHaveBeenCalledTimes(2)
  })

  it('replays effects on retry after the database update has committed', async () => {
    const em = orm.em.fork()
    const resource = em.create(ResourcesResource, { ...scope, name: 'Interrupted repair', resourceTypeId: randomUUID() })
    await em.flush()
    dataEngine.flushOrmEntityChanges.mockRejectedValueOnce(new Error('projection interrupted'))

    await expect(runRepair(applyArgs, bootstrap)).rejects.toThrow('projection interrupted')
    const repaired = await orm.em.fork().findOneOrFail(ResourcesResource, resource.id)
    expect(repaired.resourceTypeId).toBeNull()
    expect(invalidateCrudCache).not.toHaveBeenCalled()

    expect(await runRepair(applyArgs, bootstrap)).toEqual({ mode: 'apply', found: 0, cleared: 0, replayed: 1 })
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(2)
    expect(dataEngine.markOrmEntityChange).toHaveBeenLastCalledWith(expect.objectContaining({
      identifiers: { id: resource.id, ...scope },
    }))
    expect(invalidateCrudCache).toHaveBeenCalledTimes(1)
    expect(await orm.em.fork().findOneOrFail(ResourcesResource, resource.id)).toEqual(repaired)
  })

  it('retains the journal when publication fails and retries the persistent event', async () => {
    const em = orm.em.fork()
    const resource = em.create(ResourcesResource, { ...scope, name: 'Pending event', resourceTypeId: randomUUID() })
    await em.flush()
    eventBus.emitEvent.mockRejectedValueOnce(new Error('queue unavailable'))

    await expect(runRepair(applyArgs, bootstrap)).rejects.toThrow('queue unavailable')
    expect(invalidateCrudCache).not.toHaveBeenCalled()
    expect(await runRepair(applyArgs, bootstrap)).toEqual({ mode: 'apply', found: 0, cleared: 0, replayed: 1 })
    expect(eventBus.emitEvent).toHaveBeenCalledTimes(2)
    expect((await orm.em.fork().findOneOrFail(ResourcesResource, resource.id)).resourceTypeId).toBeNull()
  })

  it('leaves every reference and version unchanged if the write fails', async () => {
    const em = orm.em.fork()
    em.create(ResourcesResource, { ...scope, name: 'First', resourceTypeId: randomUUID(), updatedAt: oldVersion })
    em.create(ResourcesResource, { ...scope, name: 'Second', resourceTypeId: randomUUID(), updatedAt: oldVersion })
    await em.flush()
    await em.execute("alter table resources_resources add constraint synthetic_failure check (name <> 'Second' or resource_type_id is not null)")
    try {
      await expect(runRepair(applyArgs, bootstrap)).rejects.toThrow('synthetic_failure')
      const rows = await orm.em.fork().find(ResourcesResource, {})
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row.resourceTypeId).toEqual(expect.any(String))
        expect(row.updatedAt).toEqual(oldVersion)
      }
      expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
      expect(dataEngine.flushOrmEntityChanges).not.toHaveBeenCalled()
      expect(invalidateCrudCache).not.toHaveBeenCalled()
    } finally {
      await em.execute('alter table resources_resources drop constraint synthetic_failure')
    }
  })
})
