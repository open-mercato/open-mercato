/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { CatalogProductCategory } from '../../data/entities'
import { lockCategoryHierarchyForOrganization } from '../../lib/categoryHierarchy'
import '../categories'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

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
      entities: [CatalogProductCategory],
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
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
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
    await lockCategoryHierarchyForOrganization(blocker, scope.organizationId, scope.tenantId)
    const completed = Promise.allSettled([
      command.execute({ id: first.id, parentId: second.id }, ctx),
      command.execute({ id: second.id, parentId: first.id }, ctx),
    ])
    let waiters = 0
    try {
      const deadline = Date.now() + 5000
      while (waiters !== 2 && Date.now() < deadline) {
        const rows = await em.execute<Array<{ count: number }>>(
          "select count(*)::int as count from pg_locks where locktype = 'advisory' and not granted",
        )
        waiters = rows[0]?.count ?? 0
        if (waiters !== 2) await delay(25)
      }
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
})
