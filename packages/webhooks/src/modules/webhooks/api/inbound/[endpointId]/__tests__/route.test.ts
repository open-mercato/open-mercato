const mockVerifyWebhook = jest.fn()
const mockFork = jest.fn(() => ({}))
const mockResolve = jest.fn((token: string) => {
  if (token === 'em') return { fork: mockFork }
  throw new Error(`Unexpected token: ${token}`)
})

jest.mock('../../../../lib/adapter-registry', () => ({
  getWebhookEndpointAdapter: jest.fn(() => ({
    providerKey: 'mock',
    verifyWebhook: mockVerifyWebhook,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { POST, buildInboundRateLimitKey, resolveInboundReceiptMessageId } from '../route'

describe('POST /api/webhooks/inbound/[endpointId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects an oversized declared body before adapter verification', async () => {
    const request = new Request('http://localhost/api/webhooks/inbound/mock', {
      method: 'POST',
      headers: { 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    })

    const response = await POST(request, { params: Promise.resolve({ endpointId: 'mock' }) })

    expect(response.status).toBe(413)
    expect(mockVerifyWebhook).not.toHaveBeenCalled()
  })
})

describe('buildInboundRateLimitKey', () => {
  it('uses an endpoint-global bucket when proxy headers are untrusted', () => {
    const request = new Request('http://localhost/api/webhooks/inbound/mock', {
      headers: {
        'x-forwarded-for': '203.0.113.1',
        'x-real-ip': '198.51.100.10',
      },
    })

    expect(buildInboundRateLimitKey('mock_inbound', request, 0)).toBe('mock_inbound:global')
  })

  it('uses a trusted proxy-derived IP when trust depth is configured', () => {
    const request = new Request('http://localhost/api/webhooks/inbound/mock', {
      headers: {
        'x-forwarded-for': '203.0.113.1, 198.51.100.10',
        'x-real-ip': '192.0.2.5',
      },
    })

    expect(buildInboundRateLimitKey('mock_inbound', request, 1)).toBe('mock_inbound:ip:198.51.100.10')
  })
})

describe('resolveInboundReceiptMessageId', () => {
  it('prefers explicit webhook ids when present', () => {
    expect(
      resolveInboundReceiptMessageId({
        endpointId: 'mock_inbound',
        providerKey: 'mock',
        headers: {
          'webhook-id': 'msg-123',
          'webhook-timestamp': '1700000000',
        },
        body: '{"ok":true}',
      })
    ).toBe('msg-123')
  })

  it('derives a stable fallback id from provider, endpoint, timestamp, and body', () => {
    const first = resolveInboundReceiptMessageId({
      endpointId: 'mock_inbound',
      providerKey: 'mock',
      headers: {
        'webhook-timestamp': '1700000000',
      },
      body: '{"ok":true}',
    })

    const second = resolveInboundReceiptMessageId({
      endpointId: 'mock_inbound',
      providerKey: 'mock',
      headers: {
        'webhook-timestamp': '1700000000',
      },
      body: '{"ok":true}',
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^derived:1700000000:/)
  })

  it('changes when timestamp changes', () => {
    const first = resolveInboundReceiptMessageId({
      endpointId: 'mock_inbound',
      providerKey: 'mock',
      headers: {
        'webhook-timestamp': '1700000000',
      },
      body: '{"ok":true}',
    })

    const second = resolveInboundReceiptMessageId({
      endpointId: 'mock_inbound',
      providerKey: 'mock',
      headers: {
        'webhook-timestamp': '1700000001',
      },
      body: '{"ok":true}',
    })

    expect(first).not.toBe(second)
  })
})
