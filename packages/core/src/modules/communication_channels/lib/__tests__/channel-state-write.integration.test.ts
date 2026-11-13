import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { CommunicationChannel } from '../../data/entities'
import { withLockedChannel } from '../channel-state-write'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('channel state writes against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver> | undefined

  beforeAll(async () => {
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: 'channels', POSTGRES_USER: 'channels', POSTGRES_PASSWORD: 'channels' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      entities: [CommunicationChannel],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'channels', user: 'channels', password: 'channels',
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  }, 30_000)

  it('serializes concurrent owned-key merges without losing a cursor or push state', async () => {
    if (!orm) throw new Error('[internal] PostgreSQL test ORM unavailable')
    const em = orm.em.fork()
    const channel = em.create(CommunicationChannel, {
      tenantId: randomUUID(), organizationId: null, providerKey: 'gmail', channelType: 'email',
      displayName: 'Concurrency fixture', channelState: { historyId: '100' },
    })
    await em.flush()
    try {
      await Promise.all(Array.from({ length: 8 }, (_, index) => withLockedChannel(em, channel, async (current, transaction) => {
        const state = current.channelState ?? {}
        await transaction.execute('select pg_sleep(0.02)')
        current.channelState = { ...state, [`writer${index}`]: true }
        await transaction.flush()
      })))
      const stored = await em.fork({ clear: true }).findOneOrFail(CommunicationChannel, { id: channel.id })
      expect(stored.channelState).toEqual({ historyId: '100', ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`writer${index}`, true])) })
    } finally {
      await em.nativeDelete(CommunicationChannel, { id: channel.id })
    }
  }, 20_000)
})
