/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { CommandBus, commandRegistry } from '@open-mercato/shared/lib/commands'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { E } from '#generated/entities.ids.generated'
import { CatalogProductCategory } from '../../data/entities'
import { lockCategoryHierarchyForOrganization, rebuildCategoryHierarchyForOrganization } from '../../lib/categoryHierarchy'
import '../categories'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

async function waitForLockWaiters(em: EntityManager, expected: number): Promise<number> {
  const deadline = Date.now() + 5000
  let waiters = 0
  while (Date.now() < deadline) {
    const rows = await em.execute<Array<{ count: number }>>(
      "select count(*)::int as count from pg_locks where locktype = 'advisory' and not granted",
    )
    waiters = rows[0]?.count ?? 0
    if (waiters === expected) break
    await delay(25)
  }
  return waiters
}

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('catalog category hierarchy serialization', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    const password = randomUUID()
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'category_lock_test', POSTGRES_PASSWORD: password })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'category_lock_test',
      user: 'postgres',
      password,
      entities: [CatalogProductCategory, CustomFieldDef, CustomFieldValue],
      pool: { min: 0, max: 6 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  it('serializes concurrent category moves and refuses the move that would form a cycle', async () => {
    const scope = {
      tenantId: 'aaaaaaaa-5555-4000-8000-331111111111',
      organizationId: 'bbbbbbbb-5555-4000-8000-441111111111',
    }
    const em = orm.em.fork()
    const first = em.create(CatalogProductCategory, { ...scope, name: 'First category' })
    const second = em.create(CatalogProductCategory, { ...scope, name: 'Second category' })
    await em.flush()

    const command = commandRegistry.get('catalog.categories.update')
    if (!command) throw new Error('[internal] Category update command is missing')
    const ctx = {
      container: {
        resolve: (token: string) => token === 'em' ? em : { markOrmEntityChange: jest.fn() },
      } as unknown as AwilixContainer,
      auth: { sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId },
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }

    const blocker = orm.em.fork()
    await blocker.begin()
    await lockCategoryHierarchyForOrganization(blocker, scope.organizationId.toUpperCase(), scope.tenantId.toUpperCase())
    const completed = Promise.allSettled([
      command.execute({ id: first.id, parentId: second.id }, ctx),
      command.execute({ id: second.id, parentId: first.id }, ctx),
    ])
    let waiters = 0
    try {
      waiters = await waitForLockWaiters(em, 2)
    } finally {
      await blocker.rollback()
    }
    const outcomes = await completed
    expect(waiters).toBe(2)
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'fulfilled' }),
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({
          status: 400,
          body: expect.objectContaining({ code: 'catalog.categories.errors.parentCycle' }),
        }),
      }),
    ]))

    const persisted = await orm.em.fork().find(CatalogProductCategory, scope)
    const [root, child] = persisted.sort((left, right) => left.depth - right.depth)
    expect(root.parentId).toBeNull()
    expect(child.parentId).toBe(root.id)
    expect(child.ancestorIds).toEqual([root.id])
  }, 30_000)
  it.each(['update', 'delete'] as const)('undo of a waiting %s keeps the preceding move', async (operation) => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const em = orm.em.fork()
    const parent = em.create(CatalogProductCategory, { ...scope, name: 'Parent' })
    const category = em.create(CatalogProductCategory, { ...scope, name: 'Category' })
    await em.flush()

    const actionLogService = {
      log: jest.fn(async (entry: Record<string, unknown>) => ({
        ...entry,
        id: randomUUID(),
      })),
    }
    const dependencies: Record<string, unknown> = {
      em,
      actionLogService,
      dataEngine: { markOrmEntityChange: jest.fn() },
    }
    const ctx = {
      container: { resolve: (token: string) => dependencies[token] } as unknown as AwilixContainer,
      auth: { sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId },
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }

    const blocker = orm.em.fork()
    await blocker.begin()
    let completed: Promise<PromiseSettledResult<unknown>[]> | undefined
    let waiters = 0
    try {
      await lockCategoryHierarchyForOrganization(blocker, scope.organizationId, scope.tenantId)
      const moved = await blocker.findOneOrFail(CatalogProductCategory, { id: category.id })
      moved.parentId = parent.id
      await blocker.flush()
      await rebuildCategoryHierarchyForOrganization(blocker, scope.organizationId, scope.tenantId)

      const bus = new CommandBus()
      completed = Promise.allSettled([bus.execute(`catalog.categories.${operation}`, {
        input: operation === 'update' ? { id: category.id, name: 'Renamed' } : { id: category.id },
        ctx,
        skipCacheInvalidation: true,
      })])
      waiters = await waitForLockWaiters(em, 1)
      await blocker.commit()
    } finally {
      if (blocker.isInTransaction()) await blocker.rollback()
    }
    expect(waiters).toBe(1)
    expect(await completed).toEqual([expect.objectContaining({ status: 'fulfilled' })])

    const logEntry = await actionLogService.log.mock.results[0].value
    expect(logEntry.snapshotBefore).toMatchObject({ id: category.id, parentId: parent.id, name: 'Category' })
    const handler = commandRegistry.get(`catalog.categories.${operation}`)
    if (!handler?.undo) throw new Error('[internal] Category undo missing')
    await handler.undo({ input: { id: category.id }, ctx, logEntry })
    const restored = await orm.em.fork().findOneOrFail(CatalogProductCategory, { id: category.id })
    expect(restored).toMatchObject({ name: 'Category', parentId: parent.id, deletedAt: null })
  }, 30_000)

  it.each(['update', 'delete'] as const)('undo of a waiting %s keeps the preceding custom-field edit', async (operation) => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const em = orm.em.fork()
    const category = em.create(CatalogProductCategory, { ...scope, name: 'Category' })
    const entityId = E.catalog.catalog_product_category
    em.create(CustomFieldDef, { ...scope, entityId, key: 'marker', kind: 'text', isActive: true })
    await em.flush()
    const fieldScope = { ...scope, entityId, recordId: category.id }
    await setRecordCustomFields(em, { ...fieldScope, values: { marker: 'initial' } })

    const reachedFieldWrite = Promise.withResolvers<void>()
    const allowFieldWrite = Promise.withResolvers<void>()
    const actionLogService = {
      log: jest.fn(async (entry: Record<string, unknown>) => ({ ...entry, id: randomUUID() })),
    }
    const firstActionLogService = {
      log: jest.fn(async (entry: Record<string, unknown>) => ({ ...entry, id: randomUUID() })),
    }
    const dataEngine = {
      markOrmEntityChange: jest.fn(),
      setCustomFields: async ({ transactionalEm, ...opts }: Parameters<DataEngine['setCustomFields']>[0]) => {
        if (opts.values.marker === 'first edit') {
          reachedFieldWrite.resolve()
          await allowFieldWrite.promise
        }
        await setRecordCustomFields(transactionalEm ?? em, opts)
      },
    }
    const dependencies: Record<string, unknown> = { em, actionLogService, dataEngine }
    const ctx = {
      container: { resolve: (token: string) => dependencies[token] } as unknown as AwilixContainer,
      auth: { sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId },
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }
    const bus = new CommandBus()
    const firstInput = { id: category.id, cf_marker: 'first edit' }
    const firstCtx = {
      ...ctx,
      container: {
        resolve: (token: string) => token === 'actionLogService' ? firstActionLogService : dependencies[token],
      } as unknown as AwilixContainer,
    }
    const firstWrite = Promise.allSettled([bus.execute('catalog.categories.update', {
      input: firstInput, ctx: firstCtx, skipCacheInvalidation: true,
    })])
    const input = operation === 'update' ? { id: category.id, name: 'Renamed' } : { id: category.id }
    let waiters = 0
    let secondWrite: Promise<PromiseSettledResult<unknown>[]> | undefined
    try {
      const reached = await Promise.race([reachedFieldWrite.promise.then(() => true), firstWrite.then(() => false)])
      expect(reached).toBe(true)
      secondWrite = Promise.allSettled([bus.execute(`catalog.categories.${operation}`, {
        input, ctx, skipCacheInvalidation: true,
      })])
      waiters = await waitForLockWaiters(em, 1)
    } finally {
      allowFieldWrite.resolve()
    }
    expect(await firstWrite).toEqual([expect.objectContaining({ status: 'fulfilled' })])
    expect(await secondWrite).toEqual([expect.objectContaining({ status: 'fulfilled' })])

    const firstLog = await firstActionLogService.log.mock.results[0]?.value
    const secondLog = await actionLogService.log.mock.results[0]?.value
    const handler = commandRegistry.get(`catalog.categories.${operation}`)
    if (!handler?.undo || !secondLog) throw new Error('[internal] Category undo or log is missing')
    await handler.undo({ input, ctx, logEntry: secondLog })

    expect(await loadCustomFieldSnapshot(orm.em.fork(), fieldScope)).toEqual({ marker: 'first edit' })
    expect(secondLog.snapshotBefore).toMatchObject({ custom: { marker: 'first edit' } })
    expect(firstLog?.snapshotAfter).toMatchObject({ custom: { marker: 'first edit' } })
    expect(waiters).toBe(1)
  }, 30_000)
})
