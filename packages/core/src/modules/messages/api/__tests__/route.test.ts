const resolveMessageContextMock = jest.fn()
const canUseMessageEmailFeatureMock = jest.fn(async () => true)
const isCrudCacheEnabledMock = jest.fn(() => false)
const findWithDecryptionMock = jest.fn()
const canUseChannelThreadFallbackMock = jest.fn(async () => true)
const resolveMessageChannelThreadAccessMock = jest.fn()
const delegateComposeToSenderMock = jest.fn()
const resolveReplyParentMessageMock = jest.fn()
const canPostToChannelThreadMock = jest.fn(async () => true)

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async <T>(_tenantId: string | null, callback: () => Promise<T> | T) => callback(),
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
  canUseChannelThreadFallback: (...args: unknown[]) => canUseChannelThreadFallbackMock(...args),
  canPostToChannelThread: (...args: unknown[]) => canPostToChannelThreadMock(...args),
  resolveReplyParentMessage: (...args: unknown[]) => resolveReplyParentMessageMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/channelThreadAccess', () => ({
  ...jest.requireActual('@open-mercato/core/modules/messages/lib/channelThreadAccess'),
  resolveMessageChannelThreadAccess: (...args: unknown[]) => resolveMessageChannelThreadAccessMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/composeSenderDelegation', () => ({
  ...jest.requireActual('@open-mercato/core/modules/messages/lib/composeSenderDelegation'),
  delegateComposeToSender: (...args: unknown[]) => delegateComposeToSenderMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
    t: (_key: string, fallback: string) => fallback,
  }),
}))

import { GET, POST } from '@open-mercato/core/modules/messages/api/route'
import { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE } from '@open-mercato/core/modules/messages/lib/channelThreadAccess'

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

function createEmMock() {
  let messagesQueryCount = 0
  const db = {
    selectFrom: jest.fn((table: string) => {
      if (table === 'messages as m') {
        messagesQueryCount += 1
        return messagesQueryCount === 1
          ? createQueryBuilder([], { count: '1' })
          : createQueryBuilder([{
              id: messageId,
              sender_user_id: userId,
              is_draft: false,
              recipient_status: 'unread',
              read_at: null,
            }])
      }
      return createQueryBuilder([])
    }),
  }
  return {
    getKysely: jest.fn(() => db),
    find: jest.fn(async () => []),
    db,
  }
}

function mockListContext(options: {
  cache?: CacheMock
  em?: ReturnType<typeof createEmMock>
  scope?: Partial<{ tenantId: string; organizationId: string | null; userId: string }>
} = {}) {
  const em = options.em ?? createEmMock()
  const cache = options.cache
  const scope = {
    tenantId,
    organizationId,
    userId,
    ...options.scope,
  }
  resolveMessageContextMock.mockResolvedValueOnce({
    ctx: {
      auth: { orgId: scope.organizationId },
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'cache') return cache
          return null
        },
      },
    },
    scope,
  })
  return { em, cache }
}

function mockMessageRows(actionData: unknown = null) {
  findWithDecryptionMock.mockImplementation(async (_em, entity) => {
    if (entity?.name === 'Message') {
      return [{
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
        actionData,
        actionTaken: null,
        sentAt: new Date('2026-06-18T06:00:00.000Z'),
        threadId: messageId,
      }]
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

  it('threads a delegated mailbox send onto the conversation thread the server resolved', async () => {
    const conversationId = '0f3c2a9e-6f0e-4d0a-9a5c-2f8c6d1b7e41'
    const senderChannelId = '22222222-2222-4222-8222-222222222222'
    const resolvedThreadId = '9d4c1e5b-3a7f-4c28-b6d1-8e2f0a7c5b13'
    resolveMessageChannelThreadAccessMock.mockResolvedValue({
      messageThreadId: resolvedThreadId,
      canAccess: true,
    })
    delegateComposeToSenderMock.mockResolvedValue({
      ok: true,
      messageId,
      threadId: resolvedThreadId,
    })

    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        type: 'default',
        visibility: 'public',
        externalEmail: 'client@example.com',
        subject: 'Re: Quote',
        body: 'Body',
        senderChannelId,
        sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
        sourceEntityId: conversationId,
      }),
    }))

    expect(response.status).toBe(201)
    expect(delegateComposeToSenderMock).toHaveBeenCalledTimes(1)
    expect(delegateComposeToSenderMock.mock.calls[0][2]).toMatchObject({
      senderChannelId,
      parentMessageId: resolvedThreadId,
    })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})

describe('messages /api/messages GET hasActions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isCrudCacheEnabledMock.mockReturnValue(false)
  })

  it('reports hasActions true when actionData round-trips as an encrypted JSON string', async () => {
    mockMessageRows(JSON.stringify({ actions: [{ id: 'approve', label: 'Approve' }] }))
    mockListContext()

    const response = await GET(new Request('http://localhost/api/messages?folder=inbox'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items[0].hasActions).toBe(true)
  })

  it('reports hasActions false when actionData has no actions', async () => {
    mockMessageRows(null)
    mockListContext()

    const response = await GET(new Request('http://localhost/api/messages?folder=inbox'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items[0].hasActions).toBe(false)
  })
})

describe('messages /api/messages GET cache', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isCrudCacheEnabledMock.mockReturnValue(false)
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

  it('serves an identical second request from cache', async () => {
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

  it('partitions cache keys by tenant, organization, and user', async () => {
    isCrudCacheEnabledMock.mockReturnValue(true)
    const cache = createCacheMock()
    mockListContext({ cache })
    mockListContext({ cache, scope: { userId: otherUserId } })
    mockListContext({ cache, scope: { organizationId: null } })

    await GET(new Request('http://localhost/api/messages?folder=inbox'))
    await GET(new Request('http://localhost/api/messages?folder=inbox'))
    await GET(new Request('http://localhost/api/messages?folder=inbox'))

    const keys = cache.set.mock.calls.map(([key]) => key as string)
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toContain(`tenant:${tenantId}`)
    expect(keys[0]).toContain(`org:${organizationId}`)
    expect(keys[0]).toContain(`user:${userId}`)
    expect(keys[1]).toContain(`user:${otherUserId}`)
    expect(keys[2]).toContain('org:null')
  })

  it('stores the existing message collection tag with a 30-second backstop', async () => {
    isCrudCacheEnabledMock.mockReturnValue(true)
    const cache = createCacheMock()
    mockListContext({ cache })

    await GET(new Request('http://localhost/api/messages?folder=inbox'))

    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ items: expect.any(Array) }),
      {
        ttl: 30_000,
        tags: [`crud:messages.message:tenant:${tenantId}:org:${organizationId}:collection`],
      },
    )
  })

  it('returns a valid cached payload without resolving the database', async () => {
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
        container: {
          resolve: (name: string) => {
            if (name === 'cache') return cache
            if (name === 'em') throw new Error('database should not be resolved on a cache hit')
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

describe('messages /api/messages POST reply parent', () => {
  const parentMessageId = '3f9a6c2e-1d4b-4e8a-9c7f-5b2d8e1a6c40'
  const parentThreadId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  let commandBus: { execute: jest.Mock }

  function composeRequest(extra: Record<string, unknown>) {
    return new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        type: 'default',
        recipients: [{ userId: otherUserId, type: 'to' }],
        subject: 'Re: Subject',
        body: 'Body',
        parentMessageId,
        ...extra,
      }),
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    commandBus = {
      execute: jest.fn(async () => ({
        result: { id: messageId, threadId: parentThreadId, externalEmail: null, recipientUserIds: [otherUserId] },
      })),
    }
    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        auth: { orgId: organizationId },
        container: { resolve: (name: string) => (name === 'commandBus' ? commandBus : null) },
      },
      scope: { tenantId, organizationId, userId },
    })
    canPostToChannelThreadMock.mockResolvedValue(true)
  })

  it('resolves the parent the client sent in the caller scope before composing', async () => {
    resolveReplyParentMessageMock.mockResolvedValue({
      status: 'readable',
      message: { id: parentMessageId, threadId: parentThreadId },
    })

    const response = await POST(composeRequest({}))

    expect(response.status).toBe(201)
    expect(resolveReplyParentMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId, organizationId, userId },
      parentMessageId,
    )
    expect(commandBus.execute.mock.calls[0][1].input.parentMessageId).toBe(parentMessageId)
  })

  it.each([
    ['an internal message', {}],
    ['a draft', { isDraft: true }],
  ])('refuses a parent the caller cannot read on %s, writing nothing', async (_label, extra) => {
    resolveReplyParentMessageMock.mockResolvedValue({ status: 'forbidden' })

    const response = await POST(composeRequest(extra))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Access denied' })
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(delegateComposeToSenderMock).not.toHaveBeenCalled()
  })

  it('answers an unknown, deleted or out-of-scope parent with 404, writing nothing', async () => {
    resolveReplyParentMessageMock.mockResolvedValue({ status: 'not_found' })

    const response = await POST(composeRequest({}))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'The message you are replying to was not found' })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('refuses before delegating a mailbox send onto an unreadable parent', async () => {
    resolveReplyParentMessageMock.mockResolvedValue({ status: 'forbidden' })

    const response = await POST(composeRequest({
      visibility: 'public',
      recipients: [],
      externalEmail: 'client@example.com',
      senderChannelId: '22222222-2222-4222-8222-222222222222',
    }))

    expect(response.status).toBe(403)
    expect(delegateComposeToSenderMock).not.toHaveBeenCalled()
    expect(canPostToChannelThreadMock).not.toHaveBeenCalled()
  })

  it('applies the channel posting gate to the thread of the parent it resolved', async () => {
    resolveReplyParentMessageMock.mockResolvedValue({
      status: 'readable',
      message: { id: parentMessageId, threadId: parentThreadId },
    })
    canPostToChannelThreadMock.mockResolvedValue(false)

    const response = await POST(composeRequest({
      visibility: 'public',
      recipients: [],
      externalEmail: 'client@example.com',
    }))

    expect(response.status).toBe(403)
    expect(canPostToChannelThreadMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), parentThreadId)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('does not resolve anything when no parent is named', async () => {
    const response = await POST(composeRequest({ parentMessageId: undefined }))

    expect(response.status).toBe(201)
    expect(resolveReplyParentMessageMock).not.toHaveBeenCalled()
  })
})
