/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockCommandExecute = jest.fn()
const mockNormalizeInbound = jest.fn()
const mockLoadAcl = jest.fn()
const mockRawSql = jest.fn()

const mockEm = {
  fork: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  getConnection: jest.fn(() => ({ execute: mockRawSql })),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { loadAcl: mockLoadAcl }
    if (token === 'commandBus') return { execute: (...args: unknown[]) => mockCommandExecute(...args) }
    if (token === 'channelAdapterRegistry') {
      return { get: () => ({ normalizeInbound: mockNormalizeInbound }) }
    }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../../../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn(async () => undefined),
}))

jest.mock('../../../../lib/test-seed', () => ({
  TEST_SEED_PROVIDER_KEY: '__test_seed__',
  TEST_SEED_CHAT_PROVIDER_KEY: '__test_seed_chat__',
  ensureTestSeedAdapterRegistered: jest.fn(),
  isTestChannelSeedingEnabled: () => true,
}))

import { POST } from '../route'

const CALLER_USER = 'caller-user-id'
const CALLER_TENANT = '11111111-1111-4111-8111-111111111111'
const CALLER_ORG = '22222222-2222-4222-8222-222222222222'
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333'

function ingestRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/communication_channels/test-seed', {
    method: 'POST',
    body: JSON.stringify({
      action: 'ingest-inbound',
      channelId: CHANNEL_ID,
      senderIdentifier: '1499156851487539260',
      senderDisplayName: 'Karol Kapsa',
      body: 'hello from a guild channel',
      externalMessageId: 'chat-message-1',
      externalConversationId: 'chat-conversation-1',
      ...overrides,
    }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.fork.mockReturnValue(mockEm)
  mockCreateRequestContainer.mockResolvedValue(mockContainer)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: CALLER_USER,
    tenantId: CALLER_TENANT,
    orgId: CALLER_ORG,
  })
  mockLoadAcl.mockResolvedValue({
    isSuperAdmin: false,
    features: ['communication_channels.connect_user_channel'],
    organizations: null,
  })
  mockFindOneWithDecryption.mockResolvedValue({
    id: CHANNEL_ID,
    userId: CALLER_USER,
    providerKey: '__test_seed_chat__',
    channelType: 'discord',
    // A real chat channel carries no email-derived identifier (#4977).
    externalIdentifier: null,
  })
  mockNormalizeInbound.mockImplementation(async (raw: { raw: Record<string, unknown> }) => ({
    externalMessageId: raw.raw.externalMessageId,
    externalConversationId: raw.raw.externalConversationId,
    senderIdentifier: raw.raw.senderIdentifier,
    senderDisplayName: raw.raw.senderDisplayName,
    body: raw.raw.body,
    bodyFormat: 'text',
    timestamp: new Date(),
    channelPayload: {},
    channelContentType: 'text/plain',
    channelMetadata: {},
  }))
  mockCommandExecute.mockResolvedValue({
    result: {
      status: 'created',
      messageId: 'message-1',
      externalConversationId: 'conversation-1',
      channelLinkId: 'link-1',
    },
  })
})

describe('POST /api/communication_channels/test-seed — ingest-inbound (#4975)', () => {
  it('drives the real ingest command instead of seeding rows behind it', async () => {
    const response = await POST(ingestRequest())

    expect(response.status).toBe(201)
    expect(mockNormalizeInbound).toHaveBeenCalledTimes(1)
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'communication_channels.message.ingest_inbound',
      expect.anything(),
    )
    // No SQL shortcut: the platform message must come from the compose command.
    expect(mockRawSql).not.toHaveBeenCalled()
  })

  it('passes the channel row type through, so the hub applies the right identity contract', async () => {
    await POST(ingestRequest())

    const ingestInput = mockCommandExecute.mock.calls[0][1].input
    expect(ingestInput.channelType).toBe('discord')
    expect(ingestInput.providerKey).toBe('__test_seed_chat__')
    expect(ingestInput.scope).toEqual({ tenantId: CALLER_TENANT, organizationId: CALLER_ORG })
  })

  it('never invents an address anywhere in the ingested payload', async () => {
    await POST(ingestRequest())

    const ingestInput = mockCommandExecute.mock.calls[0][1].input
    expect(JSON.stringify(ingestInput)).not.toContain('@')
    expect(ingestInput.message.senderIdentifier).toBe('1499156851487539260')
  })

  it('reports the ingest outcome verbatim', async () => {
    const response = await POST(ingestRequest())

    expect(await response.json()).toEqual({
      status: 'created',
      messageId: 'message-1',
      conversationId: 'conversation-1',
      channelLinkId: 'link-1',
      channelType: 'discord',
    })
  })

  it('refuses to ingest against a channel connected with the email-shaped stub', async () => {
    // Ingest does not verify that providerKey matches the channel it names, so
    // accepting an email-flavored channel here would silently stamp the wrong
    // provider onto the link — and normalizeInbound would throw anyway.
    mockFindOneWithDecryption.mockResolvedValue({
      id: CHANNEL_ID,
      userId: CALLER_USER,
      providerKey: '__test_seed__',
      channelType: 'email',
      externalIdentifier: 'seed@test-seed.local',
    })

    const response = await POST(ingestRequest())

    expect(response.status).toBe(422)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('refuses to ingest against a channel the caller does not own', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const response = await POST(ingestRequest())

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })
})
