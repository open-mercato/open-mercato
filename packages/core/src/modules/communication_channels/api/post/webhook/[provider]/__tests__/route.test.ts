/** @jest-environment node */

const mockFindWithDecryption = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockRegistryGet = jest.fn()
const mockEnqueue = jest.fn()
const mockCredentialsResolve = jest.fn()

const mockEm = {
  fork: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'integrationCredentialsService') {
      return { resolve: mockCredentialsResolve }
    }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('../../../../../lib/adapter-registry-singleton', () => ({
  getChannelAdapterRegistry: () => ({ get: mockRegistryGet }),
}))

jest.mock('../../../../../lib/queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: {
    inbound: 'communication_channels.inbound',
    reactions: 'communication_channels.reactions',
  },
  getCommunicationChannelsQueue: () => ({ enqueue: mockEnqueue }),
}))

import { GET, POST } from '../route'

describe('POST /api/communication_channels/webhook/[provider]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockCreateRequestContainer.mockResolvedValue(mockContainer)
    mockCredentialsResolve.mockResolvedValue({})
    mockEnqueue.mockResolvedValue(undefined)
  })

  it('rejects an oversized declared body before adapter verification', async () => {
    const verifyWebhook = jest.fn()
    mockRegistryGet.mockReturnValue({ verifyWebhook })
    const request = new Request('http://localhost/api/communication_channels/webhook/test', {
      method: 'POST',
      headers: { 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    })

    const response = await POST(request, { params: Promise.resolve({ provider: 'test' }) })

    expect(response.status).toBe(413)
    expect(verifyWebhook).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('does not cap provider webhook verification to the newest 50 channels', async () => {
    const candidates = Array.from({ length: 60 }, (_, index) => {
      const n = String(index + 1).padStart(3, '0')
      return {
        id: `channel-${n}`,
        providerKey: 'test',
        channelType: 'email',
        tenantId: `tenant-${n}`,
        organizationId: null,
        userId: null,
        credentialsRef: null,
      }
    })
    mockFindWithDecryption.mockImplementation(
      async (
        _em: unknown,
        _entity: unknown,
        _where: unknown,
        options?: { limit?: number },
      ) => candidates.slice(0, options?.limit ?? candidates.length),
    )
    mockRegistryGet.mockReturnValue({
      verifyWebhook: jest.fn(async ({ scope }: { scope: { tenantId: string } }) => {
        if (scope.tenantId === 'tenant-060') {
          return { eventType: 'message', raw: { ok: true } }
        }
        throw new Error('signature mismatch')
      }),
    })

    const response = await POST(
      new Request('http://localhost/api/communication_channels/webhook/test', {
        method: 'POST',
        body: '{"ok":true}',
      }),
      { params: Promise.resolve({ provider: 'test' }) },
    )

    expect(response.status).toBe(202)
    expect(mockFindWithDecryption.mock.calls[0][3]).not.toHaveProperty('limit')
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-060',
        // Ingest scope uses the channel's REAL org (null here), matching the poll
        // and dedicated gmail webhook path — NOT the tenantId fallback
        // that `candidateScope` uses for credential/verify lookups (that fallback
        // must not leak into ingest, or dedup diverges for null-org channels).
        scope: { tenantId: 'tenant-060', organizationId: null },
      }),
    )
  })
})

describe('GET /api/communication_channels/webhook/[provider]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockCreateRequestContainer.mockResolvedValue(mockContainer)
    mockCredentialsResolve.mockResolvedValue({})
  })

  const subscribeRequest = () =>
    new Request(
      'http://localhost/api/communication_channels/webhook/whatsapp'
      + '?hub.mode=subscribe&hub.verify_token=token-1&hub.challenge=challenge-1',
      { method: 'GET' },
    )

  it('returns 404 for an unknown provider', async () => {
    mockRegistryGet.mockReturnValue(undefined)
    const response = await GET(subscribeRequest(), { params: Promise.resolve({ provider: 'whatsapp' }) })
    expect(response.status).toBe(404)
  })

  it('returns 405 when the provider has no subscription handshake', async () => {
    mockRegistryGet.mockReturnValue({ verifyWebhook: jest.fn() })
    const response = await GET(subscribeRequest(), { params: Promise.resolve({ provider: 'whatsapp' }) })
    expect(response.status).toBe(405)
  })

  it('echoes the challenge from the candidate channel whose token verifies', async () => {
    mockFindWithDecryption.mockResolvedValue([
      { id: 'channel-a', tenantId: 'tenant-a', organizationId: null, userId: null, credentialsRef: 'ref-a' },
      { id: 'channel-b', tenantId: 'tenant-b', organizationId: null, userId: null, credentialsRef: 'ref-b' },
    ])
    mockCredentialsResolve.mockImplementation(async (_service: string, scope: { tenantId: string }) => ({
      verifyToken: scope.tenantId === 'tenant-b' ? 'token-1' : 'other',
    }))
    mockRegistryGet.mockReturnValue({
      verifyWebhookSubscription: jest.fn(async ({ query, credentials }: {
        query: Record<string, string>
        credentials: Record<string, unknown>
      }) => {
        if (query['hub.verify_token'] !== credentials.verifyToken) throw new Error('token mismatch')
        return { challenge: query['hub.challenge'] }
      }),
    })

    const response = await GET(subscribeRequest(), { params: Promise.resolve({ provider: 'whatsapp' }) })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('challenge-1')
  })

  it('returns 401 when no candidate channel accepts the token', async () => {
    mockFindWithDecryption.mockResolvedValue([
      { id: 'channel-a', tenantId: 'tenant-a', organizationId: null, userId: null, credentialsRef: 'ref-a' },
    ])
    mockCredentialsResolve.mockResolvedValue({ verifyToken: 'other' })
    mockRegistryGet.mockReturnValue({
      verifyWebhookSubscription: jest.fn(async () => {
        throw new Error('token mismatch')
      }),
    })

    const response = await GET(subscribeRequest(), { params: Promise.resolve({ provider: 'whatsapp' }) })
    expect(response.status).toBe(401)
  })
})
