const resolveMessageContextMock = jest.fn()
const canUseMessageEmailFeatureMock = jest.fn(async () => true)
const isCrudCacheEnabledMock = jest.fn(() => false)
const findWithDecryptionMock = jest.fn()
const findMessageIdsBySearchTokensMock = jest.fn()

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async <T>(_tenantId: string | null, fn: () => Promise<T> | T) => fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    isCrudCacheEnabled: () => isCrudCacheEnabledMock(),
  }
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseMessageEmailFeature: (...args: unknown[]) => canUseMessageEmailFeatureMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/messages/lib/searchLookup', () => ({
  findMessageIdsBySearchTokens: (...args: unknown[]) => findMessageIdsBySearchTokensMock(...args),
}))

import { GET, POST } from '@open-mercato/core/modules/messages/api/route'

const tenantId = '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7'
const organizationId = '2045013f-8977-4f57-a1cc-9bb7d2f42a0e'
const userId = '5be8e4d6-14d2-4352-8f55-b95f95fd9205'
const otherUserId = 'ec52dcf7-e8aa-4f2c-8b0d-32725a2e89e1'
const messageId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

type CacheMock = {
  get: jest.Mock
  set: jest.Mock
}

function createCacheMock(): CacheMock {
  const store = new Map<string, unknown>()
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
  }
}

function createQueryBuilder(result: unknown, takeFirstResult?: unknown) {
  const builder: Record<string, jest.Mock> = {}
  const chain = jest.fn(() => builder)
  Object.assign(builder, {
    select: chain,
    where: chain,
    leftJoin: chain,
    orderBy: chain,
    offset: chain,
    limit: chain,
    groupBy: chain,
    execute: jest.fn(async () => result),
    executeTakeFirst: jest.fn(async () => takeFirstResult),
  })
  return builder
}

function createDbMock() {
  let messageQueryCount = 0
  const selectFrom = jest.fn((table: string) => {
    if (table === 'messages as m') {
      messageQueryCount += 1
      return messageQueryCount === 1
        ? createQueryBuilder([], { count: '1' })
        : createQueryBuilder([
          {
            id: messageId,
            sender_user_id: userId,
            is_draft: false,
            recipient_status: 'unread',
            read_at: null,
          },
        ])
    }
    if (table === 'attachments') return createQueryBuilder([])
    if (table === 'message_recipients') return createQueryBuilder([])
    return createQueryBuilder([])
  })

  return { selectFrom }
}

function createEmMock() {
  const db = createDbMock()
  return {
    getKysely: jest.fn(() => db),
    find: jest.fn(async () => []),
    db,
  }
}

function mockListContext(options: {
  cache?: CacheMock
  em?: ReturnType<typeof createEmMock>
  scope?: Partial<{ tenantId: string | null, organizationId: string | null, userId: string | null }>
} = {}) {
  const em = options.em ?? createEmMock()
  const cache = options.cache
  const scopeTenantId = Object.prototype.hasOwnProperty.call(options.scope ?? {}, 'tenantId')
    ? options.scope?.tenantId
    : tenantId
  const scopeOrganizationId = Object.prototype.hasOwnProperty.call(options.scope ?? {}, 'organizationId')
    ? options.scope?.organizationId
    : organizationId
  const scopeUserId = Object.prototype.hasOwnProperty.call(options.scope ?? {}, 'userId')
    ? options.scope?.userId
    : userId
  resolveMessageContextMock.mockResolvedValueOnce({
    ctx: {
      auth: { orgId: scopeOrganizationId },
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'cache') return cache
          return null
        },
      },
    },
    scope: {
      tenantId: scopeTenantId,
      organizationId: scopeOrganizationId,
      userId: scopeUserId,
    },
  })
  return { em, cache }
}

function mockMessageRows() {
  findWithDecryptionMock.mockImplementation(async (_em, entity) => {
    if (entity?.name === 'Message') {
      return [
        {
          id: messageId,
          body: 'Message body',
          type: 'default',
          visibility: 'internal',
          sourceEntityType: null,
          sourceEntityId: null,
          externalEmail: null,
          externalName: null,
          subject: 'Subject',
          senderUserId: userId,
          priority: 'normal',
          actionData: null,
          actionTaken: null,
          sentAt: new Date('2026-06-18T06:00:00.000Z'),
          threadId: messageId,
        },
      ]
    }
    if (entity?.name === 'User') {
      return [{ id: userId, name: 'Sender User', email: 'sender@example.com' }]
    }
    return []
  })
}

describe('messages /api/messages POST', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    isCrudCacheEnabledMock.mockReturnValue(false)
    findMessageIdsBySearchTokensMock.mockResolvedValue([])
    commandBus = {
      execute: jest.fn(async () => ({
        result: {
          id: messageId,
          threadId: messageId,
          externalEmail: null,
          recipientUserIds: [
            'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a',
            '2ce61514-c312-4a54-8ec0-cd9b70d7e76f',
          ],
        },
      })),
    }

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        auth: { orgId: organizationId },
        container: {
          resolve: (name: string) => {
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      },
      scope: {
        tenantId,
        organizationId,
        userId,
      },
    })
  })

  it('composes message via command bus when message is sent', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        type: 'default',
        recipients: [
          { userId: 'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a', type: 'to' },
          { userId: '2ce61514-c312-4a54-8ec0-cd9b70d7e76f', type: 'cc' },
        ],
        subject: 'Subject',
        body: 'Body',
      }),
    }))

    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.compose',
      expect.objectContaining({
        input: expect.objectContaining({
          subject: 'Subject',
          body: 'Body',
          sendViaEmail: false,
          tenantId: '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7',
          organizationId: '2045013f-8977-4f57-a1cc-9bb7d2f42a0e',
          userId: '5be8e4d6-14d2-4352-8f55-b95f95fd9205',
        }),
      }),
    )
  })

  it('passes draft compose input to command bus without route side effects', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        type: 'default',
        recipients: [
          { userId: 'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a', type: 'to' },
        ],
        subject: 'Subject',
        body: 'Body',
        isDraft: true,
      }),
    }))

    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
  })
})

describe('messages /api/messages GET cache', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isCrudCacheEnabledMock.mockReturnValue(false)
    findMessageIdsBySearchTokensMock.mockResolvedValue([])
    mockMessageRows()
  })

  it('does not use cache when the CRUD cache flag is off', async () => {
    const cache = createCacheMock()
    mockListContext({ cache })

    const response = await GET(new Request('http://localhost/api/messages?folder=inbox'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).toHaveBeenCalled()
  })

  it('serves the second identical GET from cache', async () => {
    isCrudCacheEnabledMock.mockReturnValue(true)
    const cache = createCacheMock()
    mockListContext({ cache })
    mockListContext({ cache })

    const first = await GET(new Request('http://localhost/api/messages?folder=inbox&page=1'))
    const second = await GET(new Request('http://localhost/api/messages?page=1&folder=inbox'))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(await first.json())
    expect(cache.get).toHaveBeenCalledTimes(2)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(2)
  })

  it('partitions cache keys by user and organization scope', async () => {
    isCrudCacheEnabledMock.mockReturnValue(true)
    const cache = createCacheMock()
    mockListContext({ cache, scope: { userId, organizationId } })
    mockListContext({ cache, scope: { userId: otherUserId, organizationId } })
    mockListContext({ cache, scope: { userId, organizationId: null } })

    await GET(new Request('http://localhost/api/messages?folder=inbox'))
    await GET(new Request('http://localhost/api/messages?folder=inbox'))
    await GET(new Request('http://localhost/api/messages?folder=inbox'))

    const keys = cache.set.mock.calls.map(([key]) => key as string)
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toContain(`user:${userId}`)
    expect(keys[1]).toContain(`user:${otherUserId}`)
    expect(keys[2]).toContain('org:null')
  })

  it('stores the messages collection tag with the cached payload', async () => {
    isCrudCacheEnabledMock.mockReturnValue(true)
    const cache = createCacheMock()
    mockListContext({ cache })

    await GET(new Request('http://localhost/api/messages?folder=inbox'))

    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ items: expect.any(Array) }),
      expect.objectContaining({
        ttl: 30_000,
        tags: expect.arrayContaining([
          `crud:messages.message:tenant:${tenantId}:org:${organizationId}:collection`,
        ]),
      }),
    )
  })

  it('returns a cached payload without running the heavy query path', async () => {
    isCrudCacheEnabledMock.mockReturnValue(true)
    const cachedPayload = {
      items: [{ id: messageId, subject: 'Cached subject' }],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    }
    const cache = {
      get: jest.fn(async () => cachedPayload),
      set: jest.fn(),
    }
    resolveMessageContextMock.mockResolvedValueOnce({
      ctx: {
        auth: { orgId: organizationId },
        container: {
          resolve: (name: string) => {
            if (name === 'cache') return cache
            if (name === 'em') throw new Error('heavy query path should not run')
            return null
          },
        },
      },
      scope: { tenantId, organizationId, userId },
    })

    const response = await GET(new Request('http://localhost/api/messages?folder=inbox'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(cachedPayload)
    expect(cache.set).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })
})
