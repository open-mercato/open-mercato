import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ChannelThreadMapping, CommunicationChannel, ExternalConversation, MessageChannelLink } from '../../data/entities'
import { sendAsUser } from '../send-as-user'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('sendAsUser scope with persisted mailboxes', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    const connection = { POSTGRES_DB: 'mailbox_scope', POSTGRES_USER: 'mailbox_scope', POSTGRES_PASSWORD: 'mailbox_scope' }
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment(connection)
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: connection.POSTGRES_DB,
      user: connection.POSTGRES_USER,
      password: connection.POSTGRES_PASSWORD,
      entities: [CommunicationChannel, ChannelThreadMapping, ExternalConversation, MessageChannelLink],
    })
    await orm.schema.create()
  }, 180_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  it.each(['tenantId', 'organizationId'] as const)('rejects a different %s before policy or writes', async (field) => {
    const em = orm.em.fork()
    const actor = { userId: randomUUID(), tenantId: randomUUID(), organizationId: randomUUID() }
    const mailbox = em.create(CommunicationChannel, {
      userId: randomUUID(),
      providerKey: 'gmail',
      channelType: 'email',
      displayName: 'Orders',
      tenantId: actor.tenantId,
      organizationId: actor.organizationId,
      [field]: randomUUID(),
    })
    await em.flush()

    const authorizeNonOwner = jest.fn(() => true)
    const execute = jest.fn()
    const container: AppContainer = createContainer()
    container.register({ em: asValue(em), commandBus: asValue({ execute }) })

    await expect(sendAsUser(container, actor, {
      userChannelId: mailbox.id,
      to: ['customer@example.com'],
      subject: 'Order query',
      body: { plain: 'Thanks for your order.' },
    }, { authorizeNonOwner })).resolves.toMatchObject({ ok: false, status: 404 })

    expect(authorizeNonOwner).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(await em.count(ExternalConversation)).toBe(0)
    expect(await em.count(ChannelThreadMapping)).toBe(0)
    expect(await em.count(MessageChannelLink)).toBe(0)
  })
})
