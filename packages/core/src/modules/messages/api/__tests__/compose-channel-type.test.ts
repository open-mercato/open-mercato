const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const messageId = '44444444-4444-4444-8444-444444444444'
const conversationId = '66666666-6666-4666-8666-666666666666'

const em = { fork: jest.fn(), find: jest.fn(), findOne: jest.fn() }
const commandBusExecuteMock = jest.fn()
const resolveChannelTypeMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return { execute: (...args: unknown[]) => commandBusExecuteMock(...args) }
    if (name === 'communicationChannelsResolveChannelType') return resolveChannelTypeMock
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

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
