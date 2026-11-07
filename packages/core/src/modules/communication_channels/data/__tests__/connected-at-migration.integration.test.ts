import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { MigrationRunner } from '@mikro-orm/migrations'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { CommunicationChannel } from '../entities'
import { restoreDeletedChannel } from '../../lib/channel-restore'
import { Migration20261105120000_communication_channels } from '../../migrations/Migration20261105120000_communication_channels'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'channel_connected_at_migration_test'
const DATABASE_USER = 'channel_migration'
const DATABASE_PASSWORD = 'channel_migration'

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type ColumnRow = { is_nullable: string; data_type: string }

type ChannelRow = {
  id: string
  tenant_id: string
  user_id: string | null
  provider_key: string
  display_name: string
  external_identifier: string | null
  credentials_ref: string | null
  status: string
  is_active: boolean
  created_at: Date
  deleted_at: Date | null
}

describeWithPostgres('Migration20261105120000_communication_channels on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  function runningOrm(): TestOrm {
    if (!orm) throw new Error('[internal] ORM is not running')
    return orm
  }

  function requestEm(): EntityManager {
    return runningOrm().em.fork({ clear: true, useContext: true })
  }

  async function runMigration(method: 'up' | 'down') {
    const driver = runningOrm().em.getDriver()
    const config = runningOrm().config
    const runner = new MigrationRunner(driver, { transactional: true }, config)
    await runner.run(new Migration20261105120000_communication_channels(driver, config), method)
  }

  async function connectedAtColumn(): Promise<ColumnRow | null> {
    const rows = await requestEm().execute<ColumnRow[]>(
      `select is_nullable, data_type from information_schema.columns
        where table_schema = current_schema() and table_name = 'communication_channels' and column_name = 'connected_at'`,
    )
    return rows[0] ?? null
  }

  async function channelRows(): Promise<ChannelRow[]> {
    return requestEm().execute<ChannelRow[]>(
      `select id, tenant_id, user_id, provider_key, display_name, external_identifier, credentials_ref,
              status, is_active, created_at, deleted_at
         from communication_channels order by display_name`,
    )
  }

  async function insertLegacyChannel(values: {
    tenantId: string
    userId: string
    displayName: string
    externalIdentifier: string | null
    createdAt: Date
    deletedAt: Date | null
  }): Promise<string> {
    const id = randomUUID()
    await requestEm().execute(
      `insert into communication_channels
         (id, provider_key, channel_type, display_name, external_identifier, credentials_ref, capabilities,
          is_active, user_id, is_primary, status, tenant_id, organization_id, created_at, updated_at, deleted_at)
       values (?, 'discord', 'chat', ?, ?, ?, '{}', true, ?, false, 'connected', ?, null, ?, ?, ?)`,
      [
        id,
        values.displayName,
        values.externalIdentifier,
        randomUUID(),
        values.userId,
        values.tenantId,
        values.createdAt,
        values.createdAt,
        values.deletedAt,
      ],
    )
    return id
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [CommunicationChannel],
      debug: false,
      pool: { min: 0, max: 4 },
    })
    await orm.schema.create()
    await orm.em.getConnection().execute('alter table "communication_channels" drop column "connected_at"')
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  }, 60_000)

  it('adds a nullable connected_at that keeps existing channels usable, and drops it again without losing them', async () => {
    expect(await connectedAtColumn()).toBeNull()
    const tenantId = randomUUID()
    const userId = randomUUID()
    const deletedAt = new Date(Date.now() - 60_000)
    const liveId = await insertLegacyChannel({
      tenantId,
      userId,
      displayName: 'Existing live channel',
      externalIdentifier: 'bot-live',
      createdAt: new Date(Date.now() - 600_000),
      deletedAt: null,
    })
    const deletedId = await insertLegacyChannel({
      tenantId,
      userId,
      displayName: 'Existing deleted channel',
      externalIdentifier: 'bot-deleted',
      createdAt: new Date(Date.now() - 300_000),
      deletedAt,
    })
    const unrelatedId = await insertLegacyChannel({
      tenantId: randomUUID(),
      userId: randomUUID(),
      displayName: 'Unrelated tenant channel',
      externalIdentifier: null,
      createdAt: new Date(Date.now() - 120_000),
      deletedAt: null,
    })
    const before = await channelRows()

    await runMigration('up')

    expect(await connectedAtColumn()).toEqual({ is_nullable: 'YES', data_type: 'timestamp with time zone' })
    expect(await channelRows()).toEqual(before)
    const nullStamps = await requestEm().execute<Array<{ id: string }>>(
      'select id from communication_channels where connected_at is null order by display_name',
    )
    expect(nullStamps.map((row) => row.id)).toEqual([deletedId, liveId, unrelatedId])

    const live = await requestEm().findOneOrFail(CommunicationChannel, { id: liveId })
    expect(live.connectedAt).toBeNull()
    await restoreDeletedChannel(requestEm(), { channelId: deletedId, tenantId })
    const restored = await requestEm().findOneOrFail(CommunicationChannel, { id: deletedId })
    expect(restored.deletedAt).toBeNull()
    const connectedAt = new Date()
    const stampEm = requestEm()
    const stamped = await stampEm.findOneOrFail(CommunicationChannel, { id: liveId })
    stamped.connectedAt = connectedAt
    await stampEm.flush()
    expect((await requestEm().findOneOrFail(CommunicationChannel, { id: liveId })).connectedAt).toEqual(connectedAt)
    const afterUp = await channelRows()

    await runMigration('down')

    expect(await connectedAtColumn()).toBeNull()
    expect(await channelRows()).toEqual(afterUp)
    expect(afterUp.map((row) => row.id)).toEqual([deletedId, liveId, unrelatedId])
  }, 60_000)
})
