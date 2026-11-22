import { randomUUID } from 'node:crypto'
import { MikroORM, PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { IntegrationCredentials } from '@open-mercato/core/modules/integrations/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { StartedTestContainer } from 'testcontainers'
import { CommunicationChannel, ExternalConversation, ExternalMessage } from '../../../../../../data/entities'
import { COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME, encryptOAuthState } from '../../../../../../lib/oauth-state'
import { GET } from '../route'

const mockGetAuth = jest.fn()
const mockResolve = jest.fn()
const mockExchange = jest.fn()
const mockSaveCredentials = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolve }),
}))

jest.mock('../../../../../../lib/adapter-registry-singleton', () => ({
  getChannelAdapter: (provider: string) => provider === 'gmail' ? {
    channelType: 'email',
    capabilities: { realtimePush: false },
    exchangeOAuthCode: mockExchange,
  } : undefined,
}))

const provider = 'gmail'
const integrationId = 'channel_gmail'
const mailbox = 'owner@example.com'
const history = { historyId: '16201' }
const scope = { tenantId: randomUUID(), organizationId: randomUUID(), userId: randomUUID() }

function callbackRequest(error?: string) {
  const state = randomUUID()
  const cookie = encryptOAuthState({
    ...scope,
    state,
    nonce: randomUUID(),
    providerKey: provider,
    returnUrl: '/backend/profile/communication-channels',
    expiresAt: Date.now() + 60_000,
  })
  const url = new URL('https://app.example.com/api/communication_channels/oauth/gmail/callback')
  url.search = new URLSearchParams(error ? { error, state } : { code: 'test-code', state }).toString()
  return new Request(url, {
    headers: { cookie: `${COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(cookie)}` },
  })
}

async function reconnect(error?: string) {
  const response = await GET(callbackRequest(error), { params: { provider } })
  expect(response.status).toBe(302)
  return new URL(response.headers.get('location') ?? '').searchParams
}

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('Gmail OAuth reconnect against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver>
  let em: EntityManager

  beforeAll(async () => {
    jest.replaceProperty(process, 'env', { ...process.env, OM_HUB_OAUTH_STATE_KEY: randomUUID() })
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: 'channels', POSTGRES_USER: 'channels', POSTGRES_PASSWORD: 'channels' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      entities: [CommunicationChannel, ExternalConversation, ExternalMessage, IntegrationCredentials],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'channels', user: 'channels', password: 'channels',
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    jest.restoreAllMocks()
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  beforeEach(() => {
    jest.resetAllMocks()
    em = orm.em.fork()
    mockGetAuth.mockResolvedValue({ sub: scope.userId, tenantId: scope.tenantId })
    mockExchange.mockResolvedValue({ credentials: { access_token: 'test-token' }, externalIdentifier: mailbox })
    mockSaveCredentials.mockResolvedValue(undefined)
    const usedState = new Set<string>()
    const services = new Map<string, unknown>([
      ['em', em],
      ['cache', { has: async (key: string) => usedState.has(key), set: async (key: string) => { usedState.add(key) } }],
      ['integrationCredentialsService', {
        resolve: async () => ({ clientId: 'test-client', clientSecret: 'test-secret' }),
        save: mockSaveCredentials,
      }],
    ])
    mockResolve.mockImplementation((key: string) => services.get(key))
  })

  afterEach(async () => {
    await orm?.schema.clear()
  })

  function legacyChannel(overrides: Partial<CommunicationChannel> = {}) {
    return em.create(CommunicationChannel, {
      ...scope,
      providerKey: provider,
      channelType: 'email',
      displayName: 'Legacy Gmail',
      externalIdentifier: null,
      credentialsRef: randomUUID(),
      channelState: history,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      ...overrides,
    })
  }

  function readChannels() {
    return findWithDecryption(em.fork({ clear: true }), CommunicationChannel, {}, { orderBy: { id: 'asc' } })
  }

  it('preserves the original ID and email history, retires only owned duplicates, and reconnects again in place', async () => {
    const original = legacyChannel({ isActive: false, status: 'requires_reauth' })
    const duplicate = legacyChannel({
      createdAt: new Date('2026-01-01T00:00:00Z'), isPrimary: true, status: 'requires_reauth',
    })
    const later = new Date('2026-01-03T00:00:00Z')
    const foreignScopes = [
      { ...scope, organizationId: randomUUID() },
      { ...scope, userId: randomUUID() },
      { ...scope, tenantId: randomUUID() },
    ]
    const foreignChannels = foreignScopes.map((foreignScope) => legacyChannel({ ...foreignScope, createdAt: later }))
    const credentials = em.create(IntegrationCredentials, { ...scope, integrationId, credentials: {} })
    for (const foreignScope of foreignScopes) {
      em.create(IntegrationCredentials, { ...foreignScope, integrationId, credentials: {} })
    }
    await em.flush()
    const conversation = em.create(ExternalConversation, {
      ...scope, channelId: original.id, externalConversationId: 'existing-thread',
    })
    await em.flush()
    const message = em.create(ExternalMessage, {
      ...scope, channelId: original.id, conversationId: conversation.id,
      externalMessageId: 'existing-email', direction: 'inbound',
    })
    await em.flush()
    const foreignIds = foreignChannels.map(({ id }) => id)
    const foreignBefore = (await readChannels()).filter(({ id }) => foreignIds.includes(id))

    const first = await reconnect()
    expect(first.get('oauth')).toBe('connected')
    expect(first.get('channelId')).toBe(original.id)
    const firstRows = await readChannels()
    expect(firstRows).toHaveLength(5)
    const connected = {
      ...scope, externalIdentifier: mailbox, credentialsRef: credentials.id, channelState: history,
      isActive: true, isPrimary: true, status: 'connected',
    }
    expect(firstRows.find(({ id }) => id === original.id)).toMatchObject(connected)
    expect(firstRows.find(({ id }) => id === duplicate.id)).toMatchObject({
      isActive: false, isPrimary: false, status: 'disconnected', lastError: 'superseded_by_reconnect',
    })
    expect(firstRows.filter(({ id }) => foreignIds.includes(id))).toEqual(foreignBefore)

    const second = await reconnect()
    expect(second.get('oauth')).toBe('connected')
    expect(second.get('channelId')).toBe(original.id)
    expect(mockSaveCredentials).toHaveBeenCalledTimes(2)
    expect(mockSaveCredentials).toHaveBeenLastCalledWith(integrationId, expect.objectContaining({ userId: scope.userId }), scope)
    const finalRows = await readChannels()
    expect(finalRows.find(({ id }) => id === original.id)).toMatchObject(connected)
    expect(finalRows.filter(({ id }) => id !== original.id)).toEqual(firstRows.filter(({ id }) => id !== original.id))
    expect(await findOneWithDecryption(em.fork(), ExternalMessage, { id: message.id })).toMatchObject({
      channelId: original.id, conversationId: conversation.id, externalMessageId: 'existing-email',
    })
    expect(await findOneWithDecryption(em.fork(), ExternalConversation, { id: conversation.id })).toMatchObject({
      channelId: original.id, externalConversationId: 'existing-thread',
    })
  })

  it.each(['save rejected', 'credential row missing'])('leaves persisted channels unchanged when %s', async (failure) => {
    const original = legacyChannel({ isPrimary: true })
    legacyChannel({ createdAt: new Date('2026-01-01T00:00:00Z') })
    if (failure === 'save rejected') {
      mockSaveCredentials.mockRejectedValueOnce(new Error('[internal] Test credential save failed'))
      em.create(IntegrationCredentials, { ...scope, integrationId, credentials: {} })
    }
    await em.flush()
    const before = await readChannels()

    const result = await reconnect()

    expect(result.get('channelId')).toBe(original.id)
    expect(mockSaveCredentials).toHaveBeenCalledTimes(1)
    expect(await readChannels()).toEqual(before)
  })

  it.each([
    { error: 'access_denied', session: {}, resultCode: 'access_denied' },
    { session: { sub: randomUUID() }, resultCode: 'user_mismatch' },
    { session: { tenantId: randomUUID() }, resultCode: 'tenant_mismatch' },
  ])('leaves persisted channels unchanged for $resultCode', async ({ error, session, resultCode }) => {
    legacyChannel({ isPrimary: true })
    await em.flush()
    const before = await readChannels()
    mockGetAuth.mockResolvedValue({ sub: scope.userId, tenantId: scope.tenantId, ...session })

    const result = await reconnect(error)

    expect(result.get('oauth')).toBe('error')
    expect(result.get('code')).toBe(resultCode)
    expect(mockExchange).not.toHaveBeenCalled()
    expect(mockSaveCredentials).not.toHaveBeenCalled()
    expect(await readChannels()).toEqual(before)
  })
})
