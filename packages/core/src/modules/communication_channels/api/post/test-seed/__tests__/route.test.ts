/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockEmitEvent = jest.fn()
const mockExecute = jest.fn()
const mockLoadAcl = jest.fn()

const mockCommandExecute = jest.fn()

const mockEm = {
  fork: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  getConnection: jest.fn(() => ({ execute: mockExecute })),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { loadAcl: mockLoadAcl }
    if (token === 'commandBus') return { execute: (...args: unknown[]) => mockCommandExecute(...args) }
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
  emitCommunicationChannelsEvent: (...args: unknown[]) => mockEmitEvent(...args),
}))

jest.mock('../../../../lib/test-seed', () => ({
  TEST_SEED_PROVIDER_KEY: '__test_seed__',
  TEST_SEED_CHAT_PROVIDER_KEY: '__test_seed_chat__',
  ensureTestSeedAdapterRegistered: jest.fn(),
  isTestChannelSeedingEnabled: () => true,
}))

import { POST } from '../route'

const CALLER_USER = 'caller-user-id'
const OTHER_USER = 'other-user-id'
const CALLER_TENANT = '11111111-1111-4111-8111-111111111111'
const CALLER_ORG = '22222222-2222-4222-8222-222222222222'
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333'

function emitInboundRequest(channelId: string): Request {
  return new Request('http://localhost/api/communication_channels/test-seed', {
    method: 'POST',
    body: JSON.stringify({ action: 'emit-inbound', channelId, subject: 'seeded' }),
  })
}

function expectNothingSeeded(): void {
  expect(mockEm.create).not.toHaveBeenCalled()
  expect(mockEm.persist).not.toHaveBeenCalled()
  expect(mockExecute).not.toHaveBeenCalled()
  expect(mockEmitEvent).not.toHaveBeenCalled()
}

describe('POST /api/communication_channels/test-seed — emit-inbound channel authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      id: 'created-row-id',
      ...data,
    }))
    mockEm.flush.mockResolvedValue(undefined)
    mockEm.getConnection.mockReturnValue({ execute: mockExecute })
    mockExecute.mockResolvedValue([{ id: 'seeded-message-id' }])
    mockEmitEvent.mockResolvedValue(undefined)
    mockCreateRequestContainer.mockResolvedValue(mockContainer)
    mockLoadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['communication_channels.connect_user_channel'],
      organizations: null,
    })
    mockGetAuthFromRequest.mockResolvedValue({
      sub: CALLER_USER,
      tenantId: CALLER_TENANT,
      orgId: CALLER_ORG,
    })
  })

  it('rejects a channelId outside the caller tenant/org with 404 and seeds nothing', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const res = await POST(emitInboundRequest(CHANNEL_ID))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Channel not found' })
    expectNothingSeeded()
  })

  it('scopes the ownership lookup to the caller tenant/org and excludes soft-deleted channels', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    await POST(emitInboundRequest(CHANNEL_ID))

    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption.mock.calls[0][2]).toEqual({
      id: CHANNEL_ID,
      tenantId: CALLER_TENANT,
      organizationId: CALLER_ORG,
      deletedAt: null,
    })
  })

  it('rejects a same-tenant personal mailbox owned by another user with 404 and seeds nothing', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: CHANNEL_ID,
      tenantId: CALLER_TENANT,
      organizationId: CALLER_ORG,
      userId: OTHER_USER,
    })

    const res = await POST(emitInboundRequest(CHANNEL_ID))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Channel not found' })
    expectNothingSeeded()
  })

  it('rejects a shared channel when the caller lacks the elevated manage feature', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: CHANNEL_ID,
      tenantId: CALLER_TENANT,
      organizationId: CALLER_ORG,
      userId: null,
    })

    const res = await POST(emitInboundRequest(CHANNEL_ID))

    expect(res.status).toBe(404)
    expectNothingSeeded()
  })

  it('allows a shared channel when the caller holds communication_channels.manage', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: CHANNEL_ID,
      tenantId: CALLER_TENANT,
      organizationId: CALLER_ORG,
      userId: null,
    })
    mockLoadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['communication_channels.manage'],
      organizations: null,
    })

    const res = await POST(emitInboundRequest(CHANNEL_ID))

    expect(res.status).toBe(201)
    expect(mockEmitEvent).toHaveBeenCalledTimes(1)
  })

  it('still seeds the inbound rows and emits the hub event for the mailbox owner', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: CHANNEL_ID,
      tenantId: CALLER_TENANT,
      organizationId: CALLER_ORG,
      userId: CALLER_USER,
    })

    const res = await POST(emitInboundRequest(CHANNEL_ID))

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({
      channelLinkId: 'created-row-id',
      messageId: 'seeded-message-id',
      conversationId: 'created-row-id',
    })
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'communication_channels.message.received',
      expect.objectContaining({ channelId: CHANNEL_ID, tenantId: CALLER_TENANT }),
      { persistent: true },
    )
  })
})


/**
 * The `connect-channel` action's provider-key relabelling.
 *
 * It exists because a real channel for a provider package cannot be connected in
 * CI — the Discord adapter validates its bot token against the live API — so a
 * route that filters on that provider key would otherwise only ever be asserted
 * against an empty result. That is precisely the assertion that stayed green
 * while the AI auto-reply panel could list nothing at all (#5602).
 */
describe('POST /api/communication_channels/test-seed — connect-channel provider labelling', () => {
  function connectRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost/api/communication_channels/test-seed', {
      method: 'POST',
      body: JSON.stringify({ action: 'connect-channel', ...body }),
    })
  }

  let connectedRow: { id: string; providerKey: string }

  beforeEach(() => {
    jest.clearAllMocks()
    connectedRow = { id: CHANNEL_ID, providerKey: '__test_seed_chat__' }
    mockEm.fork.mockReturnValue(mockEm)
    mockFindOneWithDecryption.mockResolvedValue(connectedRow)
    mockEm.flush.mockResolvedValue(undefined)
    mockCreateRequestContainer.mockResolvedValue(mockContainer)
    mockCommandExecute.mockResolvedValue({
      result: { status: 'connected', channelId: CHANNEL_ID, externalIdentifier: null },
    })
    mockGetAuthFromRequest.mockResolvedValue({
      sub: CALLER_USER,
      tenantId: CALLER_TENANT,
      orgId: CALLER_ORG,
    })
  })

  it('connects the stub adapter, never the named provider’s own', async () => {
    await POST(connectRequest({ providerFlavor: 'chat', labelAsProviderKey: 'discord' }))

    const [, args] = mockCommandExecute.mock.calls[0]
    expect(args.input.providerKey).toBe('__test_seed_chat__')
  })

  it('relabels the connected row and reports the key it ended up with', async () => {
    const res = await POST(connectRequest({ providerFlavor: 'chat', labelAsProviderKey: 'discord' }))

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({
      channelId: CHANNEL_ID,
      providerKey: 'discord',
    })
    expect(connectedRow.providerKey).toBe('discord')
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption.mock.calls[0][2]).toEqual({
      id: CHANNEL_ID,
      tenantId: CALLER_TENANT,
    })
  })

  it('leaves the row alone when no relabelling was asked for', async () => {
    const res = await POST(connectRequest({ providerFlavor: 'chat' }))

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ providerKey: '__test_seed_chat__' })
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('rejects a provider key that is not a plain provider identifier', async () => {
    const res = await POST(connectRequest({ labelAsProviderKey: "discord'; DROP TABLE" }))

    expect(res.status).toBe(422)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })
})
