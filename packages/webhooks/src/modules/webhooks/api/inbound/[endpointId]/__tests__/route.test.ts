import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { clearWebhookEndpointAdapters, registerWebhookEndpointAdapter } from '../../../../lib/adapter-registry'
import { emitWebhooksEvent } from '../../../../events'
import { POST, resolveInboundReceiptMessageId } from '../route'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? '' })),
}))

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('../../../../lib/integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(async () => true),
}))

const mockEm = {
  create: jest.fn((Entity: new () => unknown, values: Record<string, unknown>) => Object.assign(new Entity(), values)),
  fork: jest.fn(),
  flush: jest.fn(async () => undefined),
  persist: jest.fn(),
}

const mockCreateRequestContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const mockEmitWebhooksEvent = emitWebhooksEvent as jest.MockedFunction<typeof emitWebhooksEvent>

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/webhooks/inbound/weak_inbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: '{"ok":true}',
  })
}

const routeContext = { params: Promise.resolve({ endpointId: 'weak_inbound' }) }

describe('POST inbound timestamp replay protection', () => {
  beforeEach(() => {
    clearWebhookEndpointAdapters()
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return mockEm
        throw new Error('not registered')
      },
    } as Awaited<ReturnType<typeof createRequestContainer>>)
    registerWebhookEndpointAdapter({
      providerKey: 'weak_inbound',
      subscribedEvents: ['weak.event'],
      verifyWebhook: jest.fn(async () => ({
        eventType: 'weak.event',
        payload: { accepted: true },
      })),
      processInbound: jest.fn(async () => undefined),
    })
  })

  afterEach(() => {
    clearWebhookEndpointAdapters()
  })

  it('rejects stale Standard Webhooks timestamps before persisting a fresh message id', async () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60)

    const response = await POST(request({
      'webhook-id': 'fresh-message-id',
      'webhook-timestamp': staleTimestamp,
      'webhook-signature': 'v1,mock',
    }), routeContext)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Webhook timestamp is outside the allowed replay window' })
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it('rejects when any present Standard or Svix timestamp header is stale', async () => {
    const now = Math.floor(Date.now() / 1000)

    const response = await POST(request({
      'webhook-id': 'fresh-message-id',
      'webhook-timestamp': String(now),
      'webhook-signature': 'v1,mock',
      'svix-timestamp': String(now - 10 * 60),
    }), routeContext)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Webhook timestamp is outside the allowed replay window' })
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it('accepts fresh Standard Webhooks timestamps', async () => {
    const freshTimestamp = String(Math.floor(Date.now() / 1000))

    const response = await POST(request({
      'webhook-id': 'fresh-message-id',
      'webhook-timestamp': freshTimestamp,
      'webhook-signature': 'v1,mock',
    }), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockEm.persist).toHaveBeenCalledTimes(1)
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
    expect(mockEmitWebhooksEvent).toHaveBeenCalledTimes(1)
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
