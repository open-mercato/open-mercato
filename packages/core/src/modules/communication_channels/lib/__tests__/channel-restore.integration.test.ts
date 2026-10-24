import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { CommunicationChannel } from '../../data/entities'
import { captureChannelRestoreRecord, restoreDeletedChannel } from '../channel-restore'
import { createConnectedChannelRow } from '../connect-channel'

const duplicateCheck: { pause: ((where: Record<string, unknown>) => Promise<void>) | null } = { pause: null }

jest.mock('@open-mercato/shared/lib/encryption/find', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/encryption/find')
  return {
    ...actual,
    findWithDecryption: async (...args: Parameters<typeof actual.findWithDecryption>) => {
      const rows = await actual.findWithDecryption(...args)
      const where = args[2] as Record<string, unknown>
      const pause = duplicateCheck.pause
      if (pause && where.providerKey === undefined) {
        duplicateCheck.pause = null
        await pause(where)
      }
      return rows
    },
  }
})

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'channel_restore_test'
const DATABASE_USER = 'channel_restore'
const DATABASE_PASSWORD = 'channel_restore'
const CHAT_ADAPTER = { channelType: 'chat', capabilities: { realtimePush: true } } as never
const CONNECT_WAIT_MS = 400

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type LiveRow = { id: string; external_identifier: string | null }

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

describeWithPostgres('channel delete undo against a concurrent reconnect on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  function requestEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not running')
    return orm.em.fork({ clear: true, useContext: true })
  }

  async function seedChannel(scope: { tenantId: string; userId: string }, values: Partial<CommunicationChannel>) {
    const em = requestEm()
    const channel = em.create(CommunicationChannel, {
      providerKey: 'discord',
      channelType: 'chat',
      displayName: 'Discord',
      externalIdentifier: null,
      credentialsRef: randomUUID(),
      capabilities: {},
      isActive: true,
      isPrimary: false,
      status: 'connected',
      tenantId: scope.tenantId,
      organizationId: null,
      userId: scope.userId,
      ...values,
    })
    em.persist(channel)
    await em.flush()
    return channel
  }

  async function deleteChannel(channelId: string) {
    const em = requestEm()
    const channel = await em.findOneOrFail(CommunicationChannel, { id: channelId })
    const record = await captureChannelRestoreRecord(em, channel)
    channel.deletedAt = new Date()
    await em.flush()
    return record
  }

  function reconnect(scope: { tenantId: string; userId: string }) {
    return createConnectedChannelRow({
      em: requestEm(),
      adapter: CHAT_ADAPTER,
      providerKey: 'discord',
      displayName: 'Discord',
      externalIdentifier: 'bot-1234',
      credentialsRefId: randomUUID(),
      userId: scope.userId,
      scope: { tenantId: scope.tenantId, organizationId: null },
      adoptUnidentifiedChannel: true,
    })
  }

  async function liveRows(scope: { tenantId: string; userId: string }): Promise<LiveRow[]> {
    return requestEm().execute<LiveRow[]>(
      'select id, external_identifier from communication_channels where tenant_id = ? and user_id = ? and deleted_at is null and is_active order by created_at',
      [scope.tenantId, scope.userId],
    )
  }

  function newScope() {
    return { tenantId: randomUUID(), userId: randomUUID() }
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
  }, 120_000)

  afterEach(() => {
    duplicateCheck.pause = null
  })

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  }, 60_000)

  it('makes a reconnect that starts between the duplicate check and the restore wait, then adopts the restored row', async () => {
    const scope = newScope()
    const deleted = await seedChannel(scope, { createdAt: new Date(Date.now() - 60_000) })
    const record = await deleteChannel(deleted.id)
    const checked = createDeferred()
    const release = createDeferred()
    duplicateCheck.pause = async () => {
      checked.resolve()
      await release.promise
    }

    const restore = restoreDeletedChannel(requestEm(), { channelId: deleted.id, tenantId: scope.tenantId, ...record })
    await checked.promise
    let connectSettled = false
    const connect = reconnect(scope).finally(() => {
      connectSettled = true
    })
    await sleep(CONNECT_WAIT_MS)
    expect(connectSettled).toBe(false)
    expect(await liveRows(scope)).toEqual([])

    release.resolve()
    await restore
    const connected = await connect

    expect(connected.id).toBe(deleted.id)
    expect(await liveRows(scope)).toEqual([{ id: deleted.id, external_identifier: 'bot-1234' }])
  }, 30_000)

  it('refuses an undo that runs after a reconnect committed', async () => {
    const scope = newScope()
    const deleted = await seedChannel(scope, { createdAt: new Date(Date.now() - 60_000) })
    const record = await deleteChannel(deleted.id)
    const connected = await reconnect(scope)

    await expect(
      restoreDeletedChannel(requestEm(), { channelId: deleted.id, tenantId: scope.tenantId, ...record }),
    ).rejects.toMatchObject({ status: 409 })
    expect(await liveRows(scope)).toEqual([{ id: connected.id, external_identifier: 'bot-1234' }])
  }, 30_000)

  it('refuses an undo once a reconnect adopted an older identifier-less row', async () => {
    const scope = newScope()
    const older = await seedChannel(scope, { createdAt: new Date(Date.now() - 120_000) })
    const deleted = await seedChannel(scope, { createdAt: new Date(Date.now() - 60_000) })
    const record = await deleteChannel(deleted.id)
    expect(record.unidentifiedSiblingIds).toEqual([older.id])
    const adopted = await reconnect(scope)
    expect(adopted.id).toBe(older.id)

    await expect(
      restoreDeletedChannel(requestEm(), { channelId: deleted.id, tenantId: scope.tenantId, ...record }),
    ).rejects.toMatchObject({ status: 409 })
    expect(await liveRows(scope)).toEqual([{ id: older.id, external_identifier: 'bot-1234' }])
  }, 30_000)

  it('restores next to an identifier-less row that lived beside the deleted one', async () => {
    const scope = newScope()
    const older = await seedChannel(scope, { createdAt: new Date(Date.now() - 120_000) })
    const deleted = await seedChannel(scope, { createdAt: new Date(Date.now() - 60_000) })
    const record = await deleteChannel(deleted.id)

    await restoreDeletedChannel(requestEm(), { channelId: deleted.id, tenantId: scope.tenantId, ...record })
    expect((await liveRows(scope)).map((row) => row.id)).toEqual([older.id, deleted.id])
  }, 30_000)
})
