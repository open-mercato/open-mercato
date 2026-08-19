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

import { POST } from '../route'

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
