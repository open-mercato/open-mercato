/** @jest-environment node */

import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { SyncRun } from '../../data/entities'
import { createSyncRunService, SyncRunOverlapError } from '../sync-run-service'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('data sync run admission in PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'sync_test', POSTGRES_PASSWORD: 'sync_test', POSTGRES_DB: 'sync_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    orm = await MikroORM.init({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'sync_test',
      password: 'sync_test',
      dbName: 'sync_test',
      entities: [SyncRun],
      pool: { min: 0, max: 4 },
    })
    await orm.schema.create()
  }, 90_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  it('admits a single active run per scope and allows a new run after completion', async () => {
    const scope = { organizationId: randomUUID(), tenantId: randomUUID() }
    const input = {
      integrationId: 'sync_fixture', entityType: 'catalog.product', direction: 'import' as const, cursor: 'page-2',
    }
    const first = createSyncRunService(orm.em.fork())
    const second = createSyncRunService(orm.em.fork())
    const prepareProgressJob = jest.fn(async () => randomUUID())
    const results = await Promise.allSettled([
      first.createRun(input, scope, prepareProgressJob),
      second.createRun(input, { ...scope, tenantId: scope.tenantId.toUpperCase() }, prepareProgressJob),
    ])

    const accepted = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    const refused = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    expect(accepted).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0]).toBeInstanceOf(SyncRunOverlapError)
    expect(prepareProgressJob).toHaveBeenCalledTimes(1)
    expect(accepted[0]).toMatchObject({ status: 'pending', cursor: 'page-2', initialCursor: 'page-2' })

    const independentRuns = await Promise.all([
      first.createRun(input, { ...scope, organizationId: randomUUID() }),
      second.createRun({ ...input, direction: 'export' }, scope),
    ])
    expect(independentRuns).toHaveLength(2)

    await first.markStatus(accepted[0].id, 'running', scope)
    await expect(second.createRun(input, scope)).rejects.toBeInstanceOf(SyncRunOverlapError)
    await first.markStatus(accepted[0].id, 'completed', scope)
    await expect(second.createRun(input, scope)).resolves.toMatchObject({ status: 'pending' })
  })
})
