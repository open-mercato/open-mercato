const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async <T>(_tenantId: string | null, callback: () => Promise<T> | T) => callback(),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  isCrudCacheEnabled: () => false,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  ...jest.requireActual('@open-mercato/core/modules/messages/lib/routeHelpers'),
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseMessageEmailFeature: jest.fn(async () => true),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string) => key,
    t: (key: string) => key,
  }),
}))

import { GET, POST } from '@open-mercato/core/modules/messages/api/route'
import { GET as GET_UNREAD } from '@open-mercato/core/modules/messages/api/unread-count/route'

const tenantId = '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7'
const organizationId = '2045013f-8977-4f57-a1cc-9bb7d2f42a0e'
const userId = '5be8e4d6-14d2-4352-8f55-b95f95fd9205'
const recipientId = 'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a'

type WhereCall = unknown[]

function createRecordingBuilder(calls: WhereCall[], result: unknown[] = [], first: unknown = { count: '0' }) {
  const builder: Record<string, jest.Mock> = {}
  const chain = jest.fn(() => builder)
  Object.assign(builder, {
    select: chain,
    leftJoin: chain,
    innerJoin: chain,
    orderBy: chain,
    offset: chain,
    limit: chain,
    groupBy: chain,
    where: jest.fn((...args: unknown[]) => {
      calls.push(args)
      return builder
    }),
    execute: jest.fn(async () => result),
    executeTakeFirst: jest.fn(async () => first),
  })
  return builder
}

function mockContext(options: { scheduler?: boolean; commandBus?: { execute: jest.Mock }; calls?: WhereCall[]; services?: Record<string, unknown> } = {}) {
  const calls = options.calls ?? []
  const em = {
    getKysely: () => ({ selectFrom: () => createRecordingBuilder(calls) }),
    find: jest.fn(async () => []),
  }
  resolveMessageContextMock.mockResolvedValue({
    ctx: {
      auth: { orgId: organizationId },
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'commandBus') return options.commandBus
          return options.services?.[name] ?? null
        },
        hasRegistration: (name: string) => name === 'schedulerService' && options.scheduler !== false,
      },
    },
    scope: { tenantId, organizationId, userId },
  })
  return { calls }
}

function inMinutes(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000)
  date.setUTCSeconds(0, 0)
  return date.toISOString()
}

function composeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/messages', {
    method: 'POST',
    body: JSON.stringify({
      recipients: [{ userId: recipientId, type: 'to' }],
      subject: 'Subject',
      body: 'Body',
      ...body,
    }),
  })
}

describe('POST /api/messages with scheduledAt', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    commandBus = { execute: jest.fn(async () => ({ result: { id: recipientId, threadId: null } })) }
  })

  it.each([
    ['in the past', inMinutes(-10), 'messages.errors.scheduleInPast'],
    ['beyond the max days', inMinutes(60 * 24 * 31), 'messages.errors.scheduleTooFar'],
    ['with seconds', new Date(Date.parse(inMinutes(30)) + 15_000).toISOString(), 'messages.errors.scheduleNotMinute'],
  ])('answers 400 for a schedule %s', async (_case, scheduledAt, errorKey) => {
    mockContext({ commandBus })
    const response = await POST(composeRequest({ scheduledAt }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.fieldErrors).toEqual({ scheduledAt: errorKey })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('honors OM_MESSAGES_SCHEDULE_MAX_DAYS at call time', async () => {
    mockContext({ commandBus })
    const previous = process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS
    process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS = '1'
    try {
      const response = await POST(composeRequest({ scheduledAt: inMinutes(60 * 30) }))
      expect(response.status).toBe(400)
    } finally {
      if (previous === undefined) delete process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS
      else process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS = previous
    }
  })

  it('refuses scheduledAt combined with an explicit draft', async () => {
    mockContext({ commandBus })
    const response = await POST(composeRequest({ scheduledAt: inMinutes(30), isDraft: true }))
    expect(response.status).toBe(400)
  })

  it('answers 422 when the scheduler module is not registered', async () => {
    mockContext({ commandBus, scheduler: false })
    const response = await POST(composeRequest({ scheduledAt: inMinutes(30) }))
    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('messages.errors.schedulingUnavailable')
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('composes a valid schedule through the command bus', async () => {
    mockContext({ commandBus })
    const scheduledAt = inMinutes(30)
    const response = await POST(composeRequest({ scheduledAt }))
    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.compose',
      expect.objectContaining({ input: expect.objectContaining({ scheduledAt: new Date(scheduledAt) }) }),
    )
  })
})

describe('POST /api/messages with scheduledAt and a mailbox sender', () => {
  const senderChannelId = 'c6a3f0d2-4b8e-4f61-9a7e-0d1f2e3a4b5c'
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    commandBus = { execute: jest.fn(async () => ({ result: { id: recipientId, threadId: null } })) }
  })

  function mailboxCompose(scheduledAt: string) {
    return composeRequest({
      recipients: [],
      visibility: 'public',
      externalEmail: 'client@example.com',
      senderChannelId,
      scheduledAt,
    })
  }

  it('checks the mailbox now and stores the schedule without sending through it', async () => {
    const validate = jest.fn(async () => ({ ok: true }))
    const sendAsUser = jest.fn()
    mockContext({
      commandBus,
      services: { communicationChannelsValidateSenderChannel: validate, communicationChannelsSendAsUser: sendAsUser },
    })

    const response = await POST(mailboxCompose(inMinutes(30)))

    expect(response.status).toBe(201)
    expect(validate).toHaveBeenCalledWith(expect.anything(), { userId, tenantId, organizationId }, senderChannelId)
    expect(sendAsUser).not.toHaveBeenCalled()
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.compose',
      expect.objectContaining({ input: expect.objectContaining({ senderChannelId, scheduledAt: expect.any(Date) }) }),
    )
  })

  it('refuses a mailbox that is not connected with the channel status', async () => {
    const validate = jest.fn(async () => ({ ok: false, status: 409, error: "Channel is in status 'syncing' (not connected)" }))
    mockContext({ commandBus, services: { communicationChannelsValidateSenderChannel: validate } })

    const response = await POST(mailboxCompose(inMinutes(30)))

    expect(response.status).toBe(409)
    expect((await response.json()).fieldErrors).toEqual({ senderChannelId: "Channel is in status 'syncing' (not connected)" })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})

describe('GET /api/messages folder filters for drafts and scheduled messages', () => {
  beforeEach(() => jest.clearAllMocks())

  async function whereCallsFor(folder: string): Promise<WhereCall[]> {
    const { calls } = mockContext()
    const response = await GET(new Request(`http://localhost/api/messages?folder=${folder}`))
    expect(response.status).toBe(200)
    return calls
  }

  it('excludes scheduled messages from drafts', async () => {
    const calls = await whereCallsFor('drafts')
    expect(calls).toContainEqual(['m.is_draft', '=', true])
    expect(calls).toContainEqual(['m.status', 'not in', ['scheduled', 'releasing']])
  })

  it('lists only the sender\'s scheduled messages in the scheduled folder', async () => {
    const calls = await whereCallsFor('scheduled')
    expect(calls).toContainEqual(['m.sender_user_id', '=', userId])
    expect(calls).toContainEqual(['m.status', 'in', ['scheduled', 'releasing']])
  })

  it.each(['archived', 'all', 'inbox', 'sent'])('hides drafts and scheduled messages from %s', async (folder) => {
    const calls = await whereCallsFor(folder)
    expect(calls).toContainEqual(['m.is_draft', '=', false])
  })
})

describe('GET /api/messages/unread-count', () => {
  it('never counts drafts or scheduled messages', async () => {
    const { calls } = mockContext()
    const response = await GET_UNREAD(new Request('http://localhost/api/messages/unread-count'))
    expect(response.status).toBe(200)
    expect(calls).toContainEqual(['m.is_draft', '=', false])
  })
})
