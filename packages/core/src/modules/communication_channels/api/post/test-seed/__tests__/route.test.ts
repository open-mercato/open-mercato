/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockEmitEvent = jest.fn()
const mockExecute = jest.fn()

const mockEm = {
  fork: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  getConnection: jest.fn(() => ({ execute: mockExecute })),
}

const mockContainer = {
  resolve: jest.fn((token: string) => (token === 'em' ? mockEm : undefined)),
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
  ensureTestSeedAdapterRegistered: jest.fn(),
  isTestChannelSeedingEnabled: () => true,
}))

import { POST } from '../route'

const CALLER_TENANT = '11111111-1111-4111-8111-111111111111'
const CALLER_ORG = '22222222-2222-4222-8222-222222222222'
const FOREIGN_CHANNEL = '33333333-3333-4333-8333-333333333333'

function emitInboundRequest(channelId: string): Request {
  return new Request('http://localhost/api/communication_channels/test-seed', {
    method: 'POST',
    body: JSON.stringify({ action: 'emit-inbound', channelId, subject: 'seeded' }),
  })
}

describe('POST /api/communication_channels/test-seed — emit-inbound channel ownership', () => {
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
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: CALLER_TENANT,
      orgId: CALLER_ORG,
    })
  })

  it('rejects a channelId the caller does not own with 404 and seeds nothing', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const res = await POST(emitInboundRequest(FOREIGN_CHANNEL))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Channel not found' })
    // No conversation, message, link, or mapping may reference a foreign channel.
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  it('scopes the ownership lookup to the caller tenant/org and excludes soft-deleted channels', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    await POST(emitInboundRequest(FOREIGN_CHANNEL))

    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption.mock.calls[0][2]).toEqual({
      id: FOREIGN_CHANNEL,
      tenantId: CALLER_TENANT,
      organizationId: CALLER_ORG,
      deletedAt: null,
    })
  })

  it('still seeds the inbound rows and emits the hub event for an owned channel', async () => {
    const ownedChannel = '44444444-4444-4444-8444-444444444444'
    mockFindOneWithDecryption.mockResolvedValue({
      id: ownedChannel,
      tenantId: CALLER_TENANT,
      organizationId: CALLER_ORG,
    })

    const res = await POST(emitInboundRequest(ownedChannel))

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({
      channelLinkId: 'created-row-id',
      messageId: 'seeded-message-id',
      conversationId: 'created-row-id',
    })
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'communication_channels.message.received',
      expect.objectContaining({ channelId: ownedChannel, tenantId: CALLER_TENANT }),
      { persistent: true },
    )
  })
})
