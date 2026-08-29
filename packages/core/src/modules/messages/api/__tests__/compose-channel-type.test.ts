const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const messageId = '44444444-4444-4444-8444-444444444444'
const conversationId = '66666666-6666-4666-8666-666666666666'

const em = { fork: jest.fn(), find: jest.fn(), findOne: jest.fn() }
const commandBusExecuteMock = jest.fn()
const resolveChannelTypeMock = jest.fn()
const resolveChannelThreadAccessMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return { execute: (...args: unknown[]) => commandBusExecuteMock(...args) }
    if (name === 'communicationChannelsResolveChannelType') return resolveChannelTypeMock
    if (name === 'communicationChannelsResolveChannelThreadAccess') return resolveChannelThreadAccessMock
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const CHANNEL_THREAD_ID = '55555555-5555-4555-8555-555555555555'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
    features: ['messages.compose', 'messages.view', 'messages.email'],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown) =>
    emInstance.find(entity, filters),
  findOneWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown) =>
    emInstance.findOne(entity, filters),
}))

jest.mock('../guards', () => ({
  resolveUserFeatures: jest.fn(() => ['*']),
  runMessageMutationGuards: jest.fn(async () => ({ ok: true, afterSuccessCallbacks: [] })),
  runMessageMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('../../lib/routeHelpers', () => {
  const actual = jest.requireActual('../../lib/routeHelpers')
  return { ...actual, canUseMessageEmailFeature: jest.fn(async () => true) }
})

import { POST as composeMessage } from '../route'

function publicComposeBody(extra: Record<string, unknown> = {}) {
  return {
    visibility: 'public',
    sourceEntityType: 'communication_channels.external_conversation',
    sourceEntityId: conversationId,
    subject: 'Re: hello',
    body: 'Answering on the guild channel',
    recipients: [],
    ...extra,
  }
}

function composeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function composeInput(): Record<string, unknown> {
  const call = commandBusExecuteMock.mock.calls.find(
    (args: unknown[]) => args[0] === 'messages.messages.compose',
  )
  return (call as any[])[1].input as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
  em.fork.mockReturnValue(em)
  em.find.mockResolvedValue([])
  em.findOne.mockResolvedValue(null)
  // #5535: a public compose naming a channel conversation is attached to that
  // conversation's existing thread, so the default fixture resolves one.
  resolveChannelThreadAccessMock.mockResolvedValue({
    messageThreadId: CHANNEL_THREAD_ID,
    externalConversationId: conversationId,
    channelId: '77777777-7777-4777-8777-777777777777',
    channelType: 'discord',
    canAccess: true,
  })
  commandBusExecuteMock.mockImplementation(async () => ({
    result: { id: messageId, threadId: 'thread-1' },
    logEntry: null,
  }))
})

describe('POST /api/messages — source channel type resolution (#4975)', () => {
  it('composes without an external email when the conversation is a non-email channel', async () => {
    resolveChannelTypeMock.mockResolvedValue('discord')

    const response = await composeMessage(composeRequest(publicComposeBody()))

    expect(response.status).toBe(201)
    expect(composeInput().sourceChannelType).toBe('discord')
    expect(resolveChannelTypeMock).toHaveBeenCalledWith(
      container,
      { tenantId, organizationId },
      { externalConversationId: conversationId, messageId: null },
    )
  })

  it('ignores a client-supplied channel type', async () => {
    // Otherwise any caller could waive the externalEmail requirement simply by
    // claiming the message came from a chat channel.
    resolveChannelTypeMock.mockResolvedValue(null)

    await expect(
      composeMessage(composeRequest(publicComposeBody({ sourceChannelType: 'discord' }))),
    ).rejects.toThrow()
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('does not let a client-supplied type override the resolved one', async () => {
    resolveChannelTypeMock.mockResolvedValue('email')

    await expect(
      composeMessage(composeRequest(publicComposeBody({ sourceChannelType: 'discord' }))),
    ).rejects.toThrow()
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('keeps requiring an external email when the source resolves to an email channel', async () => {
    resolveChannelTypeMock.mockResolvedValue('email')

    await expect(composeMessage(composeRequest(publicComposeBody()))).rejects.toThrow()

    resolveChannelTypeMock.mockResolvedValue('email')
    const response = await composeMessage(
      composeRequest(publicComposeBody({ externalEmail: 'jane@example.com' })),
    )
    expect(response.status).toBe(201)
  })

  it('fails closed when the source cannot be resolved to a channel', async () => {
    resolveChannelTypeMock.mockResolvedValue(null)

    await expect(composeMessage(composeRequest(publicComposeBody()))).rejects.toThrow()
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('resolves through the parent message when that is the only channel-ish hint', async () => {
    // The mirror of the conversation hop, and the one the route actually reads
    // off an untrusted body for every threaded reply.
    resolveChannelTypeMock.mockResolvedValue('discord')

    const response = await composeMessage(
      composeRequest({
        visibility: 'public',
        parentMessageId: messageId,
        subject: 'Re: hello',
        body: 'Answering in-thread',
        recipients: [],
      }),
    )

    expect(response.status).toBe(201)
    expect(resolveChannelTypeMock).toHaveBeenCalledWith(
      container,
      { tenantId, organizationId },
      { externalConversationId: null, messageId },
    )
    expect(composeInput().sourceChannelType).toBe('discord')
  })

  it('does not attempt resolution for a message with no channel-ish source', async () => {
    const response = await composeMessage(
      composeRequest({
        visibility: 'internal',
        subject: 'Internal note',
        body: 'For the team',
        recipients: [{ userId, type: 'to' }],
      }),
    )

    expect(response.status).toBe(201)
    expect(resolveChannelTypeMock).not.toHaveBeenCalled()
    expect(composeInput().sourceChannelType).toBeUndefined()
  })
})

describe('POST /api/messages — the channel-type lookup stays off the compose hot path', () => {
  // `sourceChannelType` is consulted by exactly one validator branch. Every
  // compose below carries a channel-ish hint and would have paid for a DI
  // resolve plus a `MessageChannelLink` query whose answer nothing could read.
  it('skips resolution for an internal threaded reply', async () => {
    const response = await composeMessage(
      composeRequest({
        visibility: 'internal',
        parentMessageId: messageId,
        subject: 'Re: internal',
        body: 'For the team',
        recipients: [{ userId, type: 'to' }],
      }),
    )

    expect(response.status).toBe(201)
    expect(resolveChannelTypeMock).not.toHaveBeenCalled()
  })

  it('skips resolution for a public compose that already supplies an address', async () => {
    const response = await composeMessage(
      composeRequest(publicComposeBody({ externalEmail: 'jane@example.com' })),
    )

    expect(response.status).toBe(201)
    expect(resolveChannelTypeMock).not.toHaveBeenCalled()
  })

  it('skips resolution for a draft', async () => {
    const response = await composeMessage(composeRequest(publicComposeBody({ isDraft: true })))

    expect(response.status).toBe(201)
    expect(resolveChannelTypeMock).not.toHaveBeenCalled()
  })

  it('still resolves — and still fails closed — for a public compose with no address', async () => {
    // The skip must not become a waiver: the one branch that reads the answer
    // keeps getting it, and an unresolvable source keeps the pre-#4975 rule.
    resolveChannelTypeMock.mockResolvedValue(null)

    await expect(composeMessage(composeRequest(publicComposeBody()))).rejects.toThrow()
    expect(resolveChannelTypeMock).toHaveBeenCalledTimes(1)
  })
})

// #5535 — composing on a channel conversation used to open a brand-new thread:
// 201, no ChannelThreadMapping, no outbound link, and nothing ever delivered.
// A success response for a message that never leaves the building is worse than
// a refusal, so the route now either threads the message onto the conversation
// or says why it cannot.
describe('POST /api/messages — channel conversation deliverability (#5535)', () => {
  it('threads a public compose onto the conversation existing thread', async () => {
    resolveChannelTypeMock.mockResolvedValue('discord')

    const response = await composeMessage(composeRequest(publicComposeBody()))

    expect(response.status).toBe(201)
    expect(resolveChannelThreadAccessMock).toHaveBeenCalledWith(
      container,
      { tenantId, organizationId },
      { externalConversationId: conversationId },
      { userId, features: ['*'] },
    )
    expect(composeInput().parentMessageId).toBe(CHANNEL_THREAD_ID)
  })

  it('refuses with 409 when the conversation has no channel thread to deliver into', async () => {
    resolveChannelTypeMock.mockResolvedValue('discord')
    resolveChannelThreadAccessMock.mockResolvedValue(null)

    const response = await composeMessage(composeRequest(publicComposeBody()))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Conversation has no channel thread to deliver into',
    })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('refuses with 403 when the caller may not act on the channel behind the thread', async () => {
    resolveChannelTypeMock.mockResolvedValue('email')
    resolveChannelThreadAccessMock.mockResolvedValue({
      messageThreadId: CHANNEL_THREAD_ID,
      externalConversationId: conversationId,
      channelId: '77777777-7777-4777-8777-777777777777',
      channelType: 'email',
      canAccess: false,
    })

    const response = await composeMessage(
      composeRequest(publicComposeBody({ externalEmail: 'jane@example.com' })),
    )

    expect(response.status).toBe(403)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('leaves a caller-supplied parent message alone', async () => {
    resolveChannelTypeMock.mockResolvedValue('discord')

    const response = await composeMessage(
      composeRequest(publicComposeBody({ parentMessageId: messageId })),
    )

    expect(response.status).toBe(201)
    expect(resolveChannelThreadAccessMock).not.toHaveBeenCalled()
    expect(composeInput().parentMessageId).toBe(messageId)
  })

  it('leaves drafts and internal notes on the conversation untouched', async () => {
    const draft = await composeMessage(composeRequest(publicComposeBody({ isDraft: true })))
    expect(draft.status).toBe(201)

    const internalNote = await composeMessage(
      composeRequest({
        visibility: 'internal',
        sourceEntityType: 'communication_channels.external_conversation',
        sourceEntityId: conversationId,
        subject: 'Note to the team',
        body: 'Handled by phone',
        recipients: [{ userId, type: 'to' }],
      }),
    )
    expect(internalNote.status).toBe(201)
    expect(resolveChannelThreadAccessMock).not.toHaveBeenCalled()
  })
})
