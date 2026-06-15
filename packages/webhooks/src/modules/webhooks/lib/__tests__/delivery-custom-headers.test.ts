import type { EntityManager } from '@mikro-orm/postgresql'
import { processWebhookDeliveryJob } from '../delivery'
import { isReservedWebhookCustomHeader, sanitizeWebhookCustomHeaders } from '../custom-headers'

jest.mock('../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(async () => true),
  WEBHOOK_INTEGRATION_DISABLED_MESSAGE: 'disabled',
}))

jest.mock('@open-mercato/shared/lib/webhooks', () => ({
  buildWebhookHeaders: jest.fn(() => ({
    'webhook-id': 'msg-1',
    'webhook-timestamp': '1700000000',
    'webhook-signature': 'v1,legitimate-signature',
  })),
  generateMessageId: jest.fn(() => 'msg-1'),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

describe('isReservedWebhookCustomHeader', () => {
  it('reserves webhook-* and content-type case-insensitively', () => {
    expect(isReservedWebhookCustomHeader('webhook-signature')).toBe(true)
    expect(isReservedWebhookCustomHeader('Webhook-Id')).toBe(true)
    expect(isReservedWebhookCustomHeader('WEBHOOK-TIMESTAMP')).toBe(true)
    expect(isReservedWebhookCustomHeader(' webhook-signature ')).toBe(true)
    expect(isReservedWebhookCustomHeader('Content-Type')).toBe(true)
    expect(isReservedWebhookCustomHeader('x-custom-header')).toBe(false)
    expect(isReservedWebhookCustomHeader('authorization')).toBe(false)
  })
})

describe('sanitizeWebhookCustomHeaders', () => {
  it('strips reserved headers and keeps the rest', () => {
    expect(sanitizeWebhookCustomHeaders({
      'Webhook-Signature': 'forged',
      'webhook-id': 'constant',
      'Content-Type': 'text/plain',
      'x-api-key': 'value',
    })).toEqual({ 'x-api-key': 'value' })
  })

  it('returns an empty object for null or undefined', () => {
    expect(sanitizeWebhookCustomHeaders(null)).toEqual({})
    expect(sanitizeWebhookCustomHeaders(undefined)).toEqual({})
  })
})

describe('processWebhookDeliveryJob — custom headers cannot override signed headers', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS = '1'
    globalThis.fetch = jest.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS
  })

  function buildDelivery() {
    return {
      id: 'delivery-1',
      tenantId: 't',
      organizationId: 'o',
      webhookId: 'w-1',
      status: 'pending',
      payload: { type: 'x', timestamp: new Date().toISOString(), data: {} },
      enqueuedAt: new Date(),
      eventType: 'x',
      maxAttempts: 3,
      attemptNumber: 0,
      messageId: 'msg-1',
      responseBody: null,
      responseHeaders: null,
      responseStatus: null,
      nextRetryAt: null,
      errorMessage: null,
      lastAttemptAt: null,
      deliveredAt: null,
      durationMs: null,
    }
  }

  function buildWebhook(customHeaders: Record<string, string> | null) {
    return {
      id: 'w-1',
      url: 'http://127.0.0.1:3001/hook',
      isActive: true,
      timeoutMs: 1000,
      httpMethod: 'POST',
      customHeaders,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      autoDisableThreshold: 0,
      maxRetries: 3,
      secret: 'secret',
      previousSecret: null,
      tenantId: 't',
      organizationId: 'o',
    }
  }

  function buildEm(delivery: Record<string, unknown>) {
    return {
      findOne: jest.fn(async () => delivery),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
  }

  it('sends signed headers even when customHeaders tries to override them', async () => {
    const delivery = buildDelivery()
    const webhook = buildWebhook({
      'webhook-signature': 'forged-signature',
      'Webhook-Id': 'pinned-id',
      'WEBHOOK-TIMESTAMP': '0',
      'content-type': 'text/plain',
      'x-api-key': 'tenant-value',
    })
    findOneWithDecryptionMock.mockResolvedValueOnce(webhook as never)

    const em = buildEm(delivery)
    const result = await processWebhookDeliveryJob(em, {
      deliveryId: 'delivery-1',
      tenantId: 't',
      organizationId: 'o',
    }, { scheduleRetries: false })

    expect(result?.status).toBe('delivered')
    expect((globalThis.fetch as jest.Mock).mock.calls).toHaveLength(1)
    const sentHeaders = new Headers((globalThis.fetch as jest.Mock).mock.calls[0][1].headers)
    expect(sentHeaders.get('webhook-signature')).toBe('v1,legitimate-signature')
    expect(sentHeaders.get('webhook-id')).toBe('msg-1')
    expect(sentHeaders.get('webhook-timestamp')).toBe('1700000000')
    expect(sentHeaders.get('content-type')).toBe('application/json')
    expect(sentHeaders.get('x-api-key')).toBe('tenant-value')
  })

  it('still applies non-reserved custom headers', async () => {
    const delivery = buildDelivery()
    const webhook = buildWebhook({ authorization: 'Bearer receiver-token' })
    findOneWithDecryptionMock.mockResolvedValueOnce(webhook as never)

    const em = buildEm(delivery)
    const result = await processWebhookDeliveryJob(em, {
      deliveryId: 'delivery-1',
      tenantId: 't',
      organizationId: 'o',
    }, { scheduleRetries: false })

    expect(result?.status).toBe('delivered')
    const sentHeaders = new Headers((globalThis.fetch as jest.Mock).mock.calls[0][1].headers)
    expect(sentHeaders.get('authorization')).toBe('Bearer receiver-token')
    expect(sentHeaders.get('webhook-signature')).toBe('v1,legitimate-signature')
  })
})
