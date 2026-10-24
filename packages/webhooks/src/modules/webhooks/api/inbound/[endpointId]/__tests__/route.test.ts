/** @jest-environment node */

import { buildWebhookHeaders, verifyWebhookSignature } from '@open-mercato/shared/lib/webhooks'

const mockCreateRequestContainer = jest.fn()
const mockResolveTranslations = jest.fn()
const mockEmitWebhooksEvent = jest.fn()
const mockGetWebhookEndpointAdapter = jest.fn()
const mockIsWebhookIntegrationEnabled = jest.fn()

type MockRecord = Record<string, unknown>
type MockEntityManager = {
  fork: () => MockEntityManager
  create: (entity: unknown, data: MockRecord) => MockRecord
  persist: (entity: MockRecord) => MockEntityManager
  flush: () => Promise<void>
  findOne: (entity: unknown, where: MockRecord) => Promise<MockRecord | null>
  transactional: <Result>(operation: (transaction: MockEntityManager) => Promise<Result>) => Promise<Result>
}

const mockPersistedEntities: MockRecord[] = []

const mockRouteEm: MockEntityManager = {
  fork: () => mockRouteEm,
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
  persist: jest.fn((entity: MockRecord) => {
    if (entity.endpointId && mockPersistedEntities.some((record) => (
      record.endpointId === entity.endpointId && record.messageId === entity.messageId
    ))) {
      throw { code: '23505' }
    }
    mockPersistedEntities.push(entity)
    return mockRouteEm
  }),
  flush: jest.fn(async () => undefined),
  findOne: jest.fn(async (_entity: unknown, where: MockRecord) => (
    mockPersistedEntities.find((record) => Object.entries(where).every(([key, value]) => record[key] === value)) ?? null
  )),
  transactional: async (operation) => {
    const snapshot = structuredClone(mockPersistedEntities)
    try {
      const result = await operation(mockRouteEm)
      await mockRouteEm.flush()
      return result
    } catch (error) {
      mockPersistedEntities.splice(0, mockPersistedEntities.length, ...snapshot)
      throw error
    }
  },
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (manager: MockEntityManager, entity: unknown, where: MockRecord) => manager.findOne(entity, where),
}))

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => mockEmitWebhooksEvent(...args),
}))

jest.mock('../../../../lib/queue', () => ({
  enqueueInboundDispatch: jest.fn(async () => 'job-1'),
  ensureLocalInboundQueueWorkerStarted: jest.fn(async () => undefined),
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

function createRequest(body: string = '{"ok":true}', headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/webhooks/inbound/mock_inbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg-1',
      ...headers,
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

function signedLegacyWebhook() {
  const body = '{"ok":true}'
  const secret = `whsec_${Buffer.from('inbound-receipt-test-secret').toString('base64')}`
  const headers = buildWebhookHeaders('msg-signed-retry', Math.floor(Date.now() / 1000), body, secret)
  const adapter = createAdapter({
    eventType: 'mock.inbound.received',
    payload: { ok: true },
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  })
  adapter.verifyWebhook = jest.fn(async (request) => {
    const verification = verifyWebhookSignature(
      request.headers['webhook-id'],
      request.headers['webhook-timestamp'],
      request.body,
      request.headers['webhook-signature'],
      [secret],
    )
    if (!verification.valid) throw new Error('[internal] Invalid test signature')
    return {
      eventType: 'mock.inbound.received',
      payload: { ok: true },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }
  })
  mockGetWebhookEndpointAdapter.mockReturnValue(adapter)
  return { adapter, request: () => createRequest(body, headers) }
}

describe('POST', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmitWebhooksEvent.mockReset()
    mockEmitWebhooksEvent.mockResolvedValue(undefined)
    mockPersistedEntities.length = 0
    mockCreateRequestContainer.mockResolvedValue(mockContainer)
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? '',
    })
    mockIsWebhookIntegrationEnabled.mockResolvedValue(true)
    mockGetWebhookEndpointAdapter.mockReturnValue(createAdapter(
      {
        eventType: 'mock.inbound.received',
        payload: { ok: true },
      },
      { allowUnscopedInbound: true },
    ))
  })

  it('rejects stale Standard Webhooks timestamps before persisting a fresh message id', async () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60)

    const response = await POST(createRequest('{"ok":true}', {
      'webhook-id': 'fresh-message-id',
      'webhook-timestamp': staleTimestamp,
      'webhook-signature': 'v1,mock',
    }), routeContext)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Webhook timestamp is outside the allowed replay window' })
    expect(mockRouteEm.persist).not.toHaveBeenCalled()
    expect(mockRouteEm.flush).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it('rejects when any present Standard or Svix timestamp header is stale', async () => {
    const now = Math.floor(Date.now() / 1000)

    const response = await POST(createRequest('{"ok":true}', {
      'webhook-id': 'fresh-message-id',
      'webhook-timestamp': String(now),
      'webhook-signature': 'v1,mock',
      'svix-timestamp': String(now - 10 * 60),
    }), routeContext)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Webhook timestamp is outside the allowed replay window' })
    expect(mockRouteEm.persist).not.toHaveBeenCalled()
    expect(mockRouteEm.flush).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it.each(['', 'not-a-number'])('rejects malformed Standard Webhooks timestamps: %j', async (timestamp) => {
    const response = await POST(createRequest('{"ok":true}', {
      'webhook-id': 'fresh-message-id',
      'webhook-timestamp': timestamp,
      'webhook-signature': 'v1,mock',
    }), routeContext)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Webhook timestamp is outside the allowed replay window' })
    expect(mockRouteEm.persist).not.toHaveBeenCalled()
    expect(mockRouteEm.flush).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it('accepts fresh Standard Webhooks timestamps', async () => {
    mockGetWebhookEndpointAdapter.mockReturnValue(createAdapter(
      {
        eventType: 'mock.inbound.received',
        payload: { ok: true },
      },
      { allowUnscopedInbound: true },
    ))
    const freshTimestamp = String(Math.floor(Date.now() / 1000))

    const response = await POST(createRequest('{"ok":true}', {
      'webhook-id': 'fresh-message-id',
      'webhook-timestamp': freshTimestamp,
      'webhook-signature': 'v1,mock',
    }), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockRouteEm.persist).toHaveBeenCalledTimes(1)
    expect(mockPersistedEntities[0]).toEqual(expect.objectContaining({ receivedEventPublished: true }))
    expect(mockEmitWebhooksEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized declared body before adapter verification', async () => {
    const adapter = createAdapter({
      eventType: 'mock.inbound.received',
      payload: { ok: true },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    mockGetWebhookEndpointAdapter.mockReturnValue(adapter)
    const request = new Request('http://localhost/api/webhooks/inbound/mock_inbound', {
      method: 'POST',
      headers: { 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    })

    const response = await POST(request, routeContext)

    expect(response.status).toBe(413)
    expect(adapter.verifyWebhook).not.toHaveBeenCalled()
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

  it('retries persistent publication for the same signed legacy message after failure', async () => {
    const signed = signedLegacyWebhook()
    mockEmitWebhooksEvent.mockRejectedValueOnce(new Error('[internal] Event queue unavailable'))

    await expect(POST(signed.request(), routeContext)).rejects.toThrow('Event queue unavailable')

    expect(mockPersistedEntities).toHaveLength(1)
    const pendingReceipt = structuredClone(mockPersistedEntities[0])
    const retried = await POST(signed.request(), routeContext)

    await expect(retried.json()).resolves.toEqual({ ok: true })
    expect(pendingReceipt).toEqual(expect.objectContaining({ receivedEventPublished: false }))
    expect(mockEmitWebhooksEvent).toHaveBeenCalledTimes(2)
    expect(mockEmitWebhooksEvent.mock.calls[1]).toEqual(mockEmitWebhooksEvent.mock.calls[0])
    expect(signed.adapter.verifyWebhook).toHaveBeenCalledTimes(2)
    expect(mockPersistedEntities).toHaveLength(1)
    expect(mockPersistedEntities[0]).toEqual(expect.objectContaining({ receivedEventPublished: true }))

    const duplicate = await POST(signed.request(), routeContext)
    await expect(duplicate.json()).resolves.toEqual({ ok: true, duplicate: true })
    expect(mockEmitWebhooksEvent).toHaveBeenCalledTimes(2)
  })

  it('keeps a historical completed legacy receipt as a successful duplicate', async () => {
    mockPersistedEntities.push({
      endpointId: 'mock_inbound',
      messageId: 'msg-1',
      providerKey: 'mock_inbound',
      eventType: 'mock.inbound.received',
      tenantId: null,
      organizationId: null,
      ingestionId: null,
      dispatchQueued: true,
      receivedEventPublished: true,
    })

    const response = await POST(createRequest(), routeContext)

    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true })
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
    expect(mockRouteEm.persist).not.toHaveBeenCalled()
  })

  it('rejects a receipt key collision from another verified scope without publishing', async () => {
    const signed = signedLegacyWebhook()
    mockPersistedEntities.push({
      endpointId: 'mock_inbound',
      messageId: 'msg-signed-retry',
      providerKey: 'mock_inbound',
      eventType: 'mock.inbound.received',
      tenantId: 'another-tenant',
      organizationId: 'another-org',
      ingestionId: null,
      dispatchQueued: true,
      receivedEventPublished: false,
    })

    await expect(POST(signed.request(), routeContext)).rejects.toThrow('Inbound receipt not found in verified scope')

    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
    expect(mockPersistedEntities).toHaveLength(1)
    expect(mockPersistedEntities[0]).toEqual(expect.objectContaining({
      tenantId: 'another-tenant',
      receivedEventPublished: false,
    }))
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
