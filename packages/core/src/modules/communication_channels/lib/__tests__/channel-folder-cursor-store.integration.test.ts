import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { CommunicationChannel, CommunicationChannelFolderCursor } from '../../data/entities'
import { register } from '../../di'
import { Migration20261122165240_communication_channels as FolderCursorMigration } from '../../migrations/Migration20261122165240_communication_channels'
import type { ChannelFolderCursorStore } from '../channel-folder-cursor-store'
import { withLockedChannel } from '../channel-state-write'

const testDatabaseUrl = process.env.OM_CHANNEL_FOLDER_CURSOR_PG_URL
const describePostgres = testDatabaseUrl || process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describePostgres('channel folder cursor storage against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver> | undefined
  let createdSchema = false
  let em: EntityManager
  let channel: CommunicationChannel
  let store: ChannelFolderCursorStore
  let key: Parameters<ChannelFolderCursorStore['read']>[0]

  beforeAll(async () => {
    let clientUrl = testDatabaseUrl
    if (!clientUrl) {
      postgres = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_DB: 'channels', POSTGRES_USER: 'channels', POSTGRES_PASSWORD: 'channels' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .start()
      clientUrl = `postgresql://channels:channels@${postgres.getHost()}:${postgres.getMappedPort(5432)}/channels`
    }
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      clientUrl,
      entities: [CommunicationChannel, CommunicationChannelFolderCursor],
    })
    await orm.schema.create()
    createdSchema = true
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    await register(container)
    const scope = container.createScope()
    scope.register('em', asValue(orm.em.fork()))
    store = scope.resolve<ChannelFolderCursorStore>('channelFolderCursorStore')
  }, 120_000)

  afterAll(async () => {
    try {
      if (testDatabaseUrl && createdSchema) await orm?.schema.drop()
    } finally {
      try {
        await orm?.close(true)
      } finally {
        await postgres?.stop()
      }
    }
  }, 30_000)

  beforeEach(async () => {
    if (!orm) throw new Error('[internal] PostgreSQL test ORM unavailable')
    em = orm.em.fork()
    channel = em.create(CommunicationChannel, {
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      providerKey: 'imap',
      channelType: 'email',
      displayName: 'Folder cursor fixture',
      channelState: { uidNext: 7, watchExpirationMs: '100' },
    })
    await em.flush()
    key = {
      channelId: channel.id,
      tenantId: channel.tenantId,
      organizationId: channel.organizationId ?? null,
      folderId: "Projects/Team's notes",
    }
  })

  afterEach(async () => {
    if (channel?.id) await em.nativeDelete(CommunicationChannel, { id: channel.id, tenantId: channel.tenantId })
  })

  it('keeps differently cased folders independent of channel polling and push state', async () => {
    const otherFolder = { ...key, folderId: key.folderId.toLowerCase() }

    const [firstWritten, secondWritten] = await Promise.all([
      store.advance(key, null, "provider's opaque ? cursor"),
      store.advance(otherFolder, null, 'second cursor'),
      withLockedChannel(em, channel, async (current, transaction) => {
        current.channelState = { ...current.channelState, uidNext: 8 }
        await transaction.flush()
      }),
    ])

    expect(firstWritten).toBe(true)
    expect(secondWritten).toBe(true)
    expect(await store.read(key)).toMatchObject({ cursor: "provider's opaque ? cursor" })
    expect(await store.read(otherFolder)).toMatchObject({ cursor: 'second cursor' })
    const saved = await em.findOneOrFail(CommunicationChannel, { id: channel.id }, { refresh: true })
    expect(saved.channelState).toEqual({ uidNext: 8, watchExpirationMs: '100' })
  })

  it('permits one writer for an absent cursor and one writer for each persisted version', async () => {
    expect(await store.read(key)).toBeNull()
    const inserted = await Promise.all([
      store.advance(key, null, 'initial first'),
      store.advance(key, null, 'initial second'),
    ])
    expect(inserted.filter(Boolean)).toHaveLength(1)

    const initial = await store.read(key)
    if (!initial) throw new Error('[internal] Initial folder cursor missing')
    expect(initial.cursor).toBe(inserted[0] ? 'initial first' : 'initial second')

    const advanced = await Promise.all([
      store.advance(key, initial.version, 'advance first'),
      store.advance(key, initial.version, 'advance second'),
    ])
    expect(advanced.filter(Boolean)).toHaveLength(1)

    const winner = await store.read(key)
    expect(winner?.version).not.toBe(initial.version)
    expect(winner?.cursor).toBe(advanced[0] ? 'advance first' : 'advance second')
    expect(await store.advance(key, initial.version, 'late result')).toBe(false)
    expect(await store.advance({ ...key, folderId: 'Missing' }, initial.version, 'unexpected insert')).toBe(false)
    expect(await store.read(key)).toEqual(winner)
  })

  it('checks tenant, organization and channel lifecycle on both reads and writes', async () => {
    expect(await store.advance(key, null, 'scoped')).toBe(true)
    const scoped = await store.read(key)
    if (!scoped) throw new Error('[internal] Scoped folder cursor missing')

    const rejectedKeys = [
      { ...key, tenantId: randomUUID() },
      { ...key, organizationId: randomUUID() },
      { ...key, organizationId: null },
      { ...key, channelId: randomUUID() },
    ]
    for (const rejectedKey of rejectedKeys) {
      expect(await store.read(rejectedKey)).toBeNull()
      expect(await store.advance(rejectedKey, null, 'wrong scope')).toBe(false)
      expect(await store.advance(rejectedKey, scoped.version, 'wrong scope')).toBe(false)
    }

    const where = { id: channel.id, tenantId: channel.tenantId, organizationId: key.organizationId }
    await em.nativeUpdate(CommunicationChannel, where, { status: 'disconnected' })
    expect(await store.read(key)).toBeNull()
    expect(await store.advance(key, scoped.version, 'disconnected')).toBe(false)

    await em.nativeUpdate(CommunicationChannel, where, { status: 'connected', deletedAt: new Date() })
    expect(await store.read(key)).toBeNull()
    expect(await store.advance(key, scoped.version, 'deleted')).toBe(false)

    await em.nativeUpdate(CommunicationChannel, where, { deletedAt: null })
    expect(await store.read(key)).toEqual(scoped)
    await em.nativeDelete(CommunicationChannel, where)
    expect(await em.count(CommunicationChannelFolderCursor, { channelId: channel.id })).toBe(0)
  })

  it('supports an exact null organization scope for tenant-wide channels', async () => {
    await em.nativeUpdate(CommunicationChannel, { id: channel.id, tenantId: key.tenantId }, { organizationId: null })
    const tenantWideKey = { ...key, organizationId: null }

    expect(await store.advance(tenantWideKey, null, 'tenant-wide')).toBe(true)
    expect(await store.read(tenantWideKey)).toMatchObject({ cursor: 'tenant-wide' })
    expect(await store.read(key)).toBeNull()
    expect(await store.advance(key, null, 'organization-scoped')).toBe(false)
  })

  it('rolls back and reapplies the migration without altering channel state', async () => {
    const migration = new FolderCursorMigration(em.getDriver(), em.config)
    await em.transactional(async (transaction) => {
      await migration.down()
      for (const query of migration.getQueries()) await transaction.execute(query)
      const [removed] = await transaction.execute<Array<{ cursor_table: string | null }>>(
        "select to_regclass('communication_channel_folder_cursors') as cursor_table",
      )
      expect(removed.cursor_table).toBeNull()

      migration.reset()
      await migration.up()
      for (const query of migration.getQueries()) await transaction.execute(query)
    })

    expect(await store.advance(key, null, 'after migration')).toBe(true)
    expect(await store.read(key)).toMatchObject({ cursor: 'after migration' })
    const saved = await em.findOneOrFail(CommunicationChannel, { id: channel.id }, { refresh: true })
    expect(saved.channelState).toEqual({ uidNext: 7, watchExpirationMs: '100' })
  })
})
