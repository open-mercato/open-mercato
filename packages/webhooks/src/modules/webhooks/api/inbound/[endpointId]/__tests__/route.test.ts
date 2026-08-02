/** @jest-environment node */

const mockCreateRequestContainer = jest.fn()
const mockResolveTranslations = jest.fn()
const mockEmitWebhooksEvent = jest.fn()
const mockGetWebhookEndpointAdapter = jest.fn()
const mockIsWebhookIntegrationEnabled = jest.fn()

const mockPersistedEntities: unknown[] = []

const mockRouteEm = {
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
  persist: jest.fn((entity: unknown) => {
    mockPersistedEntities.push(entity)
    return mockRouteEm
  }),
  flush: jest.fn(async () => undefined),
}

const mockRootEm = {
  fork: jest.fn(() => mockRouteEm),
}

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return mockRootEm
    throw new Error(`Unexpected dependency: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: () => mockResolveTranslations(),
}))

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => mockEmitWebhooksEvent(...args),
}))

jest.mock('../../../../lib/adapter-registry', () => ({
  getWebhookEndpointAdapter: (...args: unknown[]) => mockGetWebhookEndpointAdapter(...args),
}))

jest.mock('../../../../lib/integration-state', () => ({
  isWebhookIntegrationEnabled: (...args: unknown[]) => mockIsWebhookIntegrationEnabled(...args),
  WEBHOOK_INTEGRATION_DISABLED_MESSAGE: 'Custom Webhooks integration is disabled',
}))

jest.mock('../../../helpers', () => ({
  json: (payload: unknown, init: ResponseInit = { status: 200 }) =>
    new Response(JSON.stringify(payload), {
      ...init,
      headers: { 'content-type': 'application/json' },
    }),
}))

import type { WebhookEndpointAdapter } from '../../../../lib/adapter-registry'
import { POST, buildInboundRateLimitKey, resolveInboundReceiptMessageId } from '../route'

const routeContext = { params: Promise.resolve({ endpointId: 'mock_inbound' }) }

function createRequest(body: string = '{"ok":true}') {
  return new Request('http://localhost/api/webhooks/inbound/mock_inbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg-1',
    },
    body,
  })
}

function createAdapter(
  verified: Awaited<ReturnType<WebhookEndpointAdapter['verifyWebhook']>>,
  overrides: Partial<WebhookEndpointAdapter> = {},
): WebhookEndpointAdapter {
  return {
    providerKey: 'mock_inbound',
    subscribedEvents: ['*'],
    verifyWebhook: jest.fn(async () => verified),
    processInbound: jest.fn(async () => undefined),
    ...overrides,
  }
}

describe('POST', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPersistedEntities.length = 0
    mockCreateRequestContainer.mockResolvedValue(mockContainer)
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? '',
    })
    mockIsWebhookIntegrationEnabled.mockResolvedValue(true)
  })

  it('rejects verified inbound webhooks without tenant and organization scope before side effects', async () => {
    mockGetWebhookEndpointAdapter.mockReturnValue(createAdapter({
      eventType: 'mock.inbound.received',
      payload: { ok: true },
    }))

    const response = await POST(createRequest(), routeContext)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Custom Webhooks integration is disabled',
    })
    expect(mockIsWebhookIntegrationEnabled).not.toHaveBeenCalled()
    expect(mockRouteEm.persist).not.toHaveBeenCalled()
    expect(mockRouteEm.flush).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it.each([
    ['tenant only', { tenantId: 'tenant-1' }],
    ['organization only', { organizationId: 'org-1' }],
  ] as const)('rejects verified inbound webhooks with partial scope before side effects: %s', async (_label, partialScope) => {
    mockGetWebhookEndpointAdapter.mockReturnValue(createAdapter({
      eventType: 'mock.inbound.received',
      payload: { ok: true },
      ...partialScope,
    }))

    const response = await POST(createRequest(), routeContext)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Custom Webhooks integration is disabled',
    })
    expect(mockIsWebhookIntegrationEnabled).not.toHaveBeenCalled()
    expect(mockRouteEm.persist).not.toHaveBeenCalled()
    expect(mockRouteEm.flush).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it('allows adapters that explicitly opt in to unscoped inbound events', async () => {
    mockGetWebhookEndpointAdapter.mockReturnValue(createAdapter(
      {
        eventType: 'mock.inbound.received',
        payload: { ok: true },
      },
      { allowUnscopedInbound: true },
    ))

    const response = await POST(createRequest(), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockIsWebhookIntegrationEnabled).not.toHaveBeenCalled()
    expect(mockPersistedEntities).toEqual([
      expect.objectContaining({
        endpointId: 'mock_inbound',
        messageId: 'msg-1',
        providerKey: 'mock_inbound',
        eventType: 'mock.inbound.received',
        tenantId: null,
        organizationId: null,
      }),
    ])
    expect(mockEmitWebhooksEvent).toHaveBeenCalledWith(
      'webhooks.inbound.received',
      expect.objectContaining({
        providerKey: 'mock_inbound',
        endpointId: 'mock_inbound',
        messageId: 'msg-1',
        eventType: 'mock.inbound.received',
        tenantId: null,
        organizationId: null,
      }),
      { persistent: true },
    )
  })

  it('rejects scoped inbound webhooks before side effects when the integration is disabled', async () => {
    mockIsWebhookIntegrationEnabled.mockResolvedValue(false)
    mockGetWebhookEndpointAdapter.mockReturnValue(createAdapter({
      eventType: 'mock.inbound.received',
      payload: { ok: true },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }))

    const response = await POST(createRequest(), routeContext)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Custom Webhooks integration is disabled',
    })
    expect(mockIsWebhookIntegrationEnabled).toHaveBeenCalledWith(mockRouteEm, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(mockRouteEm.persist).not.toHaveBeenCalled()
    expect(mockRouteEm.flush).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it('persists and emits scoped inbound webhooks when the integration is enabled', async () => {
    mockGetWebhookEndpointAdapter.mockReturnValue(createAdapter({
      eventType: 'mock.inbound.received',
      payload: { ok: true },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }))

    const response = await POST(createRequest(), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockIsWebhookIntegrationEnabled).toHaveBeenCalledWith(mockRouteEm, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(mockPersistedEntities).toEqual([
      expect.objectContaining({
        endpointId: 'mock_inbound',
        messageId: 'msg-1',
        providerKey: 'mock_inbound',
        eventType: 'mock.inbound.received',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    ])
    expect(mockEmitWebhooksEvent).toHaveBeenCalledWith(
      'webhooks.inbound.received',
      expect.objectContaining({
        providerKey: 'mock_inbound',
        endpointId: 'mock_inbound',
        messageId: 'msg-1',
        eventType: 'mock.inbound.received',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
      { persistent: true },
    )
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
