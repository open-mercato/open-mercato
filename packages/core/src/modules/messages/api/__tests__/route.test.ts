const resolveMessageContextMock = jest.fn()
const canUseMessageEmailFeatureMock = jest.fn(async () => true)
const findWithDecryptionMock = jest.fn()
const findMessageIdsBySearchTokensMock = jest.fn()
let mockCrudOptions: Record<string, any> | null = null
const mockCrudGet = jest.fn(async () => Response.json({ ok: true }))

jest.mock('@open-mercato/shared/lib/crud/factory', () => {
  return {
    makeCrudRoute: jest.fn((opts: Record<string, any>) => {
      mockCrudOptions = opts
      return {
        GET: mockCrudGet,
        POST: jest.fn(),
        PUT: jest.fn(),
        DELETE: jest.fn(),
      }
    }),
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
const messageId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

function createQueryBuilder(result: unknown, takeFirstResult?: unknown) {
  const builder: Record<string, jest.Mock> = {}
  const chain = jest.fn(() => builder)
  const joinBuilder = {
    onRef: jest.fn(() => joinBuilder),
    on: jest.fn(() => joinBuilder),
  }
  const expressionBuilder = {
    or: jest.fn((value) => value),
    exists: jest.fn((value) => value),
    not: jest.fn((value) => value),
    selectFrom: jest.fn(() => builder),
  }
  Object.assign(builder, {
    select: chain,
    where: jest.fn((arg: unknown) => {
      if (typeof arg === 'function') arg(expressionBuilder)
      return builder
    }),
    whereRef: chain,
    leftJoin: jest.fn((_table: string, callback?: (jb: typeof joinBuilder) => unknown) => {
      if (callback) callback(joinBuilder)
      return builder
    }),
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
  const selectFrom = jest.fn((table: string) => {
    if (table === 'messages as m') {
      return createQueryBuilder([{ id: messageId }])
    }
    if (table === 'message_recipients') {
      return createQueryBuilder([
        {
          id: messageId,
          recipient_status: 'unread',
          read_at: null,
        },
      ])
    }
    if (table === 'attachments') return createQueryBuilder([])
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

function getCrudOptions() {
  if (!mockCrudOptions) throw new Error('makeCrudRoute was not called')
  return mockCrudOptions
}

describe('messages /api/messages POST', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
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

describe('messages /api/messages GET crud route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findMessageIdsBySearchTokensMock.mockResolvedValue([])
  })

  it('delegates GET to the CRUD factory route', async () => {
    const response = await GET(new Request('http://localhost/api/messages?folder=inbox'))

    expect(response.status).toBe(200)
    expect(mockCrudGet).toHaveBeenCalledWith(expect.any(Request))
    const delegatedRequest = mockCrudGet.mock.calls[0][0] as Request
    const delegatedUrl = new URL(delegatedRequest.url)
    expect(delegatedUrl.searchParams.get('sortField')).toBe('sentAt')
    expect(delegatedUrl.searchParams.get('sortDir')).toBe('desc')
  })

  it('preserves explicit GET sort parameters', async () => {
    await GET(new Request('http://localhost/api/messages?folder=inbox&sortField=subject&sortDir=asc'))

    const delegatedRequest = mockCrudGet.mock.calls[0][0] as Request
    const delegatedUrl = new URL(delegatedRequest.url)
    expect(delegatedUrl.searchParams.get('sortField')).toBe('subject')
    expect(delegatedUrl.searchParams.get('sortDir')).toBe('asc')
  })

  it('uses makeCrudRoute with messages resource configuration', () => {
    const opts = getCrudOptions()

    expect(opts.metadata.GET).toEqual({ requireAuth: true })
    expect(opts.orm).toEqual(expect.objectContaining({
      idField: 'id',
      orgField: null,
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    }))
    expect(opts.events).toEqual({ module: 'messages', entity: 'message' })
    expect(opts.indexer).toEqual({ entityType: 'messages:message' })
    expect(opts.enrichers).toEqual({ entityId: 'messages.message' })
    expect(opts.list).toEqual(expect.objectContaining({
      schema: expect.any(Object),
      entityId: 'messages:message',
      buildFilters: expect.any(Function),
      transformItem: expect.any(Function),
    }))
  })

  it('builds the scoped message id filter before the CRUD factory list query', async () => {
    const em = createEmMock()
    const opts = getCrudOptions()
    const ctx = {
      auth: { tenantId, orgId: organizationId, sub: userId },
      selectedOrganizationId: organizationId,
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          return null
        },
      },
    }

    const filters = await opts.list.buildFilters(
      { folder: 'inbox', search: 'Subject', page: 1, pageSize: 20 },
      ctx,
    )

    expect(filters).toEqual({ id: { $in: [messageId] } })
    expect(findMessageIdsBySearchTokensMock).toHaveBeenCalledWith({
      em,
      query: 'Subject',
      tenantId,
      organizationId,
    })
    const messageQuery = em.db.selectFrom.mock.results[0]?.value
    expect(messageQuery.where).toHaveBeenCalledWith('m.tenant_id', '=', tenantId)
    expect(messageQuery.where).toHaveBeenCalledWith('m.organization_id', '=', organizationId)
    expect(messageQuery.where).toHaveBeenCalledWith('r.archived_at', 'is', null)
  })

  it('keeps the existing message list response shape through transform and afterList hooks', async () => {
    const em = createEmMock()
    em.find.mockResolvedValueOnce([
      { messageId, actionRequired: true, actionType: 'approve' },
    ])
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: userId, name: 'Sender User', email: 'sender@example.com' },
    ])
    const opts = getCrudOptions()
    const payload = {
      items: [
        opts.list.transformItem({
          id: messageId,
          type: 'default',
          sender_user_id: userId,
          subject: 'Subject',
          body: 'Message body',
          priority: 'normal',
          is_draft: false,
          sent_at: new Date('2026-06-18T06:00:00.000Z'),
          action_data: null,
          thread_id: messageId,
        }),
      ],
    }

    await opts.hooks.afterList(payload, {
      auth: { tenantId, orgId: organizationId, sub: userId },
      selectedOrganizationId: organizationId,
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          return null
        },
      },
    })

    expect(payload.items[0]).toEqual(expect.objectContaining({
      id: messageId,
      subject: 'Subject',
      bodyPreview: 'Message body',
      senderUserId: userId,
      senderName: 'Sender User',
      senderEmail: 'sender@example.com',
      status: 'unread',
      hasObjects: true,
      objectCount: 1,
      hasActions: true,
    }))
  })
})
